// i18n dict — catch-all for chrome that doesn't fit another namespace.
// Shape contract: export const <ns> = { ko: {...}, en: {...} } as const;
export const misc = {
  ko: {
    gemini_connected: 'Gemini 연결됨 — 최근 응답 성공',
    gemini_disconnected: 'Gemini 끊김 — 최근 응답 실패 (키/네트워크 확인)',
    gemini_unknown: 'Gemini 상태 미확인 — 아직 요청 없음',
    ai_fail_context: 'AI 응답 실패 — 컨텍스트를 불러오지 못했습니다',
    ai_fail_retry: 'AI 응답 실패 — 잠시 후 재시도',
    image_read_error: '이미지를 읽지 못했습니다.',
  },
  en: {
    gemini_connected: 'Gemini connected — last response succeeded',
    gemini_disconnected: 'Gemini disconnected — last response failed (check key/network)',
    gemini_unknown: 'Gemini status unknown — no requests yet this session',
    ai_fail_context: 'AI response failed — could not load context',
    ai_fail_retry: 'AI response failed — please retry in a moment',
    image_read_error: 'Could not read the image.',
  },
} as const;
