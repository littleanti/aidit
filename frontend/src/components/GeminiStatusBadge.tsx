import { useT } from '../i18n/useT';
import { useGeminiStatusStore } from '../stores/geminiStatusStore';

// Header connectivity badge for the BYOK Gemini key (retro green-phosphor LED +
// label). Reflects geminiStatusStore — the outcome of the most recent real LLM
// query this session. Presentational only; reads the store, never calls Gemini.

const META = {
  connected: {
    glyph: '●',
    dotClass: 'text-term-bright glow',
    titleKey: 'misc.gemini_connected' as const,
  },
  disconnected: {
    glyph: '●',
    dotClass: 'text-term-danger animate-pulse',
    titleKey: 'misc.gemini_disconnected' as const,
  },
  unknown: {
    glyph: '○',
    dotClass: 'text-term-faint',
    titleKey: 'misc.gemini_unknown' as const,
  },
} as const;

export default function GeminiStatusBadge() {
  const { t } = useT();
  const status = useGeminiStatusStore((s) => s.status);
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
      <span
        aria-hidden
        className="text-[10px] uppercase tracking-wider text-term-faint"
      >
        GEMINI
      </span>
    </span>
  );
}
