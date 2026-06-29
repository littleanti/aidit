// WP BE-12 — Context assembler.
//
// Pure-ish builder that turns a post's ACTIVE ContextSegment into the
// { segmentIndex, contents, tokenSum, summaryNeeded } payload the browser feeds
// directly to the LLM provider (BYOK, M3). The server stays KEY-BLIND (L1): no apiKey is
// read or returned here — this only shapes conversation turns.
//
// CONTEXT MAPPING (TRD §5.1 / §6.1):
//  - Persona prompt is NEVER part of `contents` (it is systemInstruction only).
//  - User content is ALWAYS a `role:'user'` turn (L6); AI replies are `role:'model'`.
//  - Segment 0: first turn is the original post as a user turn
//      "「{authorUsername}」: {title}\n{body}".
//  - Segment N>=1: first turn is the opening AI_SUMMARY as a user turn
//      "지금까지 요약: {summaryBody}"; only comments at/after that summary are
//      included (FR-7.2). Each segment only owns its own comments, so scoping to
//      the active segment already enforces this.
//  - HUMAN     -> { role:'user',  text:"「{username}」: {body}" }
//  - AI_REPLY  -> { role:'model', text: body }
//  - AI_SUMMARY-> only ever emitted as the opening user turn (above).
//  - PENDING / FAILED AI bubbles are skipped (only COMPLETE content is context).

import type { Db } from "./segment.js";

// L5 / A-2: product threshold for lazy summarization, checked against the active
// segment's tokenSum (128K basis).
export const CONTEXT_TOKEN_THRESHOLD = 128_000;

export interface ContextTurn {
  role: "user" | "model";
  text: string;
}

export interface AssembledContext {
  segmentIndex: number;
  contents: ContextTurn[];
  tokenSum: number;
  summaryNeeded: boolean;
}

// Error sentinels callers map to HTTP codes.
export const ERR_POST_NOT_FOUND = "POST_NOT_FOUND";
export const ERR_NO_ACTIVE_SEGMENT = "NO_ACTIVE_SEGMENT";

/**
 * Assemble the LLM-ready context for a post's active segment.
 *
 * Throws Error(ERR_POST_NOT_FOUND) if the post does not exist, or
 * Error(ERR_NO_ACTIVE_SEGMENT) if it has no active ContextSegment.
 */
export async function assembleContext(
  db: Db,
  postId: string,
): Promise<AssembledContext> {
  const post = await db.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      title: true,
      body: true,
      author: { select: { username: true } },
    },
  });
  if (!post) {
    throw new Error(ERR_POST_NOT_FOUND);
  }

  const segment = await db.contextSegment.findFirst({
    where: { postId, isActive: true },
    select: { id: true, index: true, tokenSum: true },
  });
  if (!segment) {
    throw new Error(ERR_NO_ACTIVE_SEGMENT);
  }

  // Comments owned by the active segment, in stable thread order (L4: seq).
  const comments = await db.comment.findMany({
    where: { segmentId: segment.id },
    orderBy: { seq: "asc" },
    select: {
      type: true,
      status: true,
      body: true,
      author: { select: { username: true } },
    },
  });

  const contents: ContextTurn[] = [];

  if (segment.index === 0) {
    // Opening turn: the original post itself as a user turn.
    const authorName = post.author?.username ?? "익명";
    contents.push({
      role: "user",
      text: `「${authorName}」: ${post.title}\n${post.body}`,
    });
  } else {
    // Segment N>=1 opens with the AI_SUMMARY bubble rendered as a user turn.
    // It is stored as the segment's first comment (FR-7.2); render it here and
    // skip it in the main loop below.
    const opening = comments.find((c) => c.type === "AI_SUMMARY");
    if (opening) {
      contents.push({
        role: "user",
        text: `지금까지 요약: ${opening.body}`,
      });
    }
  }

  for (const c of comments) {
    if (c.type === "HUMAN") {
      const name = c.author?.username ?? "익명";
      contents.push({ role: "user", text: `「${name}」: ${c.body}` });
    } else if (c.type === "AI_REPLY") {
      // Only COMPLETE AI content belongs in context (skip PENDING/FAILED).
      if (c.status !== "COMPLETE") continue;
      contents.push({ role: "model", text: c.body });
    }
    // AI_SUMMARY is only ever the opening turn (handled above) — never repeated.
  }

  const tokenSum = segment.tokenSum;

  return {
    segmentIndex: segment.index,
    contents,
    tokenSum,
    summaryNeeded: tokenSum > CONTEXT_TOKEN_THRESHOLD,
  };
}
