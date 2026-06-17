import type {
  Comment,
  CommentStatus,
  Community,
  ContextResponse,
  CreateCommentRequest,
  Post,
  PostListItem,
  SessionResponse,
} from './types';

// REST client base. In dev, Vite proxies /api -> http://localhost:3001
// (stripping the /api prefix). In prod, configure the reverse proxy similarly.
const BASE = '/api';

/** Typed error thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** acting user id -> sent as 'x-user-id'. NEVER send any API key. */
  userId?: string;
  query?: Record<string, string | number | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = BASE + path;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.userId) headers['x-user-id'] = opts.userId;

  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : undefined) ?? `Request failed: ${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

// ---- Auth ----

/** POST /auth/session — returns persisted { id, username } (L11). */
export function postAuthSession(username: string): Promise<SessionResponse> {
  return request<SessionResponse>('/auth/session', {
    method: 'POST',
    body: { username },
  });
}

// ---- Communities ----

export function getCommunities(q?: string): Promise<Community[]> {
  return request<Community[]>('/communities', { query: { q } });
}

export interface CreateCommunityBody {
  slug: string;
  name: string;
  description?: string;
  personaPrompt: string;
  personaIcon?: string | null;
}

export function postCommunity(
  body: CreateCommunityBody,
  userId: string,
): Promise<Community> {
  return request<Community>('/communities', { method: 'POST', body, userId });
}

export interface UpdateCommunityBody {
  name?: string;
  description?: string;
  personaPrompt?: string;
  personaIcon?: string | null;
}

export function patchCommunity(
  id: string,
  body: UpdateCommunityBody,
  userId: string,
): Promise<Community> {
  return request<Community>(`/communities/${id}`, {
    method: 'PATCH',
    body,
    userId,
  });
}

// ---- Posts ----

export type PostSort = 'hot' | 'new' | 'top';

export interface GetPostsParams {
  sort?: PostSort;
  cursor?: string;
}

// The server returns a paginated envelope { items, nextCursor? } for post
// listings (a bare array for some other resources). Normalize to an array here
// so callers can rely on the declared PostListItem[] return type. The next
// cursor is derived client-side from the last item's id.
type PostListResponse = PostListItem[] | { items: PostListItem[] };
function toItems(r: PostListResponse): PostListItem[] {
  return Array.isArray(r) ? r : (r?.items ?? []);
}

export async function getPosts(
  params: GetPostsParams = {},
): Promise<PostListItem[]> {
  const r = await request<PostListResponse>('/posts', {
    query: { sort: params.sort, cursor: params.cursor },
  });
  return toItems(r);
}

export async function getCommunityPosts(slug: string): Promise<PostListItem[]> {
  const r = await request<PostListResponse>(`/communities/${slug}/posts`);
  return toItems(r);
}

export interface CreatePostBody {
  communityId: string;
  title: string;
  body: string;
}

export function postPost(body: CreatePostBody, userId: string): Promise<Post> {
  return request<Post>('/posts', { method: 'POST', body, userId });
}

export function getPost(id: string): Promise<Post> {
  return request<Post>(`/posts/${id}`);
}

// ---- Comments ----

/**
 * POST /posts/:id/comments — create a comment (human or AI placeholder).
 * L1: NO key crosses the wire; acting user via x-user-id header.
 * L12: body carries clientId for idempotency.
 */
export function postComment(
  postId: string,
  body: CreateCommentRequest,
  userId: string,
): Promise<Comment> {
  return request<Comment>(`/posts/${postId}/comments`, {
    method: 'POST',
    body,
    userId,
  });
}

/**
 * GET /posts/:id/comments?afterSeq= — fetch comments, optionally only those
 * after a given seq (L4 ordering key) for incremental catch-up.
 */
export async function getComments(
  postId: string,
  afterSeq?: number,
): Promise<Comment[]> {
  // Server returns the paginated envelope { items, nextCursor? }; normalize to
  // an array so callers (threadStore.setInitial) get the declared Comment[].
  const r = await request<Comment[] | { items: Comment[] }>(
    `/posts/${postId}/comments`,
    { query: { afterSeq } },
  );
  return Array.isArray(r) ? r : (r?.items ?? []);
}

/**
 * GET /posts/:id/context — assembled context for a direct Gemini call (M3).
 * L5: built from the active ContextSegment; L1: NO key crosses the wire.
 */
export function getContext(postId: string): Promise<ContextResponse> {
  return request<ContextResponse>(`/posts/${postId}/context`);
}

// ---- Metrics (XC-10 / BE-13) ----

/**
 * POST /metrics/visit — record an idempotent daily visit for the acting user
 * (author D1-retention basis). L1: carries ONLY x-user-id, NEVER any API key.
 * The server reads the header and upserts on @@unique([userId, date]); no body.
 */
export function postMetricsVisit(
  userId: string,
): Promise<{ userId: string; date: string }> {
  return request<{ userId: string; date: string }>('/metrics/visit', {
    method: 'POST',
    userId,
  });
}

export interface PatchCommentBody {
  status?: CommentStatus;
  body?: string;
  /** L12: carried for AI-bubble authz (matches @@unique([postId, clientId])). */
  clientId?: string;
}

/**
 * PATCH /comments/:id — update an AI/human comment's status or body once the
 * browser-side Gemini call resolves. L1: NO key. x-user-id sent when present.
 */
export function patchComment(
  id: string,
  body: PatchCommentBody,
  userId?: string,
): Promise<Comment> {
  return request<Comment>(`/comments/${id}`, {
    method: 'PATCH',
    body,
    userId,
  });
}
