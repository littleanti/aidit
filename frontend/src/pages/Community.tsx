import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ApiError,
  getCommunities,
  getCommunity,
  getCommunityPosts,
} from '../api/rest';
import type { Community as CommunityDTO, PostListItem } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import PersonaBadge from '../components/PersonaBadge';
import Avatar from '../components/Avatar';
import { EmptyState, ErrorState, LoadingState } from '../components/states';

// FE-5: community detail (/c/:slug). The slug-less case redirects to the
// dedicated '/search' route which renders <CommunitySearch /> (see Search.tsx),
// so the search experience lives at a single canonical URL.
export default function Community() {
  const { slug } = useParams<{ slug: string }>();
  return slug ? <CommunityDetail slug={slug} /> : <Navigate to="/search" replace />;
}

// ---------------------------------------------------------------------------
// Search view
// ---------------------------------------------------------------------------

export function CommunitySearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CommunityDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // debounced partial-match search
  useEffect(() => {
    let cancelled = false;
    const term = q.trim();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const list = await getCommunities(term || undefined);
        if (!cancelled) {
          setResults(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : '커뮤니티를 불러오지 못했습니다.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const trimmed = q.trim();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-800">커뮤니티 검색</h1>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="커뮤니티 이름으로 검색"
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
      />

      {error && <ErrorState variant="banner" message={error} />}

      {loading && results.length === 0 ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : (
        <ul className="space-y-2">
          {results.map((c) => (
            <li key={c.id}>
              <Link
                to={`/c/${c.slug}`}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition active:bg-slate-50 hover:border-brand/40"
              >
                <PersonaBadge
                  personaIcon={c.personaIcon}
                  name={c.name}
                  size="sm"
                />
                {c.description && (
                  <span className="ml-auto truncate text-xs text-slate-500">
                    {c.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && results.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
          결과 없음?{' '}
          <Link
            to="/create-community"
            state={trimmed ? { name: trimmed } : undefined}
            className="font-semibold text-brand underline"
          >
            + {trimmed ? `'${trimmed}' ` : ''}만들기
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function CommunityDetail({ slug }: { slug: string }) {
  const userId = useAuthStore((s) => s.userId);

  const [community, setCommunity] = useState<CommunityDTO | null>(null);
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinct from a transient load error: a 404 means the slug doesn't exist,
  // so we show a dedicated not-found state with a way back instead of a retry.
  const [notFound, setNotFound] = useState(false);

  // reload nonce: bump to re-run the fetch effect (used by the retry button).
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      try {
        // Resolve the EXACT community by slug (no partial-search / first-match
        // fallback, which could surface the wrong community), then its posts.
        const [found, postList] = await Promise.all([
          getCommunity(slug),
          getCommunityPosts(slug),
        ]);
        if (cancelled) return;
        setCommunity(found);
        setPosts(postList);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(
            err instanceof ApiError
              ? err.message
              : '커뮤니티를 불러오지 못했습니다.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  const isCreator = useMemo(
    () => !!community && !!userId && community.creatorId === userId,
    [community, userId],
  );

  if (loading) {
    return <LoadingState />;
  }
  if (notFound) {
    return (
      <EmptyState
        title="커뮤니티를 찾을 수 없어요"
        hint="주소가 바뀌었거나 삭제된 커뮤니티일 수 있어요."
        action={
          <Link
            to="/search"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            커뮤니티 검색으로
          </Link>
        }
        className="py-10"
      />
    );
  }
  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }
  if (!community) {
    return <EmptyState title="커뮤니티를 찾을 수 없어요" />;
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="space-y-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <PersonaBadge
            personaIcon={community.personaIcon}
            name={community.name}
            size="lg"
            className="min-w-0 flex-1"
          />
          {isCreator && (
            <Link
              to={`/create-community`}
              state={{ editId: community.id }}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:border-brand hover:text-brand"
              aria-label="페르소나 편집"
              title="페르소나 편집"
            >
              ✎ 편집
            </Link>
          )}
        </div>

        {community.description && (
          <p className="text-sm text-slate-600">{community.description}</p>
        )}

        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="mb-1 text-xs font-semibold text-slate-500">페르소나</p>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-slate-700">
            {community.personaPrompt}
          </p>
        </div>

        <Link
          to={`/c/${community.slug}/create-post`}
          className="inline-block rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          + 이 커뮤니티에 글쓰기
        </Link>
      </header>

      {/* posts */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">글</h2>
        {posts.length === 0 ? (
          <EmptyState
            title="아직 글이 없습니다."
            hint="첫 글을 작성해 보세요."
            action={
              <Link
                to={`/c/${community.slug}/create-post`}
                className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
              >
                + 첫 글 쓰기
              </Link>
            }
            className="py-10"
          />
        ) : (
          <ul className="space-y-2">
            {posts.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/p/${p.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition active:bg-slate-50 hover:border-brand/40"
                >
                  <p className="truncate font-medium text-slate-800">
                    {p.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                    {p.body}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                    <Avatar kind="user" seed={p.authorUsername} size="sm" />
                    u/{p.authorUsername} · 점수 {p.score} · 댓글{' '}
                    {p.commentCount}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
