import type {
  Comment,
  CommentStatus,
  CommunitiesPage,
  Community,
  ContextResponse,
  CreateCommentRequest,
  Post,
  PostListItem,
  SessionResponse,
} from './types';

import { API_BASE } from '../config/api';
import { getAuthToken } from '../lib/authToken';
import { notifyAuthExpired } from '../lib/authEvents';
import { tn } from '../i18n/tn';

// REST client base. In dev (VITE_API_ORIGIN unset), API_BASE is "/api" and
// Vite proxies /api -> http://localhost:3001 (stripping the prefix). In prod
// (VITE_API_ORIGIN set), API_BASE is the absolute backend origin + "/api".
const BASE = API_BASE;

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
  /**
   * Kept for call-site compatibility; no longer sets any header.
   * Identity is now carried by the Authorization: Bearer JWT from authToken.ts.
   */
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
  const tok = getAuthToken();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;

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
    // A 401 on a request that CARRIED a token means the token was rejected
    // (expired / secret rotated / invalid) — the session is no longer usable.
    // Signal the app to clear it + prompt re-login. Gated on `tok` so that a
    // 401 from login/register (no token attached) does NOT force a logout.
    if (res.status === 401 && tok) notifyAuthExpired();
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
      tn('misc.request_failed', { status: res.status, statusText: res.statusText });
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

// ---- Auth ----

/** Auth response shape (register + login both return this). */
export interface AuthResponse {
  token: string;
  id: string;
  username: string;
}

/** POST /auth/register { username, password } → 201 { token, id, username }. */
export function register(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: { username, password },
  });
}

/** POST /auth/session { username, password } → 200 { token, id, username }. */
export function login(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/session', {
    method: 'POST',
    body: { username, password },
  });
}

/**
 * POST /auth/guest { username } → 201 { token, id, username }.
 * Password-less guest entry (server appends a #hex4 tag to the base nickname).
 * Returns the same AuthResponse shape as register/login.
 */
export function guestLogin(username: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/guest', {
    method: 'POST',
    body: { username },
  });
}

/**
 * POST /auth/refresh (Bearer, no body) → 200 { token }.
 * Sliding-window renewal: presenting a valid token mints a fresh one.
 */
export function refreshToken(): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/refresh', { method: 'POST' });
}

/**
 * Thin compat alias — authStore previously called postAuthSession(username).
 * @deprecated Use login(username, password) instead.
 */
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

export async function getPosts(params: GetPostsParams = {}, userId?: string): Promise<PostsPage> {
  const r = await request<PostListResponse | { items: PostListItem[]; nextCursor?: string | null }>(
    '/posts',
    { query: { sort: params.sort, cursor: params.cursor }, userId },
  );
  const nextCursor =
    !Array.isArray(r) && 'nextCursor' in r ? (r.nextCursor ?? null) : null;
  return { items: toItems(r), nextCursor };
}

export async function getCommunityPosts(slug: string, userId?: string): Promise<PostListItem[]> {
  const r = await request<PostListResponse>(`/communities/${slug}/posts`, { userId });
  return toItems(r);
}

// ---- Profile ("my content") ----

/**
 * GET /users/:id/posts — posts authored by a user, keyset-paginated.
 * Returns one page (items + opaque nextCursor). Pass cursor from the previous
 * page to continue; omit for the first page. nextCursor is null at end-of-list.
 * Pass actingUserId for compat (unused; server reads identity from Authorization header).
 */
export async function getUserPosts(
  userId: string,
  cursor?: string,
  actingUserId?: string,
): Promise<PostsPage> {
  const r = await request<{ items: PostListItem[]; nextCursor?: string | null }>(
    `/users/${userId}/posts`,
    { query: { cursor }, userId: actingUserId },
  );
  return { items: r.items ?? [], nextCursor: r.nextCursor ?? null };
}

/**
 * GET /users/:id/bookmarks — posts bookmarked by a user, keyset-paginated by
 * bookmark row (most-recently-bookmarked first). The cursor encodes the bookmark
 * row position — treat it as fully opaque (do not derive from post fields).
 * L1: NO apiKey. Pass actingUserId to have the server compute voted per card.
 */
export async function getUserBookmarks(
  userId: string,
  cursor?: string,
  actingUserId?: string,
): Promise<PostsPage> {
  const r = await request<{ items: PostListItem[]; nextCursor?: string | null }>(
    `/users/${userId}/bookmarks`,
    { query: { cursor }, userId: actingUserId },
  );
  return { items: r.items ?? [], nextCursor: r.nextCursor ?? null };
}

