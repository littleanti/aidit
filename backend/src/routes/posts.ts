import type { FastifyPluginAsync } from "fastify";

import { prisma } from "../db.js";
import { effectiveHotScore, hotScore } from "../domain/hotScore.js";
import { createInitialSegment } from "../domain/segment.js";
import { encodeCursor, decodeCursor } from "../domain/cursor.js";
import { isAllowedImageUrl } from "../storage/imageUrl.js";
import { requireAuth, optionalAuth } from "../auth.js";

// Feed cursor: opaque base64 of "hotScore|id" (hot) or "createdAtMs|id" (new). The
// numeric component is the keyset tie-break anchor; id breaks ties deterministically.
// encode/decode live in domain/cursor.ts so other routes reuse them verbatim.

const FEED_PAGE_SIZE = 20;

// Profile activity lists (a user's posts / bookmarks). Same default as the feed.
const PROFILE_PAGE_SIZE = 20;

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
  voted = false,
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
    voted,
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
      const userId = await requireAuth(req, reply);
      if (!userId) return;

      const { communityId, title, body, imageUrl } = req.body ?? {};
      if (!communityId || !title || !body) {
        return reply
          .code(400)
          .send({ error: "communityId, title and body are required" });
      }

      if (imageUrl !== undefined && typeof imageUrl !== "string") {
        return reply.code(400).send({ error: "Invalid imageUrl" });
      }
      if (
        typeof imageUrl === "string" &&
        imageUrl.length > 0 &&
        !isAllowedImageUrl(imageUrl)
      ) {
        return reply.code(400).send({ error: "Invalid imageUrl" });
      }
      const safeImageUrl = typeof imageUrl === "string" && imageUrl.length > 0 ? imageUrl : null;

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
            imageUrl: safeImageUrl,
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
        voted: false,
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
  // FR-1.4: optional `q` — partial, case-insensitive (ASCII, SQLite LIKE) match
  // on title OR body. ANDed with the keyset predicate so search pages exactly
  // like the feed; omitting `q` keeps the original feed behavior verbatim.
  app.get<{ Querystring: { sort?: string; cursor?: string; q?: string } }>(
    "/posts",
    async (req, reply) => {
      const sort = req.query.sort === "new" ? "new" : "hot";
      const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const cursorRaw = req.query.cursor;
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      if (cursorRaw && !cursor) {
        return reply.code(400).send({ error: "Invalid cursor" });
      }

      const searchWhere = term
        ? {
            OR: [{ title: { contains: term } }, { body: { contains: term } }],
          }
        : null;

      // Keyset predicate: rows strictly "after" the cursor in the sort order.
      // For DESC ordering on (key, id) the next page is key < cursorKey, OR
      // key == cursorKey AND id < cursorId (id also DESC as a stable tie-break).
      const cursorWhere =
        cursor === null
          ? null
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

      // Both predicates are OR-shaped, so combining them MUST use an explicit
      // AND (object-merging would clobber one OR with the other).
      const where =
        searchWhere && cursorWhere
          ? { AND: [searchWhere, cursorWhere] }
          : (searchWhere ?? cursorWhere ?? {});

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

      // Batch voted lookup for optional acting user (JWT-derived, never x-user-id).
      const actingUserId = await optionalAuth(req);
      const votedSet = new Set<string>();
      if (actingUserId && page.length > 0) {
        const pageIds = page.map((p) => p.id);
        const userVotes = await prisma.vote.findMany({
          where: { userId: actingUserId, postId: { in: pageIds } },
          select: { postId: true },
        });
        for (const v of userVotes) votedSet.add(v.postId);
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
          items: withEffective.map((e) =>
            toFeedCard(e.row, e.eff, votedSet.has(e.row.id)),
          ),
          nextCursor,
        });
      }

      return reply.send({
        items: page.map((p) => toFeedCard(p, undefined, votedSet.has(p.id))),
        nextCursor,
      });
    },
  );

  // Single post + community + author summary.
  // OPTIONAL auth: when a valid Bearer token is present, `bookmarked` and `voted`
  // reflect the acting user's state. No 401 — this endpoint remains public.
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

    // JWT-derived optional identity (never x-user-id).
    const actingUserId = await optionalAuth(req);

    let bookmarked = false;
    let voted = false;
    if (actingUserId) {
      const bm = await prisma.bookmark.findUnique({
        where: { userId_postId: { userId: actingUserId, postId: post.id } },
        select: { id: true },
      });
      bookmarked = bm !== null;
      const vt = await prisma.vote.findUnique({
        where: { userId_postId: { userId: actingUserId, postId: post.id } },
        select: { id: true },
      });
      voted = vt !== null;
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
      voted,
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

      // JWT-derived optional identity (never x-user-id).
      const actingUserId = await optionalAuth(req);
      const votedSet = new Set<string>();
      if (actingUserId && rows.length > 0) {
        const pageIds = rows.map((p) => p.id);
        const userVotes = await prisma.vote.findMany({
          where: { userId: actingUserId, postId: { in: pageIds } },
          select: { postId: true },
        });
        for (const v of userVotes) votedSet.add(v.postId);
      }

      return reply.send({
        items: rows.map((p) => toFeedCard(p, undefined, votedSet.has(p.id))),
      });
    },
  );

  // Posts authored by a user (public profile view, read-only), newest first.
  // Keyset/cursor paginated — identical anchor to the "new" feed
  // (createdAt(ms) + id), so the cursor encoding matches the feed.
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/users/:id/posts",
    async (req, reply) => {
      const cursorRaw = req.query.cursor;
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      if (cursorRaw && !cursor) {
        return reply.code(400).send({ error: "Invalid cursor" });
      }

      // Keyset predicate (createdAt DESC, id DESC): rows strictly after cursor.
      const where =
        cursor === null
          ? { authorId: req.params.id }
          : {
              authorId: req.params.id,
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

      const rows = await prisma.post.findMany({
        where,
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        take: PROFILE_PAGE_SIZE + 1,
        include: feedInclude,
      });

      const hasMore = rows.length > PROFILE_PAGE_SIZE;
      const page = hasMore ? rows.slice(0, PROFILE_PAGE_SIZE) : rows;

      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1]!;
        nextCursor = encodeCursor(last.createdAt.getTime(), last.id);
      }

      // JWT-derived optional identity (never x-user-id).
      const actingUserId = await optionalAuth(req);
      const votedSet = new Set<string>();
      if (actingUserId && page.length > 0) {
        const pageIds = page.map((p) => p.id);
        const userVotes = await prisma.vote.findMany({
          where: { userId: actingUserId, postId: { in: pageIds } },
          select: { postId: true },
        });
        for (const v of userVotes) votedSet.add(v.postId);
      }

      return reply.send({
        items: page.map((p) => toFeedCard(p, undefined, votedSet.has(p.id))),
        nextCursor,
      });
    },
  );

  // PATCH /posts/:id — only the author may edit title, body, or imageUrl.
  app.patch<{
    Params: { id: string };
    Body: { title?: string; body?: string; imageUrl?: string | null };
  }>("/posts/:id", async (req, reply) => {
    const userId = await requireAuth(req, reply);
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
          !isAllowedImageUrl(imageUrl)
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

  // DELETE /posts/:id — only the author may delete. Mirrors PATCH /posts/:id's
  // auth/ownership gate. The Prisma schema has NO onDelete:Cascade on Post's
  // children, so we delete them by hand inside a SINGLE transaction in an order
  // that satisfies every FK constraint:
  //   1. vote        — Vote.postId FK
  //   2. bookmark    — Bookmark.postId FK
  //   3. comment.replyToId = null — break the self-referential ReplyChain FK
  //                    BEFORE deleting comments so a reply never points at a
  //                    just-deleted parent.
  //   4. comment     — delete BEFORE segments (Comment.segmentId FK -> segment).
  //   5. contextSegment — ContextSegment.postId FK.
  //   6. post        — finally the row itself.
  // (ContextSegment.summaryCommentId is a loose String with no FK relation, so
  //  it needs no action here.)
  app.delete<{ Params: { id: string } }>("/posts/:id", async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;

    const existing = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Post not found" });
    }
    if (existing.authorId !== userId) {
      return reply.code(403).send({ error: "Only the author may delete" });
    }

    const id = req.params.id;
    await prisma.$transaction(async (tx) => {
      await tx.vote.deleteMany({ where: { postId: id } });
      await tx.bookmark.deleteMany({ where: { postId: id } });
      await tx.comment.updateMany({
        where: { postId: id },
        data: { replyToId: null },
      });
      await tx.comment.deleteMany({ where: { postId: id } });
      await tx.contextSegment.deleteMany({ where: { postId: id } });
      await tx.post.delete({ where: { id } });
    });

    return reply.send({ deleted: true });
  });

  // POST /posts/:id/upvote — idempotent upsert of a Vote; recomputes score + hotScore.
  app.post<{ Params: { id: string } }>(
    "/posts/:id/upvote",
    async (req, reply) => {
      const userId = await requireAuth(req, reply);
      if (!userId) return;

      const post = await prisma.post.findUnique({
        where: { id: req.params.id },
        select: { id: true, commentCount: true, createdAt: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      await prisma.vote.upsert({
        where: { userId_postId: { userId, postId: req.params.id } },
        create: { userId, postId: req.params.id },
        update: {},
      });

      const newScore = await prisma.vote.count({
        where: { postId: req.params.id },
      });
      const newHot = hotScore(newScore, post.commentCount, post.createdAt);

      const updated = await prisma.post.update({
        where: { id: req.params.id },
        data: { score: newScore, hotScore: newHot },
        select: { id: true, score: true, hotScore: true },
      });

      return reply.code(201).send({
        id: updated.id,
        score: updated.score,
        hotScore: updated.hotScore,
        voted: true,
      });
    },
  );

  // DELETE /posts/:id/upvote — idempotent remove; recomputes score + hotScore.
  app.delete<{ Params: { id: string } }>(
    "/posts/:id/upvote",
    async (req, reply) => {
      const userId = await requireAuth(req, reply);
      if (!userId) return;

      await prisma.vote.deleteMany({
        where: { userId, postId: req.params.id },
      });

      const post = await prisma.post.findUnique({
        where: { id: req.params.id },
        select: { id: true, commentCount: true, createdAt: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      const newScore = await prisma.vote.count({
        where: { postId: req.params.id },
      });
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
        voted: false,
      });
    },
  );

  // POST /posts/:id/bookmark — idempotent upsert; requires Bearer auth.
  app.post<{ Params: { id: string } }>(
    "/posts/:id/bookmark",
    async (req, reply) => {
      const userId = await requireAuth(req, reply);
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

  // DELETE /posts/:id/bookmark — idempotent delete; requires Bearer auth.
  app.delete<{ Params: { id: string } }>(
    "/posts/:id/bookmark",
    async (req, reply) => {
      const userId = await requireAuth(req, reply);
      if (!userId) return;

      await prisma.bookmark.deleteMany({
        where: { userId, postId: req.params.id },
      });

      return reply.send({ bookmarked: false });
    },
  );

  // GET /users/:id/bookmarks — public; returns bookmarked posts as feed cards,
  // ordered by BOOKMARK row createdAt DESC (most recently bookmarked first),
  // tie-break by bookmark id DESC. Keyset/cursor paginated.
  //
  // IMPORTANT: the cursor anchor is the BOOKMARK join row position
  // (bookmark.createdAt(ms) + bookmark.id), NOT post.createdAt. The keyset
  // predicate and nextCursor both reference the bookmark row, because the sort
  // order is "when bookmarked", which is independent of the post's own age.
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/users/:id/bookmarks",
    async (req, reply) => {
      const cursorRaw = req.query.cursor;
      const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
      if (cursorRaw && !cursor) {
        return reply.code(400).send({ error: "Invalid cursor" });
      }

      // Keyset predicate on the BOOKMARK row (createdAt DESC, id DESC).
      const where =
        cursor === null
          ? { userId: req.params.id }
          : {
              userId: req.params.id,
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

      const rows = await prisma.bookmark.findMany({
        where,
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        take: PROFILE_PAGE_SIZE + 1,
        include: { post: { include: feedInclude } },
      });

      const hasMore = rows.length > PROFILE_PAGE_SIZE;
      const page = hasMore ? rows.slice(0, PROFILE_PAGE_SIZE) : rows;

      // nextCursor anchors on the LAST bookmark row in the page, NOT its post.
      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1]!;
        nextCursor = encodeCursor(last.createdAt.getTime(), last.id);
      }

      // JWT-derived optional identity (never x-user-id).
      const actingUserId = await optionalAuth(req);
      const votedSet = new Set<string>();
      if (actingUserId && page.length > 0) {
        const pageIds = page.map((r) => r.post.id);
        const userVotes = await prisma.vote.findMany({
          where: { userId: actingUserId, postId: { in: pageIds } },
          select: { postId: true },
        });
        for (const v of userVotes) votedSet.add(v.postId);
      }

      return reply.send({
        items: page.map((r) =>
          toFeedCard(r.post, undefined, votedSet.has(r.post.id)),
        ),
        nextCursor,
      });
    },
  );
};

export default plugin;
