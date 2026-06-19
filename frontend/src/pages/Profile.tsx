import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { getUserCommunities, getUserPosts, getUserBookmarks, ApiError } from '../api/rest';
import type { Community, PostListItem } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import PostCard from '../components/PostCard';
import PersonaBadge from '../components/PersonaBadge';
import Avatar from '../components/Avatar';

// FE: 👤 나 — profile page (WIREFRAME §9).
// L1: googleApiKey is LOCAL ONLY. It is shown MASKED here and never logged,
// never sent to the server. Key changes go through authStore.updateKey.

type LoadState = 'loading' | 'error' | 'ready';

/** Show only that a key is set + its last 4 chars; never reveal the full key. */
function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `••••••••${trimmed.slice(-4)}`;
}

export default function Profile() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const googleApiKey = useAuthStore((s) => s.googleApiKey);
  const updateKey = useAuthStore((s) => s.updateKey);
  const logout = useAuthStore((s) => s.logout);

  // ---- key editing (local only) ----
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  // ---- my content ----
  const [communities, setCommunities] = useState<Community[]>([]);
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [bookmarks, setBookmarks] = useState<PostListItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    Promise.all([getUserCommunities(userId), getUserPosts(userId), getUserBookmarks(userId)])
      .then(([cs, ps, bks]) => {
        if (cancelled) return;
        setCommunities(cs);
        setPosts(ps);
        setBookmarks(bks);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : '내 활동을 불러오지 못했습니다.';
        setError(msg);
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

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
          title="로그인이 필요합니다."
          hint="로그인하면 내 글과 커뮤니티를 볼 수 있어요."
          action={
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright"
            >
              [ 로그인 ]
            </Link>
          }
        />
      </div>
    );
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function startEditKey() {
    setKeyDraft('');
    setEditingKey(true);
  }

  function saveKey() {
    const next = keyDraft.trim();
    if (!next) return;
    updateKey(next); // L1: local only — never crosses the network.
    setKeyDraft('');
    setEditingKey(false);
  }

  function cancelEditKey() {
    setKeyDraft('');
    setEditingKey(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-6 font-mono">
      {/* header */}
      <header className="flex items-center gap-3">
        <Avatar kind="user" seed={username} size="md" />
        <h1 className="truncate text-xl font-bold text-term-title">
          {username}
        </h1>
      </header>

      {/* API Key */}
      <section className="relative rounded-[2px] border border-term-border bg-term-card p-4 shadow-term-glow">
        <span className="absolute -top-2 left-3 select-none bg-term-tag px-1.5 text-[11px] font-bold uppercase tracking-wider text-term-faint">
          API KEY
        </span>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-term-bright">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          >
            <circle cx="8" cy="8" r="4" />
            <path d="M11 11l8 8M16 16l2-2M19 19l2-2" />
          </svg>
          API 키
        </h2>

        {!editingKey ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-term-dim">
              {googleApiKey ? maskKey(googleApiKey) : '키가 설정되지 않았습니다.'}
            </span>
            <button
              type="button"
              onClick={startEditKey}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover"
            >
              [ 변경 ]
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza..."
              className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-dim focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveKey}
                disabled={!keyDraft.trim()}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
              >
                [ 저장 ]
              </button>
              <button
                type="button"
                onClick={cancelEditKey}
                className="inline-flex min-h-[44px] items-center justify-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover"
              >
                [ 숨김 ]
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 rounded-[2px] bg-term-info px-3 py-2 text-xs leading-relaxed text-term-amber">
          키는 이 기기(localStorage)에만 저장됩니다.
        </p>
      </section>

      {/* 로그아웃 (FR-2.4) */}
      <section className="rounded-[2px] border border-term-border bg-term-card p-4 shadow-term-glow">
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[2px] border border-term-danger px-4 text-sm font-semibold text-term-danger transition hover:bg-term-hover"
        >
          [ 로그아웃 ]
        </button>
      </section>

      {/* 내가 만든 커뮤니티 + 내 글 */}
      {state === 'loading' && <LoadingState label="내 활동을 불러오는 중…" />}

      {state === 'error' && (
        <ErrorState
          message={error ?? '내 활동을 불러오지 못했습니다.'}
          onRetry={() => {
            // re-trigger the effect by toggling state; simplest is a reload of
            // the same userId-bound fetch.
            setState('loading');
            setError(null);
            Promise.all([getUserCommunities(userId), getUserPosts(userId), getUserBookmarks(userId)])
              .then(([cs, ps, bks]) => {
                setCommunities(cs);
                setPosts(ps);
                setBookmarks(bks);
                setState('ready');
              })
              .catch((err) => {
                const msg =
                  err instanceof ApiError
                    ? err.message
                    : '내 활동을 불러오지 못했습니다.';
                setError(msg);
                setState('error');
              });
          }}
        />
      )}

      {state === 'ready' && (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-term-faint">
              // 내가 만든 커뮤니티
            </h2>
            {communities.length === 0 ? (
              <div className="rounded-[2px] border border-dashed border-term-border bg-term-card/40 py-2">
                <EmptyState
                  title="아직 만든 커뮤니티가 없어요."
                  hint="새 커뮤니티를 만들어 대화를 시작해 보세요."
                  action={
                    <Link
                      to="/create-community"
                      className="inline-flex min-h-[44px] items-center rounded-[2px] border border-term-border px-4 text-sm font-semibold text-term-bright transition hover:border-term-bright hover:bg-term-hover"
                    >
                      [ 커뮤니티 만들기 ]
                    </Link>
                  }
                />
              </div>
            ) : (
              <ul className="space-y-2">
                {communities.map((c) => (
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
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-term-faint">
              // 내 글
            </h2>
            {posts.length === 0 ? (
              <div className="rounded-[2px] border border-dashed border-term-border bg-term-card/40 py-2">
                <EmptyState
                  title="아직 작성한 글이 없어요."
                  hint="커뮤니티에서 첫 글을 남겨 보세요."
                />
              </div>
            ) : (
              <div className="space-y-2">
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-term-faint">
              // 북마크한 글
            </h2>
            {bookmarks.length === 0 ? (
              <div className="rounded-[2px] border border-dashed border-term-border bg-term-card/40 py-2">
                <EmptyState
                  title="아직 북마크한 글이 없어요."
                  hint="글 상단의 🔖 로 저장한 글이 여기 모여요."
                />
              </div>
            ) : (
              <div className="space-y-2">
                {bookmarks.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
