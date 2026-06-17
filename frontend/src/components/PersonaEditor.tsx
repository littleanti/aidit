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
        className="mb-1 block text-sm font-medium text-slate-700"
      >
        🤖 AI 페르소나 프롬프트
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
        placeholder="예) 당신은 친절한 요리 전문가입니다. 항상 단계별로 쉽게 설명하고, 재료 대체안을 함께 제안하세요."
      />
      <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-600">
        이 프롬프트는 커뮤니티의 모든 AI 호출에 적용되는 시스템 지침(systemInstruction)이 됩니다.
        AI의 말투·역할·관점을 정해 보세요.
      </p>
    </div>
  );
}
