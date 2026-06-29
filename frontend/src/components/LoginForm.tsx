import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../api/rest';
import { useT } from '../i18n/useT';

interface LoginFormProps {
  /** called after guestLogin() / login() / register() resolves successfully. */
  onSuccess?: () => void;
}

type Tab = 'guest' | 'login';
type LoginMode = 'login' | 'register';

// Read the persisted identity (zustand persist key 'aidit-auth') to pick the
// default tab: if a previous username is on record, open [Login]; otherwise
// [Guest]. Parse failures fall back to 'guest'.
function defaultTab(): Tab {
  try {
    const raw = localStorage.getItem('aidit-auth');
    if (!raw) return 'guest';
    const parsed = JSON.parse(raw) as { state?: { username?: unknown } };
    const u = parsed?.state?.username;
    return typeof u === 'string' && u.length > 0 ? 'login' : 'guest';
  } catch {
    return 'guest';
  }
}

// Runtime dual-mode login. The card has two top tabs:
//   [Guest] — nickname only (POST /auth/guest). Server appends '#hex4'.
//   [Login] — username + password. A bottom link flips between login
//             (POST /auth/session) and register (POST /auth/register);
//             register reveals the confirm-password field.
// The LLM API key is orthogonal to the mode: optional in both tabs, stored
// locally only (L1) via updateKey().
export default function LoginForm({ onSuccess }: LoginFormProps) {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const guestLogin = useAuthStore((s) => s.guestLogin);
  const updateKey = useAuthStore((s) => s.updateKey);
  // A key may already be in localStorage (e.g. saved before, kept across logout).
  // We only flag its presence here — never prefill the value into the field.
  const storedKey = useAuthStore((s) => s.googleApiKey);
  const hasStoredKey = !!storedKey && storedKey.length > 0;
  const { t } = useT();

  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [loginMode, setLoginMode] = useState<LoginMode>('login');

  // Guest tab field.
  const [nickname, setNickname] = useState('');
  // Login tab fields.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Shared across both tabs.
  const [apiKey, setApiKey] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGuest = activeTab === 'guest';
  const isLogin = loginMode === 'login';

  const canSubmit = isGuest
    ? nickname.trim().length > 0
    : username.trim().length > 0 &&
      password.trim().length > 0 &&
      (isLogin || confirmPassword.length > 0);

  // Live mismatch hint (register mode, once the user has typed a confirmation).
  const passwordsMismatch =
    !isGuest &&
    loginMode === 'register' &&
    confirmPassword.length > 0 &&
    password !== confirmPassword;

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setError(null);
  }

  function toggleLoginMode() {
    setLoginMode((m) => (m === 'login' ? 'register' : 'login'));
    setConfirmPassword('');
    setError(null);
  }

  function localizedError(err: unknown): string {
    if (!(err instanceof ApiError)) return t('auth.errorGeneric');
    if (err.status === 401) return t('auth.errorWrongCredentials');
    if (err.status === 409) return t('auth.errorUsernameTaken');
    if (err.status === 400) {
      // Surface server's validation message; fall back to password length hint.
      if (typeof err.message === 'string' && err.message) return err.message;
      return t('auth.errorPasswordTooShort');
    }
    return err.message || t('auth.errorGeneric');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    // Guest tab: nickname-only entry. No password / confirm validation.
    if (isGuest) {
      setSubmitting(true);
      setError(null);
      try {
        await guestLogin(nickname.trim());
        if (apiKey.trim()) updateKey(apiKey.trim());
        onSuccess?.();
      } catch (err) {
        setError(localizedError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Login tab — register mode validation.
    if (loginMode === 'register') {
      if (password.length < 8) {
        setError(t('auth.errorPasswordTooShort'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('auth.errorPasswordMismatch'));
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      if (loginMode === 'login') {
        await login(username.trim(), password.trim());
      } else {
        await register(username.trim(), password.trim());
      }
      // Persist the LLM key locally if the user supplied one.
      if (apiKey.trim()) updateKey(apiKey.trim());
      onSuccess?.();
    } catch (err) {
      setError(localizedError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright';
  const labelClass = 'mb-1 block text-sm font-medium text-term-dim';

  // Shared optional LLM API-key field (rendered in both tabs).
  const apiKeyField = (
    <div>
      <label htmlFor="apiKey" className={labelClass}>
        {t('auth.apiKeyLabel')}{' '}
        {hasStoredKey ? (
          <span className="text-term-green">{t('auth.apiKeyStoredBadge')}</span>
        ) : (
          <span className="text-term-faint">{t('auth.apiKeyOptional')}</span>
        )}
      </label>
      <input
        id="apiKey"
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className={inputClass}
        placeholder={hasStoredKey ? t('auth.apiKeyStoredPlaceholder') : 'AIza...'}
      />
      <p className="mt-2 rounded-[2px] border border-term-amber bg-term-info px-3 py-2 text-xs leading-relaxed text-term-amber">
        {hasStoredKey ? t('auth.apiKeyStoredHint') : t('auth.apiKeyNote')}
      </p>
      <a
        href="https://aistudio.google.com/app/apikey"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs text-term-bright underline"
      >
        {t('auth.apiKeyLink')}
      </a>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Tabs: [Guest] / [Login] */}
      <div role="tablist" className="flex gap-1.5">
        <button
          type="button"
          role="tab"
          aria-selected={isGuest}
          onClick={() => switchTab('guest')}
          className={`flex min-h-[40px] flex-1 items-center justify-center rounded-[2px] border text-sm font-bold tracking-wide transition ${
            isGuest
              ? 'border-term-amber bg-term-input text-term-amber'
              : 'border-term-border bg-term-input text-term-dim hover:bg-term-hover'
          }`}
        >
          {t('auth.guestTabLabel')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isGuest}
          onClick={() => switchTab('login')}
          className={`flex min-h-[40px] flex-1 items-center justify-center rounded-[2px] border text-sm font-bold tracking-wide transition ${
            !isGuest
              ? 'border-term-amber bg-term-input text-term-amber'
              : 'border-term-border bg-term-input text-term-dim hover:bg-term-hover'
          }`}
        >
          {t('auth.loginTabLabel')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {isGuest ? (
          <>
            <div>
              <label htmlFor="nickname" className={labelClass}>
                {t('auth.usernameLabel')}
              </label>
              <input
                id="nickname"
                type="text"
                autoComplete="off"
                value={nickname}
                maxLength={16}
                onChange={(e) => setNickname(e.target.value.replace(/#/g, ''))}
                className={inputClass}
                placeholder={t('auth.usernamePlaceholder')}
              />
              <p className="mt-1 text-xs text-term-dim">
                {t('auth.guestNameNote')}
              </p>
            </div>

            {apiKeyField}

            <p className="rounded-[2px] border border-term-amber bg-term-info px-3 py-2 text-xs leading-relaxed text-term-amber">
              {t('auth.guestEphemeralWarning')}
            </p>

            {error && <p className="text-sm text-term-danger">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="min-h-[44px] w-full rounded-[2px] border border-term-cta bg-term-cta py-2.5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? t('auth.submitting') : t('auth.guestStartBtn')}
            </button>

            <p className="text-center text-xs text-term-dim">
              {t('auth.switchToLogin')}{' '}
              <button
                type="button"
                onClick={() => switchTab('login')}
                className="text-term-bright underline"
              >
                {t('auth.switchToLoginLink')}
              </button>
            </p>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="username" className={labelClass}>
                {t('auth.usernameLabel')}
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder={t('auth.usernamePlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>
                {loginMode === 'register'
                  ? t('auth.passwordLabelWithHint')
                  : t('auth.passwordLabel')}
              </label>
              <input
                id="password"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>

            {!isLogin && (
              <div>
                <label htmlFor="confirmPassword" className={labelClass}>
                  {t('auth.passwordConfirmLabel')}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={passwordsMismatch}
                  className={`w-full rounded-[2px] border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:ring-1 ${
                    passwordsMismatch
                      ? 'border-term-danger focus:border-term-danger focus:ring-term-danger'
                      : 'border-term-border focus:border-term-bright focus:ring-term-bright'
                  }`}
                  placeholder={t('auth.passwordConfirmPlaceholder')}
                />
                {passwordsMismatch && (
                  <p className="mt-1 text-xs text-term-danger">
                    {t('auth.errorPasswordMismatch')}
                  </p>
                )}
              </div>
            )}

            {apiKeyField}

            {error && <p className="text-sm text-term-danger">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="min-h-[44px] w-full rounded-[2px] border border-term-cta bg-term-cta py-2.5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting
                ? t('auth.submitting')
                : isLogin
                  ? t('auth.loginBtn')
                  : t('auth.registerBtn')}
            </button>

            <p className="text-center text-xs text-term-dim">
              {isLogin ? t('auth.switchToRegister') : t('auth.switchToLogin')}{' '}
              <button
                type="button"
                onClick={toggleLoginMode}
                className="text-term-bright underline"
              >
                {isLogin
                  ? t('auth.switchToRegisterLink')
                  : t('auth.switchToLoginLink')}
              </button>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
