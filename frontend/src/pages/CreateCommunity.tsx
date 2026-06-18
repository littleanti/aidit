import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError, postCommunity, type CreateCommunityBody } from '../api/rest';
import PersonaEditor from '../components/PersonaEditor';

/**
 * Derive a URL-safe slug suggestion from the community name.
 * Keeps unicode letters/numbers (so Korean names work), collapses the rest
 * into single hyphens, and trims leading/trailing hyphens.
 */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export default function CreateCommunity() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);

  // require login
  useEffect(() => {
    if (!userId) navigate('/login', { replace: true });
  }, [userId, navigate]);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [personaPrompt, setPersonaPrompt] = useState('');
  const [personaIcon, setPersonaIcon] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // auto-suggest slug from name until the user edits the slug manually
  function handleNameChange(next: string) {
    setName(next);
    if (!slugEdited) setSlug(slugify(next));
  }

  function handleSlugChange(next: string) {
    setSlugEdited(true);
    // keep slug input itself clean as the user types
    setSlug(next.toLowerCase().replace(/\s+/g, '-'));
  }

  const canSubmit =
    name.trim().length > 0 &&
    slug.trim().length > 0 &&
    personaPrompt.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting || !userId) return;
    setSubmitting(true);
    setError(null);

    const body: CreateCommunityBody = {
      slug: slug.trim(),
      name: name.trim(),
      personaPrompt: personaPrompt.trim(),
    };
    const trimmedDesc = description.trim();
    if (trimmedDesc) body.description = trimmedDesc;
    const trimmedIcon = personaIcon.trim();
    if (trimmedIcon) body.personaIcon = trimmedIcon;

    try {
      const community = await postCommunity(body, userId);
      navigate(`/c/${community.slug}`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : '커뮤니티 생성에 실패했습니다. 다시 시도해 주세요.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!userId) return null;

  return (
    <div className="mx-auto max-w-app py-6">
      <h1 className="mb-1 text-xl font-bold text-slate-900">커뮤니티 만들기</h1>
      <p className="mb-6 text-sm text-slate-600">
        주제를 정하고, 이 커뮤니티의 AI 페르소나를 설정하세요.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700"
          >
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            이름
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            placeholder="예) 집밥 레시피"
          />
        </div>

        <div>
          <label
            htmlFor="slug"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            주소
          </label>
          <div className="flex items-center rounded-lg border border-slate-300 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
            <span className="select-none pl-3 pr-1 text-sm text-slate-400">
              /c/
            </span>
            <input
              id="slug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="w-full rounded-r-lg bg-transparent py-2 pr-3 text-sm outline-none"
              placeholder="home-cooking"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            커뮤니티의 고유 주소입니다. 이름에서 자동 추천되며, 직접 수정할 수 있습니다.
          </p>
        </div>

        <div>
          <label
            htmlFor="description"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            설명{' '}
            <span className="font-normal text-slate-400">(선택)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            placeholder="이 커뮤니티가 어떤 곳인지 한 줄로 소개해 보세요."
          />
        </div>

        <PersonaEditor value={personaPrompt} onChange={setPersonaPrompt} />

        <div>
          <label
            htmlFor="personaIcon"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            AI 아이콘{' '}
            <span className="font-normal text-slate-400">(선택)</span>
          </label>
          <input
            id="personaIcon"
            type="text"
            value={personaIcon}
            onChange={(e) => setPersonaIcon(e.target.value)}
            maxLength={8}
            className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-center text-lg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            placeholder="🤖"
          />
          <p className="mt-1 text-xs text-slate-500">
            AI 답변 옆에 표시될 이모지 또는 짧은 토큰입니다.
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '만드는 중…' : '커뮤니티 만들기'}
        </button>
      </form>
    </div>
  );
}
