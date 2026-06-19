import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPosts, ApiError, type PostSort } from '../api/rest';
import type { PostListItem } from '../api/types';
import PostCard from '../components/PostCard';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useAuthStore } from '../stores/authStore';

type Tab = Extract<PostSort, 'hot' | 'new'>;

const TABS: { key: Tab; label: string }[] = [
  { key: 'hot', label: '인기' },
  { key: 'new', label: '최신' },
];

export default function Home() {
  const myUserId = useAuthStore((s) => s.userId);
  const [sort, setSort] = useState<Tab>('hot');
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Track the in-flight request so a tab switch cancels stale appends.
  const reqRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (nextSort: Tab, cursor?: string) => {
      const reqId = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const { items, nextCursor: serverCursor } = await getPosts(
          { sort: nextSort, cursor },
          myUserId ?? undefined,
        );
        if (reqRef.current !== reqId) return; // superseded
        setPosts((prev) => (cursor ? [...prev, ...items] : items));
        setNextCursor(serverCursor);
        setDone(serverCursor == null);
      } catch (err) {
        if (reqRef.current !== reqId) return;
        setError(
          err instanceof ApiError
            ? err.message
            : '글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
      } finally {
        if (reqRef.current === reqId) {
          setLoading(false);
          setInitialized(true);
        }
      }
    },
    [myUserId],
  );

  // Reset + load whenever the tab changes.
  useEffect(() => {
    setPosts([]);
    setDone(false);
    setNextCursor(null);
    setInitialized(false);
    void loadPage(sort);
  }, [sort, loadPage]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done || loading || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadPage(sort, nextCursor);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [posts, done, loading, nextCursor, sort, loadPage]);

  const isEmpty = initialized && !error && posts.length === 0;

  return (
    <div className="pb-4">
      {/* tabs */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-term-border bg-term-screen px-4">
        <div className="flex">
          {TABS.map((t) => {
            const active = sort === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSort(t.key)}
                aria-pressed={active}
                className={`min-h-[44px] flex-1 border-b-2 text-sm font-semibold transition ${
                  active
                    ? 'border-term-amber bg-[rgba(255,207,74,0.06)] text-term-amber'
                    : 'border-transparent text-term-dim hover:text-term-bright'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* terminal prompt line */}
      <div className="mb-3 text-xs text-term-faint">
        aidit@yoon:~$ feed --sort={sort}{' '}
        <span aria-hidden className="term-cursor" />
      </div>

      {error && (
        <ErrorState
          variant="banner"
          message={error}
          onRetry={() => void loadPage(sort)}
          className="mb-3"
        />
      )}

      {/* first-load skeleton (before we know whether the list is empty) */}
      {!initialized && loading && posts.length === 0 && (
        <LoadingState variant="skeleton" rows={5} />
      )}

      {isEmpty && (
        <EmptyState
          title={sort === 'hot' ? '아직 인기글이 없어요.' : '아직 글이 없어요.'}
          action={
            <Link
              to="/create-post"
              className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition"
            >
              + 첫 글 쓰기
            </Link>
          }
        />
      )}

      {posts.length > 0 && (
        <div className="space-y-2">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      {/* loading + infinite-scroll sentinel */}
      {!isEmpty && (
        <div
          ref={sentinelRef}
          className="flex justify-center py-6 text-xs text-term-faint"
        >
          {loading && posts.length > 0
            ? '불러오는 중…'
            : done && posts.length > 0
              ? '— EOF · 마지막 글이에요 —'
              : ''}
        </div>
      )}
    </div>
  );
}
