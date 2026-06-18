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
import { useAiModeStore } from '../stores/aiModeStore';
import { postComment } from '../api/rest';
import type { Comment } from '../api/types';
import { runAtAiReply } from '../engine/contextEngine';

interface ComposerProps {
  postId: string;
  /** community persona prompt — passed to the engine for @AI replies. */
  communityPersonaPrompt?: string;
}

// Manual one-off @AI shortcut: a leading or whitespace-preceded '@AI' token.
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

  // Thread-scoped AI-mode toggle (session-only, default OFF per post).
  const aiMode = useAiModeStore((s) => s.byPost[postId] ?? false);
  const toggleAiMode = useAiModeStore((s) => s.toggle);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const hasMention = AI_MENTION.test(text);
  // Unified routing: the message goes to the AI if the thread toggle is ON OR
  // the user manually typed an '@AI' token (one-off shortcut). A single source
  // of truth so we never double-trigger when both are true.
  const wantsAI = aiMode || hasMention;
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

    // 1b. AI invocation requires a personal Gemini key (BYOK). Block before
    // posting so we never commit a human turn that can't be answered. The
    // decision unifies the thread toggle and the manual '@AI' shortcut.
    const willInvokeAi = wantsAI;
    const apiKey = useAuthStore.getState().googleApiKey;
    if (willInvokeAi && !apiKey) {
      showToast('AI 호출에는 Gemini 키가 필요합니다 — 로그인에서 키를 등록하세요.');
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

  // The Composer is a NORMAL bottom flex child of Thread's fixed-height column:
  // the sibling `flex-1` scroll area shrinks to fit above it (no overlay), so the
  // newest chat bubble is always visible above the input regardless of how tall
  // this row grows. Mobile tab-bar clearance is handled at the Thread root
  // (bottom padding), not by a sticky offset here.
  return (
    <div className="shrink-0 border-t border-slate-200 bg-white">
      {toast && (
        <div
          role="alert"
          className="mx-3 mb-1 mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {toast}
        </div>
      )}

      {/* Thin control row: thread-scoped AI-mode toggle + BYOK cost hint. */}
      <div className="flex items-center gap-2 px-3 pt-2">
        <label className="group inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={aiMode}
            onChange={() => toggleAiMode(postId)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-violet-600"
          />
          <span>🤖 AI에게 묻기</span>
        </label>
        <span
          className="text-[11px] text-slate-400"
          title="AI에게 묻기가 켜져 있으면 보내는 메시지마다 내 Gemini 키로 호출됩니다(비용 발생)."
        >
          메시지마다 내 키로 호출됩니다
        </span>
      </div>

      {hasMention && !aiMode && (
        <div className="px-3 pt-1 text-xs font-medium text-purple-600">
          🤖 @AI 멘션 포함 — AI가 응답합니다
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Leading attach button — VISUAL placeholder only. Non-functional;
            no handler is wired. Reserved for a future attachment feature. */}
        <button
          type="button"
          aria-label="첨부"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-slate-400"
        >
          <span aria-hidden>＋</span>
        </button>
        <div
          className={`flex max-h-32 min-h-[44px] flex-1 items-center gap-2 rounded-full border bg-slate-50 px-4 py-1 focus-within:bg-white ${
            aiMode
              ? 'border-purple-300 focus-within:border-purple-500'
              : 'border-slate-300 focus-within:border-brand'
          }`}
        >
          {aiMode && (
            <span
              aria-label="AI에게 전송"
              className="shrink-0 select-none rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700"
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
            placeholder={aiMode ? 'AI에게 메시지 보내기…' : '메시지를 입력하세요…'}
            aria-label="댓글 입력"
            className="max-h-28 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label="전송"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white transition active:scale-95 disabled:opacity-40 ${
            wantsAI ? 'bg-purple-600' : 'bg-brand'
          }`}
        >
          <span aria-hidden>↑</span>
        </button>
      </div>
    </div>
  );
}
