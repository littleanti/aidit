// i18n React hook — useT(). Subscribes to langStore so any component using it
// re-renders when the language toggles. Returns a stable-per-language t(key,
// vars?) that resolves 'ns.subkey' against DICTS (ko fallback -> raw key) and
// interpolates {token} placeholders. t ALWAYS returns a string.
//
// Use useT() inside React components. For non-React modules (stores/, engine/,
// lib/, api/) use tn() from './tn' instead.

import { useCallback } from 'react';
import { useLangStore } from '../stores/langStore';
import { resolve, type TVars } from './resolve';

export function useT() {
  const lang = useLangStore((s) => s.lang);
  const t = useCallback(
    (key: string, vars?: TVars): string => resolve(lang, key, vars),
    [lang],
  );
  return { t, lang };
}
