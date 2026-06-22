// FE-11: Composer — bottom input row for a post's chat thread.
//
// Flow (FR-5.x / L4 / L12):
//  1. require login (no userId -> route to /login).
//  2. generate clientId = crypto.randomUUID() (L12 idempotency key).
//  3. addOptimistic: temp HUMAN bubble (right side, status COMPLETE) for
//     instant render, carrying the clientId + a temp seq.
//  4. rest.postComment(postId, { type:'HUMAN', body, clientId }, userId).
//  5. on success SSE 'comment.created' + store dedupe (by clientId) reconciles
//     the optimistic bubble; we upsert the server DTO too as a fast path.
//  6. on failure: remove/mark the optimistic bubble + show a toast.
//
// AI routing (M3 / 2026-06-23): AI replies are driven SOLELY by the in-composer
// AI-mode toggle (the trailing [AI] popover) — there is NO '@AI' body-token
// shortcut anymore. The toggle's default is key-based: a BYOK Gemini key present
// -> default ON, absent -> default OFF. When AI mode is ON for a post, after the
// human comment commits we fire the engine's runAtAiReply with the CALLER's key.
// If AI is on but no key is set, the human comment still posts and the AI turn is
// skipped (the key-absent guard is surfaced in the popover at activation time).
// L1: nothing here ever sends a key to the Aidit server; the Gemini key is handed
// straight to the engine (browser->Gemini) and only { type, body, clientId }
// crosses the Aidit wire.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThreadStore } from '../stores/threadStore';
import { useAiModeStore } from '../stores/aiModeStore';
import { useAiLengthStore } from '../stores/aiLengthStore';
import { postComment, uploadImage } from '../api/rest';
import type { Comment } from '../api/types';
import { runAtAiReply } from '../engine/contextEngine';
import { type AiLength, DEFAULT_AI_LENGTH } from '../engine/length';
import { useT } from '../i18n/useT';
import { tn } from '../i18n/tn';

// Single-image attach constraints (mirrored server-side for defense in depth).
const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Read a File as base64 inline data (mimeType + base64 WITHOUT the data: prefix)
 *  for a Gemini inlineData part. Read from the File, never a (revocable) URL. */
function fileToInlineData(
  file: File,
): Promise<{ mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(tn('thread.fileReadError')));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error(tn('thread.fileReadError')));
        return;
      }
      // result is a data URL: "data:<mime>;base64,<data>". Strip the prefix.
      const comma = result.indexOf(',');
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({ mimeType: file.type, data });
    };
    reader.readAsDataURL(file);
  });
}

interface ComposerProps {
  postId: string;
  /** community persona prompt — passed to the engine for @AI replies. */
  communityPersonaPrompt?: string;
  /** Surface ONLY the wantsAI boolean up to Thread (for the shell-prompt swap).
   *  The live comment TEXT is intentionally NOT surfaced — mirroring it would
   *  force a thread-wide re-render on every keystroke; only the boolean is. */
  onWantsAIChange?: (v: boolean) => void;
}

/** A monotonic-ish temp seq for optimistic bubbles; far above real seqs so it
 *  sorts last until the real server seq arrives. Negative would also work, but
 *  large positive keeps it visually at the bottom of an ascending list. */
function tempSeq(): number {
  return Number.MAX_SAFE_INTEGER - Math.floor(Math.random() * 1_000_000);
}

// The 3 AI-response-length levels, in display order.
const LENGTH_ORDER: AiLength[] = ['short', 'normal', 'long'];

/** Robot "AI" glyph shared by the trailing chip + the popover toggle. */
function RobotIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="5" y="8" width="14" height="11" rx="1" />
      <path d="M12 8V4M9 4h6" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// FE: the trailing-popover AI menu — a single ROW with an [AI] on/off switch +
