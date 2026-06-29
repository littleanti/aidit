import { useT } from '../i18n/useT';
import { useLlmStatusStore } from '../stores/llmStatusStore';

// Header connectivity badge for the active LLM (retro green-phosphor LED dot).
// Reflects llmStatusStore — the outcome of the most recent real LLM query
// this session. Presentational only; reads the store, never calls the LLM.
// No model name is shown (any LLM endpoint may be used); tooltip says "LLM …".

const META = {
  connected: {
    glyph: '●',
    dotClass: 'text-term-bright glow',
    titleKey: 'misc.llm_connected' as const,
  },
  disconnected: {
    glyph: '●',
    dotClass: 'text-term-danger animate-pulse',
    titleKey: 'misc.llm_disconnected' as const,
  },
  unknown: {
    glyph: '○',
    dotClass: 'text-term-faint',
    titleKey: 'misc.llm_unknown' as const,
  },
} as const;

export default function LlmStatusBadge() {
  const { t } = useT();
  const status = useLlmStatusStore((s) => s.status);
  const meta = META[status];
  const title = t(meta.titleKey);

  return (
    <span
      role="status"
      aria-label={title}
      title={title}
      className="inline-flex select-none items-center gap-1"
    >
      <span aria-hidden className={`text-[10px] leading-none ${meta.dotClass}`}>
        {meta.glyph}
      </span>
      {/* Visible label — sibling-app Aidit-Code parity. Generic "AI" (never a
          model name); hidden on narrow viewports, shown from `sm` (640px) up. */}
      <span
        aria-hidden
        className="hidden text-[10px] uppercase tracking-wider text-term-faint sm:inline"
      >
        AI
      </span>
    </span>
  );
}
