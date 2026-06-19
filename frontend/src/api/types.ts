// ============================================================================
// FROZEN CONTRACT — DTOs shared with the Aidit backend.
//
// L1 (key-blind): NO 'apiKey' field appears on ANY DTO, request body, header,
// or anything that crosses the network boundary. The Google API key lives ONLY
// in the browser (localStorage via authStore) and is used for direct Gemini
// calls in M3 — never sent to the Aidit server.
//
// L4: 'seq' (monotonic per-post int) is the single source of truth for
// ordering / SSE-replay / idempotency.
// ============================================================================

/** POST /auth/session response. L11: 'me' = persisted User.id. */
export interface SessionResponse {
  id: string;
  username: string;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  personaPrompt: string;
  /** L12: nullable persona icon (emoji or short string). */
  personaIcon?: string | null;
  creatorId: string;
  createdAt: string;
}

export interface Post {
  id: string;
  communityId: string;
  authorId: string;
  title: string;
  body: string;
  score: number;
  commentCount: number;
  hotScore: number;
  createdAt: string;
  /** optional uploaded image (filesystem-served URL); null = no image. */
  imageUrl?: string | null;
  // optional joined relations
  community?: Community;
  author?: { id: string; username: string };
  /** server-computed for the acting user via x-user-id on GET /posts/:id. */
  bookmarked?: boolean;
  /** server-computed for the acting user via x-user-id; score is the live vote count. */
  voted?: boolean;
}

/** Feed card shape (joined fields for rendering a list item). */
export interface PostListItem {
  id: string;
  title: string;
  body: string;
  score: number;
  commentCount: number;
  hotScore: number;
  createdAt: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  communityPersonaIcon?: string | null;
  authorId: string;
  authorUsername: string;
  /** optional uploaded image (filesystem-served URL); null = no image. */
  imageUrl?: string | null;
  /** server-computed for the acting user via x-user-id; score is the live vote count. */
  voted?: boolean;
}

export type CommentType = 'HUMAN' | 'AI_REPLY' | 'AI_SUMMARY';
export type CommentStatus = 'PENDING' | 'COMPLETE' | 'FAILED';

export interface Comment {
  id: string;
  postId: string;
  /** null for AI-authored comments. */
  authorId: string | null;
  authorUsername?: string | null;
  type: CommentType;
  status: CommentStatus;
  body: string;
  tokenCount: number;
  /** ContextSegment id this comment belongs to (L5). */
  segmentId: string;
  replyToId?: string | null;
  /** L12: client-supplied idempotency key, @@unique([postId, clientId]). */
  clientId?: string | null;
  /** L4: monotonic per-post ordering key. */
  seq: number;
  /** optional uploaded image (filesystem-served URL); null = no image. */
  imageUrl?: string | null;
  createdAt: string;
}

/** Request body for creating a comment. L1: NO apiKey. */
export interface CreateCommentRequest {
  type: CommentType;
  body: string;
  status?: CommentStatus;
  replyToId?: string | null;
  /** idempotency key (L12). */
  clientId: string;
  /**
   * Segment index the client believes is active, for optimistic concurrency
   * (L5). REQUIRED (integer >= 0) when type === 'AI_SUMMARY' (BE-7 idempotency
   * guard): the server returns 409 if the active index !== segmentExpected so
   * the loser re-assembles instead of double-opening a segment.
   */
  segmentExpected?: number;
  /** optional pre-computed token count (else server estimates ~chars/4). */
  tokenCount?: number;
  /** optional uploaded image URL (server-relative /uploads/<name>). */
  imageUrl?: string | null;
}

/**
 * Context payload assembled for a direct Gemini call (used in M3).
 * L5: built from the active ContextSegment; tokenSum is the 128K basis.
 */
export interface ContextResponse {
  segmentIndex: number;
  contents: Array<{ role: 'user' | 'model'; text: string }>;
  tokenSum: number;
  summaryNeeded: boolean;
}
