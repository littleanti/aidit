import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  getUserCommunities,
  getUserPosts,
  getUserBookmarks,
} from '../api/rest';
import type { Community, PostListItem } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import PostCard from '../components/PostCard';
import PersonaBadge from '../components/PersonaBadge';
import Avatar from '../components/Avatar';
import { useT } from '../i18n/useT';
import ShellPrompt from '../components/ShellPrompt';
import { usePagedList } from '../hooks/usePagedList';

// FE: 👤 나 — profile page, now a TABBED activity view (WIREFRAME §9 redesign).
// API Key / Language / Logout settings moved out to /me/settings (Settings.tsx).
// Each tab fetches lazily and paginates with the same infinite-scroll mechanism
// as the Home feed (IntersectionObserver sentinel + opaque nextCursor).

type Tab = 'communities' | 'posts' | 'bookmarks';

// Per-tab terminal command (NOT translated — shell idiom, identical KO/EN).
const TAB_COMMAND: Record<Tab, string> = {
  communities: 'ls ~/communities',
  posts: 'ls ~/posts',
  bookmarks: 'ls ~/bookmarks',
};

export default function Profile() {
  const { t } = useT();
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const [tab, setTab] = useState<Tab>('communities');

  // ---- not logged in ----
  if (!userId) {
    return (
      <div className="mx-auto max-w-md py-8 font-mono">
        <EmptyState
          icon={
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="currentColor"
            >
              <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-3.31-3.58-6-8-6Z" />
            </svg>
          }
          title={t('profile.loginRequired')}
          hint={t('profile.loginHint')}
          action={
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright"
            >
              {t('profile.loginBtn')}
            </Link>
          }
        />
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'communities', label: t('profile.tabCommunities') },
    { key: 'posts', label: t('profile.tabPosts') },
    { key: 'bookmarks', label: t('profile.tabBookmarks') },
  ];

  return (
    <div className="mx-auto max-w-2xl py-6 font-mono">
      {/* header: avatar + username + settings entry point */}
      <header className="mb-4 flex items-center gap-3">
        <Avatar kind="user" seed={username} size="md" />
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-term-title">
          {username}
        </h1>
        <Link
          to="/me/settings"
          aria-label={t('profile.settingsLink')}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[2px] border border-term-border px-3 text-sm font-semibold text-term-dim transition hover:border-term-bright hover:text-term-bright"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" />
          </svg>
          <span className="hidden sm:inline">{t('profile.settingsLink')}</span>
        </Link>
      </header>

      {/* tabs — same terminal/amber segmented style as the Home feed */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-term-border bg-term-screen px-4">
        <div className="flex">
          {TABS.map((tabDef) => {
            const active = tab === tabDef.key;
            return (
              <button
                key={tabDef.key}
                type="button"
                onClick={() => setTab(tabDef.key)}
                aria-pressed={active}
                className={`min-h-[44px] flex-1 border-b-2 text-sm font-semibold transition ${
                  active
                    ? 'border-term-amber bg-[rgba(255,207,74,0.06)] text-term-amber'
                    : 'border-transparent text-term-dim hover:text-term-bright'
                }`}
              >
                {tabDef.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* terminal prompt line — per-tab command */}
      <ShellPrompt command={TAB_COMMAND[tab]} className="mb-3" />

      {/* Only the active tab is mounted, so only it fetches + paginates. */}
      {tab === 'communities' && <CommunitiesTab userId={userId} />}
      {tab === 'posts' && <PostsTab userId={userId} />}
      {tab === 'bookmarks' && <BookmarksTab userId={userId} />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tab panels. Each owns its own usePagedList instance so its cursor/loading/
// done state is independent and only fetches while mounted (lazy per tab).
// ----------------------------------------------------------------------------

function CommunitiesTab({ userId }: { userId: string }) {
  const { t } = useT();
  const { items, loading, error, done, initialized, sentinelRef, reload } =
    usePagedList<Community>({
      resetKey: `communities:${userId}`,
      errorFallback: t('profile.loadError'),
      fetcher: (cursor) => getUserCommunities(userId, cursor),
    });

  const isEmpty = initialized && !error && items.length === 0;

  return (
    <>
      {error && (
        <ErrorState
          variant="banner"
          message={error}
          onRetry={reload}
          className="mb-3"
        />
      )}

      {!initialized && loading && items.length === 0 && (
        <LoadingState variant="skeleton" rows={5} />
      )}

      {isEmpty && (
        <div className="rounded-[2px] border border-dashed border-term-border bg-term-card/40 py-2">
          <EmptyState
            title={t('profile.noCommunityTitle')}
            hint={t('profile.noCommunityHint')}
            action={
              <Link
                to="/create-community"
                className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover"
              >
                {t('profile.createCommunityBtn')}
              </Link>
            }
          />
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/c/${c.slug}`}
                className="flex items-center justify-between gap-3 rounded-[2px] border border-term-border bg-term-card px-4 py-3 shadow-term-glow transition active:bg-term-hover hover:border-term-bright"
              >
                <PersonaBadge
                  personaIcon={c.personaIcon}
                  name={c.name}
                  size="sm"
                  className="min-w-0"
                />
                <span className="shrink-0 text-xs text-term-faint">
                  r/{c.slug}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Sentinel
        sentinelRef={sentinelRef}
        loading={loading}
        done={done}
        hasItems={items.length > 0}
        isEmpty={isEmpty}
      />
    </>
  );
}

function PostsTab({ userId }: { userId: string }) {
  const { t } = useT();
  const { items, loading, error, done, initialized, sentinelRef, reload } =
    usePagedList<PostListItem>({
      resetKey: `posts:${userId}`,
      errorFallback: t('profile.loadError'),
      fetcher: (cursor) => getUserPosts(userId, cursor, userId),
    });

  const isEmpty = initialized && !error && items.length === 0;

  return (
    <>
      {error && (
        <ErrorState
          variant="banner"
          message={error}
          onRetry={reload}
          className="mb-3"
        />
      )}

      {!initialized && loading && items.length === 0 && (
        <LoadingState variant="skeleton" rows={5} />
      )}

      {isEmpty && (
        <div className="rounded-[2px] border border-dashed border-term-border bg-term-card/40 py-2">
          <EmptyState
            title={t('profile.noPostTitle')}
            hint={t('profile.noPostHint')}
          />
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      <Sentinel
        sentinelRef={sentinelRef}
        loading={loading}
        done={done}
        hasItems={items.length > 0}
        isEmpty={isEmpty}
      />
    </>
  );
}

function BookmarksTab({ userId }: { userId: string }) {
  const { t } = useT();
  const { items, loading, error, done, initialized, sentinelRef, reload } =
    usePagedList<PostListItem>({
      resetKey: `bookmarks:${userId}`,
      errorFallback: t('profile.loadError'),
      fetcher: (cursor) => getUserBookmarks(userId, cursor, userId),
    });

  const isEmpty = initialized && !error && items.length === 0;

  return (
    <>
      {error && (
        <ErrorState
          variant="banner"
          message={error}
          onRetry={reload}
          className="mb-3"
        />
      )}

      {!initialized && loading && items.length === 0 && (
        <LoadingState variant="skeleton" rows={5} />
      )}

      {isEmpty && (
        <div className="rounded-[2px] border border-dashed border-term-border bg-term-card/40 py-2">
          <EmptyState
            title={t('profile.noBookmarkTitle')}
            hint={t('profile.noBookmarkHint')}
          />
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      <Sentinel
        sentinelRef={sentinelRef}
        loading={loading}
        done={done}
        hasItems={items.length > 0}
        isEmpty={isEmpty}
      />
    </>
  );
}

// Shared infinite-scroll sentinel + loading/EOF line (Home feed idiom).
function Sentinel({
  sentinelRef,
  loading,
  done,
  hasItems,
  isEmpty,
}: {
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>;
  loading: boolean;
  done: boolean;
  hasItems: boolean;
  isEmpty: boolean;
}) {
  const { t } = useT();
  if (isEmpty) return null;
  return (
    <div
      ref={sentinelRef}
      className="flex justify-center py-6 text-xs text-term-faint"
    >
      {loading && hasItems
        ? t('profile.loading')
        : done && hasItems
          ? t('profile.eof')
          : ''}
    </div>
  );
}
