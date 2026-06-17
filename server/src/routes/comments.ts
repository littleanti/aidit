import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../db.js";
import { hotScore } from "../domain/hotScore.js";
import { findActiveSegment, openSummarySegment } from "../domain/segment.js";
import { publish } from "../realtime/publish.js";
import {
  EVENT_COMMENT_CREATED,
  EVENT_COMMENT_UPDATED,
  EVENT_SEGMENT_OPENED,
  type CommentDTO,
} from "../realtime/events.js";

// WP BE-6 + BE-11 — Comments route.
//
// Registered in app.ts under prefix '/'. Server stays KEY-BLIND (L1): no apiKey
// is ever accepted or stored. Idempotency via Comment.clientId
// (@@unique([postId, clientId]), L12); `seq` is server-assigned, monotonic per
// post (L4). After a successful create we publish a 'comment.created' SSE event
// through the realtime publish seam.

// --- helpers ---------------------------------------------------------------

// Acting user is carried in the x-user-id header (L11: persisted User.id).
function actingUserId(req: FastifyRequest): string | null {
  const header = req.headers["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  return userId ?? null;
}

type CommentType = "HUMAN" | "AI_REPLY" | "AI_SUMMARY";
type CommentStatus = "PENDING" | "COMPLETE" | "FAILED";

// Row shape returned by every comment query in this module (comment + author join).
interface CommentRow {
  id: string;
  postId: string;
  authorId: string | null;
  type: CommentType;
  status: CommentStatus;
  body: string;
  tokenCount: number;
  segmentId: string;
  replyToId: string | null;
  clientId: string | null;
  seq: number;
  createdAt: Date;
  author: { username: string } | null;
}

const commentInclude = {
  author: { select: { username: true } },
} as const;

// Shape a comment row into the wire DTO the frontend expects (types.ts → Comment),
// with ISO string dates and a flattened authorUsername.
function toCommentDTO(row: CommentRow): CommentDTO {
  return {
    id: row.id,
    postId: row.postId,
    authorId: row.authorId,
    authorUsername: row.author?.username ?? null,
    type: row.type,
    status: row.status,
    body: row.body,
    tokenCount: row.tokenCount,
    segmentId: row.segmentId,
    replyToId: row.replyToId,
    clientId: row.clientId,
    seq: row.seq,
    createdAt: row.createdAt.toISOString(),
  };
}

// Server-side token estimate when the client does not provide one (~4 chars/token).
function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

const LIST_PAGE_SIZE = 50;

interface CreateCommentBody {
  type?: CommentType;
  body?: string;
  status?: CommentStatus;
  replyToId?: string | null;
  clientId?: string;
  /** Optimistic-concurrency hint: the segment index the client believes is
   * active. REQUIRED for AI_SUMMARY (BE-7 guard); ignored otherwise. */
  segmentExpected?: number;
  tokenCount?: number;
}

interface PatchCommentBody {
  status?: CommentStatus;
  body?: string;
  // AI-bubble ownership proof (L1: NOT an apiKey).
  clientId?: string;
}

// --- plugin ----------------------------------------------------------------

const plugin: FastifyPluginAsync = async (app) => {
  // BE-6: Create a comment on a post.
  app.post<{ Params: { id: string }; Body: CreateCommentBody }>(
    "/posts/:id/comments",
    async (req, reply) => {
      const postId = req.params.id;
      const {
        type,
        body,
        status,
        replyToId,
        clientId,
        tokenCount: providedTokenCount,
      } = req.body ?? {};

      if (type !== "HUMAN" && type !== "AI_REPLY" && type !== "AI_SUMMARY") {
        return reply.code(400).send({ error: "Invalid or missing type" });
      }
      if (typeof body !== "string" || body.length === 0) {
        return reply.code(400).send({ error: "body is required" });
      }
      if (typeof clientId !== "string" || clientId.length === 0) {
        return reply.code(400).send({ error: "clientId is required" });
      }

      // HUMAN comments require an acting user; AI bubbles are author-less (L1).
      const userId = actingUserId(req);
      if (type === "HUMAN" && !userId) {
        return reply.code(401).send({ error: "Missing x-user-id" });
      }
      const authorId = type === "HUMAN" ? userId : null;

      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, score: true, createdAt: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      // L12 idempotency: if this (postId, clientId) already produced a comment,
      // return it instead of creating a duplicate. Makes network retries safe.
      const existing = await prisma.comment.findUnique({
        where: { postId_clientId: { postId, clientId } },
        include: commentInclude,
      });
      if (existing) {
        return reply.code(200).send(toCommentDTO(existing));
      }

      // status: default COMPLETE for HUMAN; PENDING allowed for AI bubbles.
      const resolvedStatus: CommentStatus =
        status === "PENDING" || status === "COMPLETE" || status === "FAILED"
          ? status
          : "COMPLETE";

      const tokenCount =
        typeof providedTokenCount === "number" &&
        Number.isFinite(providedTokenCount) &&
        providedTokenCount >= 0
          ? Math.floor(providedTokenCount)
          : estimateTokens(body);

      // --- AI_SUMMARY: segment-open transition (BE-5s / BE-7 / RT-8) -------
      //
      // A summary bubble is NOT an ordinary comment: it OPENS a new segment N+1
      // and is that segment's lowest-seq (opening) bubble. The idempotency guard
      // ensures only one summary opens per transition. clientId idempotency
      // (above) already short-circuited duplicate retries before we get here.
      if (type === "AI_SUMMARY") {
        const { segmentExpected } = req.body ?? {};
        if (
          typeof segmentExpected !== "number" ||
          !Number.isInteger(segmentExpected) ||
          segmentExpected < 0
        ) {
          return reply
            .code(400)
            .send({ error: "segmentExpected (number) is required for AI_SUMMARY" });
        }

        let summaryResult: Awaited<ReturnType<typeof openSummarySegment>>;
        try {
          summaryResult = await prisma.$transaction(async (tx) => {
            // L4: assign seq = (max seq for this post) + 1, inside the tx.
            const last = await tx.comment.findFirst({
              where: { postId },
              orderBy: { seq: "desc" },
              select: { seq: true },
            });
            const seq = (last?.seq ?? 0) + 1;

            const result = await openSummarySegment(
              tx,
              {
                postId,
                body,
                tokenCount,
                clientId,
                seq,
                replyToId: replyToId ?? null,
              },
              segmentExpected,
            );

            // Only the winner mutates post counters; the conflict path must not.
            if (result.kind === "opened") {
              const newCommentCount = await tx.post
                .update({
                  where: { id: postId },
                  data: { commentCount: { increment: 1 } },
                  select: { commentCount: true },
                })
                .then((p) => p.commentCount);

              const newHot = hotScore(
                post.score,
                newCommentCount,
                post.createdAt,
              );
              await tx.post.update({
                where: { id: postId },
                data: { hotScore: newHot },
              });
            }

            return result;
          });
        } catch (err) {
          // Idempotency race on (postId, clientId): a concurrent request already
          // inserted this exact summary. Return it (200), no double-open.
          if (
            err instanceof Error &&
            "code" in err &&
            (err as { code?: string }).code === "P2002"
          ) {
            const raced = await prisma.comment.findUnique({
              where: { postId_clientId: { postId, clientId } },
              include: commentInclude,
            });
            if (raced) {
              return reply.code(200).send(toCommentDTO(raced));
            }
          }
          throw err;
        }

        // BE-7 guard: someone already opened this transition → 409 with the
        // CURRENT active segment so the loser re-assembles against it.
        if (summaryResult.kind === "conflict") {
          return reply.code(409).send({
            segmentIndex: summaryResult.segmentIndex,
            summaryCommentId: summaryResult.summaryCommentId,
          });
        }

        const summaryDto = toCommentDTO(summaryResult.comment as CommentRow);

        // RT-8 server side: publish BOTH events, ordered by seq. The summary
        // bubble first (comment.created), then the segment.opened transition.
        publish(postId, {
          type: EVENT_COMMENT_CREATED,
          data: { comment: summaryDto },
        });
        publish(postId, {
          type: EVENT_SEGMENT_OPENED,
          data: {
            segmentIndex: summaryResult.newSegmentIndex,
            summaryCommentId: summaryResult.summaryCommentId,
            seq: summaryDto.seq,
          },
        });

        return reply.code(201).send(summaryDto);
      }

      let created: CommentRow;
      try {
        created = await prisma.$transaction(async (tx) => {
          // Resolve the single active ContextSegment for this post (L5).
          const segment = await findActiveSegment(tx, postId);
          if (!segment) {
            throw new Error("NO_ACTIVE_SEGMENT");
          }

          // L4: assign seq = (max seq for this post) + 1.
          const last = await tx.comment.findFirst({
            where: { postId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          });
          const seq = (last?.seq ?? 0) + 1;

          const row = await tx.comment.create({
            data: {
              postId,
              authorId,
              type,
              status: resolvedStatus,
              body,
              tokenCount,
              segmentId: segment.id,
              replyToId: replyToId ?? null,
              clientId,
              seq,
            },
            include: commentInclude,
          });

          // Bump the active segment's tokenSum (128K basis, L5).
          await tx.contextSegment.update({
            where: { id: segment.id },
            data: { tokenSum: { increment: tokenCount } },
          });

          // Increment post.commentCount and recompute hotScore.
          const newCommentCount = await tx.post
            .update({
              where: { id: postId },
              data: { commentCount: { increment: 1 } },
              select: { commentCount: true },
            })
            .then((p) => p.commentCount);

          const newHot = hotScore(post.score, newCommentCount, post.createdAt);
          await tx.post.update({
            where: { id: postId },
            data: { hotScore: newHot },
          });

          return row;
        });
      } catch (err) {
        // Idempotency race: a concurrent request inserted the same
        // (postId, clientId) between our check and the transaction. Return that.
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code?: string }).code === "P2002"
        ) {
          const raced = await prisma.comment.findUnique({
            where: { postId_clientId: { postId, clientId } },
            include: commentInclude,
          });
          if (raced) {
            return reply.code(200).send(toCommentDTO(raced));
          }
        }
        if (err instanceof Error && err.message === "NO_ACTIVE_SEGMENT") {
          return reply
            .code(409)
            .send({ error: "No active context segment for post" });
        }
        throw err;
      }

      const dto = toCommentDTO(created);

      // Publish the new bubble to all SSE subscribers of this post (RT-3/RT-5).
      publish(postId, {
        type: EVENT_COMMENT_CREATED,
        data: { comment: dto },
      });

      return reply.code(201).send(dto);
    },
  );

  // BE-11: List comments for a post, keyset paginated by seq ascending.
  // ?afterSeq= returns comments with seq > afterSeq (default 0), page size 50.
  app.get<{ Params: { id: string }; Querystring: { afterSeq?: string } }>(
    "/posts/:id/comments",
    async (req, reply) => {
      const postId = req.params.id;

      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      const afterSeqRaw = req.query.afterSeq;
      let afterSeq = 0;
      if (afterSeqRaw !== undefined) {
        const parsed = Number(afterSeqRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return reply.code(400).send({ error: "Invalid afterSeq" });
        }
        afterSeq = Math.floor(parsed);
      }

      const rows = await prisma.comment.findMany({
        where: { postId, seq: { gt: afterSeq } },
        orderBy: { seq: "asc" },
        take: LIST_PAGE_SIZE,
        include: commentInclude,
      });

      return reply.send({ items: rows.map(toCommentDTO) });
    },
  );

  // BE-8: Patch a comment's status and/or body. KEY-BLIND (L1): NO apiKey.
  //
  // AUTHZ (PLAN L12 / §6 resolved):
  //  - HUMAN comment (authorId != null): require x-user-id === comment.authorId.
  //  - AI bubble  (authorId === null):   require body.clientId === comment.clientId
  //    (the browser that created the PENDING AI bubble owns it).
  //
  // After commit we publish a 'comment.updated' event so all viewers transition
  // the bubble (AI loading -> complete/failed, or human body edit).
  app.patch<{ Params: { id: string }; Body: PatchCommentBody }>(
    "/comments/:id",
    async (req, reply) => {
      const commentId = req.params.id;
      const { status, body, clientId } = req.body ?? {};

      if (
        status !== undefined &&
        status !== "PENDING" &&
        status !== "COMPLETE" &&
        status !== "FAILED"
      ) {
        return reply.code(400).send({ error: "Invalid status" });
      }
      if (body !== undefined && typeof body !== "string") {
        return reply.code(400).send({ error: "Invalid body" });
      }
      if (status === undefined && body === undefined) {
        return reply.code(400).send({ error: "Nothing to update" });
      }

      const target = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { id: true, authorId: true, clientId: true },
      });
      if (!target) {
        return reply.code(404).send({ error: "Comment not found" });
      }

      // Ownership check.
      if (target.authorId !== null) {
        // HUMAN comment — owner is the acting user.
        const userId = actingUserId(req);
        if (!userId) {
          return reply.code(401).send({ error: "Missing x-user-id" });
        }
        if (userId !== target.authorId) {
          return reply.code(403).send({ error: "Not the comment author" });
        }
      } else {
        // AI bubble — owner is the creating browser, proven by clientId.
        if (typeof clientId !== "string" || clientId.length === 0) {
          return reply.code(401).send({ error: "clientId required" });
        }
        if (clientId !== target.clientId) {
          return reply.code(403).send({ error: "Not the bubble owner" });
        }
      }

      const data: { status?: CommentStatus; body?: string } = {};
      if (status !== undefined) data.status = status;
      if (body !== undefined) data.body = body;

      const updated = await prisma.comment.update({
        where: { id: commentId },
        data,
        include: commentInclude,
      });

      const dto = toCommentDTO(updated);

      // Notify all SSE subscribers of the new body/status (RT-5).
      publish(updated.postId, {
        type: EVENT_COMMENT_UPDATED,
        data: {
          id: dto.id,
          body: dto.body,
          status: dto.status,
          seq: dto.seq,
        },
      });

      return reply.send(dto);
    },
  );
};

export default plugin;
