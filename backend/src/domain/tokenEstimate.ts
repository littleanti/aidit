// Token estimation for the 128K segment budget (TRD §6.4 is the SoT).
//
// The server sums this per bubble into ContextSegment.tokenSum, and GET /context
// compares that sum against the 128K product threshold. So this function decides
// WHEN a thread gets summarized.
//
// We deliberately do NOT call the provider's countTokens at runtime: it is exact
// but adds a network round trip per message, needs a credential (the server is
// key-blind), and introduces another failure path. Instead the coefficients below
// were calibrated OFFLINE against countTokens (which is free) on 2026-07-28.
// Re-run scripts/calibrate-token-estimate.mjs after any model change.
//
// WHY THE OLD `chars/4` WAS A BUG, NOT JUST IMPRECISION
// chars/4 is a Latin-text rule of thumb. Measured against gemini-3.1-flash-lite,
// Korean runs ~1.7-1.9 chars per token while English runs ~4.5-5.2. The old
// estimate therefore UNDER-counted app content by 39.4% in aggregate (worst
// single sample: -58%), which pushed the 128K trigger far past the policy point
// and effectively disabled FR-7 for Korean threads.
//
// WHAT "CALIBRATION SET" MEANS HERE (a mistake worth not repeating)
// The first fit used this repo's DOCUMENTATION as the corpus and produced a much
// denser coefficient. That was wrong: the estimator never sees PRD/TRD prose — it
// sees comments, AI replies, and condensed documents. Technical Korean with heavy
// markup tokenizes ~1.5x denser than conversational Korean, so the doc-derived
// constant over-counted real app content by ~34%. The constants below are fitted
// on APP-SHAPED samples only.
//
// KEEP IN SYNC with frontend/src/api/llm.ts → estimateTokens(). Both implement
// TRD §6.4; changing one alone makes the server's tokenSum disagree with what the
// client believes it posted.

/** Chars per token for dense scripts (Hangul, CJK ideographs, kana). */
const DENSE_CHARS_PER_TOKEN = 1.3;
/** Chars per token for everything else (Latin, digits, punctuation, markdown). */
const REST_CHARS_PER_TOKEN = 4.5;

/**
 * Dense-script characters: Hangul syllables + jamo, CJK ideographs, kana.
 *
 * The coefficient was calibrated on Hangul (the app ships ko/en); CJK and kana
 * are grouped with it because they tokenize at a similar density, but that part is
 * an approximation rather than a measured result.
 */
const DENSE_SCRIPT =
  /[가-힣ᄀ-ᇿ㄰-㆏぀-ヿ一-鿿]/g;

/**
 * Estimate the token count of `text` (TRD §6.4).
 *
 * Measured accuracy over 10 app-shaped samples: +7.9% in aggregate (deliberately
 * on the conservative side), -3%..+22% per individual message, mean absolute
 * error 9%. Under-counting is the unsafe direction — it lets a thread sail past
 * the 128K policy — so the residual bias is kept positive. The aggregate is what
 * the 128K budget depends on, since tokenSum is a running total.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const dense = (text.match(DENSE_SCRIPT) ?? []).length;
  const rest = text.length - dense;
  return Math.ceil(dense / DENSE_CHARS_PER_TOKEN + rest / REST_CHARS_PER_TOKEN);
}
