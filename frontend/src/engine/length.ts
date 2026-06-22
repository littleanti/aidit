// ============================================================================
// AI response length — the 3-level control shared by the WRITE (1차 reply) and
// THREAD (@AI reply) flows. This module is the SINGLE source for the length
// type + its default. Every level emits a length directive + token cap; 'normal'
// is the default middle ground (one or two paragraphs, ~4-6 sentences).
// ============================================================================

/** The 3 AI-response-length levels: 짧게 / 보통 / 길게. */
export type AiLength = 'short' | 'normal' | 'long';

/** Default = 'normal': a bounded one-or-two-paragraph answer (~4-6 sentences). */
export const DEFAULT_AI_LENGTH: AiLength = 'normal';
