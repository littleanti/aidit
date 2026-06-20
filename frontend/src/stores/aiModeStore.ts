import { create } from 'zustand';

// Thread-scoped "AI에게 묻기" toggle (BYOK friction reducer). When ON for a
// given post, every sent message is routed to the @AI flow (engine.runAtAiReply)
// instead of being a plain human comment.
//
// Intentionally NOT persisted to localStorage: this is session-only. A fresh
// load defaults ON per post — commenting is AI-first, so the @AI flow is the
// default and the user explicitly UNchecks the toggle for a plain human reply.
// (Trade-off: this spends the user's BYOK key by default; the per-send guard in
// Composer still blocks an AI send when no key is set.) The store outlives
// Composer unmounts, so the choice survives in-session navigation between
// threads but resets on a hard reload.

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
