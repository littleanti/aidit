import { useGeminiStatusStore } from '../stores/geminiStatusStore';

// Header connectivity badge for the BYOK Gemini key (retro green-phosphor LED +
// label). Reflects geminiStatusStore — the outcome of the most recent real LLM
// query this session. Presentational only; reads the store, never calls Gemini.

const META = {
  connected: {
    glyph: '●',
    dotClass: 'text-term-bright glow',
    title: 'Gemini 연결됨 — 최근 응답 성공',
  },
  disconnected: {
    glyph: '●',
    dotClass: 'text-term-danger animate-pulse',
    title: 'Gemini 끊김 — 최근 응답 실패 (키/네트워크 확인)',
  },
  unknown: {
    glyph: '○',
    dotClass: 'text-term-faint',
    title: 'Gemini 상태 미확인 — 아직 요청 없음',
  },
} as const;

export default function GeminiStatusBadge() {
  const status = useGeminiStatusStore((s) => s.status);
  const meta = META[status];

  return (
    <span
      role="status"
      aria-label={meta.title}
      title={meta.title}
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
