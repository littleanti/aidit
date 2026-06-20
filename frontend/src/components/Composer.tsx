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
// '@AI' mention is detected & highlighted here. M3: when the sent comment
// contains '@AI', after the human comment is committed we fire the engine's
// runAtAiReply with the CALLER's key (BYOK). Non-@AI comments behave as before.
// L1: nothing here ever sends a key to the Aidit server; the Gemini key is
// handed straight to the engine (browser->Gemini) and only { type, body,
// clientId } crosses the Aidit wire.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThreadStore } from '../stores/threadStore';
import { useAiModeStore } from '../stores/aiModeStore';
import { postComment, uploadImage } from '../api/rest';
import type { Comment } from '../api/types';
import { runAtAiReply } from '../engine/contextEngine';
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

// Manual one-off @AI shortcut: a leading or whitespace-preceded '@AI' token.
const AI_MENTION = /@AI\b/i;

/** A monotonic-ish temp seq for optimistic bubbles; far above real seqs so it
 *  sorts last until the real server seq arrives. Negative would also work, but
 *  large positive keeps it visually at the bottom of an ascending list. */
function tempSeq(): number {
  return Number.MAX_SAFE_INTEGER - Math.floor(Math.random() * 1_000_000);
}

export default function Composer({ postId, communityPersonaPrompt, onWantsAIChange }: ComposerProps) {
  const navigate = useNavigate();
  const { t } = useT();
  const userId = useAuthStore((s) => s.userId);

  const addOptimistic = useThreadStore((s) => s.addOptimistic);
  const upsertComment = useThreadStore((s) => s.upsertComment);

  // Thread-scoped AI-mode toggle (session-only, default ON per post).
  const aiMode = useAiModeStore((s) => s.byPost[postId] ?? true);
  const toggleAiMode = useAiModeStore((s) => s.toggle);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Single-image attachment: the chosen File (held locally until send) + its
  // object URL (for the preview thumbnail / optimistic bubble).
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = text.trim();
  const hasMention = AI_MENTION.test(text);
  // Unified routing: the message goes to the AI if the thread toggle is ON OR
  // the user manually typed an '@AI' token (one-off shortcut). A single source
  // of truth so we never double-trigger when both are true.
  const wantsAI = aiMode || hasMention;

  // Surface ONLY the wantsAI boolean up to Thread (drives its shell-prompt swap).
  // The live comment TEXT is intentionally NOT surfaced — mirroring it would
  // force a thread-wide re-render on every keystroke; only this boolean is.
  useEffect(() => {
    onWantsAIChange?.(wantsAI);
  }, [wantsAI, onWantsAIChange]);
  // Text becomes optional when an image is attached (image-only sends allowed).
  const canSend = (trimmed.length > 0 || imageFile != null) && !sending;

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

    // 1b. AI invocation requires a personal Gemini key (BYOK). Block before
    // posting so we never commit a human turn that can't be answered. The
    // decision unifies the thread toggle and the manual '@AI' shortcut.
    const willInvokeAi = wantsAI;
    const apiKey = useAuthStore.getState().googleApiKey;
    if (willInvokeAi && !apiKey) {
      showToast(t('thread.aiNoKey'));
      navigate('/login');
      return;
    }

    // The stored human body is exactly what the user typed (trimmed). A manual
    // '@AI' mention is preserved verbatim in the human bubble (it drives routing
    // only, never mutates the body). In toggle-ON mode the text has no '@AI'
    // prefix at all — the chip is a UI element, never injected into the value.
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

      {/* Thin control row: thread-scoped AI-mode toggle + BYOK cost hint. */}
      <div className="flex items-center gap-2 px-3 pt-2">
        <label className="group inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 text-xs font-medium text-term-amber">
          <input
            type="checkbox"
            checked={aiMode}
            onChange={() => toggleAiMode(postId)}
            className="sr-only"
          />
          <span aria-hidden className="select-none font-bold text-term-amber">
            {aiMode ? '[X]' : '[ ]'}
          </span>
          <span className="inline-flex items-center gap-1 text-term-bright">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="5" y="8" width="14" height="11" rx="1" />
              <path d="M12 8V4M9 4h6" />
              <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
            </svg>
            {t('thread.aiModeLabel')}
          </span>
        </label>
        <span
          className="text-[11px] text-term-dim"
          title={t('thread.costHintTooltip')}
        >
          {t('thread.costHint')}
        </span>
      </div>

      {hasMention && !aiMode && (
        <div className="flex items-center gap-1 px-3 pt-1 text-xs font-medium text-term-amber">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="5" y="8" width="14" height="11" rx="1" />
            <path d="M12 8V4M9 4h6" />
            <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
          </svg>
          {t('thread.mentionIndicator')}
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

      <div className="flex items-center gap-2 px-3 py-2">
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
          className={`flex max-h-32 min-h-[44px] flex-1 items-center gap-2 rounded-[2px] border bg-term-bg px-4 py-1 ${
            aiMode
              ? 'border-term-amber focus-within:border-term-amber'
              : 'border-term-border focus-within:border-term-bright'
          }`}
        >
          {aiMode && (
            <span
              aria-label={t('thread.atAiChipAria')}
              className="shrink-0 select-none rounded-[2px] border border-term-amber px-2 py-0.5 text-xs font-bold text-term-amber"
            >
              @AI
            </span>
          )}
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
