import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import BottomTabBar from './BottomTabBar';
import Logo from '../components/Logo';

// Mobile-first shell.
//  <768px : single column + bottom tab bar.
//  >=1024px (desktop): multi-column (sidebar + main).

// Desktop sidebar nav item — active state mirrors the bottom tab bar (text-brand).
function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? 'block rounded-lg px-3 py-2 font-medium text-brand bg-slate-100'
    : 'block rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 hover:text-brand';
}

export default function AppLayout() {
  const username = useAuthStore((s) => s.username);

  return (
    <div className="min-h-full">
      {/* top app bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-app items-center justify-between px-4 desktop:max-w-5xl">
          <Link to="/">
            <Logo size="sm" />
          </Link>
          <div className="text-sm text-slate-600">
            {username ? (
              <span>{username}</span>
            ) : (
              <Link to="/login" className="text-brand-600">
                로그인
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* content area: single column on mobile, multi-column on desktop */}
      <div className="mx-auto grid max-w-app grid-cols-1 desktop:max-w-5xl desktop:grid-cols-[220px_1fr] desktop:gap-6 desktop:px-4">
        <aside className="hidden desktop:block desktop:py-4">
          <nav className="sticky top-16 space-y-1 text-sm">
            <NavLink to="/" end className={sidebarLinkClass}>
              🏠 홈
            </NavLink>
            <NavLink to="/search" className={sidebarLinkClass}>
              🔍 검색
            </NavLink>
            <NavLink to="/create-community" className={sidebarLinkClass}>
              ✏️ 커뮤니티 만들기
            </NavLink>
            <NavLink to="/me" className={sidebarLinkClass}>
              👤 나
            </NavLink>
          </nav>
        </aside>

        <main className="px-4 pb-20 pt-4 desktop:px-0 desktop:pb-8">
          <Outlet />
        </main>
      </div>

      <BottomTabBar />
    </div>
  );
}
