// i18n dict — AI-facing strings: Gemini error messages (USER_MESSAGES in
// gemini.ts), contextEngine fallback messages, the summary directive, and the
// response-language directive appended to systemInstruction.
//
// These are the user-visible AI failure strings AND the app-controlled prompt
// directives that make the model answer/summarize in the active UI language.
// (XC-4 still holds: the response directive is app-controlled text appended to
// systemInstruction — never user/comment content.)
export const ai = {
  ko: {
    // Gemini USER_MESSAGES (keyed by GeminiErrorKind).
    err_invalid_key: 'AI 응답 실패 — 키를 확인하세요',
    err_quota: '호출 한도 — 잠시 후 재시도',
    err_network: 'AI 응답 실패 — 네트워크 오류',
    err_unknown: 'AI 응답 실패 — 잠시 후 재시도',
    // contextEngine fallback messages (failures outside the typed Gemini path).
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
  },
} as const;
