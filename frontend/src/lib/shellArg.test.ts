// formatPromptArg — pure live-prompt arg formatter contract.
//
// Verifies the ordered pipeline: whitespace-collapse -> trim -> truncate with a
// single ellipsis (default max 32) -> cosmetic double-quote escaping. Returns
// the INNER string only (callers add the surrounding quotes).
import { describe, it, expect } from 'vitest';
import { formatPromptArg } from './shellArg';

describe('formatPromptArg', () => {
  it('passes a short, clean string through unchanged', () => {
    expect(formatPromptArg('hello world')).toBe('hello world');
  });

  it('collapses whitespace and newline runs to a single space, then trims', () => {
    expect(formatPromptArg('  a\n\nb\t  c   ')).toBe('a b c');
    expect(formatPromptArg('line1\r\nline2')).toBe('line1 line2');
  });

  it('truncates over-length input to max-1 chars plus a single ellipsis', () => {
    const out = formatPromptArg('x'.repeat(40)); // default max 32
    expect(out).toHaveLength(32);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe('x'.repeat(31) + '…');
  });

  it('respects a custom max', () => {
    const out = formatPromptArg('abcdefghij', { max: 5 });
    expect(out).toHaveLength(5);
    expect(out).toBe('abcd…');
  });

  it('escapes every double-quote as backslash-quote', () => {
    expect(formatPromptArg('say "hi" now')).toBe('say \\"hi\\" now');
  });

  it('returns an empty string for empty input', () => {
    expect(formatPromptArg('')).toBe('');
    expect(formatPromptArg('   \n  ')).toBe('');
  });
});
