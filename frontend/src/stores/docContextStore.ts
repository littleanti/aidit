import { create } from 'zustand';

// FR-14: community documents attached as reference context for ONE @AI turn.
//
// This is the return leg of the knowledge loop: FR-13 turns a discussion into a
// document, FR-14 feeds that document back into a later discussion so the
// community stops re-deriving what it already concluded.
//
// Deliberately NOT persisted (same philosophy as aiModeStore / aiLengthStore /
// the persona selection): an attachment is a decision about THIS utterance, not
// a durable property of the thread. It survives in-session navigation between
// threads (the store outlives Composer unmounts) and resets on a hard reload.
//
// Only IDS live here — never document bodies. Bodies are fetched at send time
// (GET /documents/:id) so a long guide is not duplicated into client state, and
// the attachment always reflects the document's current content.

/** FR-14.3: attaching more piles onto the active context and pulls the 128K
 *  threshold forward for everyone in the thread. Three is the cap. */
export const MAX_ATTACHED_DOCS = 3;

interface DocContextState {
  /** postId -> selected document ids (order = selection order). */
  selectedByPost: Record<string, string[]>;
  /** ids selected for a post (empty array when none). */
  selected: (postId: string) => string[];
  /** Toggle one document for a post. A no-op when adding past the cap. */
  toggle: (postId: string, documentId: string) => void;
  /** Drop every attachment for a post (the chip's ×, and after a sent turn). */
  clear: (postId: string) => void;
}

export const useDocContextStore = create<DocContextState>((set, get) => ({
  selectedByPost: {},

  selected: (postId) => get().selectedByPost[postId] ?? [],

  toggle: (postId, documentId) => {
    set((state) => {
      const current = state.selectedByPost[postId] ?? [];
      const has = current.includes(documentId);
      if (!has && current.length >= MAX_ATTACHED_DOCS) {
        // At the cap: adding is refused rather than silently evicting another
        // document the user deliberately picked.
        return state;
      }
      const next = has
        ? current.filter((id) => id !== documentId)
        : [...current, documentId];
      return { selectedByPost: { ...state.selectedByPost, [postId]: next } };
    });
  },

  clear: (postId) => {
    set((state) => {
      if (!state.selectedByPost[postId]) return state;
      const next = { ...state.selectedByPost };
      delete next[postId];
      return { selectedByPost: next };
    });
  },
}));
