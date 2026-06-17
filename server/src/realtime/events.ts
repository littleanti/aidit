// WP RT-5 — typed SSE event definitions + serialization.
//
// These are the ONLY events that cross the SSE boundary (TRD §7). All write
// paths publish through these shapes so the stream endpoint and clients share
// one contract. Each SSE frame carries `id: <seq>` so reconnecting clients can
// resume via Last-Event-ID (L4: `seq` is the SoT for ordering/replay).

// Full Comment DTO as emitted over SSE. Mirrors the FROZEN frontend contract
// (frontend/src/api/types.ts → Comment). Dates are ISO strings on the wire.
export interface CommentDTO {
  id: string;
  postId: string;
  /** null for AI-authored comments. */
  authorId: string | null;
  authorUsername?: string | null;
  type: "HUMAN" | "AI_REPLY" | "AI_SUMMARY";
  status: "PENDING" | "COMPLETE" | "FAILED";
  body: string;
  tokenCount: number;
  segmentId: string;
  replyToId?: string | null;
  clientId?: string | null;
  /** L4: monotonic per-post ordering key. */
  seq: number;
  createdAt: string;
}

// --- event name constants --------------------------------------------------

export const EVENT_COMMENT_CREATED = "comment.created" as const;
export const EVENT_COMMENT_UPDATED = "comment.updated" as const;
export const EVENT_SEGMENT_OPENED = "segment.opened" as const;

export const EVENT_NAMES = {
  COMMENT_CREATED: EVENT_COMMENT_CREATED,
  COMMENT_UPDATED: EVENT_COMMENT_UPDATED,
  SEGMENT_OPENED: EVENT_SEGMENT_OPENED,
} as const;

// --- event payloads --------------------------------------------------------

/** New bubble: human / AI PENDING / summary. */
export interface CommentCreatedEvent {
  type: typeof EVENT_COMMENT_CREATED;
  data: { comment: CommentDTO };
}

/** AI bubble transition: loading -> complete/failed (or any body/status edit). */
export interface CommentUpdatedEvent {
  type: typeof EVENT_COMMENT_UPDATED;
  data: {
    id: string;
    body: string;
    status: "PENDING" | "COMPLETE" | "FAILED";
    /** Target comment's seq, used as the SSE frame id when available. */
    seq?: number;
  };
}

/** New segment born from a summary (fully wired in M4). */
export interface SegmentOpenedEvent {
  type: typeof EVENT_SEGMENT_OPENED;
  data: {
    segmentIndex: number;
    summaryCommentId: string;
    /** Summary comment's seq, used as the SSE frame id. */
    seq?: number;
  };
}

export type ThreadEvent =
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | SegmentOpenedEvent;

// --- serialization ---------------------------------------------------------

// Monotonic fallback id for frames whose event has no natural `seq` anchor.
// Never collides with real seq values for replay purposes because the client
// only resumes from ids it has actually seen for created bubbles; this is a
// best-effort EventSource id for updated/opened frames lacking a seq.
let fallbackId = 0;

function nextFallbackId(): number {
  fallbackId += 1;
  return fallbackId;
}

// Resolve the SSE frame id for an event:
//  - comment.created → comment.seq
//  - comment.updated → target comment's seq if present, else monotonic counter
//  - segment.opened  → summary comment's seq if present, else monotonic counter
export function eventSseId(event: ThreadEvent): number {
  switch (event.type) {
    case EVENT_COMMENT_CREATED:
      return event.data.comment.seq;
    case EVENT_COMMENT_UPDATED:
      return event.data.seq ?? nextFallbackId();
    case EVENT_SEGMENT_OPENED:
      return event.data.seq ?? nextFallbackId();
  }
}

// Serialize an event into a complete SSE frame string:
//   id: <seq>\n
//   event: <name>\n
//   data: <json>\n\n
// The `data` payload is the public DTO (the `seq` hint on updated/opened is
// stripped so the wire shape matches the frozen SSE contract exactly).
export function serializeEvent(event: ThreadEvent): string {
  const id = eventSseId(event);
  let payload: unknown;
  switch (event.type) {
    case EVENT_COMMENT_CREATED:
      payload = { comment: event.data.comment };
      break;
    case EVENT_COMMENT_UPDATED:
      payload = {
        id: event.data.id,
        body: event.data.body,
        status: event.data.status,
      };
      break;
    case EVENT_SEGMENT_OPENED:
      payload = {
        segmentIndex: event.data.segmentIndex,
        summaryCommentId: event.data.summaryCommentId,
      };
      break;
  }
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
