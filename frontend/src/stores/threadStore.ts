import { create } from 'zustand';
import type { Comment } from '../api/types';

// FE-8: thread (chat-room) store. NOT persisted — it mirrors live server state
// for the currently open post and is rebuilt on every thread mount.
//
// L4: 'seq' (monotonic per-post int) is the single source of truth for
// ordering, SSE replay dedupe, and idempotency. Bubbles are kept sorted by seq.
// Optimistic bubbles (FE-11) carry a temporary negative seq + a clientId; when
// the server version arrives it replaces the optimistic one (matched by
// clientId), so the temp seq is swapped for the real monotonic seq.

interface ThreadState {
  /** All comment bubbles for the open post, always sorted ascending by seq. */
  bubbles: Comment[];
  /** L5: index of the currently active ContextSegment (updated on segment.opened). */
  activeSegmentIndex: number;

  /** Replace the whole list (initial snapshot). Sorted by seq. */
  setInitial: (comments: Comment[]) => void;
  /**
   * Insert or replace a bubble. Dedupes by seq AND by id. If an optimistic
   * bubble with the same clientId exists, it is replaced by this (server)
   * version (FE-11 reconciliation). Result stays sorted by seq.
   */
  upsertComment: (c: Comment) => void;
  /** Patch an existing bubble's body/status (for comment.updated events). */
  updateComment: (id: string, patch: { body?: string; status?: Comment['status'] }) => void;
  /** Insert a locally-created bubble (temp negative seq, has clientId) for instant render. */
  addOptimistic: (temp: Comment) => void;
  /** Set the active segment index (segment.opened). */
  setActiveSegmentIndex: (index: number) => void;
  /** Clear all state — call on thread change / unmount. */
  reset: () => void;
}

function sortBySeq(list: Comment[]): Comment[] {
  return [...list].sort((a, b) => a.seq - b.seq);
}

export const useThreadStore = create<ThreadState>((set) => ({
  bubbles: [],
  activeSegmentIndex: 0,

  setInitial: (comments) => {
    set({ bubbles: sortBySeq(comments) });
  },

  upsertComment: (c) => {
    set((state) => {
      // Drop any existing bubble that matches this incoming one by:
      //  - same id (true duplicate / replay), or
      //  - same real seq (replay re-send), or
      //  - same clientId as an optimistic placeholder (FE-11 reconciliation).
      const filtered = state.bubbles.filter((b) => {
        if (b.id === c.id) return false;
        if (b.seq === c.seq) return false;
        if (c.clientId != null && b.clientId === c.clientId) return false;
        return true;
      });
      filtered.push(c);
      return { bubbles: sortBySeq(filtered) };
    });
  },

  updateComment: (id, patch) => {
    set((state) => {
      let changed = false;
      const bubbles = state.bubbles.map((b) => {
        if (b.id !== id) return b;
        changed = true;
        return {
          ...b,
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        };
      });
      return changed ? { bubbles } : state;
    });
  },

  addOptimistic: (temp) => {
    set((state) => {
      // Guard against double-insert of the same optimistic clientId.
      const exists =
        temp.clientId != null &&
        state.bubbles.some((b) => b.clientId === temp.clientId);
      if (exists) return state;
      return { bubbles: sortBySeq([...state.bubbles, temp]) };
    });
  },

  setActiveSegmentIndex: (index) => {
    set({ activeSegmentIndex: index });
  },

  reset: () => {
    set({ bubbles: [], activeSegmentIndex: 0 });
  },
}));
