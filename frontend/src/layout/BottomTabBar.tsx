import { NavLink, useNavigate } from 'react-router-dom';

interface Tab {
  to: string;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { to: '/', label: '홈', icon: '🏠' },
  { to: '/search', label: '검색', icon: '🔍' },
  { to: '/create-community', label: '작성', icon: '✏️' },
  { to: '/me', label: '나', icon: '👤' },
];

export default function BottomTabBar() {
  const navigate = useNavigate();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white tablet:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="하단 탭"
    >
      <ul className="mx-auto flex max-w-app items-stretch">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === '/'}
              onClick={(e) => {
                // search/me are placeholders for later milestones
                if (tab.to === '/search' || tab.to === '/me') {
                  e.preventDefault();
                  navigate('/');
                }
              }}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center gap-0.5 py-2 text-xs',
                  isActive ? 'text-brand' : 'text-slate-500',
                ].join(' ')
              }
            >
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
