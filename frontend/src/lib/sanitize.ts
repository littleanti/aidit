// XC-3: client-side sanitize chokepoint.
//
// ALL user-authored content (post bodies, human comments, AI replies, AI
// summaries) is markdown that originates from untrusted input and is therefore
// rendered THROUGH this module — never via raw `dangerouslySetInnerHTML` of
// upstream HTML. The pipeline is:
//
//     markdown ──(marked)──▶ HTML ──(DOMPurify, strict allowlist)──▶ safe HTML
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

// Strict allowlist — formatting + links + code only. Deliberately NO:
// script/style/iframe/object/embed/form/input, NO event-handler attributes,
// NO `style` attribute. `target`/`rel` are allowed so links open safely.
const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 's', 'del', 'mark', 'sub', 'sup',
    'a',
    'ul', 'ol', 'li',
    'blockquote',
    'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  // Only http(s) and mailto links survive; javascript:/data: are dropped.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: [],
  RETURN_TRUSTED_TYPE: false,
};

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
    // marked.parse is synchronous when async:false (the default here).
    const rawHtml = marked.parse(md, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as string;
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
