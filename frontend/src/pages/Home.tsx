import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPosts, ApiError, type PostSort } from '../api/rest';
import type { PostListItem } from '../api/types';
import PageHeaderBar from '../components/PageHeaderBar';
import PostCard from '../components/PostCard';
import ShellPrompt from '../components/ShellPrompt';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useAuthStore } from '../stores/authStore';
import { useT } from '../i18n/useT';

type Tab = Extract<PostSort, 'hot' | 'new'>;

export default function Home() {
  const { t } = useT();
  const myUserId = useAuthStore((s) => s.userId);
  const [sort, setSort] = useState<Tab>('hot');

  const TABS: { key: Tab; label: string }[] = [
    { key: 'hot', label: t('home.tabHot') },
    { key: 'new', label: t('home.tabNew') },
  ];
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
            : t('home.loadError'),
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
      {/* fixed top bar — unified with Search/Write/Profile/Settings: the bar
          holds the page TITLE; the 인기/최신 sort tabs live in the body below
          the ShellPrompt (same tablist pattern as the search page). */}
      <PageHeaderBar>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-term-title glow">
          {t('home.title')}
        </h1>
      </PageHeaderBar>

      {/* terminal prompt line — directly under the fixed bar, mt-4 = unified
          16px gap between the bar and the ShellPrompt (same as Search/Write). */}
      <ShellPrompt command={`feed --sort=${sort}`} className="mt-4 mb-3" />

      {/* in-body sort tabs — same segmented tablist style as the search page.
          Not sticky (a switch resets the list to the top anyway). */}
      <div
        role="tablist"
        aria-label={t('home.sortTabsAria')}
        className="mb-3 flex rounded-[2px] border border-term-border"
      >
        {TABS.map((tab) => {
          const active = sort === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSort(tab.key)}
              className={`flex min-h-[44px] flex-1 items-center justify-center text-sm font-semibold transition ${
                active
                  ? 'border-b-2 border-term-amber bg-[rgba(255,207,74,0.06)] text-term-amber'
                  : 'text-term-dim hover:text-term-bright'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
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
          title={sort === 'hot' ? t('home.emptyHot') : t('home.emptyNew')}
          action={
            <Link
              to="/create-post"
              className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition"
            >
              {t('home.writeFirst')}
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
            ? t('home.loading')
            : done && posts.length > 0
              ? t('home.eof')
              : ''}
        </div>
      )}
    </div>
  );
}
