import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../db.js";
import {
  EVENT_COMMENT_CREATED,
  type CommentCreatedEvent,
  type CommentDTO,
  type ThreadEvent,
} from "./events.js";
import { pubsub } from "./pubsub.js";
import { attachSseStream } from "./transport.js";

// WP BE-10 / RT-4 / RT-6 — SSE stream endpoint.
//
// GET /posts/:id/stream serves a long-lived EventSource connection following
// the TRD §7 contract: a SNAPSHOT replay of every comment the client has not
// yet seen (ordered by `seq`, L4), immediately followed by LIVE forwarding of
// published ThreadEvents. The client resumes from a known `seq` via the
// ?afterSeq query param or, on automatic EventSource reconnect, the
// `Last-Event-ID` header (every frame carries `id: <seq>`).

// How many comment rows to pull per snapshot page. The thread may have a large
// backlog (esp. on a fresh subscription with afterSeq=0), so we page by `seq`
// to bound memory instead of materializing the whole history at once.
const SNAPSHOT_PAGE_SIZE = 200;

// Comment row shape pulled for the snapshot (mirrors the CommentDTO fields plus
// the joined author username).
const snapshotSelect = {
  id: true,
  postId: true,
  authorId: true,
  type: true,
  status: true,
  body: true,
  tokenCount: true,
  segmentId: true,
  replyToId: true,
  clientId: true,
  seq: true,
  createdAt: true,
  author: { select: { username: true } },
} as const;

type SnapshotRow = {
  id: string;
  postId: string;
  authorId: string | null;
  type: "HUMAN" | "AI_REPLY" | "AI_SUMMARY";
  status: "PENDING" | "COMPLETE" | "FAILED";
  body: string;
  tokenCount: number;
  segmentId: string;
  replyToId: string | null;
  clientId: string | null;
  seq: number;
  createdAt: Date;
  author: { username: string } | null;
};

// Shape a persisted comment row into the wire CommentDTO (ISO dates, joined
// authorUsername; null author => AI bubble).
function toCommentDTO(row: SnapshotRow): CommentDTO {
  return {
    id: row.id,
    postId: row.postId,
    authorId: row.authorId,
    authorUsername: row.author ? row.author.username : null,
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

// Resolve the resume point. Precedence (RT-6): explicit ?afterSeq= wins, then
// the EventSource-supplied `Last-Event-ID` header (the last `seq` the client
// saw), else 0 (full history). Non-numeric/negative values fall back to 0.
function resolveAfterSeq(req: FastifyRequest): number {
  const query = req.query as { afterSeq?: string } | undefined;
  const fromQuery = query?.afterSeq;
  if (fromQuery !== undefined) {
    const n = Number(fromQuery);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }

  const header = req.headers["last-event-id"];
  const lastEventId = Array.isArray(header) ? header[0] : header;
  if (lastEventId !== undefined && lastEventId !== "") {
    const n = Number(lastEventId);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }

  return 0;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string }; Querystring: { afterSeq?: string } }>(
    "/posts/:id/stream",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { id: string };
      const postId = params.id;

      // 404 before hijacking the socket so EventSource sees a clean error
      // rather than an empty stream for a nonexistent post.
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }

      const afterSeq = resolveAfterSeq(req);

      // Take the reply out of Fastify's response lifecycle: the transport writes
      // headers and frames straight to `reply.raw`, so Fastify must not also try
      // to send/serialize a body (which would throw ERR_HTTP_HEADERS_SENT).
      reply.hijack();

      // Hand the socket to the SSE transport (headers, heartbeat, cleanup).
      const connection = attachSseStream(req, reply);

      // --- LIVE buffering ---------------------------------------------------
      // Subscribe BEFORE the snapshot so no event published during the replay
      // is lost. Events that arrive mid-snapshot are buffered and flushed only
      // after the snapshot completes, preserving strict seq ordering on the
      // wire. (Duplicates between snapshot and buffer are harmless: the client
      // dedupes/upserts by comment id + seq, and `seq` is monotonic.)
      let snapshotDone = false;
      const liveBuffer: ThreadEvent[] = [];

      const unsubscribe = pubsub.subscribe(postId, (event) => {
        if (snapshotDone) {
          connection.send(event);
        } else {
          liveBuffer.push(event);
        }
      });

      // Ensure we always release the subscription when the client goes away.
      // attachSseStream already ends the response on raw 'close'; we add our
      // own listener for the pubsub teardown.
      req.raw.on("close", () => {
        unsubscribe();
      });

      // --- SNAPSHOT replay --------------------------------------------------
      // Stream every comment with seq > afterSeq, ascending, paged by seq.
      try {
        let cursorSeq = afterSeq;
        for (;;) {
          const rows = (await prisma.comment.findMany({
            where: { postId, seq: { gt: cursorSeq } },
            orderBy: { seq: "asc" },
            take: SNAPSHOT_PAGE_SIZE,
            select: snapshotSelect,
          })) as SnapshotRow[];

          if (rows.length === 0) break;

          for (const row of rows) {
            const event: CommentCreatedEvent = {
              type: EVENT_COMMENT_CREATED,
              data: { comment: toCommentDTO(row) },
            };
            connection.send(event);
            cursorSeq = row.seq;
          }

          if (rows.length < SNAPSHOT_PAGE_SIZE) break;
        }
      } catch {
        // If the snapshot fails mid-stream, tear down cleanly; the client will
        // auto-reconnect with Last-Event-ID and resume from the last seq it saw.
        unsubscribe();
        connection.close();
        return;
      }

      // --- Switch to LIVE ---------------------------------------------------
      // Flush anything buffered during the snapshot, then go fully live.
      snapshotDone = true;
      while (liveBuffer.length > 0) {
        const event = liveBuffer.shift()!;
        connection.send(event);
      }

      // Connection stays open (hijacked). It is torn down by the transport's
      // 'close' handler + our unsubscribe when the client disconnects.
    },
  );
};

export default plugin;
