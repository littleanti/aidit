import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// FR-12: user's personal AI personas (3 slots) for their OWN BYOK AI.
// L1-adjacent philosophy: like the BYOK key, personas are LOCAL ONLY
// (localStorage, key 'aidit-user-personas') and are NEVER sent to the Aidit
// server — they only ride the browser->LLM provider call as part of
// systemInstruction (XC-4: never as user-turn data).
//
// Persistence split:
//  * `personas` (3 slots of { name, prompt }) — persisted.
//  * `selectedByPost` (postId -> slot index | null) — SESSION ONLY (same
//    philosophy as aiModeStore / aiLengthStore): the user picks a persona per
//    thread in the Composer's AI menu; default is null ("없음" — no persona).

export const USER_PERSONA_SLOTS = 3;

export interface UserPersonaSlot {
  /** short display name shown in the Composer picker. */
  name: string;
  /** the persona prompt joined into systemInstruction (after the community persona). */
  prompt: string;
}

const EMPTY_SLOT: UserPersonaSlot = { name: '', prompt: '' };

/** A slot counts as "saved" when it has a prompt (name optional but encouraged). */
export function isFilledSlot(slot: UserPersonaSlot): boolean {
  return slot.prompt.trim().length > 0;
}

interface UserPersonaState {
  /** exactly USER_PERSONA_SLOTS entries; empty slots are { name:'', prompt:'' }. */
  personas: UserPersonaSlot[];
  /** postId -> selected slot index, or null/absent for "no persona" (default). */
  selectedByPost: Record<string, number | null>;
  /** save/replace one slot (trimmed by the caller or here — we trim here). */
  setPersona: (index: number, slot: UserPersonaSlot) => void;
  /** clear one slot back to empty. */
  clearPersona: (index: number) => void;
  /** pick the persona for a thread (null = none). Session-only. */
  select: (postId: string, index: number | null) => void;
}

export const useUserPersonaStore = create<UserPersonaState>()(
  persist(
    (set) => ({
      personas: Array.from({ length: USER_PERSONA_SLOTS }, () => ({
        ...EMPTY_SLOT,
      })),
      selectedByPost: {},

      setPersona: (index, slot) => {
        if (index < 0 || index >= USER_PERSONA_SLOTS) return;
        set((state) => {
          const personas = state.personas.slice();
          personas[index] = {
            name: slot.name.trim(),
            prompt: slot.prompt.trim(),
          };
          return { personas };
        });
      },

      clearPersona: (index) => {
        if (index < 0 || index >= USER_PERSONA_SLOTS) return;
        set((state) => {
          const personas = state.personas.slice();
          personas[index] = { ...EMPTY_SLOT };
          return { personas };
        });
      },

      select: (postId, index) => {
        set((state) => ({
          selectedByPost: { ...state.selectedByPost, [postId]: index },
        }));
      },
    }),
    {
      name: 'aidit-user-personas',
      // Only the slots persist; per-thread selection is session-only.
      partialize: (state) => ({ personas: state.personas }),
      // Defensive rehydrate: pad/trim to exactly USER_PERSONA_SLOTS entries so
      // a hand-edited/older localStorage value can't break slot indexing.
      merge: (persisted, current) => {
        const p = (persisted as Partial<UserPersonaState> | undefined)
          ?.personas;
        const personas = Array.from({ length: USER_PERSONA_SLOTS }, (_, i) => {
          const slot = p?.[i];
          return {
            name: typeof slot?.name === 'string' ? slot.name : '',
            prompt: typeof slot?.prompt === 'string' ? slot.prompt : '',
          };
        });
        return { ...current, personas };
      },
    },
  ),
);
