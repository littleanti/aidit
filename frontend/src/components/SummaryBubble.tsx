// FE-13a: SummaryBubble — the full-width (전폭 띠) band that renders an
// AI_SUMMARY comment as a visible segment boundary (FR-7.4).
//
// An AI_SUMMARY is the OPENING bubble of a NEW context segment (TRD §3/§6):
// everything ABOVE it has been folded into this summary, and all conversation
// BELOW it is assembled against this summary as the new baseline. We therefore
// render it as a distinct color band (amber → purple) with a clear label and a
// boundary microcopy divider underneath.
//
// L1: nothing here touches an API key. AI authorship is authorId === null +
// type === 'AI_SUMMARY'; this component is only ever asked to render that.

import type { Comment } from '../api/types';
import SafeMarkdown from '../lib/SafeMarkdown';

const DEFAULT_PERSONA_ICON = '🟣';

interface SummaryBubbleProps {
  comment: Comment;
  /** persona display name (community persona) — shown in the label. */
  personaName?: string | null;
  /** persona icon (emoji / short token). */
  personaIcon?: string | null;
}

/** PENDING typing indicator while the summary is still being generated. */
function SummaryTyping() {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label="요약 정리 중">
      <span className="inline-flex gap-0.5" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500" />
      </span>
      <span className="text-xs font-medium text-purple-700">⟳ 요약 정리 중…</span>
    </span>
  );
}

export default function SummaryBubble({
  comment,
  personaName,
  personaIcon,
}: SummaryBubbleProps) {
  const isPending = comment.status === 'PENDING';
  const isFailed = comment.status === 'FAILED';

  const personaLabel =
    personaName && personaName.trim() ? personaName : 'AI 페르소나';
  const personaEmoji =
    personaIcon && personaIcon.trim() ? personaIcon : DEFAULT_PERSONA_ICON;

  return (
    <div
      className="my-3 w-full px-1"
      role="separator"
      aria-label="대화 요약 경계"
    >
      {/* full-width band: distinct amber→purple gradient marks the boundary */}
      <div
        className={`rounded-xl border bg-gradient-to-r from-amber-50 via-purple-50 to-purple-100 px-3 py-3 ${
          isFailed ? 'border-red-300' : 'border-purple-300'
        }`}
      >
        {/* label row */}
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-purple-700">
          <span aria-hidden>≈</span>
          <span>AI 요약 (여기까지)</span>
          <span aria-hidden className="text-sm leading-none">
            {personaEmoji}
          </span>
          <span className="ml-auto rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
            {personaLabel}
          </span>
        </div>

        {/* body */}
        {isPending ? (
          <div className="min-h-[28px] py-1">
            <SummaryTyping />
          </div>
        ) : isFailed ? (
          comment.body ? (
            // XC-3: summary body is untrusted — sanitize before render.
            <SafeMarkdown
              text={comment.body}
              className="prose-chat whitespace-pre-wrap break-words text-sm leading-relaxed text-red-700"
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-red-700">
              요약 생성에 실패했습니다.
            </p>
          )
        ) : (
          <SafeMarkdown
            text={comment.body}
            className="prose-chat whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700"
          />
        )}
      </div>

      {/* boundary microcopy (FR-7.4): everything below is assembled against
          the summary above. Rendered as a centered divider line. */}
      <div className="mt-1.5 flex items-center gap-2 px-2 text-[11px] font-medium text-purple-400">
        <span className="h-px flex-1 bg-purple-200" />
        <span>이후 대화는 위 요약 기준</span>
        <span className="h-px flex-1 bg-purple-200" />
      </div>
    </div>
  );
}
