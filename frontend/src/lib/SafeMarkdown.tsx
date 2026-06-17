// XC-3: <SafeMarkdown> — the convenient render wrapper around the sanitize
// chokepoint. Components render user-authored bodies via this component (or via
// `renderMarkdownSafe` directly) so raw user HTML is NEVER injected.
//
// The HTML passed to `dangerouslySetInnerHTML` here has ALWAYS gone through
// marked + DOMPurify (see ./sanitize), so it is sanitized by construction.

import { useMemo } from 'react';
import { renderMarkdownSafe } from './sanitize';

interface SafeMarkdownProps {
  /** untrusted markdown source (post body, comment body, summary, …). */
  text: string;
  /** wrapper element tag — defaults to a block <div>. */
  as?: 'div' | 'span' | 'p';
  /** classes applied to the wrapper (prose/typography styling). */
  className?: string;
}

/**
 * Render untrusted markdown as sanitized HTML. Memoized on `text` so the
 * marked+DOMPurify pass only re-runs when the body actually changes.
 */
export default function SafeMarkdown({
  text,
  as = 'div',
  className,
}: SafeMarkdownProps) {
  const html = useMemo(() => renderMarkdownSafe(text), [text]);
  const Tag = as;
  return (
    <Tag
      className={className}
      // Safe by construction: `html` is the output of renderMarkdownSafe,
      // which runs DOMPurify with a strict allowlist (XC-3 chokepoint).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
