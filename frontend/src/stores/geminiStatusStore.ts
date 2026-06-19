import { create } from 'zustand';
import type { GeminiErrorKind } from '../api/gemini';

// Session-only "is Gemini reachable?" signal for the header badge.
//
// Semantics: reflects the MOST RECENT real LLM query (gemini.generateContent —
// 1차 답변 / @AI 답변 / 재시도 / 요약). countTokens is excluded (it has its own
// silent fallback and is not a connectivity signal). 'connected' = last query
// succeeded; 'disconnected' = last query threw a GeminiError; 'unknown' = no
// query yet this session.
//
// Intentionally NOT persisted (like aiModeStore): a hard reload resets to
// 'unknown' so the badge only ever reflects something actually observed this
// session — never a stale claim from a previous run.

export type GeminiConnState = 'unknown' | 'connected' | 'disconnected';

interface GeminiStatusState {
  status: GeminiConnState;
  /** error kind of the last failure (null when connected/unknown). */
  lastKind: GeminiErrorKind | null;
  markSuccess: () => void;
  markFailure: (kind?: GeminiErrorKind) => void;
}

export const useGeminiStatusStore = create<GeminiStatusState>((set) => ({
  status: 'unknown',
  lastKind: null,
  markSuccess: () => set({ status: 'connected', lastKind: null }),
  markFailure: (kind) =>
    set({ status: 'disconnected', lastKind: kind ?? 'unknown' }),
}));
