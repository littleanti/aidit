import { create } from 'zustand';
import { type AiLength, DEFAULT_AI_LENGTH } from '../engine/length';

// AI response-length control for the THREAD (@AI reply) flow, mirroring the
// aiModeStore idiom. Keyed by postId so a length choice never leaks between
// threads. Default is DEFAULT_AI_LENGTH ('normal') — a bounded one-or-two-
// paragraph answer (~4-6 sentences).
//
// Intentionally NOT persisted to localStorage: session-only, like aiModeStore.
// The store outlives Composer unmounts, so the choice survives in-session
// navigation between threads but resets on a hard reload.

interface AiLengthState {
  /** postId -> chosen length for that thread. Absent === DEFAULT_AI_LENGTH. */
  byPost: Record<string, AiLength>;
  /** read the length for a post (default 'normal'). Named lengthFor (not get)
   *  to avoid shadowing zustand's get. */
  lengthFor: (postId: string) => AiLength;
  /** set the length for a post explicitly. */
  set: (postId: string, len: AiLength) => void;
}

export const useAiLengthStore = create<AiLengthState>((set, get) => ({
  byPost: {},

  lengthFor: (postId) => get().byPost[postId] ?? DEFAULT_AI_LENGTH,

  set: (postId, len) => {
    set((state) => ({
      byPost: { ...state.byPost, [postId]: len },
    }));
  },
}));
