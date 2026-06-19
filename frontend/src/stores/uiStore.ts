import { create } from 'zustand';

// FE: transient UI state (not persisted). Controls the login modal overlay
// rendered above the app shell. No persist middleware by design — this resets
// on reload, unlike authStore.
interface UiState {
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  loginOpen: false,
  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
}));
