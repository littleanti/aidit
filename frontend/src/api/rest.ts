import type {
  Community,
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

export function getPosts(params: GetPostsParams = {}): Promise<PostListItem[]> {
  return request<PostListItem[]>('/posts', {
    query: { sort: params.sort, cursor: params.cursor },
  });
}

export function getCommunityPosts(slug: string): Promise<PostListItem[]> {
  return request<PostListItem[]>(`/communities/${slug}/posts`);
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
