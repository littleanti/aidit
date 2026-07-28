import type { FastifyPluginAsync } from "fastify";

import { prisma } from "../db.js";
import { encodeCursor, decodeCursor } from "../domain/cursor.js";
import { requireAuth } from "../auth.js";

// FR-13 — Discussion documents ("논의 문서 응결").
//
// A Document is the condensed markdown result of a thread discussion. The
// markdown itself is generated IN THE BROWSER with the caller's own key
// (frontend/src/engine/documentEngine.ts); this route only PERSISTS the finished
// text. The server stays KEY-BLIND (L1): no apiKey is read, stored, or relayed.
//
// Deliberate contract choices (TRD §4.3):
//   * `communityId` is DERIVED from the post, never taken from the body, so a
//     caller cannot file a document under a community it doesn't belong to.
//   * documents consume NO `seq` and publish NO SSE event — the thread's
//     realtime/ordering contract (L4, §7) is untouched.
//   * `clientId` makes a retry idempotent: the same key returns the existing
//     document with 200 instead of creating a second row.

// Body cap for a condensed document. Generous (a long guide is the point) but
// bounded so a single request can't be used to push megabytes into the DB.
const MAX_BODY_CHARS = 200_000;

// Community document list page size (mirrors the profile list sizes).
const COMMUNITY_PAGE_SIZE = 20;