// the 3-level length segments, plus a key-absent guard surfaced INLINE when AI is
// turned on without a BYOK key. Replaces the old stacked control row + the inline
// @AI chip. The "len" label is intentionally gone; the bare 짧게/보통/길게 are
// self-explanatory. ACTIVE uses the amber accent with bracket accents ([보통]).
function AiModeMenu({
  aiMode,
  length,
  hasApiKey,
  onToggle,
  onPickLength,
  onAddKey,
  t,
}: {
  aiMode: boolean;
  length: AiLength;
  hasApiKey: boolean;
  onToggle: () => void;
  onPickLength: (len: AiLength) => void;
  onAddKey: () => void;
  t: (key: string) => string;
}) {
  const labels: Record<AiLength, string> = {
    short: t('thread.lengthShort'),
    normal: t('thread.lengthNormal'),
    long: t('thread.lengthLong'),
  };
  return (
    <div
      role="dialog"
      aria-label={t('thread.aiMenuAria')}
      className={`absolute bottom-full right-0 z-30 mb-2 flex w-[19rem] max-w-[calc(100vw-2.5rem)] flex-col gap-2 rounded-[2px] border bg-term-card p-2 shadow-glow-soft ${
        aiMode ? 'border-term-amber' : 'border-term-border'
      }`}
    >
      {/* one row: [AI] switch | divider | length segments */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={aiMode}
          aria-label={t('thread.aiModeLabel')}
          onClick={onToggle}
          className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[2px] border px-2.5 text-xs font-bold transition ${
            aiMode
              ? 'border-term-amber text-term-amber'
              : 'border-term-border text-term-dim hover:text-term-bright'
          }`}
        >
          <RobotIcon />
          <span>AI</span>
        </button>
        <div
          role="radiogroup"
          aria-label={t('thread.lengthAria')}
          className={`flex flex-1 items-center gap-1.5 border-l border-term-border pl-2 ${
            aiMode ? '' : 'opacity-40'
          }`}
        >
          {LENGTH_ORDER.map((len) => {
            const active = aiMode && len === length;
            return (
              <button
                key={len}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!aiMode}
                onClick={() => onPickLength(len)}
                className={`flex min-h-[44px] flex-1 select-none items-center justify-center rounded-[2px] border px-1 text-xs font-bold transition ${
                  active
                    ? 'border-term-amber text-term-amber'
                    : 'border-term-border text-term-dim'
                } ${aiMode ? 'hover:text-term-bright' : 'cursor-not-allowed'}`}
              >
                {active ? `[${labels[len]}]` : labels[len]}
              </button>
            );
          })}
        </div>
      </div>
      {/* key-absent guard — shown the moment AI is turned on without a key */}
      {aiMode && !hasApiKey && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-[2px] border border-term-amber bg-term-info px-2 py-1.5 text-[11px] leading-snug text-term-amber"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span>
            {t('thread.aiNoKeyHint')}{' '}
            <button
              type="button"
              onClick={onAddKey}
              className="text-term-bright underline underline-offset-2"
            >
              {t('thread.aiNoKeyCta')} →
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

export default function Composer({ postId, communityPersonaPrompt, onWantsAIChange }: ComposerProps) {
  const navigate = useNavigate();
  const { t } = useT();
  const userId = useAuthStore((s) => s.userId);
  // Reactive BYOK key presence — drives the key-based AI-mode default + the guard.
  const googleApiKey = useAuthStore((s) => s.googleApiKey);
  const hasApiKey = Boolean(googleApiKey);

  const addOptimistic = useThreadStore((s) => s.addOptimistic);
  const upsertComment = useThreadStore((s) => s.upsertComment);

  // Thread-scoped AI mode (session-only, postId-scoped). The store holds ONLY an
  // explicit user override; absent → key-based default (key present ON, absent OFF).
  const aiModeOverride = useAiModeStore((s) => s.byPost[postId]);
  const setAiMode = useAiModeStore((s) => s.set);
  const aiMode = aiModeOverride ?? hasApiKey;

  // Thread-scoped AI-response-length (session-only, default 'normal' per post).
  const aiLength = useAiLengthStore((s) => s.byPost[postId] ?? DEFAULT_AI_LENGTH);
  const setAiLength = useAiLengthStore((s) => s.set);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Single-image attachment: the chosen File (held locally until send) + its
  // object URL (for the preview thumbnail / optimistic bubble).
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  // Trailing AI-menu popover open/close.
  const [menuOpen, setMenuOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  // AI routing is decided SOLELY by the toggle (no '@AI' body-token shortcut).
  const wantsAI = aiMode;

  // Surface ONLY the wantsAI boolean up to Thread (drives its shell-prompt swap).
  useEffect(() => {
    onWantsAIChange?.(wantsAI);
  }, [wantsAI, onWantsAIChange]);
  // Text becomes optional when an image is attached (image-only sends allowed).
  const canSend = (trimmed.length > 0 || imageFile != null) && !sending;

  // Close the AI menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Always reset the input value so re-picking the same file fires onChange.
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast(t('thread.unsupportedImageFormat'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast(t('thread.imageTooLarge'));
      return;
    }
    // Replace any previous selection, revoking its object URL first.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setImageFile(file);
    setObjectUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setImageFile(null);
    setObjectUrl(null);
  }

  // Revoke any live object URL on unmount (only — not on every state change, so
  // the optimistic bubble's blob: src stays valid until the send reconciles).
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    if (!canSend) return;

    // 1. require login.
    if (!userId) {
      navigate('/login');
      return;
    }

    // 1b. AI invocation requires a personal Gemini key (BYOK). The no-key guard
    // is surfaced in the AI menu at activation time (not here): if AI mode is on
    // without a key we DON'T block — the human comment still posts and the AI
    // turn is silently skipped. willInvokeAi unifies "wants AI" + "has a key".
    const apiKey = useAuthStore.getState().googleApiKey;
    const willInvokeAi = wantsAI && Boolean(apiKey);

    // The stored human body is exactly what the user typed (trimmed). The AI
    // toggle is a UI element — it never injects '@AI' or any token into the body.
    const body = trimmed;
    const clientId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 6.1.1 Capture the attachment up front — all subsequent logic uses these
    // locals, never the React state (which is cleared on re-render mid-send).
    const file = imageFile;
    const localUrl = objectUrl;

    // 6.1.2 Pre-read the AI base64 from the captured File (NOT a revocable URL)
    // BEFORE any setState, so the image rides the fresh-upload @AI turn even
    // after the preview URL is revoked.
    let imagePart: { mimeType: string; data: string } | undefined;
    if (willInvokeAi && file) {
      try {
        imagePart = await fileToInlineData(file);
      } catch {
        showToast(t('thread.imageReadError'));
        return;
      }
    }

    // 2/3 + 6.1.3. optimistic temp bubble — instant right-side render. Point its
    // imageUrl at the local blob: URL so the preview shows before the upload.
    const optimistic: Comment = {
      id: `optimistic-${clientId}`,
      postId,
      authorId: userId,
      authorUsername: useAuthStore.getState().username,
      type: 'HUMAN',
      status: 'COMPLETE',
      body,
      tokenCount: 0,
      segmentId: '',
      replyToId: null,
      clientId,
      seq: tempSeq(),
      imageUrl: localUrl,
      createdAt: new Date().toISOString(),
    };

    addOptimistic(optimistic);
    setSending(true);

    let humanCommentId: string | null = null;
    let sendSucceeded = false;
    try {
      // 6.1.4 Upload the image FIRST (before postComment). On failure: toast,
      // abort, leave imageFile/objectUrl intact (don't lose the file) and do
      // NOT revoke the object URL.
      const { imageUrl } = file
        ? await uploadImage(file, userId)
        : { imageUrl: null };

      // 6.1.5 post the human comment (FR-6.2: human before AI), carrying the
      // server image URL.
      const saved = await postComment(
        postId,
        { type: 'HUMAN', body, clientId, imageUrl: imageUrl ?? null },
        userId,
      );
      // fast-path reconcile; SSE 'comment.created' dedupes by clientId too. This
      // swaps the optimistic blob: URL for the server /uploads/... URL.
      upsertComment(saved);
      humanCommentId = saved.id;
      sendSucceeded = true;

      // 6.1.6 On success only: clear text + attachment, then defer revoking the
      // local blob URL until AFTER upsertComment reconciled the bubble.
      setText('');
      setImageFile(null);
      setObjectUrl(null);
      if (localUrl) URL.revokeObjectURL(localUrl);
    } catch {
      // mark/remove optimistic bubble + toast. Keep the file + object URL so the
      // user can retry without re-picking the image.
      upsertComment({ ...optimistic, status: 'FAILED' });
      showToast(t('thread.sendFailed'));
    } finally {
      setSending(false);
      taRef.current?.focus();
    }

    // 6.1.7 @AI invocation (AI-7). Only after the human comment is committed; the
    // engine fetches context (which now includes this turn), posts a PENDING
    // AI_REPLY (rendered via SSE), then resolves it with the CALLER's key. The
    // pre-read image bytes ride ONLY this fresh-upload turn.
    // The PENDING/FAILED AI bubble surfaces in the thread via SSE; we don't
    // need to touch the human bubble on AI failure (NFR-5).
    if (willInvokeAi && sendSucceeded && humanCommentId && apiKey) {
      const callerUsername = useAuthStore.getState().username ?? t('thread.userFallback');
      void runAtAiReply({
        postId,
        humanCommentId,
        communityPersonaPrompt: communityPersonaPrompt ?? '',
        callerUsername,
        callerApiKey: apiKey,
        humanCommentBody: body,
        image: imagePart,
        length: aiLength,
      }).then((res) => {
        if (!res.ok && res.errorMessage) showToast(res.errorMessage);
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter newline. (Mobile keyboards still get the button.)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // The Composer is a NORMAL bottom flex child of Thread's fixed-height column:
  // the sibling `flex-1` scroll area shrinks to fit above it (no overlay), so the
  // newest chat bubble is always visible above the input regardless of how tall
  // this row grows. Mobile tab-bar clearance is handled at the Thread root
  // (bottom padding), not by a sticky offset here.
  return (
    <div className="shrink-0 border-t border-term-border bg-term-bg font-mono">
      {toast && (
        <div
          role="alert"
          className="mx-3 mb-1 mt-2 rounded-[2px] border border-term-danger bg-term-bg px-3 py-2 text-sm text-term-danger"
        >
          {toast}
        </div>
      )}

      {objectUrl && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <div className="relative inline-block">
            <img
              src={objectUrl}
              alt={t('thread.attachPreviewAlt')}
              className="h-16 w-16 rounded-[2px] border border-term-border object-cover"
            />
            <button
              type="button"
              onClick={clearImage}
              aria-label={t('thread.removeImageAria')}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-[2px] border border-term-border bg-term-bg text-xs font-bold text-term-bright active:scale-95"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        {/* Leading attach button — opens the native image picker. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={onPick}
        />
        <button
          type="button"
          aria-label={t('thread.attachImageAria')}
          onClick={() => fileRef.current?.click()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-term-border text-term-bright hover:bg-term-border active:scale-95"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div
          className={`flex max-h-32 min-h-[44px] flex-1 items-end gap-2 rounded-[2px] border bg-term-bg px-3 py-1 ${
            aiMode
              ? 'border-term-amber focus-within:border-term-amber'
              : 'border-term-border focus-within:border-term-bright'
          }`}
        >
          {/* terminal prompt prefix (decorative) */}
          <span aria-hidden className="select-none self-center text-sm text-term-faint">
            &gt;
          </span>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={aiMode ? t('thread.placeholderAi') : t('thread.placeholderHuman')}
            aria-label={t('thread.commentInputAria')}
            className="max-h-28 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-term-bright outline-none placeholder:text-term-dim"
          />
          {/* trailing AI chip — opens the one-row AI menu (toggle + length). */}
          <div ref={menuRef} className="relative shrink-0 self-center">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-label={t('thread.aiMenuAria')}
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex h-9 items-center gap-1 rounded-[2px] border px-2 text-xs font-bold transition ${
                aiMode
                  ? 'border-term-amber text-term-amber'
                  : 'border-term-border text-term-dim hover:text-term-bright'
              }`}
            >
              <RobotIcon />
              <span>AI</span>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-2.5 w-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="square"
              >
                <path d={menuOpen ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
              </svg>
            </button>
            {menuOpen && (
              <AiModeMenu
                aiMode={aiMode}
                length={aiLength}
                hasApiKey={hasApiKey}
                onToggle={() => setAiMode(postId, !aiMode)}
                onPickLength={(len) => {
                  setAiLength(postId, len);
                  setMenuOpen(false);
                }}
                onAddKey={() => {
                  setMenuOpen(false);
                  navigate('/me/settings');
                }}
                t={t}
              />
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label={t('thread.sendAria')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-term-cta bg-gradient-to-b from-[#155230] to-[#0c3a20] text-lg font-bold text-term-bright shadow-glow-cta transition active:scale-95 disabled:opacity-40"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="square"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
