// Tracked wrapper around gemini.generateContent.
//
// Records the most-recent LLM query outcome into geminiStatusStore so the header
// badge can reflect live Gemini connectivity. gemini.ts stays key-blind and
// store-free (L1); this app-layer seam is the single chokepoint that every
// answer / summary / retry flow funnels through, so wrapping it here covers all
// call sites without each one repeating the bookkeeping.
//
// L1: apiKey is still a call-time arg, never stored/logged here.

import {
  countTokens,
  generateContent as baseGenerateContent,
  GeminiError,
  type GenerateContentArgs,
} from '../api/gemini';
import { useGeminiStatusStore } from '../stores/geminiStatusStore';

export async function generateContent(
  args: GenerateContentArgs,
): Promise<string> {
  try {
    const text = await baseGenerateContent(args);
    useGeminiStatusStore.getState().markSuccess();
    return text;
  } catch (err) {
    useGeminiStatusStore
      .getState()
      .markFailure(err instanceof GeminiError ? err.kind : 'unknown');
    throw err;
  }
}

/**
 * One-shot connectivity probe — run once per key (on login / key change) so the
 * header badge reflects real reachability immediately, instead of waiting for
 * the first @AI call. Uses countTokens: it validates the key + network with NO
 * generation cost (the cheapest authenticated Gemini round-trip). Never throws —
 * it only records the outcome into geminiStatusStore.
 *
 * Note: passive tracking (the generateContent wrapper above) intentionally
 * ignores countTokens, but this EXPLICIT probe is exactly a connectivity test,
 * so a countTokens success/failure here is a valid connected/disconnected signal.
 */
export async function pingGemini(apiKey: string): Promise<void> {
  try {
    await countTokens({
      apiKey,
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    });
    useGeminiStatusStore.getState().markSuccess();
  } catch (err) {
    useGeminiStatusStore
      .getState()
      .markFailure(err instanceof GeminiError ? err.kind : 'unknown');
  }
}
