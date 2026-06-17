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
// '@AI' mention is detected & highlighted here; actual AI invocation is M3 —
// for now we only post the human comment.
// L1: nothing here ever sends a key; only { type, body, clientId } crosses the wire.

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThreadStore } from '../stores/threadStore';
import { postComment } from '../api/rest';
import type { Comment } from '../api/types';

interface ComposerProps {
  postId: string;
}

const AI_MENTION = /@AI\b/i;

/** A monotonic-ish temp seq for optimistic bubbles; far above real seqs so it
 *  sorts last until the real server seq arrives. Negative would also work, but
 *  large positive keeps it visually at the bottom of an ascending list. */
function tempSeq(): number {
  return Number.MAX_SAFE_INTEGER - Math.floor(Math.random() * 1_000_000);
}

export default function Composer({ postId }: ComposerProps) {
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

    try {
      // 4. post the human comment (M3 will additionally fire the @AI call).
      const saved = await postComment(postId, { type: 'HUMAN', body, clientId }, userId);
      // 5. fast-path reconcile; SSE 'comment.created' dedupes by clientId too.
      upsertComment(saved);
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
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter newline. (Mobile keyboards still get the button.)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="sticky bottom-0 border-t border-slate-200 bg-white">
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
