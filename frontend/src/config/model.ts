// ============================================================================
// AI-2 / L7: SINGLE SOURCE for the Gemini model id + generation config.
// The model id is defined here ONCE — never hardcode "gemini-*" elsewhere.
// ============================================================================

import type { AiLength } from '../engine/length';

/** L7: the one and only Gemini model id used by the BYOK client. */
export const MODEL = 'gemini-3.1-flash-lite';

/** Default generation parameters for generateContent calls. */
export const GENERATION_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 2048,
} as const;

/** Safety-only maxOutputTokens cap per AI-response-length level — a backstop
 *  only; the systemInstruction length directive is the primary lever. 'normal'
 *  sits between short and long; 'long' has the widest headroom. */
export const MAX_OUTPUT_TOKENS_BY_LENGTH: Record<AiLength, number | undefined> =
  {
    short: 512,
    normal: 1024,
    long: 4096,
  };

/** Gemini REST API base (v1beta). Browser fetches go DIRECTLY here (BYOK). */
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
