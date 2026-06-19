// FE-9: ChatBubble — renders a single comment as a chat-room bubble.
//
// Side rule (FR-5.3): own human -> right (gradient CTA fill). Everyone else,
// including ALL AI comments (authorId === null), render on the left.
// Variants: own human / other human / AI reply / AI summary (full-width band).
// Status: PENDING -> typing/loading; FAILED -> danger border + 재시도 affordance.
//
// L1: nothing here touches an API key. AI authorship is signalled purely by
// authorId === null + type, never by any key material.

import { useAuthStore } from '../stores/authStore';
import type { Comment } from '../api/types';
import SummaryBubble from './SummaryBubble';
import SafeMarkdown from '../lib/SafeMarkdown';
import Avatar from './Avatar';
import { assetUrl } from '../config/api';

/** Compact relative time in Korean (방금 / N분 / N시간 / N일 / N주, else date). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return '방금';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}일`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk}주`;
  return new Date(then).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

interface ChatBubbleProps {
  comment: Comment;
  /** persona display name for AI bubbles (community persona). */
  personaName?: string | null;
  /** persona icon (emoji / short token) for AI bubbles. */
  personaIcon?: string | null;
  /** retry affordance for FAILED comments (wired in M3). */
  onRetry?: (comment: Comment) => void;
}

/** Three bouncing dots used by both PENDING variants. */
function BouncingDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      <span className="h-1.5 w-1.5 animate-bounce rounded-[1px] bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-[1px] bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-[1px] bg-current" />
    </span>
  );
}

/** Sparkle glyph (replaces the ✨ emoji) for the AI typing indicator. */
function SparkleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="currentColor"
    >
      <path d="M8 1l1.3 4.2L13.5 6.5 9.3 7.8 8 12 6.7 7.8 2.5 6.5l4.2-1.3z" />
    </svg>
  );
}

/**
 * PENDING typing indicator. AI uses a sparkle + "답변을 작성하고 있어요…" label
 * (§6.3 E.3); human keeps the existing "입력 중…" label. Both share the dots.
 */
function TypingDots({ isAi }: { isAi: boolean }) {
  if (isAi) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        aria-label="AI가 답변을 작성하고 있어요"
      >
        <span className="inline-flex items-center gap-1 text-xs opacity-70">
          <SparkleIcon /> AI가 답변을 작성하고 있어요…
        </span>
        <BouncingDots />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" aria-label="입력 중">
      <BouncingDots />
      <span className="text-xs opacity-70">입력 중…</span>
    </span>
  );
}

export default function ChatBubble({
  comment,
  personaName,
  personaIcon,
  onRetry,
}: ChatBubbleProps) {
  const me = useAuthStore((s) => s.userId);

  const isAi = comment.authorId === null;
  const isSummary = comment.type === 'AI_SUMMARY';
  // AI bubbles are ALWAYS left; only own-human goes right.
  const side: 'left' | 'right' = !isAi && comment.authorId === me ? 'right' : 'left';

  const isPending = comment.status === 'PENDING';
  const isFailed = comment.status === 'FAILED';

  const time = relativeTime(comment.createdAt);

  // ---- AI_SUMMARY: delegate to the full-width SummaryBubble band (FE-13a).
  // It conveys the segment boundary + "이후 대화는 위 요약 기준" microcopy.
  if (isSummary) {
    return (
      <SummaryBubble
        comment={comment}
        personaName={personaName}
        personaIcon={personaIcon}
      />
    );
  }

  const personaLabel =
    personaName && personaName.trim() ? personaName : 'AI 페르소나';

  // Avatar kind: AI -> robot glyph, own -> 'me', everyone else -> 'user'.
  const avatarKind: 'user' | 'me' | 'ai' = isAi
    ? 'ai'
    : side === 'right'
      ? 'me'
      : 'user';

  // Bubble surface classes per variant (green-phosphor CRT terminal).
  let bubbleClass: string;
  if (side === 'right') {
    // own human — gradient CTA fill, signature accent.
    bubbleClass =
      'bg-gradient-to-b from-[#155230] to-[#0c3a20] text-term-me border border-term-cta rounded-[2px]';
  } else if (isAi) {
    // AI reply — warm amber tint surface.
    bubbleClass =
      'bg-[rgba(60,48,10,0.22)] text-term-title border border-term-amber-border rounded-[2px]';
  } else {
    // other human (peer) — phosphor card surface.
    bubbleClass =
      'bg-term-card text-term-green border border-term-border rounded-[2px]';
  }
  if (isFailed) {
    bubbleClass += ' !border !border-term-danger !bg-term-card !text-term-danger';
  }

  // Read-receipt ✓ shows only for OWN COMPLETE human bubbles (§6.3 E.2).
  const showReadReceipt =
    side === 'right' && !isAi && comment.status === 'COMPLETE';

  return (
    <div
      className={`flex w-full items-end gap-2 px-2 py-1 ${
        side === 'right' ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      {/* avatar at the row end (right for own, left for everyone else) */}
      <Avatar kind={avatarKind} seed={comment.authorUsername} size="md" />

      {/* bubble cluster */}
      <div
        className={`flex max-w-[78%] flex-col ${
          side === 'right' ? 'items-end' : 'items-start'
        }`}
      >
        {/* author / persona header (left bubbles only) — emoji now lives in
            the avatar, so it is no longer duplicated here. */}
        {side === 'left' && (
          <div className="flex items-center gap-1 px-1 font-mono text-xs">
            {isAi ? (
              <span className="font-medium text-term-amber">
                {personaLabel} [AI] &gt;
              </span>
            ) : (
              <span className="font-medium text-term-dim">
                {comment.authorUsername ?? '익명'} &gt;
              </span>
            )}
          </div>
        )}

        <div
          className={`min-h-[44px] px-3 py-2 text-sm leading-relaxed ${bubbleClass}`}
        >
          {isPending ? (
            <TypingDots isAi={isAi} />
          ) : (
            <>
              {comment.imageUrl && (
                <img
                  src={assetUrl(comment.imageUrl)}
                  alt="첨부 이미지"
                  className="mb-1 max-h-60 rounded-[2px] object-contain"
                  loading="lazy"
                />
              )}
              {/* Render only the image when the body is empty (image-only). */}
              {comment.body && (
                // XC-3: user/AI body is untrusted markdown — render via the
                // sanitize chokepoint, never as raw HTML.
                <SafeMarkdown
                  text={comment.body}
                  className="prose-chat whitespace-pre-wrap break-words"
                />
              )}
            </>
          )}
        </div>

        {/* meta line: time + read-receipt (own complete) / retry on failure */}
        <div
          className={`mt-0.5 flex items-center gap-2 px-1 font-mono text-[11px] text-term-faint ${
            side === 'right' ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          {time && <time dateTime={comment.createdAt}>{time}</time>}
          {showReadReceipt && (
            <span aria-hidden className="text-term-dim opacity-70">
              ✓
            </span>
          )}
          {isFailed && (
            <button
              type="button"
              onClick={() => onRetry?.(comment)}
              className="inline-flex min-h-[44px] items-center gap-0.5 font-medium text-term-danger active:opacity-70"
            >
              <span aria-hidden>↻</span> 재시도
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
