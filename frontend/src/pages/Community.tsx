import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ApiError,
  getCommunities,
  getCommunity,
  getCommunityDocuments,
  getCommunityPosts,
  getPosts,
} from '../api/rest';
import type {
  Community as CommunityDTO,
  DocumentSummary,
  PostListItem,
} from '../api/types';
import { useAuthStore } from '../stores/authStore';
import Avatar from '../components/Avatar';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useT } from '../i18n/useT';
import ShellPrompt from '../components/ShellPrompt';
import PageHeaderBar from '../components/PageHeaderBar';

// Robot persona tile (phosphor stroke line-art) — matches the canonical
// retro screens. Honors a community's personaIcon when present, otherwise
// falls back to the robot SVG glyph.
function RobotTile({
  personaIcon,
  className = '',
  iconSize = 20,
}: {
  personaIcon?: string | null;
  className?: string;
  iconSize?: number;
}) {
  const icon = personaIcon && personaIcon.trim() ? personaIcon : null;
  return (
    <div
      aria-hidden
      className={`flex flex-none items-center justify-center rounded-[3px] border border-term-border bg-term-screen text-term-title ${className}`}
    >
      {icon ?? (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <circle cx="9.5" cy="13" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="13" r="1.2" fill="currentColor" stroke="none" />
          <path d="M12 5v3M9 19v2.4M15 19v2.4" />
        </svg>
      )}
    </div>
  );
}

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
  const { t } = useT();
  // FR-1.4: unified search — [communities | posts] tabs sharing one query box.
  const [tab, setTab] = useState<'communities' | 'posts'>('communities');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CommunityDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // post-search state (FR-1.4): newest-first, cursor-paginated via [ load more ].
  const [postResults, setPostResults] = useState<PostListItem[]>([]);
  const [postCursor, setPostCursor] = useState<string | null>(null);
  const [postLoading, setPostLoading] = useState(false);
  const [postMoreLoading, setPostMoreLoading] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // debounced partial-match community search (active tab only)
  useEffect(() => {
    if (tab !== 'communities') return;
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
              : t('community.loadError'),
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
  }, [q, tab, t]);

  // debounced post search (active tab only) — resets to page 1 on query change.
  useEffect(() => {
    if (tab !== 'posts') return;
    let cancelled = false;
    const term = q.trim();
    setPostLoading(true);
    const timer = setTimeout(async () => {
      try {
        const page = await getPosts({ sort: 'new', q: term || undefined });
        if (!cancelled) {
          setPostResults(page.items);
          setPostCursor(page.nextCursor);
          setPostError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPostError(
            err instanceof ApiError
              ? err.message
              : t('community.postLoadError'),
          );
        }
      } finally {
        if (!cancelled) setPostLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, tab, t]);

  async function loadMorePosts() {
    if (!postCursor || postMoreLoading) return;
    setPostMoreLoading(true);
    try {
      const page = await getPosts({
        sort: 'new',
        q: q.trim() || undefined,
        cursor: postCursor,
      });
      setPostResults((prev) => [...prev, ...page.items]);
      setPostCursor(page.nextCursor);
      setPostError(null);
    } catch (err) {
      setPostError(
        err instanceof ApiError ? err.message : t('community.postLoadError'),
      );
    } finally {
      setPostMoreLoading(false);
    }
  }

  const trimmed = q.trim();

  return (
    <div className="space-y-4 font-mono">
      <PageHeaderBar>
        <h1 className="truncate text-base font-semibold text-term-title glow">
          {t('community.searchTitle')}
        </h1>
      </PageHeaderBar>
      <ShellPrompt command={`grep -ri "${q}"`} className="mb-3" />

      {/* FR-1.4: search-target tabs (communities | posts) */}
      <div
        role="tablist"
        aria-label={t('community.searchTabsAria')}
        className="flex rounded-[2px] border border-term-border"
      >
        {(['communities', 'posts'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex min-h-[44px] flex-1 items-center justify-center text-sm font-semibold transition ${
              tab === key
                ? 'border-b-2 border-term-amber bg-[rgba(255,207,74,0.06)] text-term-amber'
                : 'text-term-dim hover:text-term-bright'
            }`}
          >
            {t(
              key === 'communities'
                ? 'community.tabCommunities'
                : 'community.tabPosts',
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 focus-within:border-term-bright">
        <span aria-hidden className="text-term-cta">
          &gt;
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(
            tab === 'communities'
              ? 'community.searchPlaceholder'
              : 'community.postSearchPlaceholder',
          )}
          aria-label={t(
            tab === 'communities'
              ? 'community.searchAriaLabel'
              : 'community.postSearchAriaLabel',
          )}
          className="w-full flex-1 bg-transparent text-sm text-term-bright outline-none placeholder:text-term-dim"
        />
      </div>

      {tab === 'communities' && (
      <>
      <Link
        to="/create-community"
        state={trimmed ? { name: trimmed } : undefined}
        className="flex items-center justify-center gap-2 rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 py-3 text-sm font-bold tracking-wider text-term-title shadow-glow-cta glow-lg transition hover:border-term-bright"
      >
        {t('community.createCta')}
      </Link>

      {error && <ErrorState variant="banner" message={error} />}

      {loading && results.length === 0 ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : (
        <ul className="space-y-2">
          {results.map((c) => (
            <li key={c.id}>
              <Link
                to={`/c/${c.slug}`}
                className="flex items-center gap-3 rounded-[2px] border border-term-border bg-term-card px-3 py-2.5 transition active:bg-term-hover hover:border-term-bright"
              >
                <RobotTile
                  personaIcon={c.personaIcon}
                  className="h-[38px] w-[38px]"
                  iconSize={20}
                />
                <span className="truncate text-sm font-bold text-term-title glow">
                  {c.name}
                </span>
                {c.description && (
                  <span className="ml-auto truncate text-xs text-term-faint">
                    {c.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && results.length === 0 && (
        <div className="rounded-[2px] border border-dashed border-term-border px-3 py-4 text-center text-sm leading-relaxed text-term-dim">
          {trimmed
            ? t('community.emptyNoMatch', { q: trimmed })
            : t('community.emptyAll')}
          <br />
          <Link
            to="/create-community"
            state={trimmed ? { name: trimmed } : undefined}
            className="font-bold text-term-amber"
          >
            {trimmed
              ? t('community.emptyCreateLinkWithName', { q: trimmed })
              : t('community.emptyCreateLink')}
          </Link>
        </div>
      )}
      </>
      )}

      {tab === 'posts' && (
      <>
      {postError && <ErrorState variant="banner" message={postError} />}

      {postLoading && postResults.length === 0 ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : (
        <ul className="space-y-2">
          {postResults.map((p) => (
            <li key={p.id}>
              <Link
                to={`/p/${p.id}`}
                className="block rounded-[2px] border border-term-border bg-term-card px-3 py-2.5 transition active:bg-term-hover hover:border-term-bright"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-bold text-term-title glow">
                    {p.title}
                  </span>
                  <span className="ml-auto shrink-0 truncate text-xs text-term-faint">
                    {p.communityName}
                  </span>
                </div>
                {p.body && (
                  <p className="mt-1 truncate text-xs text-term-dim">{p.body}</p>
                )}
                <p className="mt-1 text-[11px] text-term-faint">
                  {t('community.postMeta', {
                    author: p.authorUsername,
                    score: p.score,
                    count: p.commentCount,
                  })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {postCursor && !postLoading && (
        <button
          type="button"
          onClick={() => void loadMorePosts()}
          disabled={postMoreLoading}
          className="flex min-h-[44px] w-full items-center justify-center rounded-[2px] border border-term-border text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover disabled:opacity-40"
        >
          {postMoreLoading
            ? t('community.loadingMore')
            : t('community.loadMore')}
        </button>
      )}

      {!postLoading && !postError && postResults.length === 0 && (
        <div className="rounded-[2px] border border-dashed border-term-border px-3 py-4 text-center text-sm leading-relaxed text-term-dim">
          {trimmed
            ? t('community.postEmptyNoMatch', { q: trimmed })
            : t('community.postEmptyAll')}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function CommunityDetail({ slug }: { slug: string }) {
  const { t } = useT();
  const userId = useAuthStore((s) => s.userId);
  const [activeSort] = useState<'new' | 'top'>('new');

  // FR-13.6: body tab — posts (default) | condensed documents. Same segmented
  // tablist idiom as the search screen (title bar = page identity, body tab =
  // content switch).
  const [tab, setTab] = useState<'posts' | 'documents'>('posts');
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [docCursor, setDocCursor] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docMoreLoading, setDocMoreLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  // null until the first fetch resolves, so the tab label shows no count yet.
  const [docLoaded, setDocLoaded] = useState(false);

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
          getCommunityPosts(slug, userId ?? undefined),
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
              : t('community.loadError'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey, t]);

  const isCreator = useMemo(
    () => !!community && !!userId && community.creatorId === userId,
    [community, userId],
  );

  // FR-13.6: lazily load the document tab the first time it is opened, and again
  // whenever the slug changes (the loaded flag resets with it).
  useEffect(() => {
    setDocuments([]);
    setDocCursor(null);
    setDocError(null);
    setDocLoaded(false);
  }, [slug]);

  useEffect(() => {
    if (tab !== 'documents' || docLoaded) return;
    let cancelled = false;
    setDocLoading(true);
    setDocError(null);
    (async () => {
      try {
        const page = await getCommunityDocuments(slug);
        if (cancelled) return;
        setDocuments(page.items);
        setDocCursor(page.nextCursor);
        setDocLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setDocError(
          err instanceof ApiError ? err.message : t('document.listError'),
        );
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, docLoaded, slug, t]);

  async function loadMoreDocuments() {
    if (!docCursor || docMoreLoading) return;
    setDocMoreLoading(true);
    try {
      const page = await getCommunityDocuments(slug, docCursor);
      setDocuments((prev) => [...prev, ...page.items]);
      setDocCursor(page.nextCursor);
    } catch (err) {
      setDocError(err instanceof ApiError ? err.message : t('document.listError'));
    } finally {
      setDocMoreLoading(false);
    }
  }

  if (loading) {
    return <LoadingState />;
  }
  if (notFound) {
    return (
      <EmptyState
        title={t('community.notFoundTitle')}
        hint={t('community.notFoundHint')}
        action={
          <Link
            to="/search"
            className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright"
          >
            {t('community.notFoundAction')}
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
    return <EmptyState title={t('community.notFoundTitle')} />;
  }

  return (
    <div className="space-y-5 font-mono">
      <PageHeaderBar>
        <RobotTile
          personaIcon={community.personaIcon}
          className="h-7 w-7 shrink-0 rounded-[3px]"
          iconSize={16}
        />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-term-title glow">
          {community.name}
        </h1>
      </PageHeaderBar>
      <ShellPrompt command={`feed r/${slug} --sort=${activeSort}`} className="mb-3" />
      {/* header */}
      <header className="space-y-4 border-b border-term-border pb-5">
        <div className="flex items-center gap-3">
          <RobotTile
            personaIcon={community.personaIcon}
            className="h-[46px] w-[46px] rounded-[4px]"
            iconSize={26}
          />
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-term-title glow">
            {community.name}
          </h1>
          {isCreator && (
            <Link
              to={`/create-community`}
              state={{ editSlug: community.slug }}
              className="shrink-0 rounded-[2px] border border-term-border px-2 py-1 text-xs text-term-dim transition hover:border-term-bright hover:text-term-bright"
              aria-label={t('community.editAriaLabel')}
              title={t('community.editTitle')}
            >
              {t('community.editButtonLabel')}
            </Link>
          )}
        </div>

        {community.description && (
          <p className="text-sm text-term-dim">{community.description}</p>
        )}

        <div className="relative rounded-[2px] border border-term-border bg-term-card px-4 py-3.5">
          <span
            aria-hidden
            className="absolute -top-1 left-[13px] bg-term-tag px-1.5 text-[9px] tracking-wider text-term-faint"
          >
            PERSONA
          </span>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-term-dim">
            {community.personaPrompt}
          </p>
        </div>

        <Link
          to={`/c/${community.slug}/create-post`}
          className="flex items-center justify-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 py-3 text-sm font-bold tracking-wider text-term-title shadow-glow-cta glow-lg transition hover:border-term-bright"
        >
          {t('community.writePost')}
        </Link>
      </header>

      {/* FR-13.6: body tabs — [게시글 | 문서] */}
      <div
        role="tablist"
        aria-label={t('community.bodyTabsAria')}
        className="flex rounded-[2px] border border-term-border"
      >
        {(['posts', 'documents'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex min-h-[44px] flex-1 items-center justify-center text-sm font-semibold transition ${
              tab === key
                ? 'border-b-2 border-term-amber bg-[rgba(255,207,74,0.06)] text-term-amber'
                : 'text-term-dim hover:text-term-bright'
            }`}
          >
            {key === 'posts'
              ? t('community.tabPosts')
              : docLoaded
                ? t('document.tabLabelWithCount', { count: String(documents.length) })
                : t('document.tabLabel')}
          </button>
        ))}
      </div>

      {/* documents (FR-13.6) */}
      {tab === 'documents' && (
        <section className="space-y-2">
          {docError && <ErrorState variant="banner" message={docError} />}
          {docLoading ? (
            <LoadingState variant="skeleton" rows={3} />
          ) : documents.length === 0 ? (
            <EmptyState
              title={t('document.emptyTitle')}
              hint={t('document.emptyHint')}
              className="py-10"
            />
          ) : (
            <>
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id}>
                    <Link
                      to={`/d/${d.id}`}
                      className="block rounded-[2px] border border-term-border bg-term-card px-4 py-3.5 transition active:bg-term-hover hover:border-term-bright"
                    >
                      <p className="truncate text-base font-bold text-term-title glow">
                        {d.title}
                      </p>
                      {d.preview && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-term-dim">
                          {d.preview}
                        </p>
                      )}
                      {d.postTitle && (
                        <p className="mt-1.5 truncate text-xs text-term-faint">
                          {t('document.fromPost', { title: d.postTitle })}
                        </p>
                      )}
                      <p className="mt-2 flex items-center gap-2 text-xs text-term-faint">
                        <Avatar
                          kind="user"
                          seed={d.authorUsername ?? t('document.anonymous')}
                          size="sm"
                        />
                        <span className="truncate">
                          u/{d.authorUsername ?? t('document.anonymous')}
                        </span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
              {docCursor && (
                <button
                  type="button"
                  onClick={() => void loadMoreDocuments()}
                  disabled={docMoreLoading}
                  className="flex min-h-[44px] w-full items-center justify-center rounded-[2px] border border-term-border text-sm text-term-dim transition hover:border-term-bright hover:text-term-bright disabled:opacity-50"
                >
                  {t('document.loadMore')}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* posts */}
      {tab === 'posts' && (
      <section className="space-y-2">
        <h2 className="text-xs font-semibold tracking-wider text-term-faint">
          {t('community.postsSection')}
        </h2>
        {posts.length === 0 ? (
          <EmptyState
            title={t('community.noPostsTitle')}
            hint={t('community.noPostsHint')}
            action={
              <Link
                to={`/c/${community.slug}/create-post`}
                className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright"
              >
                {t('community.firstPost')}
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
                  className="block rounded-[2px] border border-term-border bg-term-card px-4 py-3.5 transition active:bg-term-hover hover:border-term-bright"
                >
                  <p className="truncate text-base font-bold text-term-title glow">
                    {p.title}
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-sm text-term-dim">
                    {p.body}
                  </p>
                  <p className="mt-3 flex items-center gap-2 text-xs text-term-faint">
                    <Avatar kind="user" seed={p.authorUsername} size="sm" />
                    {t('community.postMeta', {
                      author: p.authorUsername,
                      score: String(p.score),
                      count: String(p.commentCount),
                    })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}
