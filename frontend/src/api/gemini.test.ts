// AI-3: estimateTokens heuristic contract (~chars/4, ceil).
import { describe, it, expect } from 'vitest';
import { estimateTokens } from './gemini';

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
