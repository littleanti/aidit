// BE-5 — ContextSegment helpers (PLAN L5).
//
// ContextSegment is the single source of truth for summary boundaries. Exactly ONE
// segment per post has isActive=true; tokenSum is the 128K-threshold basis.
//
// seg#0 is auto-created on post creation (index 0, isActive=true). M4 extends this
// module to open new segments when a summary bubble is produced, so the helpers are
// written to accept either the PrismaClient or a transaction client.

import type { Prisma, PrismaClient, ContextSegment } from "@prisma/client";

// Accepts the singleton `prisma` or a `$transaction` callback client. We use the
// narrowest shape Prisma exposes for both so callers can pass a tx interchangeably.
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Create the initial context segment (index 0, isActive=true) for a freshly
 * created post. Call inside the same transaction as the Post insert.
 */
export function createInitialSegment(
  db: Db,
  postId: string,
): Promise<ContextSegment> {
  return db.contextSegment.create({
    data: {
      postId,
      index: 0,
      isActive: true,
      tokenSum: 0,
    },
  });
}

/**
 * Find the active segment for a post (the single isActive=true row). Returns null
 * if none exists (should not happen for a well-formed post).
 */
export function findActiveSegment(
  db: Db,
  postId: string,
): Promise<ContextSegment | null> {
  return db.contextSegment.findFirst({
    where: { postId, isActive: true },
  });
}

// --- M4 summary-segment transition (BE-5s / BE-7 / RT-8 server side) --------

// Input for the AI_SUMMARY comment that opens the new segment. The caller has
// already validated body/clientId and resolved tokenCount; this helper owns the
// segment bookkeeping + the comment insert so it stays a single atomic unit.
export interface SummaryCommentInput {
  postId: string;
  body: string;
  tokenCount: number;
  clientId: string;
  /** seq assigned by the caller (max seq + 1, monotonic per post — L4). */
  seq: number;
  replyToId?: string | null;
}

// Discriminated result of attempting a summary transition.
//  - kind 'conflict': someone already summarized this transition (BE-7 guard).
//    The caller should respond 409 with { segmentIndex, summaryCommentId }.
//  - kind 'opened':   this caller WON the transition; the new segment + summary
//    comment row are returned for publish + response.
export type OpenSummaryResult =
  | {
      kind: "conflict";
      segmentIndex: number;
      summaryCommentId: string | null;
    }
  | {
      kind: "opened";
      newSegmentIndex: number;
      summaryCommentId: string;
      comment: SummaryCommentRow;
    };

// Comment row shape returned by the transition (includes author for the DTO).
export interface SummaryCommentRow {
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
}

/**
 * BE-5s + BE-7: open a new context segment from an AI_SUMMARY bubble.
 *
 * MUST be called inside a transaction (pass the tx client as `db`).
 *
 * Idempotency guard (BE-7, §6.5): only ONE summary may open per transition. The
 * caller passes `segmentExpected` = the segment index it believes is active. If
 * the live active segment's index !== segmentExpected, a transition already
 * happened and we return kind 'conflict' WITHOUT mutating anything — the caller
 * responds 409 with the current active segment so the loser re-assembles.
 *
 * Winner path: deactivate the current active segment N, create segment N+1
 * (isActive=true), insert the AI_SUMMARY comment INTO segment N+1 (its tokenCount
 * seeds N+1.tokenSum), and set N+1.summaryCommentId = the summary comment id.
 */
export async function openSummarySegment(
  db: Db,
  input: SummaryCommentInput,
  segmentExpected: number,
): Promise<OpenSummaryResult> {
  const active = await db.contextSegment.findFirst({
    where: { postId: input.postId, isActive: true },
  });
  if (!active) {
    // Treat a missing active segment as a conflict (nothing safe to open against).
    return { kind: "conflict", segmentIndex: -1, summaryCommentId: null };
  }

  // BE-7 guard: the caller's assumed active index no longer matches → someone
  // already opened this transition. Do NOT double-open.
  if (active.index !== segmentExpected) {
    return {
      kind: "conflict",
      segmentIndex: active.index,
      summaryCommentId: active.summaryCommentId,
    };
  }

  // Winner. Deactivate N.
  await db.contextSegment.update({
    where: { id: active.id },
    data: { isActive: false },
  });

  // Create N+1 (active). tokenSum is seeded below from the summary's own tokens.
  const newSegment = await db.contextSegment.create({
    data: {
      postId: input.postId,
      index: active.index + 1,
      isActive: true,
      tokenSum: input.tokenCount,
    },
  });

  // The AI_SUMMARY comment is the opening (lowest-seq) bubble of N+1.
  const comment = (await db.comment.create({
    data: {
      postId: input.postId,
      authorId: null,
      type: "AI_SUMMARY",
      status: "COMPLETE",
      body: input.body,
      tokenCount: input.tokenCount,
      segmentId: newSegment.id,
      replyToId: input.replyToId ?? null,
      clientId: input.clientId,
      seq: input.seq,
    },
    include: { author: { select: { username: true } } },
  })) as SummaryCommentRow;

  // Link N+1 -> its summary comment.
  await db.contextSegment.update({
    where: { id: newSegment.id },
    data: { summaryCommentId: comment.id },
  });

  return {
    kind: "opened",
    newSegmentIndex: newSegment.index,
    summaryCommentId: comment.id,
    comment,
  };
}
