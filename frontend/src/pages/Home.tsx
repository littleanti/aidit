import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPosts, ApiError, type PostSort } from '../api/rest';
import type { PostListItem } from '../api/types';
import PostCard from '../components/PostCard';

type Tab = Extract<PostSort, 'hot' | 'new'>;

const TABS: { key: Tab; label: string }[] = [
  { key: 'hot', label: '인기' },
  { key: 'new', label: '최신' },
];

export default function Home() {
  const [sort, setSort] = useState<Tab>('hot');
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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
        const page = await getPosts({ sort: nextSort, cursor });
        if (reqRef.current !== reqId) return; // superseded
        setPosts((prev) => (cursor ? [...prev, ...page] : page));
        if (page.length === 0) setDone(true);
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
    [],
  );

  // Reset + load whenever the tab changes.
  useEffect(() => {
    setPosts([]);
    setDone(false);
    setInitialized(false);
    void loadPage(sort);
  }, [sort, loadPage]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done || loading || posts.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const last = posts[posts.length - 1];
          void loadPage(sort, last.id);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [posts, done, loading, sort, loadPage]);

  const isEmpty = initialized && !error && posts.length === 0;

  return (
    <div className="pb-4">
      {/* tabs */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-slate-200 bg-white px-4">
        <div className="flex gap-1">
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
                    ? 'border-brand text-brand'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => void loadPage(sort)}
            className="ml-2 font-semibold underline"
          >
            다시 시도
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-slate-500">
            {sort === 'hot'
              ? '아직 인기글이 없어요.'
              : '아직 글이 없어요.'}
          </p>
          <Link
            to="/create-post"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            + 첫 글 쓰기
          </Link>
        </div>
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
          className="flex justify-center py-6 text-xs text-slate-400"
        >
          {loading
            ? '불러오는 중…'
            : done && posts.length > 0
              ? '마지막 글이에요'
              : ''}
        </div>
      )}
    </div>
  );
}
