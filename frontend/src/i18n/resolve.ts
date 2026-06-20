// i18n shared resolver — the single key-resolution + interpolation routine used
// by BOTH useT (React) and tn (non-React). Keeping it here means the resolution
// contract (ns split, ko fallback, raw-key fallback, brace interpolation, DEV
// miss warning) is defined in exactly one place.

import { DICTS, type Lang } from './index';

export type TVars = Record<string, string | number>;

/** Replace {token} placeholders from vars. Leaves unknown tokens untouched. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Resolve a 'ns.subkey' key for a language. The key is split on the FIRST dot
 * so subkeys may themselves contain dots.
 *
 * Resolution order:
 *   1. DICTS[ns][lang][sub]
 *   2. DICTS[ns].ko[sub]   (Korean fallback — ko is the authoring source)
 *   3. the raw key          (last-resort, so t() ALWAYS returns a string)
 *
 * In DEV a missing key (no ns / no sub in either lang) is console.warn'd.
 */
export function resolve(lang: Lang, key: string, vars?: TVars): string {
  const dot = key.indexOf('.');
  const ns = dot === -1 ? '' : key.slice(0, dot);
  const sub = dot === -1 ? key : key.slice(dot + 1);

  const nsDict = (DICTS as Record<string, { ko: Record<string, string>; en: Record<string, string> }>)[ns];

  if (nsDict) {
    const langTable = lang === 'en' ? nsDict.en : nsDict.ko;
    const hit = langTable[sub];
    if (typeof hit === 'string') return interpolate(hit, vars);

    const koHit = nsDict.ko[sub];
    if (typeof koHit === 'string') return interpolate(koHit, vars);
  }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key: "${key}" (lang=${lang})`);
  }
  // Raw-key fallback keeps the return type a guaranteed string.
  return interpolate(key, vars);
}
