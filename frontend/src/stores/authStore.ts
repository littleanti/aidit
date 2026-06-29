import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  login as apiLogin,
  register as apiRegister,
  guestLogin as apiGuestLogin,
  refreshToken as apiRefreshToken,
} from '../api/rest';
import { setAuthToken } from '../lib/authToken';
import { recordVisit, track } from '../lib/metrics';

// FE-3: auth/identity store.
// L1: googleApiKey is LOCAL ONLY (localStorage). It is NEVER sent to the
// Aidit server. It is used in M3 for direct browser->LLM provider BYOK calls.
// Security gate: identity now comes from a server-signed JWT (token field).
// The token is stored in localStorage via persist and re-armed into the
// in-memory authToken holder on rehydration so requests work after reload.

interface AuthState {
  userId: string | null;
  username: string | null;
  token: string | null;
  googleApiKey: string | null;
  /** Authenticate with username + password; sets JWT token on success. */
  login: (username: string, password: string) => Promise<void>;
  /** Register a new account with username + password; sets JWT token on success. */
  register: (username: string, password: string) => Promise<void>;
  /** Password-less guest entry by nickname; sets JWT token on success. */
  guestLogin: (username: string) => Promise<void>;
  /** Sliding-window token renewal. Silent on failure — the existing 401 path
   *  (notifyAuthExpired → clearSession) handles a rejected/expired token. */
  refresh: () => Promise<void>;
  /** update ONLY the local Google API key (L1: never sent to the server). */
  updateKey: (key: string) => void;
  /** clear identity + token but KEEP the local LLM key. Used for an expired /
   *  rejected token and for clearing a tokenless "zombie" session on load. */
  clearSession: () => void;
  /** clear identity + token from memory and localStorage, but KEEP the local
   *  LLM key (BYOK key persists across an explicit logout). */
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      username: null,
      token: null,
      googleApiKey: null,

      login: async (username: string, password: string) => {
        const resp = await apiLogin(username, password);
        setAuthToken(resp.token);
        set({
          userId: resp.id,
          username: resp.username,
          token: resp.token,
        });
        // XC-10: authed app-open. Non-blocking; feeds author D1 retention (BE-13).
        track('login');
        recordVisit(resp.id);
      },

      register: async (username: string, password: string) => {
        const resp = await apiRegister(username, password);
        setAuthToken(resp.token);
        set({
          userId: resp.id,
          username: resp.username,
          token: resp.token,
        });
        track('register');
        recordVisit(resp.id);
      },

      guestLogin: async (username: string) => {
        const resp = await apiGuestLogin(username);
        setAuthToken(resp.token);
        set({
          userId: resp.id,
          username: resp.username,
          token: resp.token,
        });
        track('login');
        recordVisit(resp.id);
      },

      refresh: async () => {
        // Slide the expiry window. On failure, swallow — a 401 here is already
        // handled by rest.ts (notifyAuthExpired → clearSession); other errors
        // (offline, 5xx) should not disrupt the session.
        try {
          const resp = await apiRefreshToken();
          setAuthToken(resp.token);
          set({ token: resp.token });
        } catch {
          // intentionally ignored
        }
      },

      // L1: googleApiKey (LLM key) stays LOCAL ONLY (localStorage). Updating it never
      // touches the network -- no round-trip, no header, no body.
      updateKey: (key: string) => {
        set({ googleApiKey: key });
      },

      clearSession: () => {
        setAuthToken(null);
        // keep googleApiKey (BYOK LLM key shouldn't be lost on token expiry)
        set({ userId: null, username: null, token: null });
      },

      logout: () => {
        setAuthToken(null);
        // keep googleApiKey: the BYOK LLM key should survive an explicit
        // logout (cleared only via Settings' remove-key action → updateKey('')).
        set({ userId: null, username: null, token: null });
      },
    }),
    {
      name: 'aidit-auth',
      partialize: (state) => ({
        userId: state.userId,
        username: state.username,
        token: state.token,
        googleApiKey: state.googleApiKey,
      }),
      // Re-arm the in-memory token holder after zustand rehydrates from
      // localStorage, so the first request after a page reload is authed.
      onRehydrateStorage: () => (state) => {
        if (state?.token) setAuthToken(state.token);
      },
    },
  ),
);

// Module-init: zustand persist rehydrates localStorage synchronously during
// create(), so the state is already populated here. Arm the in-memory token
// holder from it. If a session has an identity but NO token — a leftover from
// before the JWT gate, or a cleared token — drop it (keeping the LLM key) so
// the UI never shows a logged-in-but-tokenless "zombie" that 401s every write.
{
  const st = useAuthStore.getState();
  if (st.token) {
    setAuthToken(st.token);
  } else if (st.userId) {
    st.clearSession();
  }
}
