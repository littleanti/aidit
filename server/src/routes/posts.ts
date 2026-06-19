import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../db.js";
import { effectiveHotScore, hotScore } from "../domain/hotScore.js";
import { createInitialSegment } from "../domain/segment.js";

// --- helpers ---------------------------------------------------------------

// Acting user is carried in the x-user-id header (L11: persisted User.id). Returns
// the id, or null after sending a 401 (caller must return immediately).
function requireUserId(req: FastifyRequest, reply: FastifyReply): string | null {
  const header = req.headers["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  if (!userId) {
    void reply.code(401).send({ error: "Missing x-user-id" });
    return null;
  }
  return userId;
}

// Feed cursor: opaque base64 of "hotScore|id" (hot) or "createdAtMs|id" (new). The
// numeric component is the keyset tie-break anchor; id breaks ties deterministically.
interface DecodedCursor {
  value: number;
  id: string;
}

function encodeCursor(value: number, id: string): string {
  return Buffer.from(`${value}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep <= 0) return null;
    const value = Number(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (!Number.isFinite(value) || id === "") return null;
    return { value, id };
  } catch {
    return null;
  }
}

const FEED_PAGE_SIZE = 20;

// Shape a post row (with community + author) into a feed card. `hotScoreOverride`
// lets the hot feed surface the read-time effective hotScore (XC-8) instead of the
// possibly-stale stored value.
// Returns the FLAT PostListItem shape (frozen contract in frontend
// api/types.ts): communitySlug/communityName/communityPersonaIcon +
// authorUsername, NOT a nested community{}/author{}. The feed card UI reads
// these flat fields; a nested shape silently blanked the community label.
function toFeedCard(
  p: {
    id: string;
    title: string;
    body: string;
    imageUrl: string | null;
    score: number;
    commentCount: number;
    hotScore: number;
    createdAt: Date;
    communityId: string;
    authorId: string;
    community: { slug: string; name: string; personaIcon: string | null };
    author: { username: string };
  },
  hotScoreOverride?: number,
) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    imageUrl: p.imageUrl,
    score: p.score,
    commentCount: p.commentCount,
    hotScore: hotScoreOverride ?? p.hotScore,
    createdAt: p.createdAt,
    communityId: p.communityId,
    communitySlug: p.community.slug,
    communityName: p.community.name,
    communityPersonaIcon: p.community.personaIcon,
    authorId: p.authorId,
    authorUsername: p.author.username,
  };
}

const feedInclude = {
  community: { select: { slug: true, name: true, personaIcon: true } },
  author: { select: { username: true } },
} as const;

// --- plugin ----------------------------------------------------------------

const plugin: FastifyPluginAsync = async (app) => {
  // BE-5: Create a post + its initial ContextSegment (index 0, isActive) atomically.
  app.post<{
    Body: {
      communityId?: string;
      title?: string;
      body?: string;
      imageUrl?: string;
    };
  }>(
    "/posts",
    async (req, reply) => {
      const userId = requireUserId(req, reply);
      if (!userId) return;

      const { communityId, title, body, imageUrl } = req.body ?? {};
      if (!communityId || !title || !body) {
        return reply
          .code(400)
          .send({ error: "communityId, title and body are required" });
      }

      const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true },
      });
      if (!community) {
        return reply.code(404).send({ error: "Community not found" });
      }

      const createdAt = new Date();
      const initialHot = hotScore(0, 0, createdAt, createdAt);

      const post = await prisma.$transaction(async (tx) => {
        const created = await tx.post.create({
          data: {
            communityId,
            authorId: userId,
            title,
            body,
            imageUrl: imageUrl ?? null,
            score: 0,
            commentCount: 0,
            hotScore: initialHot,
            createdAt,
          },
          include: feedInclude,
        });
        await createInitialSegment(tx, created.id);
        return created;
      });

      return reply.code(201).send({
        id: post.id,
        communityId: post.communityId,
        // Top-level scalar FK per the Post DTO (frontend types.ts). Mirrors the
        // GET /posts/:id fix: authorId is a required Post field, and the Thread's
        // primary-reply guard reads post.authorId. Omitting it here let a
        // POST-then-render path see an authorId-less Post (silent contract drift).
        authorId: post.authorId,
        title: post.title,
        body: post.body,
        imageUrl: post.imageUrl,
        score: post.score,
        commentCount: post.commentCount,
        hotScore: post.hotScore,
        createdAt: post.createdAt,
        community: {
          slug: post.community.slug,
          name: post.community.name,
          personaIcon: post.community.personaIcon,
        },
        author: { username: post.author.username },
      });
    },
  );

  // Home feed: ORDER BY hotScore DESC (sort=hot, default) or createdAt DESC
  // (sort=new), keyset/cursor paginated.
  app.get<{ Querystring: { sort?: string; cursor?: string } }>(
    "/posts",
    async (req, reply) => {
      const sort = req.query.sort === "new" ? "new" : "hot";
      const cursorRaw = req.query.cursor;
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      if (cursorRaw && !cursor) {
        return reply.code(400).send({ error: "Invalid cursor" });
      }

      // Keyset predicate: rows strictly "after" the cursor in the sort order.
      // For DESC ordering on (key, id) the next page is key < cursorKey, OR
      // key == cursorKey AND id < cursorId (id also DESC as a stable tie-break).
      const where =
        cursor === null
          ? {}
          : sort === "hot"
            ? {
                OR: [
                  { hotScore: { lt: cursor.value } },
                  {
                    AND: [
                      { hotScore: cursor.value },
                      { id: { lt: cursor.id } },
                    ],
                  },
                ],
              }
            : {
                OR: [
                  { createdAt: { lt: new Date(cursor.value) } },
                  {
                    AND: [
                      { createdAt: new Date(cursor.value) },
                      { id: { lt: cursor.id } },
                    ],
                  },
                ],
              };

      const orderBy =
        sort === "hot"
          ? [{ hotScore: "desc" as const }, { id: "desc" as const }]
          : [{ createdAt: "desc" as const }, { id: "desc" as const }];

      const rows = await prisma.post.findMany({
        where,
        orderBy,
        take: FEED_PAGE_SIZE + 1,
        include: feedInclude,
      });

      const hasMore = rows.length > FEED_PAGE_SIZE;
      const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;

      // Cursor anchor uses the STORED key (sort=hot → stored hotScore), keeping
      // keyset pagination consistent with the DB ORDER BY across pages (XC-8).
      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1]!;
        const anchor =
          sort === "hot" ? last.hotScore : last.createdAt.getTime();
        nextCursor = encodeCursor(anchor, last.id);
      }

      // XC-8: for the hot feed, recompute the effective hotScore at read time and
      // re-sort the in-page rows so the visible order reflects current age. The
      // stored value (and thus pagination) is untouched.
      if (sort === "hot") {
        const now = new Date();
        const withEffective = page.map((p) => ({
          row: p,
          eff: effectiveHotScore(p, now),
        }));
        withEffective.sort(
          (a, b) => b.eff - a.eff || (a.row.id < b.row.id ? 1 : -1),
        );
        return reply.send({
          items: withEffective.map((e) => toFeedCard(e.row, e.eff)),
          nextCursor,
        });
      }

      return reply.send({
        items: page.map((p) => toFeedCard(p)),
        nextCursor,
      });
    },
  );

  // Single post + community + author summary.
  // OPTIONAL x-user-id header: when present, `bookmarked` reflects whether that
  // user has bookmarked this post. No 401 — this endpoint remains public.
  app.get<{ Params: { id: string } }>("/posts/:id", async (req, reply) => {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      include: {
        community: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            personaIcon: true,
            // L6/XC-4: the AI engine reads community.personaPrompt as the ONLY
            // systemInstruction source. Omitting it left the Thread persona
            // empty so @AI / 1차 replies ran with no persona at all.
            personaPrompt: true,
          },
        },
        author: { select: { id: true, username: true } },
      },
    });
    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const actingUserHeader = req.headers["x-user-id"];
    const actingUserId = Array.isArray(actingUserHeader)
      ? actingUserHeader[0]
      : actingUserHeader;

    let bookmarked = false;
    if (actingUserId) {
      const bm = await prisma.bookmark.findUnique({
        where: { userId_postId: { userId: actingUserId, postId: post.id } },
        select: { id: true },
      });
      bookmarked = bm !== null;
    }

    return reply.send({
      id: post.id,
      // Top-level scalar FKs per the Post DTO. authorId is required by the
      // Thread's primary-reply guard (post.authorId === me) and communityId by
      // the AI engine; omitting them silently disabled the first AI reply.
      communityId: post.communityId,
      authorId: post.authorId,
      title: post.title,
      body: post.body,
      imageUrl: post.imageUrl,
      score: post.score,
      commentCount: post.commentCount,
      hotScore: post.hotScore,
      createdAt: post.createdAt,
      bookmarked,
      community: {
        id: post.community.id,
        slug: post.community.slug,
        name: post.community.name,
        description: post.community.description,
        personaIcon: post.community.personaIcon,
        // L6: required by the client AI engine (systemInstruction source).
        personaPrompt: post.community.personaPrompt,
      },
      author: { id: post.author.id, username: post.author.username },
    });
  });

  // Posts within a community (newest by default, or hot).
  app.get<{ Params: { slug: string }; Querystring: { sort?: string } }>(
    "/communities/:slug/posts",
    async (req, reply) => {
      const community = await prisma.community.findUnique({
        where: { slug: req.params.slug },
        select: { id: true },
      });
      if (!community) {
        return reply.code(404).send({ error: "Community not found" });
      }

      const sort = req.query.sort === "hot" ? "hot" : "new";
      const orderBy =
        sort === "hot"
          ? [{ hotScore: "desc" as const }, { id: "desc" as const }]
          : [{ createdAt: "desc" as const }, { id: "desc" as const }];

      const rows = await prisma.post.findMany({
        where: { communityId: community.id },
        orderBy,
        include: feedInclude,
      });

      return reply.send({ items: rows.map(toFeedCard) });
    },
  );

  // Posts authored by a user (public profile view, read-only), newest first.
  app.get<{ Params: { id: string } }>(
    "/users/:id/posts",
    async (req, reply) => {
      const rows = await prisma.post.findMany({
        where: { authorId: req.params.id },
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        include: feedInclude,
      });

      return reply.send({ items: rows.map((p) => toFeedCard(p)) });
    },
  );

  // PATCH /posts/:id — only the author may edit title, body, or imageUrl.
  app.patch<{
    Params: { id: string };
    Body: { title?: string; body?: string; imageUrl?: string | null };
  }>("/posts/:id", async (req, reply) => {
    const userId = requireUserId(req, reply);
    if (!userId) return;

    const existing = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Post not found" });
    }
    if (existing.authorId !== userId) {
      return reply.code(403).send({ error: "Only the author may edit" });
    }

    const { title, body, imageUrl } = req.body ?? {};

    if (title === undefined && body === undefined && imageUrl === undefined) {
      return reply.code(400).send({ error: "Nothing to update" });
    }

    const data: { title?: string; body?: string; imageUrl?: string | null } =
      {};

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length === 0) {
        return reply
          .code(400)
          .send({ error: "title must be a non-empty string" });
      }
      data.title = title.trim();
    }

    if (body !== undefined) {
      if (typeof body !== "string" || body.length === 0) {
        return reply
          .code(400)
          .send({ error: "body must be a non-empty string" });
      }
      data.body = body;
    }

    if (imageUrl !== undefined) {
      if (imageUrl !== null) {
        if (
          typeof imageUrl !== "string" ||
          !imageUrl.startsWith("/uploads/") ||
          imageUrl.includes("..")
        ) {
          return reply.code(400).send({ error: "Invalid imageUrl" });
        }
      }
      data.imageUrl = imageUrl;
    }

    const post = await prisma.post.update({
      where: { id: req.params.id },
      data,
      include: {
        community: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            personaIcon: true,
            // L6/XC-4: the AI engine reads community.personaPrompt as the ONLY
            // systemInstruction source. Omitting it left the Thread persona
            // empty so @AI / 1차 replies ran with no persona at all.
            personaPrompt: true,
          },
        },
        author: { select: { id: true, username: true } },
      },
    });

    return reply.send({
      id: post.id,
      communityId: post.communityId,
      authorId: post.authorId,
      title: post.title,
      body: post.body,
      imageUrl: post.imageUrl,
      score: post.score,
      commentCount: post.commentCount,
      hotScore: post.hotScore,
      createdAt: post.createdAt,
      community: {
        id: post.community.id,
        slug: post.community.slug,
        name: post.community.name,
        description: post.community.description,
        personaIcon: post.community.personaIcon,
        // L6: required by the client AI engine (systemInstruction source).
        personaPrompt: post.community.personaPrompt,
      },
      author: { id: post.author.id, username: post.author.username },
    });
  });

  // BE-9b: Upvote — increment score, recompute hotScore, persist. PoC: no dedupe.
  app.post<{ Params: { id: string } }>(
    "/posts/:id/upvote",
    async (req, reply) => {
      const userId = requireUserId(req, reply);
      if (!userId) return;

      const post = await prisma.post.findUnique({
        where: { id: req.params.id },
        select: { score: true, commentCount: true, createdAt: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      const newScore = post.score + 1;
      const newHot = hotScore(newScore, post.commentCount, post.createdAt);

      const updated = await prisma.post.update({
        where: { id: req.params.id },
        data: { score: newScore, hotScore: newHot },
        select: { id: true, score: true, hotScore: true },
      });

      return reply.send({
        id: updated.id,
        score: updated.score,
        hotScore: updated.hotScore,
      });
    },
  );

  // POST /posts/:id/bookmark — idempotent upsert; requires x-user-id.
  app.post<{ Params: { id: string } }>(
    "/posts/:id/bookmark",
    async (req, reply) => {
      const userId = requireUserId(req, reply);
      if (!userId) return;

      const post = await prisma.post.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      await prisma.bookmark.upsert({
        where: { userId_postId: { userId, postId: req.params.id } },
        create: { userId, postId: req.params.id },
        update: {},
      });

      return reply.code(201).send({ bookmarked: true });
    },
  );

  // DELETE /posts/:id/bookmark — idempotent delete; requires x-user-id.
  app.delete<{ Params: { id: string } }>(
    "/posts/:id/bookmark",
    async (req, reply) => {
      const userId = requireUserId(req, reply);
      if (!userId) return;

      await prisma.bookmark.deleteMany({
        where: { userId, postId: req.params.id },
      });

      return reply.send({ bookmarked: false });
    },
  );

  // GET /users/:id/bookmarks — public; returns bookmarked posts as feed cards,
  // ordered by bookmark createdAt DESC (most recently bookmarked first).
  app.get<{ Params: { id: string } }>(
    "/users/:id/bookmarks",
    async (req, reply) => {
      const rows = await prisma.bookmark.findMany({
        where: { userId: req.params.id },
        orderBy: { createdAt: "desc" },
        include: { post: { include: feedInclude } },
      });

      return reply.send({ items: rows.map((r) => toFeedCard(r.post)) });
    },
  );
};

export default plugin;
