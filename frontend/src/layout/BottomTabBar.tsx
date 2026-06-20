import { NavLink } from 'react-router-dom';
import { useT } from '../i18n/useT';

function IconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

function IconWrite() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5" />
    </svg>
  );
}

interface Tab {
  to: string;
  /** i18n key into the 'nav' namespace, resolved at render via useT. */
  labelKey: string;
  icon: () => JSX.Element;
  exact?: boolean;
}

const TABS: Tab[] = [
  { to: '/', labelKey: 'nav.home', icon: IconHome, exact: true },
  { to: '/search', labelKey: 'nav.search', icon: IconSearch },
  { to: '/create-post', labelKey: 'nav.write', icon: IconWrite },
  { to: '/me', labelKey: 'nav.me', icon: IconProfile },
];

export default function BottomTabBar() {
  const { t } = useT();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-term-border bg-term-screen tablet:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label={t('nav.bottomBarAria')}
    >
      <ul className="mx-auto flex max-w-app items-stretch">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.exact}
                className={({ isActive }) =>
                  [
                    'flex flex-col items-center justify-center gap-0.5 py-2 text-xs',
                    isActive ? 'text-term-amber' : 'text-term-dim',
                  ].join(' ')
                }
              >
                <span aria-hidden className="flex h-6 items-center justify-center leading-none">
                  <Icon />
                </span>
                <span>{t(tab.labelKey)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
