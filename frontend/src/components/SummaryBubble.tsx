// FE-13a: SummaryBubble — the full-width (전폭 띠) band that renders an
// AI_SUMMARY comment as a visible segment boundary (FR-7.4).
//
// An AI_SUMMARY is the OPENING bubble of a NEW context segment (TRD §3/§6):
// everything ABOVE it has been folded into this summary, and all conversation
// BELOW it is assembled against this summary as the new baseline. We therefore
// render it as a distinct warm amber tint band with a clear label and a
// boundary microcopy divider underneath.
//
// L1: nothing here touches an API key. AI authorship is authorId === null +
// type === 'AI_SUMMARY'; this component is only ever asked to render that.

import type { Comment } from '../api/types';
import SafeMarkdown from '../lib/SafeMarkdown';
import { useT } from '../i18n/useT';

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
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={t('thread.summaryTypingAria')}>
      <span className="inline-flex gap-0.5" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-[1px] bg-term-amber [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-[1px] bg-term-amber [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-[1px] bg-term-amber" />
      </span>
      <span className="font-mono text-xs font-medium text-term-amber">{t('thread.summaryTypingText')}</span>
    </span>
  );
}

export default function SummaryBubble({
  comment,
  personaName,
  personaIcon,
}: SummaryBubbleProps) {
  const { t } = useT();
  const isPending = comment.status === 'PENDING';
  const isFailed = comment.status === 'FAILED';

  const personaLabel =
    personaName && personaName.trim() ? personaName : t('thread.aiPersonaFallback');
  const personaEmoji =
    personaIcon && personaIcon.trim() ? personaIcon : DEFAULT_PERSONA_ICON;

  return (
    <div
      className="my-3 w-full px-1"
      role="separator"
      aria-label={t('thread.summaryBoundaryAria')}
    >
      {/* full-width band: warm amber tint marks the segment boundary */}
      <div
        className={`rounded-[2px] border bg-[rgba(60,48,10,0.22)] px-3 py-3 ${
          isFailed ? 'border-term-danger' : 'border-term-amber-border'
        }`}
      >
        {/* label row */}
        <div className="mb-1.5 flex items-center gap-1.5 font-mono text-xs font-semibold text-term-amber">
          <span aria-hidden>≈</span>
          <span>{t('thread.summaryLabel')}</span>
          <span aria-hidden className="text-sm leading-none">
            {personaEmoji}
          </span>
          <span className="ml-auto rounded-[2px] bg-term-tag px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-term-faint">
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
              className="prose-chat whitespace-pre-wrap break-words text-sm leading-relaxed text-term-danger"
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-term-danger">
              {t('thread.summaryFailed')}
            </p>
          )
        ) : (
          <SafeMarkdown
            text={comment.body}
            className="prose-chat whitespace-pre-wrap break-words text-sm leading-relaxed text-term-title"
          />
        )}
      </div>

      {/* boundary microcopy (FR-7.4): everything below is assembled against
          the summary above. Rendered as a centered divider line. */}
      <div className="mt-1.5 flex items-center gap-2 px-2 font-mono text-[11px] font-medium text-term-faint">
        <span className="h-px flex-1 bg-term-border" />
        <span>{t('thread.summaryBoundaryMicrocopy')}</span>
        <span className="h-px flex-1 bg-term-border" />
      </div>
    </div>
  );
}
