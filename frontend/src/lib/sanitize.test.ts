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

  it('strips onerror / on* event-handler attributes (img allowed; handler + non-http src removed)', () => {
    const out = renderMarkdownSafe('![x](https://example.com/a.png "t")\n\n<img src=x onerror=alert(1)>');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
    // img is now allowlisted: the safe https image survives with its src.
    expect(out).toMatch(/<img[^>]+src="https:\/\/example\.com\/a\.png"/);
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

  it('renders GFM tables and safe images (allowlisted)', () => {
    const out = renderMarkdownSafe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(out).toMatch(/<table>/);
    expect(out).toMatch(/<th[^>]*>a<\/th>/);
    expect(out).toMatch(/<td[^>]*>1<\/td>/);

    const img = renderMarkdownSafe('![alt](https://example.com/p.png)');
    expect(img).toMatch(/<img[^>]+src="https:\/\/example\.com\/p\.png"/);
    expect(img).toMatch(/alt="alt"/);
  });

  it('bolds "loose" emphasis with stray inner spaces (** text ** -> strong)', () => {
    expect(renderMarkdownSafe('** 굵게 **')).toMatch(/<strong>굵게<\/strong>/);
    expect(renderMarkdownSafe('앞 ** 강조 ** 뒤')).toMatch(/<strong>강조<\/strong>/);
    // proper bold still works (no regression)
    expect(renderMarkdownSafe('**bold**')).toMatch(/<strong>bold<\/strong>/);
  });

  it('bolds intraword bold whose content is punctuation-wrapped (앞**\'내용\'**뒤)', () => {
    // CommonMark leaves these literal (flanking rules); we force them to bold.
    expect(renderMarkdownSafe("앞**'내용'**뒤")).toMatch(/<strong>[^<]*내용[^<]*<\/strong>/);
    expect(renderMarkdownSafe("김치는**'적당량'**넣어요")).toMatch(/<strong>[^<]*적당량[^<]*<\/strong>/);
    // standalone, plain intraword, and bold+italic must NOT regress
    expect(renderMarkdownSafe("**'내용'**")).toMatch(/<strong>/);
    expect(renderMarkdownSafe('A**B**C')).toMatch(/A<strong>B<\/strong>C/);
    expect(renderMarkdownSafe('***굵은기울임***')).toMatch(/<em><strong>굵은기울임<\/strong><\/em>/);
  });

  it('does NOT corrupt digits or touch ** inside code spans', () => {
    // plain digits must survive verbatim (regression guard for the mask token)
    expect(renderMarkdownSafe('숫자 1234567890 입니다')).toContain('1234567890');
    // ** inside inline code stays literal (e.g. Python kwargs)
    const out = renderMarkdownSafe('`f(** a **)` 호출');
    expect(out).toContain('f(** a **)');
    expect(out).not.toMatch(/<strong>/);
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
