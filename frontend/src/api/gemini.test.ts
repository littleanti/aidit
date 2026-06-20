// AI-3: estimateTokens heuristic contract (~chars/4, ceil).
// i18n: USER_MESSAGES is now lang-aware — userMessage/userMessages follow the
// active UI language (useLangStore). These tests set a known lang and assert via
// the lang-aware accessor (the raw map is module-private).
import { describe, it, expect, beforeEach } from 'vitest';
import { estimateTokens, userMessage, userMessages } from './gemini';
import { useLangStore } from '../stores/langStore';
import { ai as aiDict } from '../i18n/dicts/ai';

describe('estimateTokens — chars/4 heuristic (AI-3)', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('ceils chars/4', () => {
    expect(estimateTokens('a')).toBe(1); // ceil(1/4) = 1
    expect(estimateTokens('abcd')).toBe(1); // 4/4 = 1
    expect(estimateTokens('abcde')).toBe(2); // ceil(5/4) = 2
    expect(estimateTokens('a'.repeat(40))).toBe(10); // 40/4 = 10
  });
});

describe('USER_MESSAGES — lang-aware error strings (i18n)', () => {
  beforeEach(() => {
    // Reset to a known language before each assertion.
    useLangStore.setState({ lang: 'ko' });
  });

  it('returns Korean messages when lang=ko', () => {
    useLangStore.setState({ lang: 'ko' });
    expect(userMessage('invalid_key')).toBe(aiDict.ko.err_invalid_key);
    expect(userMessage('quota')).toBe(aiDict.ko.err_quota);
    expect(userMessage('network')).toBe(aiDict.ko.err_network);
    expect(userMessage('unknown')).toBe(aiDict.ko.err_unknown);
  });

  it('returns English messages when lang=en', () => {
    useLangStore.setState({ lang: 'en' });
    expect(userMessage('invalid_key')).toBe(aiDict.en.err_invalid_key);
    expect(userMessage('quota')).toBe(aiDict.en.err_quota);
    expect(userMessage('network')).toBe(aiDict.en.err_network);
    expect(userMessage('unknown')).toBe(aiDict.en.err_unknown);
  });

  it('userMessages() returns the full map for the active lang', () => {
    useLangStore.setState({ lang: 'en' });
    expect(userMessages()).toEqual({
      invalid_key: aiDict.en.err_invalid_key,
      quota: aiDict.en.err_quota,
      network: aiDict.en.err_network,
      unknown: aiDict.en.err_unknown,
    });
  });
});
