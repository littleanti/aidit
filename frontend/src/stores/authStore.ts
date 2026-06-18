import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { postAuthSession } from '../api/rest';
import { recordVisit, track } from '../lib/metrics';

// FE-3: auth/identity store.
// L1: googleApiKey is LOCAL ONLY (localStorage). It is NEVER sent to the
// Aidit server. It is used in M3 for direct browser->Gemini BYOK calls.

interface AuthState {
  userId: string | null;
  username: string | null;
  googleApiKey: string | null;
  /** authenticate username, persist { userId, username } and the local key. */
  login: (username: string, key: string) => Promise<void>;
  /** update ONLY the local Google API key (L1: never sent to the server). */
  updateKey: (key: string) => void;
  /** clear all identity + key from memory and localStorage. */
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      username: null,
      googleApiKey: null,

      login: async (username: string, key: string) => {
        const session = await postAuthSession(username);
        set({
          userId: session.id,
          username: session.username,
          googleApiKey: key,
        });
        // XC-10: authed app-open. Non-blocking; feeds author D1 retention (BE-13).
        // L1: recordVisit sends ONLY x-user-id — the local key is never emitted.
        track('login');
        recordVisit(session.id);
      },

      // L1: googleApiKey stays LOCAL ONLY (localStorage). Updating it never
      // touches the network — no server round-trip, no header, no body.
      updateKey: (key: string) => {
        set({ googleApiKey: key });
      },

      logout: () => {
        set({ userId: null, username: null, googleApiKey: null });
      },
    }),
    {
      name: 'aidit-auth',
      // persist everything; the key intentionally stays in localStorage only.
      partialize: (state) => ({
        userId: state.userId,
        username: state.username,
        googleApiKey: state.googleApiKey,
      }),
    },
  ),
);
