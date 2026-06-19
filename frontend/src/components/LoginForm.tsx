import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../api/rest';

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

  function koreanError(err: unknown): string {
    if (!(err instanceof ApiError)) return '오류가 발생했습니다. 다시 시도해 주세요.';
    if (err.status === 401) return '아이디 또는 비밀번호가 올바르지 않습니다.';
    if (err.status === 409) return '이미 사용 중인 아이디입니다.';
    if (err.status === 400) {
      // Surface server's validation message; fall back to password length hint.
      if (typeof err.message === 'string' && err.message) return err.message;
      return '비밀번호는 8자 이상이어야 합니다.';
    }
    return err.message || '오류가 발생했습니다. 다시 시도해 주세요.';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    if (mode === 'register') {
      if (password.length < 8) {
        setError('비밀번호는 8자 이상이어야 합니다.');
        return;
      }
      if (password !== confirmPassword) {
        setError('비밀번호가 일치하지 않습니다.');
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
      setError(koreanError(err));
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
          사용자 이름
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
          placeholder="닉네임"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-term-dim"
        >
          비밀번호{mode === 'register' && ' (8자 이상)'}
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
            비밀번호 확인
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
            placeholder="비밀번호 재입력"
          />
          {passwordsMismatch && (
            <p className="mt-1 text-xs text-term-danger">
              비밀번호가 일치하지 않습니다.
            </p>
          )}
        </div>
      )}

      <div>
        <label
          htmlFor="apiKey"
          className="mb-1 block text-sm font-medium text-term-dim"
        >
          Google AI Studio API 키 <span className="text-term-faint">(선택)</span>
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
          키는 이 기기(localStorage)에만 저장되며 서버로 전송되지 않습니다.
        </p>
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-term-bright underline"
        >
          aistudio.google.com에서 키 발급받기
        </a>
      </div>

      {error && <p className="text-sm text-term-danger">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="min-h-[44px] w-full rounded-[2px] border border-term-cta bg-term-cta py-2.5 text-sm font-bold text-term-bright shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting
          ? '[ 처리 중… ]'
          : isLogin
            ? '[ 로그인 ]'
            : '[ 회원가입 ]'}
      </button>

      <p className="text-center text-xs text-term-dim">
        {isLogin ? '처음이신가요?' : '이미 계정이 있으신가요?'}{' '}
        <button
          type="button"
          onClick={toggleMode}
          className="text-term-bright underline"
        >
          {isLogin ? '회원가입' : '로그인'}
        </button>
      </p>
    </form>
  );
}
