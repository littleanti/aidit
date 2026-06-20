import { useUiStore } from '../stores/uiStore';
import Logo from './Logo';
import LoginForm from './LoginForm';
import { useT } from '../i18n/useT';

// Login overlay (dc.html LOGIN MODAL look). Rendered by AppLayout above the app.
// Backdrop / [x] close; card click is stopPropagation so it stays open.
export default function LoginModal() {
  const loginOpen = useUiStore((s) => s.loginOpen);
  const closeLogin = useUiStore((s) => s.closeLogin);
  const { t } = useT();

  if (!loginOpen) return null;

  return (
    <div
      onClick={closeLogin}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(2,8,5,0.82)] p-5 font-mono"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-[3px] border border-term-cta bg-[#06160c] p-6 shadow-[0_0_32px_rgba(43,212,111,0.28)]"
      >
        <button
          type="button"
          onClick={closeLogin}
          aria-label={t('auth.closeAria')}
          className="absolute right-3.5 top-3 text-sm tracking-[1px] text-term-cta hover:text-term-bright"
        >
          [x]
        </button>

        <div className="mb-1">
          <Logo size="lg" />
        </div>
        <p className="mb-6 text-sm text-term-dim">
          {t('auth.tagline')}
        </p>

        <LoginForm onSuccess={closeLogin} />
      </div>
    </div>
  );
}
