// i18n non-React translator — tn(). Reads a one-shot snapshot of the active
// language from useLangStore.getState() (NOT reactive — no subscription). Same
// resolution + interpolation contract as useT's t.
//
// Use tn() inside non-React modules (stores/, engine/, lib/, api/) — e.g. for
// AI directives and error strings. Inside React components use useT() so the
// component re-renders on a language change.

import { useLangStore } from '../stores/langStore';
import { resolve, type TVars } from './resolve';

export function tn(key: string, vars?: TVars): string {
  return resolve(useLangStore.getState().lang, key, vars);
}
