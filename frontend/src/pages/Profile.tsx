import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { getUserCommunities, getUserPosts, ApiError } from '../api/rest';
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
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    Promise.all([getUserCommunities(userId), getUserPosts(userId)])
      .then(([cs, ps]) => {
        if (cancelled) return;
        setCommunities(cs);
        setPosts(ps);
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
      <div className="mx-auto max-w-md py-8">
        <EmptyState
          icon="👤"
          title="로그인이 필요합니다."
          hint="로그인하면 내 글과 커뮤니티를 볼 수 있어요."
          action={
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              로그인
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
    <div className="mx-auto max-w-2xl space-y-8 py-6">
      {/* header */}
      <header className="flex items-center gap-3">
        <Avatar kind="user" seed={username} size="md" />
        <h1 className="truncate text-xl font-bold text-slate-900">
          {username}
        </h1>
      </header>

      {/* 🔑 API Key */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <span aria-hidden>🔑</span> API 키
        </h2>

        {!editingKey ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-600">
              {googleApiKey ? maskKey(googleApiKey) : '키가 설정되지 않았습니다.'}
            </span>
            <button
              type="button"
              onClick={startEditKey}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
            >
              변경
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
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveKey}
                disabled={!keyDraft.trim()}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                onClick={cancelEditKey}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
              >
                취소
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          키는 이 기기(localStorage)에만 저장됩니다.
        </p>
      </section>

      {/* 로그아웃 (FR-2.4) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50"
        >
          로그아웃
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
            Promise.all([getUserCommunities(userId), getUserPosts(userId)])
              .then(([cs, ps]) => {
                setCommunities(cs);
                setPosts(ps);
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
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              내가 만든 커뮤니티
            </h2>
            {communities.length === 0 ? (
              <EmptyState
                title="아직 만든 커뮤니티가 없어요."
                hint="새 커뮤니티를 만들어 대화를 시작해 보세요."
                action={
                  <Link
                    to="/create-community"
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
                  >
                    커뮤니티 만들기
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-2">
                {communities.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/c/${c.slug}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition active:bg-slate-50 hover:border-brand/40"
                    >
                      <PersonaBadge
                        personaIcon={c.personaIcon}
                        name={c.name}
                        size="sm"
                        className="min-w-0"
                      />
                      <span className="shrink-0 text-xs text-slate-400">
                        r/{c.slug}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">내 글</h2>
            {posts.length === 0 ? (
              <EmptyState
                title="아직 작성한 글이 없어요."
                hint="커뮤니티에서 첫 글을 남겨 보세요."
              />
            ) : (
              <div className="space-y-2">
                {posts.map((p) => (
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
