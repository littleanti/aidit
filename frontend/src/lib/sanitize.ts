// XC-3: client-side sanitize chokepoint.
//
// ALL user-authored content (post bodies, human comments, AI replies, AI
// summaries) is markdown that originates from untrusted input and is therefore
// rendered THROUGH this module — never via raw `dangerouslySetInnerHTML` of
// upstream HTML. The pipeline is:
//
//     markdown ──(normalize)──▶ (marked) ──▶ HTML ──(DOMPurify)──▶ safe HTML
//
// Security posture (L2 alignment): the CSP `script-src 'self'` is the primary
// key-exfiltration mitigation; this module is the in-DOM defense-in-depth that
// strips scripts, event handlers, iframes, and dangerous URL schemes BEFORE any
// user content reaches the DOM. If anything goes wrong (parse throw, non-string
// input), we fall back to plain escaped text rather than emitting raw HTML.

import DOMPurify, { type Config } from 'dompurify';
import { marked } from 'marked';

// Inline-leaning markdown: no raw HTML passthrough (marked emits structured
// tags only), GitHub-style line breaks so chat newlines survive, no deprecated
// mangling/header-id side effects.
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Strict allowlist — formatting + links + code + GFM tables + images. Deliberately
// NO: script/style/iframe/object/embed/form/input, NO event-handler attributes,
// NO `style` attribute. `target`/`rel` are allowed so links open safely. Image
// `src` is constrained to http(s) by ALLOWED_URI_REGEXP (no data:/javascript:);
// note the app CSP `img-src` further restricts which hosts actually load.
const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 's', 'del', 'mark', 'sub', 'sup',
    'a',
    'ul', 'ol', 'li',
    'blockquote',
    'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img',
    'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'align'],
  // Only http(s) and mailto URIs survive (links AND image src); javascript:/data:
  // are dropped.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: [],
  RETURN_TRUSTED_TYPE: false,
};

// Private-use-area sentinels for masking code while we normalize prose. These
// code points never appear in real markdown, so the placeholder can't collide
// with ordinary content (digits, words).
const MASK_OPEN = '';
const MASK_CLOSE = '';

/**
 * Normalize "loose" bold where stray spaces sit just inside the `**` delimiters
 * ("** text **" -> "**text**"). CommonMark (and GitHub) intentionally leave such
 * runs literal, but AI replies often emit them, so we tidy them up to match the
 * obvious intent. Code is protected first — fenced ``` blocks and inline `code`
 * are masked so we never rewrite `**` inside them (e.g. Python `**kwargs`). Only
 * the double-asterisk (bold) form is touched; single `*` is left alone (it
 * collides with list bullets and multiplication).
 */
function normalizeLooseBold(md: string): string {
  const stash: string[] = [];
  const mask = (s: string): string => {
    const token = `${MASK_OPEN}${stash.length}${MASK_CLOSE}`;
    stash.push(s);
    return token;
  };
  let out = md
    .replace(/```[\s\S]*?```/g, mask) // fenced code blocks
    .replace(/`[^`\n]*`/g, mask); // inline code spans
  // Trim spaces immediately inside a **...** run (inner content has no '*'/newline).
  out = out.replace(/\*\*[ \t]*(\S[^*\n]*?\S|\S)[ \t]*\*\*/g, '**$1**');
  // Intraword bold whose inner content begins/ends with punctuation — e.g.
  // 앞**'내용'**뒤, 김치는**'적당량'**넣어요 — is left LITERAL by CommonMark's
  // flanking rules (the opener is preceded by a word char and followed by
  // punctuation, so it can't open emphasis). Force just those runs to <strong>
  // so they bold. Spaced/standalone bold and plain intraword bold (A**B**C) are
  // left to marked. Code is still masked here, so we never touch ** in code.
  out = out.replace(
    /\*\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*\*/g,
    (m: string, inner: string, off: number, str: string) => {
      const before = str[off - 1] ?? '';
      const after = str[off + m.length] ?? '';
      const wordy = (c: string) => /[\p{L}\p{N}]/u.test(c);
      const punctEdge =
        /[^\p{L}\p{N}\s]/u.test(inner[0]) ||
        /[^\p{L}\p{N}\s]/u.test(inner[inner.length - 1]);
      return (wordy(before) || wordy(after)) && punctEdge
        ? `<strong>${inner}</strong>`
        : m;
    },
  );
  // Restore masked code verbatim.
  out = out.replace(
    new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'),
    (_, i: string) => stash[Number(i)],
  );
  return out;
}

/** Plain-text fallback: HTML-escape so the raw text is shown, never parsed. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert untrusted markdown to a SAFE HTML string.
 *
 * Returns sanitized HTML suitable for `dangerouslySetInnerHTML`. On any
 * failure (non-string input, parser throw) it returns escaped plain text, so
 * the worst case is "user sees their markdown source", never script execution.
 */
export function renderMarkdownSafe(md: string): string {
  if (typeof md !== 'string' || md.length === 0) return '';
  try {
    const normalized = normalizeLooseBold(md);
    // marked.parse is synchronous when async:false (the default here).
    const rawHtml = marked.parse(normalized, { async: false }) as string;
    return (DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as string).trim();
  } catch {
    return escapeHtml(md);
  }
}

/**
 * Sanitize an already-HTML string (no markdown parsing). Same allowlist as
 * {@link renderMarkdownSafe}; use when the caller already holds HTML.
 */
export function sanitizeHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  try {
    return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
  } catch {
    return escapeHtml(html);
  }
}
