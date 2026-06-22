import { create } from 'zustand';

// Thread-scoped "AI에게 묻기" toggle (BYOK friction reducer). When ON for a
// given post, every sent message is routed to the @AI flow (engine.runAtAiReply)
// instead of being a plain human comment.
//
// `byPost[postId]` holds ONLY an explicit user override. Absent (undefined) means
// "no choice yet" — the DEFAULT is decided by the CALLER (Composer), which keys it
// off BYOK key presence: a Gemini key present → default ON, absent → default OFF
// (2026-06-23). So the toggle writes an explicit value via `set(postId, next)`;
// don't rely on a hardcoded default in this store.
//
// Intentionally NOT persisted to localStorage: this is session-only. The store
// outlives Composer unmounts, so an explicit choice survives in-session navigation
// between threads but resets on a hard reload (falling back to the key-based default).

interface AiModeState {
  /** postId -> whether AI-mode is ON for that thread. Absent === ON (default). */
  byPost: Record<string, boolean>;
  /** read AI-mode for a post (default ON). */
  isOn: (postId: string) => boolean;
  /** flip AI-mode for a post. */
  toggle: (postId: string) => void;
  /** set AI-mode for a post explicitly. */
  set: (postId: string, on: boolean) => void;
}

export const useAiModeStore = create<AiModeState>((set, get) => ({
  byPost: {},

  isOn: (postId) => get().byPost[postId] ?? true,

  toggle: (postId) => {
    set((state) => ({
      byPost: { ...state.byPost, [postId]: !(state.byPost[postId] ?? true) },
    }));
  },

  set: (postId, on) => {
    set((state) => ({
      byPost: { ...state.byPost, [postId]: on },
    }));
  },
}));
