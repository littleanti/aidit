import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  ApiError,
  getCommunity,
  patchCommunity,
  postCommunity,
  type CreateCommunityBody,
} from '../api/rest';
import PersonaEditor from '../components/PersonaEditor';
import ShellPrompt from '../components/ShellPrompt';
import { useT } from '../i18n/useT';

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
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = useAuthStore((s) => s.userId);

  // Router-state handoff: { editSlug } from the community detail "✎ 편집" link
  // (edit mode), or { name } from the search screen's create CTA (name prefill).
  const navState = (location.state ?? null) as
    | { editSlug?: string; name?: string }
    | null;
  const editSlug = navState?.editSlug;
  const presetName = navState?.name;
  const isEdit = Boolean(editSlug);

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
  // Edit mode: resolved community id (PATCH target) + the prefill load flag.
  const [editId, setEditId] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<boolean>(Boolean(editSlug));

  // Prefill: edit mode loads the existing community by slug and fills every
  // field; create mode optionally seeds the name from the search handoff.
  useEffect(() => {
    if (editSlug) {
      let cancelled = false;
      setLoadingEdit(true);
      getCommunity(editSlug)
        .then((c) => {
          if (cancelled) return;
          setName(c.name);
          setSlug(c.slug);
          // Lock the slug: it's immutable after creation (PATCH can't change it),
          // so never let name edits re-suggest over the loaded slug.
          setSlugEdited(true);
          setDescription(c.description ?? '');
          setPersonaPrompt(c.personaPrompt);
          setPersonaIcon(c.personaIcon ?? '');
          setEditId(c.id);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(
            err instanceof ApiError
              ? err.message
              : t('community.loadEditError'),
          );
        })
        .finally(() => {
          if (!cancelled) setLoadingEdit(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (presetName) {
      setName(presetName);
      setSlug(slugify(presetName));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSlug, presetName]);

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
    !loadingEdit &&
    name.trim().length > 0 &&
    slug.trim().length > 0 &&
    personaPrompt.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting || !userId) return;
    setSubmitting(true);
    setError(null);

    try {
      if (isEdit && editId) {
        // PATCH only mutable fields (slug is immutable). Sending the trimmed
        // values — including '' — lets the user clear an optional field; the
        // server skips only keys that are `undefined`.
        const updated = await patchCommunity(
          editId,
          {
            name: name.trim(),
            personaPrompt: personaPrompt.trim(),
            description: description.trim(),
            personaIcon: personaIcon.trim(),
          },
          userId,
        );
        navigate(`/c/${updated.slug}`);
      } else {
        const body: CreateCommunityBody = {
          slug: slug.trim(),
          name: name.trim(),
          personaPrompt: personaPrompt.trim(),
        };
        const trimmedDesc = description.trim();
        if (trimmedDesc) body.description = trimmedDesc;
        const trimmedIcon = personaIcon.trim();
        if (trimmedIcon) body.personaIcon = trimmedIcon;

        const community = await postCommunity(body, userId);
        navigate(`/c/${community.slug}`);
      }
    } catch (err) {
      const fallback = isEdit
        ? t('community.submitErrorEdit')
        : t('community.submitErrorCreate');
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }

  if (!userId) return null;

  return (
    <div className="mx-auto max-w-app py-6 font-mono">
      <ShellPrompt command="mkdir /c/new" className="mb-3" />
      <h1 className="mb-1 text-xl font-bold text-term-title glow">
        {isEdit ? t('community.editPageTitle') : t('community.createPageTitle')}
      </h1>
      <p className="mb-6 text-sm text-term-dim">
        {isEdit
          ? t('community.editPageSubtitle')
          : t('community.createPageSubtitle')}
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

        {/* name field */}
        <div>
          <label
            htmlFor="name"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            {t('community.fieldName')}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            placeholder={t('community.fieldNamePlaceholder')}
          />
        </div>

        {/* slug field */}
        <div>
          <label
            htmlFor="slug"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            {t('community.fieldSlug')}
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
              readOnly={isEdit}
              aria-readonly={isEdit}
              className={`w-full rounded-r-[2px] bg-transparent py-2.5 pr-3 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint ${
                isEdit ? 'cursor-not-allowed text-term-dim' : ''
              }`}
              placeholder="home-cooking"
            />
          </div>
          <p className="mt-1 text-xs text-term-faint">
            {isEdit
              ? t('community.fieldSlugHintEdit')
              : t('community.fieldSlugHintCreate')}
          </p>
        </div>

        {/* description field (optional) */}
        <div>
          <label
            htmlFor="description"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            {t('community.fieldDescription')}{' '}
            <span className="font-normal text-term-faint">{t('community.fieldOptional')}</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
            placeholder={t('community.fieldDescriptionPlaceholder')}
          />
        </div>

        <PersonaEditor value={personaPrompt} onChange={setPersonaPrompt} />

        {/* AI icon field (optional) */}
        <div>
          <label
            htmlFor="personaIcon"
            className="mb-1 block text-sm font-medium text-term-dim"
          >
            {t('community.fieldPersonaIcon')}{' '}
            <span className="font-normal text-term-faint">{t('community.fieldOptional')}</span>
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
            {t('community.fieldPersonaIconHint')}
          </p>
        </div>

        {/* CTA */}
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="min-h-[44px] w-full rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] py-2.5 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition hover:border-term-bright disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting
            ? isEdit
              ? t('community.submittingEdit')
              : t('community.submittingCreate')
            : isEdit
              ? t('community.submitEdit')
              : t('community.submitCreate')}
        </button>
      </form>
    </div>
  );
}
