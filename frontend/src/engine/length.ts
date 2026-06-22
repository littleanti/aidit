// ============================================================================
// AI response length — the 3-level control shared by the WRITE (1차 reply) and
// THREAD (@AI reply) flows. This module is the SINGLE source for the length
// type + its default. BEHAVIOR-NEUTRAL: 'normal' is the default and emits NO
// directive + NO token override, so the wire request is identical to today.
// ============================================================================

/** The 3 AI-response-length levels: 짧게 / 보통 / 길게. */
export type AiLength = 'short' | 'normal' | 'long';

/** Default = 'normal': no length directive, no token override (byte-for-byte
 *  identical to today's request). */
export const DEFAULT_AI_LENGTH: AiLength = 'normal';
