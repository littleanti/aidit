import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { login as apiLogin, register as apiRegister } from '../api/rest';
import { setAuthToken } from '../lib/authToken';
import { recordVisit, track } from '../lib/metrics';

// FE-3: auth/identity store.
// L1: googleApiKey is LOCAL ONLY (localStorage). It is NEVER sent to the
// Aidit server. It is used in M3 for direct browser->Gemini BYOK calls.
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
  /** update ONLY the local Google API key (L1: never sent to the server). */
  updateKey: (key: string) => void;
  /** clear all identity + token + key from memory and localStorage. */
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

      // L1: googleApiKey stays LOCAL ONLY (localStorage). Updating it never
      // touches the network -- no round-trip, no header, no body.
      updateKey: (key: string) => {
        set({ googleApiKey: key });
      },

      logout: () => {
        setAuthToken(null);
        set({ userId: null, username: null, token: null, googleApiKey: null });
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

// Module-init: arm from localStorage synchronously (handles environments where
// onRehydrateStorage fires after the first render/request cycle).
{
  const raw = localStorage.getItem('aidit-auth');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { state?: { token?: string } };
      const t = parsed?.state?.token;
      if (t) setAuthToken(t);
    } catch {
      // malformed storage -- ignore
    }
  }
}
