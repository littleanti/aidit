import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// i18n-1: UI language store (state-based, KO/EN only).
//
// The whole app's static chrome AND the AI's answer/summary language follow
// this single source of truth. There are NO /en routes and NO query params —
// language is a persisted piece of client state (option a).
//
// First-visit default: derived from navigator.language ('ko*' -> 'ko', else
// 'en'). An EXPLICIT user choice (setLang/toggle) is persisted and ALWAYS beats
// the browser default on subsequent visits.
//
// document.documentElement.lang is kept in sync on every change AND on
// rehydration so the <html lang> attribute reflects the real runtime language
// (index.html ships a static lang="ko" default; this overrides it at runtime).

export type Lang = 'ko' | 'en';

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

/** First-visit browser default. Korean browsers -> 'ko', everyone else -> 'en'. */
function detectDefaultLang(): Lang {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  }
  return 'en';
}

/** Reflect the active language onto <html lang> for a11y / browser features. */
function applyHtmlLang(lang: Lang): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
}

export const useLangStore = create<LangState>()(
  persist(
    (set, get) => ({
      lang: detectDefaultLang(),

      setLang: (l: Lang) => {
        applyHtmlLang(l);
        set({ lang: l });
      },

      toggle: () => {
        const next: Lang = get().lang === 'ko' ? 'en' : 'ko';
        applyHtmlLang(next);
        set({ lang: next });
      },
    }),
    {
      name: 'aidit-lang',
      partialize: (state) => ({ lang: state.lang }),
      // After zustand rehydrates the persisted explicit choice from
      // localStorage, push it onto <html lang> so the document reflects the
      // real language immediately on load (mirrors authStore's re-arm pattern).
      onRehydrateStorage: () => (state) => {
        if (state?.lang) applyHtmlLang(state.lang);
      },
    },
  ),
);

// Module-init: zustand persist rehydrates synchronously during create(), so the
// state is already populated here. Apply it to <html lang> immediately — on a
// first visit this is the browser-derived default; on a return visit it is the
// persisted explicit choice.
applyHtmlLang(useLangStore.getState().lang);
