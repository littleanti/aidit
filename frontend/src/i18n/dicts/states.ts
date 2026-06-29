// i18n dict — shared state components (empty/error/loading screens in
// components/states, LlmStatusBadge). Filled by the states migration agent.
// Shape contract: export const <ns> = { ko: {...}, en: {...} } as const;
export const states = {
  ko: {
    retry: '다시 시도',
    loading: '불러오는 중…',
    offline: '오프라인 — 재연결 중…',
  },
  en: {
    retry: 'Retry',
    loading: 'Loading…',
    offline: 'Offline — reconnecting…',
  },
} as const;
