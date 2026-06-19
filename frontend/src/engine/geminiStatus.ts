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
