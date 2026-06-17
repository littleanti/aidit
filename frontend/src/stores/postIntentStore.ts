import { create } from 'zustand';

// FE-7: carries the "게시 후 AI 1차 답변 받기" intent from CreatePost forward
// to the Thread. The toggle decides whether the thread should auto-trigger the
// first AI reply (consumed in M3). Keyed by postId so a stale flag from one post
// never leaks into another. Intentionally NOT persisted: it is a one-shot,
// session-scoped handoff that should evaporate on reload.

interface PostIntentState {
  /** postId -> whether the user opted into the first AI reply. */
  firstAiReply: Record<string, boolean>;
  /** record the intent right after a post is created. */
  setFirstAiReply: (postId: string, value: boolean) => void;
  /** read + clear the intent (one-shot consumption by the Thread in M3). */
  consumeFirstAiReply: (postId: string) => boolean;
}

export const usePostIntentStore = create<PostIntentState>((set, get) => ({
  firstAiReply: {},

  setFirstAiReply: (postId, value) => {
    set((state) => ({
      firstAiReply: { ...state.firstAiReply, [postId]: value },
    }));
  },

  consumeFirstAiReply: (postId) => {
    const value = get().firstAiReply[postId] ?? false;
    set((state) => {
      const next = { ...state.firstAiReply };
      delete next[postId];
      return { firstAiReply: next };
    });
    return value;
  },
}));
