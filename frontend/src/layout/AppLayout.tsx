import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { pingGemini } from '../engine/geminiStatus';
import { setOnAuthExpired } from '../lib/authEvents';
import BottomTabBar from './BottomTabBar';
import Logo from '../components/Logo';
import LoginModal from '../components/LoginModal';
import GeminiStatusBadge from '../components/GeminiStatusBadge';

// Mobile-first shell.
//  <768px : single column + bottom tab bar.
//  >=1024px (desktop): multi-column (sidebar + main).

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

function IconWrite() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5" />
    </svg>
  );
}

// Desktop sidebar nav item — active: amber highlight; inactive: dim with hover.
function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? 'flex items-center gap-2.5 rounded-[2px] px-3 py-2 font-medium text-term-amber bg-term-hover'
    : 'flex items-center gap-2.5 rounded-[2px] px-3 py-2 text-term-dim hover:bg-term-hover hover:text-term-bright';
}

export default function AppLayout() {
  const username = useAuthStore((s) => s.username);
  const googleApiKey = useAuthStore((s) => s.googleApiKey);
  const clearSession = useAuthStore((s) => s.clearSession);
  const openLogin = useUiStore((s) => s.openLogin);

  // Zombie-session guard: when a write gets 401 (token expired / secret rotated),
  // rest.ts fires notifyAuthExpired → clear the dead session (keep the Gemini
  // key) and open the login modal, instead of silently 401-ing forever.
  useEffect(() => {
    setOnAuthExpired(() => {
      clearSession();
      openLogin();
    });
    return () => setOnAuthExpired(null);
  }, [clearSession, openLogin]);

  // Gemini 연결 표식: 키가 생기거나 바뀔 때(신규 로그인 · 프로필 키 변경 · 지속
  // 세션 로드) 키당 한 번 가벼운 연결 테스트(pingGemini)를 돌려 배지를 즉시
  // 갱신한다. ref로 마지막 핑한 키를 기억해 같은 키로는 한 번만 호출.
  const lastPingedKey = useRef<string | null>(null);
  useEffect(() => {
    if (googleApiKey && googleApiKey !== lastPingedKey.current) {
      lastPingedKey.current = googleApiKey;
      void pingGemini(googleApiKey);
    }
  }, [googleApiKey]);

  return (
    <div className="min-h-full">
      {/* top app bar */}
      <header className="sticky top-0 z-10 border-b border-term-border bg-term-screen/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-app items-center justify-between px-4 desktop:max-w-5xl">
          <Link to="/">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2 text-sm">
            {/* Gemini 연결 표식: 로그인(BYOK) 상태에서 아이디 바로 좌측에 표시. */}
            {username && <GeminiStatusBadge />}
            {username ? (
              <Link
                to="/me"
                className="text-term-dim transition hover:text-term-bright"
                aria-label="내 프로필로 이동"
              >
                [ {username} ]
              </Link>
            ) : (
              <button
                type="button"
                onClick={openLogin}
                className="text-term-amber"
              >
                [ Login ]
              </button>
            )}
          </div>
        </div>
      </header>

      {/* content area: single column on mobile, multi-column on desktop */}
      <div className="mx-auto grid max-w-app grid-cols-1 desktop:max-w-5xl desktop:grid-cols-[220px_1fr] desktop:gap-6 desktop:px-4">
        <aside className="hidden desktop:block desktop:py-4">
          <nav className="sticky top-16 space-y-1 text-sm">
            <NavLink to="/" end className={sidebarLinkClass}>
              <IconHome />
              홈
            </NavLink>
            <NavLink to="/search" className={sidebarLinkClass}>
              <IconSearch />
              검색
            </NavLink>
            <NavLink to="/create-post" className={sidebarLinkClass}>
              <IconWrite />
              작성
            </NavLink>
            <NavLink to="/me" className={sidebarLinkClass}>
              <IconProfile />
              나
            </NavLink>
          </nav>
        </aside>

        <main className="px-4 pb-20 pt-4 desktop:px-0 desktop:pb-8">
          <Outlet />
        </main>
      </div>

      <BottomTabBar />
      <LoginModal />
    </div>
  );
}
