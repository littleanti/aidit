import { create } from 'zustand';
import type { LlmErrorKind } from '../api/llm';

// Session-only "is the LLM reachable?" signal for the header badge.
//
// Semantics: reflects the MOST RECENT real LLM query (llm.generateContent —
// 1차 답변 / @AI 답변 / 재시도 / 요약). countTokens is excluded (it has its own
// silent fallback and is not a connectivity signal). 'connected' = last query
// succeeded; 'disconnected' = last query threw an LlmError; 'unknown' = no
// query yet this session.
//
// Intentionally NOT persisted (like aiModeStore): a hard reload resets to
// 'unknown' so the badge only ever reflects something actually observed this
// session — never a stale claim from a previous run.

export type LlmConnState = 'unknown' | 'connected' | 'disconnected';

interface LlmStatusState {
  status: LlmConnState;
  /** error kind of the last failure (null when connected/unknown). */
  lastKind: LlmErrorKind | null;
  markSuccess: () => void;
  markFailure: (kind?: LlmErrorKind) => void;
  /** back to 'unknown' — e.g. when the BYOK key is removed (no key, no claim). */
  reset: () => void;
}

export const useLlmStatusStore = create<LlmStatusState>((set) => ({
  status: 'unknown',
  lastKind: null,
  markSuccess: () => set({ status: 'connected', lastKind: null }),
  markFailure: (kind) =>
    set({ status: 'disconnected', lastKind: kind ?? 'unknown' }),
  reset: () => set({ status: 'unknown', lastKind: null }),
}));