interface CreateDocumentBody {
  title?: unknown;
  body?: unknown;
  segmentIndex?: unknown;
  sourceSeq?: unknown;
  clientId?: unknown;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// Summary shape for list endpoints: everything needed to render a card WITHOUT
// shipping the (potentially 200K char) markdown body.
const summarySelect = {
  id: true,
  communityId: true,
  postId: true,
  authorId: true,
  title: true,
  segmentIndex: true,
  sourceSeq: true,
  createdAt: true,
  author: { select: { username: true } },
  community: { select: { slug: true, name: true, personaIcon: true } },
  post: { select: { title: true } },
} as const;

type SummaryRow = {
  id: string;
  communityId: string;
  postId: string;
  authorId: string | null;
  title: string;
  segmentIndex: number;
  sourceSeq: number;
  createdAt: Date;
  author: { username: string } | null;
  community: { slug: string; name: string; personaIcon: string | null };
  post: { title: string } | null;
};

interface DocumentSummaryDTO {
  id: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  communityPersonaIcon: string | null;
  postId: string;
  postTitle: string | null;
  authorId: string | null;
  authorUsername: string | null;
  title: string;
  segmentIndex: number;
  sourceSeq: number;
  createdAt: string;
  /** First ~200 chars of the markdown, for a list-card preview. */
  preview?: string;
}

function toSummaryDTO(row: SummaryRow, preview?: string): DocumentSummaryDTO {
  return {
    id: row.id,
    communityId: row.communityId,
    communitySlug: row.community.slug,
    communityName: row.community.name,
    communityPersonaIcon: row.community.personaIcon,
    postId: row.postId,
    postTitle: row.post ? row.post.title : null,
    authorId: row.authorId,
    authorUsername: row.author ? row.author.username : null,
    title: row.title,
    segmentIndex: row.segmentIndex,
    sourceSeq: row.sourceSeq,
    createdAt: row.createdAt.toISOString(),
    ...(preview !== undefined ? { preview } : {}),
  };
}

/** Strip markdown syntax just enough for a plain-text list preview. */
function makePreview(body: string): string {
  const flat = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

const plugin: FastifyPluginAsync = async (app) => {
  // --- POST /posts/:id/documents — persist a condensed document (FR-13.2) ----
  app.post<{ Params: { id: string }; Body: CreateDocumentBody }>(
    "/posts/:id/documents",
    async (req, reply) => {
      const userId = await requireAuth(req, reply);
      if (!userId) return reply;

      const postId = req.params.id;
      const { title, body, segmentIndex, sourceSeq, clientId } = req.body ?? {};

      if (typeof body !== "string" || body.trim() === "") {
        return reply.code(400).send({ error: "body (non-empty string) is required" });
      }
      if (body.length > MAX_BODY_CHARS) {
        return reply
          .code(400)
          .send({ error: `body exceeds ${MAX_BODY_CHARS} characters` });
      }
      if (!isNonNegativeInt(segmentIndex)) {
        return reply
          .code(400)
          .send({ error: "segmentIndex (non-negative integer) is required" });
      }
      if (!isNonNegativeInt(sourceSeq)) {
        return reply
          .code(400)
          .send({ error: "sourceSeq (non-negative integer) is required" });
      }
      if (clientId !== undefined && typeof clientId !== "string") {
        return reply.code(400).send({ error: "clientId must be a string" });
      }
      if (title !== undefined && typeof title !== "string") {
        return reply.code(400).send({ error: "title must be a string" });
      }

      // communityId is DERIVED here — the client never gets to pick it.
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, communityId: true, title: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      // Idempotency: the same clientId returns the existing row (200), so a
      // network retry after a successful write never duplicates a document.
      if (typeof clientId === "string" && clientId !== "") {
        const existing = await prisma.document.findUnique({
          where: { postId_clientId: { postId, clientId } },
          select: { ...summarySelect, body: true },
        });
        if (existing) {
          return reply.code(200).send({
            document: {
              ...toSummaryDTO(existing as unknown as SummaryRow),
              body: existing.body,
            },
          });
        }
      }

      const resolvedTitle =
        typeof title === "string" && title.trim() !== ""
          ? title.trim().slice(0, 300)
          : post.title;

      const created = await prisma.document.create({
        data: {
          communityId: post.communityId,
          postId,
          authorId: userId,
          title: resolvedTitle,
          body,
          segmentIndex,
          sourceSeq,
          clientId: typeof clientId === "string" && clientId !== "" ? clientId : null,
        },
        select: summarySelect,
      });

      return reply
        .code(201)
        .send({ document: { ...toSummaryDTO(created as SummaryRow), body } });
    },
  );

  // --- GET /posts/:id/documents — documents condensed from this thread -------
  app.get<{ Params: { id: string } }>(
    "/posts/:id/documents",
    async (req, reply) => {
      const postId = req.params.id;
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      const rows = await prisma.document.findMany({
        where: { postId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { ...summarySelect, body: true },
      });

      return reply.send({
        items: rows.map((r) =>
          toSummaryDTO(r as unknown as SummaryRow, makePreview(r.body)),
        ),
      });
    },
  );

  // --- GET /communities/:slug/documents — community document feed ------------
  // Keyset pagination on (createdAt desc, id desc), same cursor codec as the
  // profile/feed lists (§4.2).
  app.get<{ Params: { slug: string }; Querystring: { cursor?: string } }>(
    "/communities/:slug/documents",
    async (req, reply) => {
      const community = await prisma.community.findUnique({
        where: { slug: req.params.slug },
        select: { id: true },
      });
      if (!community) {
        return reply.code(404).send({ error: "Community not found" });
      }

      const rawCursor = req.query?.cursor;
      const decoded =
        typeof rawCursor === "string" && rawCursor !== ""
          ? decodeCursor(rawCursor)
          : null;

      const rows = await prisma.document.findMany({
        where: {
          communityId: community.id,
          ...(decoded
            ? {
                OR: [
                  { createdAt: { lt: new Date(decoded.value) } },
                  {
                    createdAt: new Date(decoded.value),
                    id: { lt: decoded.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: COMMUNITY_PAGE_SIZE + 1,
        select: { ...summarySelect, body: true },
      });

      const hasMore = rows.length > COMMUNITY_PAGE_SIZE;
      const page = hasMore ? rows.slice(0, COMMUNITY_PAGE_SIZE) : rows;
      const last = page[page.length - 1];

      return reply.send({
        items: page.map((r) =>
          toSummaryDTO(r as unknown as SummaryRow, makePreview(r.body)),
        ),
        nextCursor:
          hasMore && last
            ? encodeCursor(last.createdAt.getTime(), last.id)
            : null,
      });
    },
  );

  // --- GET /documents/:id — single document, markdown included --------------
  app.get<{ Params: { id: string } }>("/documents/:id", async (req, reply) => {
    const row = await prisma.document.findUnique({
      where: { id: req.params.id },
      select: { ...summarySelect, body: true },
    });
    if (!row) {
      return reply.code(404).send({ error: "Document not found" });
    }
    return reply.send({
      document: { ...toSummaryDTO(row as unknown as SummaryRow), body: row.body },
    });
  });
};

export default plugin;