/**
 * GET /users/:id/communities — communities created by a user, keyset-paginated.
 * Returns one page (items + opaque nextCursor). Pass cursor from the previous
 * page to continue; omit for the first page. nextCursor is null at end-of-list.
 */
export async function getUserCommunities(
  userId: string,
  cursor?: string,
): Promise<CommunitiesPage> {
  const r = await request<{ items: Community[]; nextCursor?: string | null }>(
    `/users/${userId}/communities`,
    { query: { cursor } },
  );
  return { items: r.items ?? [], nextCursor: r.nextCursor ?? null };
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

export function getPost(id: string, userId?: string): Promise<Post> {
  return request<Post>(`/posts/${id}`, { userId });
}

/**
 * POST /posts/:id/bookmark — bookmark a post for the acting user.
 * L1: NO apiKey. Identity carried via Authorization: Bearer JWT.
 * Idempotent upsert: returns { bookmarked: true } (201 or 200).
 */
export function addBookmark(
  postId: string,
  userId: string,
): Promise<{ bookmarked: boolean }> {
  return request(`/posts/${postId}/bookmark`, { method: 'POST', userId });
}

/**
 * DELETE /posts/:id/bookmark — remove a bookmark for the acting user.
 * L1: NO apiKey. Identity carried via Authorization: Bearer JWT.
 * Idempotent: deleting a non-existent bookmark still returns { bookmarked: false }.
 */
export function removeBookmark(
  postId: string,
  userId: string,
): Promise<{ bookmarked: boolean }> {
  return request(`/posts/${postId}/bookmark`, { method: 'DELETE', userId });
}

/**
 * POST /posts/:id/upvote — upvote a post for the acting user.
 * L1: NO apiKey. Identity carried via Authorization: Bearer JWT.
 * Idempotent upsert of a Vote(userId, postId). Recomputes score + hotScore.
 */
export function upvotePost(
  postId: string,
  userId: string,
): Promise<{ id: string; score: number; hotScore: number; voted: boolean }> {
  return request(`/posts/${postId}/upvote`, { method: 'POST', userId });
}

/**
 * DELETE /posts/:id/upvote — remove an upvote for the acting user.
 * L1: NO apiKey. Identity carried via Authorization: Bearer JWT.
 * Idempotent deleteMany Vote(userId, postId). Recomputes score + hotScore.
 */
export function removeUpvote(
  postId: string,
  userId: string,
): Promise<{ id: string; score: number; hotScore: number; voted: boolean }> {
  return request(`/posts/${postId}/upvote`, { method: 'DELETE', userId });
}

export interface UpdatePostBody {
  title?: string;
  body?: string;
  imageUrl?: string | null;
}

/**
 * PATCH /posts/:id — update a post's title, body, or imageUrl (author-only).
 * L1: NO apiKey. Identity carried via Authorization: Bearer JWT.
 */
export function patchPost(
  id: string,
  body: UpdatePostBody,
  userId: string,
): Promise<Post> {
  return request<Post>(`/posts/${id}`, { method: 'PATCH', body, userId });
}

/**
 * DELETE /posts/:id — delete a post (author-only).
 * L1: NO apiKey. Identity carried via Authorization: Bearer JWT.
 * Server cascades the post's children in one transaction and returns
 * { deleted: true }.
 */
export function deletePost(
  id: string,
  userId?: string,
): Promise<{ deleted: boolean }> {
  return request(`/posts/${id}`, { method: 'DELETE', userId });
}

// ---- Comments ----

/**
 * POST /posts/:id/comments — create a comment (human or AI placeholder).
 * L1: NO key crosses the wire; identity via Authorization: Bearer JWT.
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
 * server-relative URL. L1: carries Authorization: Bearer JWT (REQUIRED; server
 * 401s without it), NEVER any API key. We do NOT set Content-Type — the browser
 * sets the multipart boundary itself. Non-2xx is mapped to ApiError via the
 * server's { error } shape so the Composer can surface it as a toast.
 */
export async function uploadImage(
  file: File,
  _userId?: string,
): Promise<{ imageUrl: string }> {
  const fd = new FormData();
  fd.append('file', file);

  const uploadHeaders: Record<string, string> = {};
  const tok = getAuthToken();
  if (tok) uploadHeaders['Authorization'] = `Bearer ${tok}`;

  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    headers: uploadHeaders,
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
      tn('misc.request_failed', { status: res.status, statusText: res.statusText });
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
 * (author D1-retention basis). L1: carries ONLY Authorization: Bearer JWT,
 * NEVER any API key. Server upserts on @@unique([userId, date]); no body.
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
 * browser-side Gemini call resolves. L1: NO key. Identity via Bearer JWT when present.
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
