// i18n dict — AI-facing strings: LLM error messages (USER_MESSAGES in
// llm.ts), contextEngine fallback messages, the summary directive, and the
// response-language directive appended to systemInstruction.
//
// These are the user-visible AI failure strings AND the app-controlled prompt
// directives that make the model answer/summarize in the active UI language.
// (XC-4 still holds: the response directive is app-controlled text appended to
// systemInstruction — never user/comment content.)
export const ai = {
  ko: {
    // LLM USER_MESSAGES (keyed by LlmErrorKind).
    err_invalid_key: 'AI 응답 실패 — 키를 확인하세요',
    err_quota: '호출 한도 — 잠시 후 재시도',
    err_network: 'AI 응답 실패 — 네트워크 오류',
    err_unknown: 'AI 응답 실패 — 잠시 후 재시도',
    // contextEngine fallback messages (failures outside the typed LLM path).
    fallback_context: 'AI 응답 실패 — 컨텍스트를 불러오지 못했습니다',
    fallback_retry: 'AI 응답 실패 — 잠시 후 재시도',
    // Default speaker label for an author turn with no resolvable username.
    author_fallback: '작성자',
    // App-controlled prompt directives.
    response_directive: '한국어로 답변하라.',
    summary_directive:
      '이 토론의 사실/결정/미해결 질문을 충실히 보존해 요약하라. 새 질문에 답하기 위한 컨텍스트로 쓰일 것.',
    // App-controlled AI-response-length directives. Every level emits a
    // directive. XC-4 safe: app-controlled text, never user content.
    length_short: '핵심만 1~2문장으로 짧게 답하라. 머리말·맺음말·목록 없이 간결하게.',
    length_normal:
      '4~6문장 내외의 한두 문단으로 답하라. 핵심을 충실히 담되 장황하지 않게.',
    length_long:
      '문장 수 제한 없이 충분히 자세하고 철저하게 답하라. 필요하면 여러 문단·근거·예시·단계로 나눠 깊이 있게 설명하라.',
    // FR-13: document-condensation directive. App-controlled text appended to
    // systemInstruction (XC-4 safe) — the discussion itself stays in data turns.
    document_directive:
      '지금까지의 토론 전체를 하나의 완결된 마크다운 문서로 정리하라. 규칙: (1) 첫 줄은 반드시 문서 제목인 `# 제목` 한 줄로 시작한다. (2) 논의에서 실제로 나온 내용만 쓰고 없는 사실을 만들지 마라. (3) 주제별 섹션(`##`)으로 묶고, 구체적인 팁·예시·주의사항은 목록으로 정리하라. (4) 상충하는 의견이 있었다면 어느 한쪽으로 단정하지 말고 양쪽 입장을 함께 남겨라. (5) 결론이 나지 않은 쟁점은 마지막에 "미해결 질문" 섹션으로 모아라. (6) 대화체("~라고 했습니다")가 아니라 문서체로 쓰고, 누가 말했는지보다 무엇이 정리되었는지를 중심으로 서술하라.',
    document_untitled: '정리된 문서',
    // FR-13 failure messages (UI toasts).
    doc_fail_context: '문서 정리 실패 — 컨텍스트를 불러오지 못했습니다',
    doc_fail_generate: '문서 정리 실패 — 잠시 후 재시도',
    doc_fail_save: '문서 정리 실패 — 저장하지 못했습니다',
    doc_fail_empty: '문서 정리 실패 — 정리할 대화가 없습니다',
  },
  en: {
    err_invalid_key: 'AI response failed — check your key',
    err_quota: 'Rate limit — try again shortly',
    err_network: 'AI response failed — network error',
    err_unknown: 'AI response failed — try again shortly',
    fallback_context: 'AI response failed — could not load context',
    fallback_retry: 'AI response failed — try again shortly',
    author_fallback: 'Author',
    response_directive: 'Respond in English.',
    summary_directive:
      'Summarize this discussion, faithfully preserving its facts, decisions, and open questions. It will be used as context for answering new questions.',
    length_short:
      'Answer briefly in 1-2 sentences, core point only. No preamble, no wrap-up, no lists.',
    length_normal:
      'Answer in one or two paragraphs of about 4-6 sentences — cover the key points without rambling.',
    length_long:
      'Answer thoroughly and in depth with no sentence limit. Use multiple paragraphs, reasons, examples, or steps where useful.',
    document_directive:
      'Condense the entire discussion above into a single self-contained markdown document. Rules: (1) The very first line MUST be the document title as a single `# Title` heading. (2) Use only what the discussion actually contains — invent nothing. (3) Group the material into topical `##` sections, and turn concrete tips, examples, and caveats into lists. (4) Where participants disagreed, keep both positions rather than picking a winner. (5) Collect anything left unresolved into a final "Open questions" section. (6) Write in document prose, not as a transcript — focus on what was established, not on who said it.',
    document_untitled: 'Condensed document',
    doc_fail_context: 'Condensation failed — could not load context',
    doc_fail_generate: 'Condensation failed — try again shortly',
    doc_fail_save: 'Condensation failed — could not save the document',
    doc_fail_empty: 'Condensation failed — there is no discussion to condense',
  },
} as const;
