import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, getCommunities, getPost, patchPost, postPost, uploadImage } from '../api/rest';
import type { Community } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { usePostIntentStore } from '../stores/postIntentStore';
import { useUiStore } from '../stores/uiStore';
import { type AiLength, DEFAULT_AI_LENGTH } from '../engine/length';
import { useT } from '../i18n/useT';
import ShellPrompt from '../components/ShellPrompt';
import { formatPromptArg } from '../lib/shellArg';

// FE-7: write a post (register-first, FR-4.2).
// Flow: resolve target community -> POST /posts -> navigate immediately to the
// thread (/p/:postId). The "게시 후 AI 1차 답변 받기" toggle (default ON) is
// recorded in postIntentStore keyed by the new postId so the Thread (M3) can
// consume it and auto-fire the first AI reply.

// Single-image attach constraints (mirrored server-side for defense in depth).
const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function CreatePost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();

  const userId = useAuthStore((s) => s.userId);
  const setFirstAiReply = usePostIntentStore((s) => s.setFirstAiReply);
  const setFirstAiLength = usePostIntentStore((s) => s.setFirstAiLength);
  const openLogin = useUiStore((s) => s.openLogin);

  // Router-state handoff: { editPostId } from the Thread's ✎ edit link.
  const editPostId = (location.state as { editPostId?: string } | null)?.editPostId;
  const isEdit = Boolean(editPostId);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');

  // 작업2: expandable community picker state. Selection still lives in
  // selectedCommunityId; these only drive the picker UI.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [firstAi, setFirstAi] = useState(true); // default ON
  // AI-response-length for the 1차 reply. Default 'normal' => a bounded one-or-
  // two-paragraph answer (~4-6 sentences). Handed off to the Thread via
  // postIntentStore alongside the firstAi flag.
  const [aiLength, setAiLength] = useState<AiLength>(DEFAULT_AI_LENGTH);

  // 작업4b: single-image attachment. We hold the server URL (after upload) so it
  // can ride the postPost body; the local object URL drives the preview chip.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode: name of the post's community (read-only label) and load flag.
  const [editCommunityName, setEditCommunityName] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<boolean>(isEdit);

  // Prefill: when arriving in edit mode, load the existing post and seed fields.
  useEffect(() => {
    if (!editPostId) return;
    let cancelled = false;
    setLoadingEdit(true);
    getPost(editPostId)
      .then((post) => {
        if (cancelled) return;
        setTitle(post.title);
        setBody(post.body);
        if (post.imageUrl) {
          setImageUrl(post.imageUrl);
          setImageObjectUrl(post.imageUrl);
          setImageName(t('post.image_attach_name'));
        }
        setEditCommunityName(post.community?.name ?? null);
        setSelectedCommunityId(post.communityId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : t('post.err_load_post'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPostId]);

  // Load communities so we can resolve the target. When a slug is in the route
  // we still load to map slug -> id; otherwise the user picks from a selector.
  useEffect(() => {
    let cancelled = false;
    setCommunitiesLoading(true);
    getCommunities()
      .then((list) => {
        if (cancelled) return;
        setCommunities(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError ? e.message : t('post.err_load_communities'),
        );
      })
      .finally(() => {
        if (!cancelled) setCommunitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke any live object URL on unmount.
  useEffect(() => {
    return () => {
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Community implied by the route slug, if any.
  const slugCommunity = useMemo(
    () => (slug ? communities.find((c) => c.slug === slug) ?? null : null),
    [slug, communities],
  );

  // Once communities load, lock the selection to the route slug when present.
  useEffect(() => {
    if (slugCommunity) setSelectedCommunityId(slugCommunity.id);
  }, [slugCommunity]);

  // Effective target community id.
  const communityId = slug ? slugCommunity?.id ?? '' : selectedCommunityId;

  const slugNotFound = Boolean(slug) && !communitiesLoading && !slugCommunity;

  // 작업2: the currently-selected community (for the picker field label).
  const selectedCommunity = useMemo(
    () => communities.find((c) => c.id === selectedCommunityId) ?? null,
    [communities, selectedCommunityId],
  );

  // 작업2: client-side name filter (case-insensitive, partial match).
  const filteredCommunities = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return communities;
    return communities.filter((c) => c.name.toLowerCase().includes(q));
  }, [communities, pickerQuery]);

  // 작업3: only when not slug-scoped, after load, and zero communities.
  const showEmptyCommunityLink =
    !slug && !communitiesLoading && communities.length === 0;

  // In edit mode the community is implied by the loaded post; no picker needed.
  const canSubmit =
    !submitting &&
    !uploadingImage &&
    !!userId &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (isEdit ? !loadingEdit : communityId.length > 0);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Always reset the input value so re-picking the same file fires onChange.
    e.target.value = '';
    if (!file) return;
    setImageError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError(t('post.image_type_error'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t('post.image_size_error'));
      return;
    }
    if (!userId) return;

    // Replace any previous selection, revoking its object URL first.
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    const localUrl = URL.createObjectURL(file);
    setImageObjectUrl(localUrl);
    setImageName(file.name);
    setUploadingImage(true);
    uploadImage(file, userId)
      .then(({ imageUrl: url }) => {
        setImageUrl(url);
      })
      .catch((err) => {
        setImageError(
          err instanceof ApiError ? err.message : t('post.image_upload_error'),
        );
        // Roll back the chip on failure.
        if (localUrl) URL.revokeObjectURL(localUrl);
        setImageObjectUrl(null);
        setImageName(null);
        setImageUrl(null);
      })
      .finally(() => {
        setUploadingImage(false);
      });
  }

  function clearImage() {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    setImageObjectUrl(null);
    setImageName(null);
    setImageUrl(null);
    setImageError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !userId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && editPostId) {
        // PATCH only the mutable fields; imageUrl: null clears the attachment.
        await patchPost(
          editPostId,
          {
            title: title.trim(),
            body: body.trim(),
            imageUrl: imageUrl ?? null,
          },
          userId,
        );
        navigate(`/p/${editPostId}`);
      } else {
        const post = await postPost(
          {
            communityId,
            title: title.trim(),
            body: body.trim(),
            ...(imageUrl ? { imageUrl } : {}),
          },
          userId,
        );
        // Record the AI-first-reply intent for the Thread to consume (M3).
        setFirstAiReply(post.id, firstAi);
        setFirstAiLength(post.id, aiLength);
        // Register-first: jump straight to the thread.
        navigate(`/p/${post.id}`);
      }
    } catch (err) {
      const fallback = isEdit
        ? t('post.err_submit_edit')
        : t('post.err_submit_create');
      setError(err instanceof ApiError ? err.message : fallback);
      setSubmitting(false);
    }
  }

  // 작업5 게이트: login is required to post, but instead of a hard redirect we
  // show a gate that opens the login modal.
  if (!userId) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center font-mono">
        <p className="text-sm text-term-dim">{t('post.login_required')}</p>
        <button
          type="button"
          onClick={openLogin}
          className="min-h-[44px] rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 py-2.5 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition"
        >
          {t('post.login_btn')}
        </button>
      </div>
    );
  }

  const shellCommand = slug ? `post --new r/${slug}` : 'post --new';
  const promptCommand =
    title.trim().length > 0
      ? `${shellCommand} "${formatPromptArg(title)}"`
      : shellCommand;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-mono">
      <ShellPrompt command={promptCommand} className="mb-3" />
      <h1 className="text-lg font-semibold text-term-title glow">
        {isEdit ? t('post.heading_edit') : t('post.heading_create')}
      </h1>

      {/* Community target */}
      {isEdit ? (
        // Edit mode: read-only community label (community is locked to the post).
        <div className="text-sm text-term-dim">
          {t('post.community_prefix')}{' '}
          <span className="font-medium text-term-title">
            {editCommunityName ?? selectedCommunityId}
          </span>
        </div>
      ) : slug ? (
        <div className="text-sm text-term-dim">
          {t('post.community_prefix')}{' '}
          <span className="font-medium text-term-title">
            {slugCommunity ? slugCommunity.name : slug}
          </span>
        </div>
      ) : showEmptyCommunityLink ? (
        // 작업3: zero communities — point the user at search to create one.
        <Link
          to="/search"
          className="text-sm font-medium text-term-amber hover:underline"
        >
          {t('post.community_empty_link')}
        </Link>
      ) : (
        // 작업2: expandable community picker.
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-term-dim">{t('post.community_label')}</span>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={communitiesLoading || submitting}
            className="flex items-center justify-between gap-2 bg-term-input border border-term-border rounded-[2px] px-3 py-2.5 text-sm outline-none focus:border-term-bright focus:ring-1 focus:ring-term-bright disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={
                selectedCommunity
                  ? 'font-bold text-term-bright'
                  : 'text-term-faint'
              }
            >
              {communitiesLoading
                ? t('post.community_loading')
                : selectedCommunity
                  ? selectedCommunity.name
                  : t('post.community_placeholder')}
            </span>
            <span className="text-term-dim">{t('post.community_change')}</span>
          </button>

          {pickerOpen && (
            <div className="mt-1 flex flex-col gap-2 border border-term-border bg-term-card rounded-[2px] p-2">
              {/* (a) search filter */}
              <div className="flex items-center gap-2 bg-term-input border border-term-border rounded-[2px] px-2.5 py-2">
                <span className="select-none font-bold text-term-cta">
                  &gt;
                </span>
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder={t('post.community_search_placeholder')}
                  autoFocus
                  className="flex-1 bg-transparent text-sm text-term-bright outline-none placeholder:text-term-faint"
                />
              </div>

              {/* (b) list */}
              {filteredCommunities.length > 0 ? (
                <ul className="flex max-h-56 flex-col overflow-y-auto">
                  {filteredCommunities.map((c) => {
                    const selected = c.id === selectedCommunityId;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCommunityId(c.id);
                            setPickerOpen(false);
                            setPickerQuery('');
                          }}
                          className="flex w-full items-center gap-2 rounded-[2px] px-2 py-2 text-left text-sm hover:bg-term-hover"
                        >
                          <span className="select-none font-bold text-term-amber">
                            {selected ? '[*]' : '[ ]'}
                          </span>
                          <span className="text-term-title">{c.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                // (c) no match
                <p className="px-2 py-2 text-sm text-term-faint">
                  {t('post.community_no_match')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Title */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-term-dim">{t('post.title_label')}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('post.title_placeholder')}
          maxLength={300}
          disabled={submitting}
          className="bg-term-input border border-term-border rounded-[2px] px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
        />
      </label>

      {/* Body */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-term-dim">{t('post.body_label')}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('post.body_placeholder')}
          rows={8}
          disabled={submitting}
          className="resize-y bg-term-input border border-term-border rounded-[2px] px-3 py-2.5 text-sm text-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright"
        />
      </label>

      {/* 작업4b: image attachment */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-term-dim">{t('post.image_label')}</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={onPickImage}
        />
        {imageObjectUrl ? (
          // Thumbnail chip with filename + remove.
          <div className="flex items-center gap-2 border border-term-border bg-term-card rounded-[2px] px-2.5 py-2">
            <img
              src={imageObjectUrl}
              alt={t('post.image_preview_alt')}
              className="h-10 w-10 rounded-[2px] border border-term-border object-cover"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-term-bright">
                {imageName}
              </span>
              <span className="text-xs text-term-dim">
                {uploadingImage ? t('post.image_uploading') : t('post.image_attached')}
              </span>
            </div>
            <button
              type="button"
              onClick={clearImage}
              disabled={submitting}
              aria-label={t('post.image_remove_aria')}
              className="shrink-0 select-none rounded-[2px] border border-term-border px-2 py-1 text-xs font-bold text-term-bright hover:bg-term-hover"
            >
              [x]
            </button>
          </div>
        ) : (
          // Dashed dropzone.
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={submitting}
            className="flex flex-col items-center justify-center gap-1 rounded-[2px] border border-dashed border-term-border px-3 py-6 text-sm text-term-dim hover:border-term-bright hover:text-term-bright disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-bold">{t('post.image_attach_btn')}</span>
            <span className="text-xs text-term-faint">PNG · JPG</span>
          </button>
        )}
        {imageError && (
          <p className="text-sm text-term-danger">{imageError}</p>
        )}
      </div>

      {/* AI first-reply toggle: hidden in edit mode (must not re-trigger). */}
      {!isEdit && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-term-dim">
            <input
              type="checkbox"
              checked={firstAi}
              onChange={(e) => setFirstAi(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded-[2px] accent-[#3fa564]"
            />
            <span>{t('post.ai_first_reply')}</span>
          </label>

          {/* AI-response-length selector for the 1차 reply — only when opted in.
              No visible "len" label (the bare 짧게/보통/길게 are self-explanatory);
              ACTIVE = amber bracket accent like the @AI chip, inactive = dim. */}
          {firstAi && (
            <div
              role="radiogroup"
              aria-label={t('post.ai_length_aria')}
              className="ml-6 flex items-center gap-1 border-l border-term-border pl-3"
            >
              {([
                ['short', t('post.ai_length_short')],
                ['normal', t('post.ai_length_normal')],
                ['long', t('post.ai_length_long')],
              ] as [AiLength, string][]).map(([len, label]) => {
                const active = len === aiLength;
                return (
                  <button
                    key={len}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setAiLength(len)}
                    disabled={submitting}
                    className={`flex min-h-[44px] select-none items-center rounded-[2px] border px-2 text-xs font-bold transition disabled:opacity-50 ${
                      active
                        ? 'border-term-amber text-term-amber'
                        : 'border-term-border text-term-dim hover:text-term-bright'
                    }`}
                  >
                    {active ? `[${label}]` : label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {slugNotFound && (
        <p className="text-sm text-term-danger">
          {t('post.community_not_found', { slug: slug ?? '' })}
        </p>
      )}
      {error && <p className="text-sm text-term-danger">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="min-h-[44px] rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] px-4 py-2.5 text-sm font-bold text-term-title glow-lg shadow-glow-cta transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isEdit
          ? submitting
            ? t('post.btn_saving')
            : t('post.btn_save')
          : submitting
            ? t('post.btn_submitting')
            : t('post.btn_submit')}
      </button>
    </form>
  );
}
