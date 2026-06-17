// XC-3: renderMarkdownSafe sanitize chokepoint contract.
//
// Runs in jsdom so DOMPurify operates against a real DOM. Verifies that the
// dangerous vectors (script tags, event-handler attributes, javascript:/data:
// URLs, iframes/objects) are stripped while safe markdown formatting survives.
import { describe, it, expect } from 'vitest';
import { renderMarkdownSafe, sanitizeHtml } from './sanitize';

describe('renderMarkdownSafe — XC-3 dangerous-vector stripping', () => {
  it('strips <script> tags entirely (no executable content survives)', () => {
    const out = renderMarkdownSafe('hello <script>alert(1)</script> world');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
  });

  it('strips onerror / on* event-handler attributes', () => {
    const out = renderMarkdownSafe('![x](https://example.com/a.png "t")\n\n<img src=x onerror=alert(1)>');
    expect(out.toLowerCase()).not.toContain('onerror');
    // img is not in the allowlist at all, so it is dropped too.
    expect(out.toLowerCase()).not.toContain('<img');
  });

  it('drops javascript: URLs on links', () => {
    const out = renderMarkdownSafe('[click](javascript:alert(1))');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('drops data: URLs on links', () => {
    const out = renderMarkdownSafe('[x](data:text/html;base64,PHNjcmlwdD4=)');
    expect(out.toLowerCase()).not.toContain('data:text/html');
  });

  it('removes iframe/object/embed elements', () => {
    const out = renderMarkdownSafe('<iframe src="https://evil.test"></iframe><object data="x"></object>');
    expect(out.toLowerCase()).not.toContain('<iframe');
    expect(out.toLowerCase()).not.toContain('<object');
  });

  it('keeps safe markdown formatting (bold, code, lists, safe links)', () => {
    const out = renderMarkdownSafe(
      '**bold** and `code`\n\n- one\n- two\n\n[safe](https://example.com)',
    );
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<code>code<\/code>/);
    expect(out).toMatch(/<li>one<\/li>/);
    expect(out).toMatch(/href="https:\/\/example\.com"/);
  });

  it('returns empty string for empty / non-string input (no throw)', () => {
    expect(renderMarkdownSafe('')).toBe('');
    // @ts-expect-error deliberate non-string to exercise the guard
    expect(renderMarkdownSafe(null)).toBe('');
  });

  it('sanitizeHtml applies the same allowlist to raw HTML', () => {
    const out = sanitizeHtml('<b>ok</b><script>bad()</script>');
    expect(out).toContain('<b>ok</b>');
    expect(out.toLowerCase()).not.toContain('<script');
  });
});
