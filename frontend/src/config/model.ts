// ============================================================================
// AI-2 / L7: SINGLE SOURCE for the LLM model id + generation config.
// The model id is defined here ONCE — never hardcode the model elsewhere.
// Provider is abstracted: the model id and REST base are env-overridable so the
// LLM provider can be swapped without code changes. Defaults target Google
// Gemini (the default provider), preserving existing behavior.
// ============================================================================

import type { AiLength } from '../engine/length';

/** L7: the one and only LLM model id used by the BYOK client. Override via
 *  VITE_LLM_MODEL; defaults to the Gemini model the app ships with. */
export const LLM_MODEL =
  (import.meta.env.VITE_LLM_MODEL as string | undefined) ??
  'gemini-3.1-flash-lite';

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

/** LLM provider REST API base. Browser fetches go DIRECTLY here (BYOK).
 *  Override via VITE_LLM_BASE; defaults to Google Gemini's v1beta endpoint. */
export const LLM_BASE =
  (import.meta.env.VITE_LLM_BASE as string | undefined) ??
  'https://generativelanguage.googleapis.com/v1beta';
