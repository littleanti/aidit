import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../api/rest';

interface LoginFormProps {
  /** called after login() resolves successfully. */
  onSuccess?: () => void;
}

// Extracted login form (nickname + API key + warning + issue link + submit).
// Shared by pages/Login.tsx (full page) and components/LoginModal.tsx (overlay).
export default function LoginForm({ onSuccess }: LoginFormProps) {
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && apiKey.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // L1: only the username crosses the network; the key stays local.
      await login(username.trim(), apiKey.trim());
      onSuccess?.();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : '로그인에 실패했습니다. 다시 시도해 주세요.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

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
          htmlFor="apiKey"
          className="mb-1 block text-sm font-medium text-term-dim"
        >
          Google AI Studio API 키
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
        {submitting ? '[ 시작하는 중… ]' : '[ 시작하기 ]'}
      </button>
    </form>
  );
}
