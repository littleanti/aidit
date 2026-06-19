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
    // The Aidit backend reports failures as { error: "..." } (some endpoints
    // use { message }). Prefer either human-readable field so callers can show
    // the server's message (e.g. the Korean duplicate-name/slug errors) before
    // falling back to a generic status line.
    const obj =
      parsed && typeof parsed === 'object'
        ? (parsed as { message?: unknown; error?: unknown })
        : undefined;
    const message =
      (obj && typeof obj.message === 'string' && obj.message) ||
      (obj && typeof obj.error === 'string' && obj.error) ||
      `Request failed: ${res.status} ${res.statusText}`;
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

/**
 * GET /communities/:slug — resolve a SINGLE community by its exact slug.
 * Throws ApiError(404) when no community matches. Use this for detail views
 * instead of partial-matching getCommunities() + picking the first result.
 */
export function getCommunity(slug: string): Promise<Community> {
  return request<Community>(`/communities/${encodeURIComponent(slug)}`);
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

// The server returns a paginated envelope { items, nextCursor } for post
// listings (a bare array for some other resources). Normalize to an array here
// so callers can rely on the declared PostListItem[] return type. The next
// cursor is an OPAQUE token minted by the server (base64url of "value|id"); it
// must be passed back verbatim as the `cursor` query param to fetch the next
// page, and is null on the last page. Never derive a cursor from item ids.
type PostListResponse = PostListItem[] | { items: PostListItem[] };
function toItems(r: PostListResponse): PostListItem[] {
  return Array.isArray(r) ? r : (r?.items ?? []);
}

/** One page of the /posts listing: items plus the server's opaque next cursor. */
export interface PostsPage {
  items: PostListItem[];
  nextCursor: string | null;
}

export async function getPosts(params: GetPostsParams = {}): Promise<PostsPage> {
  const r = await request<PostListResponse | { items: PostListItem[]; nextCursor?: string | null }>(
    '/posts',
    { query: { sort: params.sort, cursor: params.cursor } },
  );
  const nextCursor =
    !Array.isArray(r) && 'nextCursor' in r ? (r.nextCursor ?? null) : null;
  return { items: toItems(r), nextCursor };
}

export async function getCommunityPosts(slug: string): Promise<PostListItem[]> {
  const r = await request<PostListResponse>(`/communities/${slug}/posts`);
  return toItems(r);
}

// ---- Profile ("my content") ----

/**
 * GET /users/:id/posts — posts authored by a user (public, read-only).
 * Normalizes the server's { items } envelope to an array like getPosts.
 */
export async function getUserPosts(userId: string): Promise<PostListItem[]> {
  const r = await request<PostListResponse>(`/users/${userId}/posts`);
  return toItems(r);
}

/**
 * GET /users/:id/communities — communities created by a user (public, read-only).
 * Normalizes to an array consistently with getCommunities.
 */
export async function getUserCommunities(userId: string): Promise<Community[]> {
  const r = await request<Community[] | { items: Community[] }>(
    `/users/${userId}/communities`,
  );
  return Array.isArray(r) ? r : (r?.items ?? []);
}

export interface CreatePostBody {
  communityId: string;
  title: string;
  body: string;
  /** optional uploaded image URL (server-relative /uploads/<name>). */
  imageUrl?: string;
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
 * POST /uploads — upload a single image via multipart/form-data and return its
 * server-relative URL. L1: carries ONLY x-user-id (REQUIRED; server 401s
 * without it), NEVER any API key. We do NOT set Content-Type — the browser sets
 * the multipart boundary itself. Non-2xx is mapped to ApiError via the server's
 * { error } shape so the Composer can surface it as a toast.
 */
export async function uploadImage(
  file: File,
  userId: string,
): Promise<{ imageUrl: string }> {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    headers: { 'x-user-id': userId },
    body: fd,
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
    const obj =
      parsed && typeof parsed === 'object'
        ? (parsed as { message?: unknown; error?: unknown })
        : undefined;
    const message =
      (obj && typeof obj.message === 'string' && obj.message) ||
      (obj && typeof obj.error === 'string' && obj.error) ||
      `Request failed: ${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as { imageUrl: string };
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
