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

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThreadStore } from '../stores/threadStore';
import { postComment } from '../api/rest';
import type { Comment } from '../api/types';
import { runAtAiReply } from '../engine/contextEngine';

interface ComposerProps {
  postId: string;
  /** community persona prompt — passed to the engine for @AI replies. */
  communityPersonaPrompt?: string;
}

const AI_MENTION = /@AI\b/i;

/** A monotonic-ish temp seq for optimistic bubbles; far above real seqs so it
 *  sorts last until the real server seq arrives. Negative would also work, but
 *  large positive keeps it visually at the bottom of an ascending list. */
function tempSeq(): number {
  return Number.MAX_SAFE_INTEGER - Math.floor(Math.random() * 1_000_000);
}

export default function Composer({ postId, communityPersonaPrompt }: ComposerProps) {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.userId);

  const addOptimistic = useThreadStore((s) => s.addOptimistic);
  const upsertComment = useThreadStore((s) => s.upsertComment);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const hasMention = AI_MENTION.test(text);
  const canSend = trimmed.length > 0 && !sending;

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }

  async function handleSend() {
    if (!canSend) return;

    // 1. require login.
    if (!userId) {
      navigate('/login');
      return;
    }

    // 1b. @AI requires a personal Gemini key (BYOK). Block before posting so we
    // never commit a human '@AI ...' turn that can't be answered.
    const willInvokeAi = AI_MENTION.test(text);
    const apiKey = useAuthStore.getState().googleApiKey;
    if (willInvokeAi && !apiKey) {
      showToast('@AI 사용에는 Gemini 키가 필요합니다 — 로그인에서 키를 등록하세요.');
      navigate('/login');
      return;
    }

    const body = trimmed;
    const clientId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 2/3. optimistic temp bubble — instant right-side render.
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
      createdAt: new Date().toISOString(),
    };

    addOptimistic(optimistic);
    setText('');
    setSending(true);

    let humanCommentId: string | null = null;
    try {
      // 4. post the human comment FIRST (FR-6.2: human before AI).
      const saved = await postComment(postId, { type: 'HUMAN', body, clientId }, userId);
      // 5. fast-path reconcile; SSE 'comment.created' dedupes by clientId too.
      upsertComment(saved);
      humanCommentId = saved.id;
    } catch {
      // 6. mark/remove optimistic bubble + toast.
      upsertComment({ ...optimistic, status: 'FAILED' });
      showToast('전송 실패 — 다시 시도해 주세요.');
      // restore the text so the user can retry without retyping.
      setText(body);
    } finally {
      setSending(false);
      taRef.current?.focus();
    }

    // 7. @AI invocation (AI-7). Only after the human comment is committed; the
    // engine fetches context (which now includes this turn), posts a PENDING
    // AI_REPLY (rendered via SSE), then resolves it with the CALLER's key.
    // The PENDING/FAILED AI bubble surfaces in the thread via SSE; we don't
    // need to touch the human bubble on AI failure (NFR-5).
    if (willInvokeAi && humanCommentId && apiKey) {
      const callerUsername = useAuthStore.getState().username ?? '사용자';
      void runAtAiReply({
        postId,
        humanCommentId,
        communityPersonaPrompt: communityPersonaPrompt ?? '',
        callerUsername,
        callerApiKey: apiKey,
        humanCommentBody: body,
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

  // On mobile the fixed bottom tab bar (h ~56px) sits at bottom-0; lift the
  // composer above it so the send button isn't covered. On tablet+ the tab bar
  // is hidden, so sit flush at the bottom.
  return (
    <div className="sticky bottom-16 z-30 border-t border-slate-200 bg-white tablet:bottom-0">
      {toast && (
        <div
          role="alert"
          className="mx-3 mb-1 mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {toast}
        </div>
      )}

      {hasMention && (
        <div className="px-3 pt-2 text-xs font-medium text-purple-600">
          🤖 @AI 멘션 포함 — AI가 응답합니다
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="＠AI 멘션 포함 가능…"
          aria-label="댓글 입력"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:bg-white"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label="전송"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold text-white transition active:scale-95 disabled:opacity-40"
        >
          <span aria-hidden>↑</span>
        </button>
      </div>
    </div>
  );
}
