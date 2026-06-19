// ============================================================================
// FE-12 retry — re-run a FAILED AI bubble without changing the engine's public
// API. This rebuilds the SAME assembly chokepoint (buildGeminiRequest) used by
// the primary/@AI flows and re-resolves an EXISTING AI_REPLY bubble in place:
// it PATCHes the same comment id (authorized by its clientId, BE-8) back to
// PENDING -> COMPLETE/FAILED. It never creates a new bubble and never mutates
// the human/original (NFR-5).
//
// L1 (key-blind): apiKey is a call-time arg only; handed straight to
// gemini.generateContent (browser->Gemini). Never stored/logged/sent to Aidit.
// ============================================================================

import { GeminiError, type GenerationConfig } from '../api/gemini';
// status-tracked wrapper (records connectivity for the header badge).
import { generateContent } from './geminiStatus';
import { getContext, patchComment } from '../api/rest';
import { buildGeminiRequest, type ReplyResult } from './contextEngine';

export interface RetryAiBubbleArgs {
  postId: string;
  /** id of the EXISTING (FAILED) AI_REPLY bubble to re-resolve. */
  aiCommentId: string;
  /** the bubble's clientId — required to authorize the null-author PATCH (BE-8). */
  clientId: string;
  communityPersonaPrompt: string;
  /** the retrying user's Gemini key (call-time only; never stored/logged). */
  apiKey: string;
  generationConfig?: GenerationConfig;
}

/**
 * Re-run generateContent for an already-posted AI bubble and PATCH it back to
 * COMPLETE (with the answer) or FAILED (with the UI message). Mirrors the
 * engine's resolveAiBubble, but targets an existing id instead of posting a new
 * placeholder. Best-effort: a failed FAILED-PATCH still surfaces the original
 * error to the caller.
 */
export async function retryAiBubble(
  args: RetryAiBubbleArgs,
): Promise<ReplyResult> {
  const {
    postId,
    aiCommentId,
    clientId,
    communityPersonaPrompt,
    apiKey,
    generationConfig,
  } = args;

  // Flip the bubble back to PENDING so the UI shows the typing state again.
  // Best-effort — if this fails we still attempt the generation.
  try {
    await patchComment(aiCommentId, { status: 'PENDING', clientId });
  } catch {
    // ignore; the generation result PATCH below is what matters.
  }

  let request;
  try {
    const context = await getContext(postId);
    request = buildGeminiRequest({
      personaPrompt: communityPersonaPrompt,
      context,
      ...(generationConfig ? { generationConfig } : {}),
    });
  } catch (err) {
    const msg = 'AI 응답 실패 — 컨텍스트를 불러오지 못했습니다';
    try {
      await patchComment(aiCommentId, {
        status: 'FAILED',
        body: msg,
        clientId,
      });
    } catch {
      // best-effort
    }
    return {
      ok: false,
      aiCommentId,
      errorMessage: msg,
      errorKind: 'unknown',
    };
  }

  try {
    const answer = await generateContent({
      apiKey,
      systemInstruction: request.systemInstruction,
      contents: request.contents,
      generationConfig: request.generationConfig,
    });
    await patchComment(aiCommentId, {
      status: 'COMPLETE',
      body: answer,
      clientId,
    });
    return { ok: true, aiCommentId, answer };
  } catch (err) {
    const ge =
      err instanceof GeminiError
        ? err
        : new GeminiError('unknown', 'AI 응답 실패 — 잠시 후 재시도', {
            cause: err,
          });
    try {
      await patchComment(aiCommentId, {
        status: 'FAILED',
        body: ge.userMessage,
        clientId,
      });
    } catch {
      // best-effort
    }
    return {
      ok: false,
      aiCommentId,
      errorMessage: ge.userMessage,
      errorKind: ge.kind,
    };
  }
}
