// Tracked wrapper around llm.generateContent.
//
// Records the most-recent LLM query outcome into llmStatusStore so the header
// badge can reflect live LLM connectivity. llm.ts stays key-blind and
// store-free (L1); this app-layer seam is the single chokepoint that every
// answer / summary / retry flow funnels through, so wrapping it here covers all
// call sites without each one repeating the bookkeeping.
//
// L1: apiKey is still a call-time arg, never stored/logged here.

import {
  countTokens,
  generateContent as baseGenerateContent,
  LlmError,
  type GenerateContentArgs,
} from '../api/llm';
import { useLlmStatusStore } from '../stores/llmStatusStore';

export async function generateContent(
  args: GenerateContentArgs,
): Promise<string> {
  try {
    const text = await baseGenerateContent(args);
    useLlmStatusStore.getState().markSuccess();
    return text;
  } catch (err) {
    useLlmStatusStore
      .getState()
      .markFailure(err instanceof LlmError ? err.kind : 'unknown');
    throw err;
  }
}

/**
 * One-shot connectivity probe — run once per key (on login / key change) so the
 * header badge reflects real reachability immediately, instead of waiting for
 * the first @AI call. Uses countTokens: it validates the key + network with NO
 * generation cost (the cheapest authenticated LLM provider round-trip). Never
 * throws — it only records the outcome into llmStatusStore.
 *
 * Note: passive tracking (the generateContent wrapper above) intentionally
 * ignores countTokens, but this EXPLICIT probe is exactly a connectivity test,
 * so a countTokens success/failure here is a valid connected/disconnected signal.
 */
export async function pingLlm(apiKey: string): Promise<void> {
  try {
    await countTokens({
      apiKey,
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    });
    useLlmStatusStore.getState().markSuccess();
  } catch (err) {
    useLlmStatusStore
      .getState()
      .markFailure(err instanceof LlmError ? err.kind : 'unknown');
  }
}
