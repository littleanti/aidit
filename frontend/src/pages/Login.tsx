import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../api/rest';
import Logo from '../components/Logo';

export default function Login() {
  const navigate = useNavigate();
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
      navigate('/');
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
    <div className="mx-auto max-w-sm py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-1">
          <Logo size="lg" />
        </div>
        <p className="mb-6 text-sm text-slate-600">
          커뮤니티에서 함께 만드는 AI 대화
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              사용자 이름
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              placeholder="닉네임"
            />
          </div>

          <div>
            <label
              htmlFor="apiKey"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Google AI Studio API 키
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              placeholder="AIza..."
            />
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              키는 이 기기(localStorage)에만 저장되며 서버로 전송되지 않습니다.
            </p>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-brand-600 underline"
            >
              aistudio.google.com에서 키 발급받기
            </a>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="min-h-[44px] w-full rounded-xl bg-brand-gradient py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '시작하는 중…' : '시작하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
