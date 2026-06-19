interface PersonaEditorProps {
  /** current persona prompt value (becomes systemInstruction for all AI calls). */
  value: string;
  onChange: (value: string) => void;
  /** optional id for label association; defaults to 'persona-prompt'. */
  id?: string;
  rows?: number;
  disabled?: boolean;
}

/**
 * Reusable editor for a community's AI persona prompt.
 *
 * The text entered here becomes the Gemini `systemInstruction` for every AI
 * call made within the community (set later in M3). It is plain text only —
 * L1: it never carries or references any API key.
 *
 * Used by CreateCommunity now; reused by the community edit flow later.
 */
export default function PersonaEditor({
  value,
  onChange,
  id = 'persona-prompt',
  rows = 6,
  disabled = false,
}: PersonaEditorProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 flex items-center gap-1.5 text-sm font-medium text-term-dim"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="10" height="8" rx="1.5" />
          <path d="M8 5V2.5M5.5 8.5h.01M10.5 8.5h.01M1.5 8.5h1.5M13 8.5h1.5" />
        </svg>
        AI 페르소나 프롬프트
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        className="w-full resize-y rounded-[2px] border border-term-border bg-term-input px-3 py-2.5 text-sm leading-relaxed text-term-bright caret-term-bright outline-none placeholder:text-term-faint focus:border-term-bright focus:ring-1 focus:ring-term-bright disabled:cursor-not-allowed disabled:opacity-50"
        placeholder="예) 당신은 친절한 요리 전문가입니다. 항상 단계별로 쉽게 설명하고, 재료 대체안을 함께 제안하세요."
      />
      <p className="mt-2 rounded-[2px] border border-term-border bg-term-info px-3 py-2 text-xs leading-relaxed text-term-dim">
        이 프롬프트는 커뮤니티의 모든 AI 호출에 적용되는 시스템 지침(systemInstruction)이 됩니다.
        AI의 말투·역할·관점을 정해 보세요.
      </p>
    </div>
  );
}
