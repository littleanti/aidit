// AI-3: estimateTokens contract. Calibrated against the provider's countTokens
// (TRD §6.4): dense scripts ~1 token/char, everything else ~4 chars/token.
// i18n: USER_MESSAGES is now lang-aware — userMessage/userMessages follow the
// active UI language (useLangStore). These tests set a known lang and assert via
// the lang-aware accessor (the raw map is module-private).
import { describe, it, expect, beforeEach } from 'vitest';
import { estimateTokens, userMessage, userMessages } from './llm';
import { useLangStore } from '../stores/langStore';
import { ai as aiDict } from '../i18n/dicts/ai';

describe('estimateTokens — calibrated estimate (AI-3, TRD §6.4)', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('ceils Latin text at ~4.5 chars/token', () => {
    expect(estimateTokens('a')).toBe(1); // ceil(1/4.5) = 1
    expect(estimateTokens('abcd')).toBe(1); // ceil(4/4.5) = 1
    expect(estimateTokens('abcde')).toBe(2); // ceil(5/4.5) = 2
    expect(estimateTokens('a'.repeat(40))).toBe(9); // ceil(40/4.5) = 9
  });
  it('counts Hangul ~3.5x denser than Latin (the calibration fix)', () => {
    // Measured: Korean runs ~1.7-1.9 chars/token; the dense-script divisor is 1.3.
    // chars/4 under-counted Korean by up to 58%.
    expect(estimateTokens('가나다라')).toBe(4); // ceil(4/1.3) = 4
    expect(estimateTokens('가나다라마바사아자차')).toBe(8); // ceil(10/1.3) = 8
    // Mixed: ceil(4/1.3 + 8/4.5) = 5
    expect(estimateTokens('가나다라abcdefgh')).toBe(5);
  });

  it('stays in sync with the backend estimator (TRD §6.4 constants)', () => {
    // Same formula lives in backend/src/domain/tokenEstimate.ts; if these two
    // drift, the server's tokenSum stops matching what the client posted.
    const dense = (t: string) => (t.match(/[가-힣ᄀ-ᇿ㄰-㆏぀-ヿ一-鿿]/g) ?? []).length;
    const reference = (t: string) =>
      t.length === 0 ? 0 : Math.ceil(dense(t) / 1.3 + (t.length - dense(t)) / 4.5);
    for (const t of ['', 'abcd', '가나다', '「아라」: 계획을 먼저 세우게 합니다.', 'a'.repeat(37)]) {
      expect(estimateTokens(t)).toBe(reference(t));
    }
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
