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
    <div className="mx-auto max-w-app py-6 font-mono">
      <h1 className="mb-1 text-xl font-bold text-term-title glow">커뮤니티 만들기</h1>
      <p className="mb-6 text-sm text-term-dim">
        주제를 정하고, 이 커뮤니티의 AI 페르소나를 설정하세요.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div
            role="alert"
            className="rounded-[2px] border border-term-danger bg-term-info px-3 py-2.5 text-sm font-medium text-term-danger"
          >
            {error}
          </div>
        )}

        {/* 이름 */}
        <div>
          <label
            htmlFor="name"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            이름
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            placeholder="예) 집밥 레시피"
          />
        </div>

        {/* 주소 */}
        <div>
          <label
            htmlFor="slug"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            주소
          </label>
          <div className="flex items-center rounded-[2px] border border-term-border bg-term-input focus-within:border-term-bright focus-within:ring-1 focus-within:ring-term-bright">
            <span className="select-none pl-3 pr-1 text-sm text-term-faint">
              /c/
            </span>
            <input
              id="slug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="w-full rounded-r-[2px] bg-transparent py-2.5 pr-3 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint"
              placeholder="home-cooking"
            />
          </div>
          <p className="mt-1 text-xs text-term-faint">
            커뮤니티의 고유 주소입니다. 이름에서 자동 추천되며, 직접 수정할 수 있습니다.
          </p>
        </div>

        {/* 설명 (선택) */}
        <div>
          <label
            htmlFor="description"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            설명{' '}
            <span className="font-normal text-term-faint">(선택)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            placeholder="이 커뮤니티가 어떤 곳인지 한 줄로 소개해 보세요."
          />
        </div>

        <PersonaEditor value={personaPrompt} onChange={setPersonaPrompt} />

        {/* AI 아이콘 (선택) */}
        <div>
          <label
            htmlFor="personaIcon"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            AI 아이콘{' '}
            <span className="font-normal text-term-faint">(선택)</span>
          </label>
          <input
            id="personaIcon"
            type="text"
            value={personaIcon}
            onChange={(e) => setPersonaIcon(e.target.value)}
            maxLength={8}
            className="w-20 rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-center text-lg text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            placeholder="🤖"
          />
          <p className="mt-1 text-xs text-term-faint">
            AI 답변 옆에 표시될 이모지 또는 짧은 토큰입니다.
          </p>
        </div>

        {/* CTA */}
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="min-h-[44px] w-full rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] py-2.5 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? '[ 만드는 중… ]' : '[ 커뮤니티 만들기 ]'}
        </button>
      </form>
    </div>
  );
}
