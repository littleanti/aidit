import { create } from 'zustand';

// Thread-scoped "AI에게 묻기" toggle (BYOK friction reducer). When ON for a
// given post, every sent message is routed to the @AI flow (engine.runAtAiReply)
// instead of being a plain human comment.
//
// Intentionally NOT persisted to localStorage: this is session-only. A fresh
// load defaults OFF per post, which is the cost-safe default for BYOK (no key
// is ever spent without a deliberate in-session opt-in). The store outlives
// Composer unmounts, so the choice survives in-session navigation between
// threads but resets on a hard reload.

interface AiModeState {
  /** postId -> whether AI-mode is ON for that thread. Absent === OFF. */
  byPost: Record<string, boolean>;
  /** read AI-mode for a post (default OFF). */
  isOn: (postId: string) => boolean;
  /** flip AI-mode for a post. */
  toggle: (postId: string) => void;
  /** set AI-mode for a post explicitly. */
  set: (postId: string, on: boolean) => void;
}

export const useAiModeStore = create<AiModeState>((set, get) => ({
  byPost: {},

  isOn: (postId) => get().byPost[postId] ?? false,

  toggle: (postId) => {
    set((state) => ({
      byPost: { ...state.byPost, [postId]: !(state.byPost[postId] ?? false) },
    }));
  },

  set: (postId, on) => {
    set((state) => ({
      byPost: { ...state.byPost, [postId]: on },
    }));
  },
}));
