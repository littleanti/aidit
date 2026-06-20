import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../api/rest';
import { useT } from '../i18n/useT';

interface LoginFormProps {
  /** called after login() or register() resolves successfully. */
  onSuccess?: () => void;
}

// Extracted login/register form.
// Mode toggle: "처음이신가요? 회원가입" / "이미 계정이 있으신가요? 로그인"
// Gemini key: still BYOK, stored locally only (L1). Optional field shown in
// both modes so users can set it right away; stored via updateKey().
export default function LoginForm({ onSuccess }: LoginFormProps) {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const updateKey = useAuthStore((s) => s.updateKey);
  const { t } = useT();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Register mode also requires the confirm field; login does not.
  const canSubmit =
    username.trim().length > 0 &&
    password.trim().length > 0 &&
    (mode === 'login' || confirmPassword.length > 0);

  // Live mismatch hint (register mode, once the user has typed a confirmation).
  const passwordsMismatch =
    mode === 'register' &&
    confirmPassword.length > 0 &&
    password !== confirmPassword;

  function toggleMode() {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
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

    if (mode === 'register') {
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
      if (mode === 'login') {
        await login(username.trim(), password.trim());
      } else {
        await register(username.trim(), password.trim());
      }
      // Persist the Gemini key locally if the user supplied one.
      if (apiKey.trim()) updateKey(apiKey.trim());
      onSuccess?.();
    } catch (err) {
      setError(localizedError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="username"
          className="mb-1 block text-sm font-medium text-term-dim"
        >
          {t('auth.usernameLabel')}
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
          placeholder={t('auth.usernamePlaceholder')}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-term-dim"
        >
          {mode === 'register' ? t('auth.passwordLabelWithHint') : t('auth.passwordLabel')}
        </label>
        <input
          id="password"
          type="password"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
          placeholder="••••••••"
        />
      </div>

      {!isLogin && (
        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
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

      <div>
        <label
          htmlFor="apiKey"
          className="mb-1 block text-sm font-medium text-term-dim"
        >
          {t('auth.apiKeyLabel')} <span className="text-term-faint">{t('auth.apiKeyOptional')}</span>
        </label>
        <input
          id="apiKey"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
          placeholder="AIza..."
        />
        <p className="mt-2 rounded-[2px] border border-term-amber bg-term-info px-3 py-2 text-xs leading-relaxed text-term-amber">
          {t('auth.apiKeyNote')}
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
          onClick={toggleMode}
          className="text-term-bright underline"
        >
          {isLogin ? t('auth.switchToRegisterLink') : t('auth.switchToLoginLink')}
        </button>
      </p>
    </form>
  );
}
