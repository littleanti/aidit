// Live-prompt arg formatter for the decorative ShellPrompt line.
//
// Each primary screen echoes a tiny shell command (e.g. `post --new "title"`)
// that reflects live user input. The user-supplied portion must be made safe
// for a SINGLE-LINE, fixed-width terminal echo so there is no layout shift and
// no horizontal scroll, and so embedded quotes don't visually break the line.
//
// This is a PURE helper (no React, no state). It returns the INNER string only;
// callers wrap it in quotes themselves. The command is never executed and the
// whole prompt line is aria-hidden, so the quote-escaping here is purely
// cosmetic — it keeps the rendered idiom looking right, nothing more.

interface FormatPromptArgOpts {
  /** Max visible length of the inner string before truncation. Default 32. */
  max?: number;
}

/** Single ellipsis character (not three dots) to keep the truncation compact. */
const ELLIPSIS = '…';

/**
 * Format a raw user-supplied value for inline display inside a shell prompt.
 *
 * Behavior, IN ORDER:
 *   1) collapse every run of whitespace (incl. newlines/tabs) to one space;
 *   2) trim leading/trailing whitespace;
 *   3) if longer than `max` (default 32), cut to `max - 1` chars + ellipsis;
 *   4) escape every double-quote as `\"` (cosmetic only).
 *
 * Returns the inner string only — callers wrap it in quotes.
 */
export function formatPromptArg(raw: string, opts?: FormatPromptArgOpts): string {
  const max = opts?.max ?? 32;

  // 1) collapse whitespace runs -> single space, 2) trim.
  let result = raw.replace(/\s+/g, ' ').trim();

  // 3) truncate with a single ellipsis character.
  if (result.length > max) {
    result = result.slice(0, max - 1) + ELLIPSIS;
  }

  // 4) escape double-quotes (cosmetic — never executed, line is aria-hidden).
  result = result.replace(/"/g, '\\"');

  return result;
}
