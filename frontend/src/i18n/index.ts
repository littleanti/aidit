// i18n registry — imports EVERY namespace dict and exposes them as one DICTS
// map. Adding a namespace means: create src/i18n/dicts/<ns>.ts (shape
// { ko: {...}, en: {...} } as const) and register it here.
//
// Resolution + interpolation lives in ./useT (React) and ./tn (non-React), both
// driven by useLangStore. UGC is NEVER routed through here.

import { common } from './dicts/common';
import { nav } from './dicts/nav';
import { ai } from './dicts/ai';
import { auth } from './dicts/auth';
import { home } from './dicts/home';
import { thread } from './dicts/thread';
import { post } from './dicts/post';
import { community } from './dicts/community';
import { profile } from './dicts/profile';
import { states } from './dicts/states';
import { misc } from './dicts/misc';

export type Lang = 'ko' | 'en';

export const DICTS = {
  common,
  nav,
  ai,
  auth,
  home,
  thread,
  post,
  community,
  profile,
  states,
  misc,
} as const;

export type Namespace = keyof typeof DICTS;
