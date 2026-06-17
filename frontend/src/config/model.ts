// ============================================================================
// AI-2 / L7: SINGLE SOURCE for the Gemini model id + generation config.
// The model id is defined here ONCE — never hardcode "gemini-*" elsewhere.
// ============================================================================

/** L7: the one and only Gemini model id used by the BYOK client. */
export const MODEL = 'gemini-3.1-flash-lite';

/** Default generation parameters for generateContent calls. */
export const GENERATION_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 2048,
} as const;

/** Gemini REST API base (v1beta). Browser fetches go DIRECTLY here (BYOK). */
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
