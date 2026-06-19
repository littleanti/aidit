// ============================================================================
// THE HEART — frontend/src/engine/contextEngine.ts
//
// WP AI-4 (buildContents — the assembly chokepoint) + XC-4 (prompt-injection
// guard) + AI-5 (primary reply flow) + AI-7 (@AI reply flow).
//
// This is the single orchestration chokepoint that turns a community persona +
// an assembled ContextResponse into a Gemini request, and drives the two reply
// flows (post-creation primary reply, and @AI reply). ALL LLM calls are BYOK:
// the browser calls the caller's own key via gemini.generateContent — the Aidit
// server is key-blind and never sees a key here.
//
// ---------------------------------------------------------------------------
// XC-4 GUARD (CRITICAL, TRD §8 — prompt injection):
//   * The community personaPrompt is the ONLY thing that goes into
//     systemInstruction.
//   * EVERY piece of user/comment content stays as role:'user' DATA turns and
//     is NEVER concatenated into systemInstruction.
//   * buildGeminiRequest is the SINGLE place this persona->system /
//     content->user mapping happens, so no user-supplied text can promote
//     itself to a system role. An appended turn is ALWAYS forced to role:'user'.
//
// ---------------------------------------------------------------------------
// M4 SEAM (summarization): runAtAiReply checks context.summaryNeeded
// (tokenSum > 128_000). The branch that would call ensureSummary() is clearly
// marked below. In M3 we proceed without summarizing.
// ============================================================================

import type { ContextResponse } from '../api/types';
import {
  generateContent,
  estimateTokens,
  type GeminiContent,
  type GenerationConfig,
  GeminiError,
} from '../api/gemini';
import { getContext, postComment, patchComment, ApiError } from '../api/rest';
import { useAuthStore } from '../stores/authStore';
import { track } from '../lib/metrics';

/** Product threshold (A-2 / FR-7): active-segment token budget. Above this the
 *  next @AI caller must summarize first. Kept here so the engine's lazy-summary
 *  branch has a named constant; the server's GET /context computes summaryNeeded
 *  (tokenSum > THIS) authoritatively — we branch on that flag, not this value. */
export const SUMMARY_TOKEN_THRESHOLD = 128_000;

/** Summary directive appended to the persona for the summarization call (AI-6).
 *  Faithfully preserves facts/decisions/open questions for use as the opening
 *  context turn of the next segment. */
export const SUMMARY_DIRECTIVE =
  '이 토론의 사실/결정/미해결 질문을 충실히 보존해 요약하라. 새 질문에 답하기 위한 컨텍스트로 쓰일 것.';

// ---------------------------------------------------------------------------
// AI-4 + XC-4: buildGeminiRequest — the assembly chokepoint.
// ---------------------------------------------------------------------------

/** An optional new user turn to append to the context (e.g. an @AI comment
 *  that may not yet be reflected in the fetched context snapshot). It is ALWAYS
 *  mapped to role:'user' with the speaker prefix — it can never become system. */
export interface AppendedTurn {
  username: string;
  body: string;
  /** Optional inline image bytes (base64, no data: prefix) attached to this
   *  fresh-upload turn ONLY. Pushed as a second user-role inlineData part. */
  image?: { mimeType: string; data: string };
}

export interface BuildGeminiRequestArgs {
  /** Community persona prompt. L6/XC-4: goes ONLY into systemInstruction. */
  personaPrompt: string;
  /** Assembled context from GET /posts/:id/context (active segment). */
  context: ContextResponse;
  /** Optional extra user turn to append after the context turns. */
  appended?: AppendedTurn;
  /** Optional generation overrides (merged over defaults by gemini client). */
  generationConfig?: GenerationConfig;
}

export interface GeminiRequest {
  /** Persona only — never any user/comment text (XC-4). undefined if blank. */
  systemInstruction?: string;
  contents: GeminiContent[];
  generationConfig?: GenerationConfig;
}

/** Speaker prefix applied to HUMAN user turns (CONTEXT MAPPING). */
function speakerPrefix(username: string, body: string): string {
  return `「${username}」: ${body}`;
}

/**
 * Map a ContextResponse (+ optional appended user turn) into a Gemini request.
 *
 * XC-4: personaPrompt -> systemInstruction ONLY. Every context turn keeps the
 * role the assembler already assigned ('user' for HUMAN/AI_SUMMARY data turns,
 * 'model' for AI_REPLY). The appended turn is FORCED to role:'user' so no
 * caller-supplied content can promote itself to model/system.
 */
export function buildGeminiRequest(
  args: BuildGeminiRequestArgs,
): GeminiRequest {
  const { personaPrompt, context, appended, generationConfig } = args;

  // Copy context turns verbatim into wire shape. The server-side assembler is
  // the source of truth for role mapping; we do NOT re-derive roles here, only
  // wrap text into { parts: [{ text }] }. This keeps roles immutable.
  const contents: GeminiContent[] = context.contents.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }));

  // XC-4: an appended turn is ALWAYS a user data turn with the speaker prefix.
  // On a fresh-upload turn it additionally carries the local image bytes as a
  // second inlineData part (still role:'user' — never system).
  if (appended) {
    const parts: GeminiContent['parts'] = [
      { text: speakerPrefix(appended.username, appended.body) },
    ];
    if (appended.image) {
      parts.push({
        inlineData: {
          mimeType: appended.image.mimeType,
          data: appended.image.data,
        },
      });
    }
    contents.push({ role: 'user', parts });
  }

  const systemInstruction = personaPrompt.trim()
    ? personaPrompt
    : undefined;

  return {
    systemInstruction,
    contents,
    ...(generationConfig ? { generationConfig } : {}),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Generate an idempotency clientId (L12). Used to author + later authorize the
 *  AI bubble's PATCH (BE-8: AI-bubble PATCH is authorized by matching clientId). */
function makeClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Outcome of a reply flow. `aiCommentId` is the id of the PENDING AI bubble
 *  that was posted (present even on failure, since it gets PATCHed to FAILED). */
export interface ReplyResult {
  ok: boolean;
  /** id of the AI_REPLY comment (PENDING -> COMPLETE/FAILED). */
  aiCommentId: string | null;
  /** the generated answer text on success. */
  answer?: string;
  /** UI-safe Korean message on failure (from GeminiError.userMessage). */
  errorMessage?: string;
  /** error kind when ok === false and the failure was a GeminiError. */
  errorKind?: GeminiError['kind'];
}

/**
 * Resolve the model answer for a freshly-posted PENDING AI bubble, then PATCH it
 * to COMPLETE (with body) on success or FAILED (with the UI message) on a
 * GeminiError. The clientId authorizes the AI-bubble PATCH (BE-8). The human /
 * original is never mutated here (NFR-5).
 */
async function resolveAiBubble(args: {
  aiCommentId: string;
  clientId: string;
  apiKey: string;
  request: GeminiRequest;
}): Promise<ReplyResult> {
  const { aiCommentId, clientId, apiKey, request } = args;
  // XC-10: an @AI / primary reply Gemini call is being invoked (KPI: avg @AI per
  // post). Non-blocking, no key in props.
  track('ai_reply_invoked');
  try {
    const answer = await generateContent({
      apiKey,
      systemInstruction: request.systemInstruction,
      contents: request.contents,
      generationConfig: request.generationConfig,
    });

    // XC-10: Gemini call succeeded (KPI: Gemini success rate, target >= 0.97).
    track('gemini_success');

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

    // XC-10: Gemini call failed (KPI: Gemini success rate). `kind` is the typed
    // GeminiError category only — NEVER any key or raw error text.
    track('gemini_failure', { kind: ge.kind });

    // Mark the bubble FAILED with the UI-safe message; clientId authorizes it.
    // If even this PATCH fails we still surface the original failure.
    try {
      await patchComment(aiCommentId, {
        status: 'FAILED',
        body: ge.userMessage,
        clientId,
      });
    } catch {
      // best-effort; the SSE/poll path will reconcile eventually.
    }

    return {
      ok: false,
      aiCommentId,
      errorMessage: ge.userMessage,
      errorKind: ge.kind,
    };
  }
}

// ---------------------------------------------------------------------------
// AI-5: primary reply flow (FR-4.3) — runs right after a post is created,
// using the AUTHOR'S key.
// ---------------------------------------------------------------------------

export interface RunPrimaryReplyArgs {
  postId: string;
  /** persona of the post's community. */
  communityPersonaPrompt: string;
  /** the post AUTHOR'S Gemini key (call-time only; never stored/logged). */
  apiKey: string;
}

/**
 * AI-5: after a post is created, fetch segment-0 context (original post + all
 * seg-0 bubbles are already inside it), build the persona request (NO appended
 * turn — the post itself is already a turn in contents), post a PENDING
 * AI_REPLY bubble (visible to everyone via SSE as loading), then resolve it
 * with the author's key and PATCH COMPLETE/FAILED.
 */
export async function runPrimaryReply(
  args: RunPrimaryReplyArgs,
): Promise<ReplyResult> {
  const { postId, communityPersonaPrompt, apiKey } = args;

  let context: ContextResponse;
  try {
    context = await getContext(postId);
  } catch (err) {
    return {
      ok: false,
      aiCommentId: null,
      errorMessage: 'AI 응답 실패 — 컨텍스트를 불러오지 못했습니다',
      errorKind: 'unknown',
    };
  }

  const request = buildGeminiRequest({
    personaPrompt: communityPersonaPrompt,
    context,
    // NO appended turn: the post is already segment-0 turn 0.
  });

  const clientId = makeClientId();

  // Post the PENDING placeholder. The author's x-user-id is taken from the
  // store; the AI bubble has authorId === null server-side, and the clientId
  // we send here is what later authorizes its PATCH (BE-8).
  const userId = useAuthStore.getState().userId ?? undefined;
  let aiCommentId: string;
  try {
    const pending = await postComment(
      postId,
      {
        type: 'AI_REPLY',
        body: '',
        status: 'PENDING',
        clientId,
        // token accounting: estimate from context so the segment tokenSum
        // stays roughly current (PoC-acceptable, patched post-hoc on COMPLETE).
      },
      userId ?? '',
    );
    aiCommentId = pending.id;
  } catch (err) {
    return {
      ok: false,
      aiCommentId: null,
      errorMessage: 'AI 응답 실패 — 잠시 후 재시도',
      errorKind: 'unknown',
    };
  }

  return resolveAiBubble({ aiCommentId, clientId, apiKey, request });
}

// ---------------------------------------------------------------------------
// AI-7: @AI reply flow (FR-6.1 / FR-6.2).
// Precondition: the human '@AI ...' comment was ALREADY posted COMPLETE by the
// Composer (human first, FR-6.2). We fetch context AFTER it is committed so it
// is already inside context.contents.
// ---------------------------------------------------------------------------

export interface RunAtAiReplyArgs {
  postId: string;
  /** id of the already-committed human '@AI ...' comment (replyTo target). */
  humanCommentId: string;
  communityPersonaPrompt: string;
  /** username of the caller (for an appended turn IF context predates it). */
  callerUsername: string;
  /** the CALLER'S Gemini key (call-time only; never stored/logged). */
  callerApiKey: string;
  /** optional: the @AI text, used only if we must append (context predates it). */
  humanCommentBody?: string;
  /** optional: inline image bytes (base64) freshly uploaded on THIS turn. When
   *  present, the appended user turn is FORCED so the image rides this call. */
  image?: { mimeType: string; data: string };
}

// ---------------------------------------------------------------------------
// AI-6 + AI-8 + AI-9: lazy 128K summarization (FR-7, L3).
//
// L3 (lazy): the server is KEY-BLIND, so the 128K summary is performed with the
// NEXT @AI caller's own key. When GET /context reports summaryNeeded, the caller
// (1) generates an AI_SUMMARY with its key (AI-6), (2) POSTs it with
// segmentExpected = current active index so the server's BE-7 guard opens EXACTLY
// one new segment (winner) or rejects with 409 (loser), then (3) re-fetches
// GET /context so the answer is built ONLY from (summary opening turn + bubbles
// after) of the now-active segment N+1 (AI-9 reassembly).
// ---------------------------------------------------------------------------

export interface EnsureSummaryArgs {
  postId: string;
  /** Community persona — combined with the summary directive for systemInstruction. */
  communityPersonaPrompt: string;
  /** Caller username (unused in the summary request itself, kept for symmetry/logging). */
  callerUsername: string;
  /** The CALLER'S Gemini key (lazy L3/FR-7.3): the summary runs on this key. */
  callerApiKey: string;
  /** The pre-summary ContextResponse (summaryNeeded === true) to summarize. */
  currentContext: ContextResponse;
}

export interface EnsureSummaryResult {
  /** The context to use for the actual @AI answer (the now-active segment). */
  context: ContextResponse;
  /** How the transition resolved (for tests / observability). */
  outcome: 'summarized' | 'concurrent_loser' | 'summary_failed_fallback';
}

/**
 * AI-6: ensure a 128K summary exists before answering, opening a new segment.
 *
 * Flow:
 *  1. Build a summary request: systemInstruction = persona + SUMMARY_DIRECTIVE
 *     (XC-4: persona/directive ONLY in systemInstruction; the discussion stays as
 *     role:'user'/'model' DATA turns). Call generateContent with the CALLER'S key.
 *  2. POST the AI_SUMMARY bubble with segmentExpected = currentContext.segmentIndex
 *     (BE-7 idempotency guard). authorId is null server-side (key-blind).
 *       - 201 winner: the server opened segment N+1 (published comment.created +
 *         segment.opened). Re-fetch GET /context -> reassembled context (AI-9).
 *       - 409 loser: a peer already summarized. Do NOT error — re-fetch
 *         GET /context (now scoped to the new active segment) and use it (AI-9).
 *  3. If the summary Gemini call FAILS (GeminiError): graceful fallback (TRD §11)
 *     — proceed to answer using the EXISTING pre-summary context. We do NOT lose
 *     the human comment and we never block the answer on a summarization failure.
 *     (Chosen over surfacing a hard error: the @AI answer is the user-visible goal;
 *     a failed summary just means we answer against the larger context this turn,
 *     and the next caller will retry the summary.)
 *
 * Returns the post-summary ContextResponse to use for the actual answer.
 */
export async function ensureSummary(
  args: EnsureSummaryArgs,
): Promise<EnsureSummaryResult> {
  const {
    postId,
    communityPersonaPrompt,
    callerApiKey,
    currentContext,
  } = args;

  // (1) Generate the summary on the CALLER'S key. XC-4: persona + directive go
  // ONLY into systemInstruction; the discussion contents stay as data turns.
  const systemInstruction = `${communityPersonaPrompt.trim()}\n\n${SUMMARY_DIRECTIVE}`.trim();
  const summaryContents: GeminiContent[] = currentContext.contents.map(
    (turn) => ({ role: turn.role, parts: [{ text: turn.text }] }),
  );

  let summaryText: string;
  try {
    summaryText = await generateContent({
      apiKey: callerApiKey,
      systemInstruction,
      contents: summaryContents,
    });
  } catch {
    // (3) Graceful fallback (TRD §11): the summary Gemini call failed (any
    // GeminiError/unknown). Do NOT block the answer or lose the human comment —
    // answer against the existing pre-summary context; the next caller retries.
    // XC-10: summary attempt failed at the Gemini call (KPI: summary success rate).
    track('summary_failure', { stage: 'generate' });
    return { context: currentContext, outcome: 'summary_failed_fallback' };
  }

  // (2) POST the AI_SUMMARY bubble with the BE-7 idempotency guard.
  const clientId = makeClientId();
  const userId = useAuthStore.getState().userId ?? undefined;
  try {
    await postComment(
      postId,
      {
        type: 'AI_SUMMARY',
        body: summaryText,
        status: 'COMPLETE',
        clientId,
        segmentExpected: currentContext.segmentIndex,
        tokenCount: estimateTokens(summaryText),
      },
      userId ?? '',
    );
    // 201 winner: server opened segment N+1. Re-fetch reassembled context (AI-9).
    // XC-10: a summary was successfully created and committed (KPI: summary success rate).
    track('summary_success', { outcome: 'summarized' });
    const reassembled = await getContext(postId);
    return { context: reassembled, outcome: 'summarized' };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // 409 loser (BE-7): a peer already summarized. Re-fetch the now-active
      // segment's context and answer against it (AI-9). NOT an error.
      // XC-10: a summary exists (peer won the race) — count as a success.
      track('summary_success', { outcome: 'concurrent_loser' });
      const reassembled = await getContext(postId);
      return { context: reassembled, outcome: 'concurrent_loser' };
    }
    // Any other POST/fetch failure: fall back to the pre-summary context so the
    // human comment is never lost and the @AI answer can still proceed.
    // XC-10: the summary could not be committed (KPI: summary success rate).
    track('summary_failure', { stage: 'commit' });
    return { context: currentContext, outcome: 'summary_failed_fallback' };
  }
}

/**
 * AI-7: generate an AI reply to an @AI mention.
 *
 * Steps: fetch context (the @AI human turn is already inside it). M4 SEAM: if
 * context.summaryNeeded, a summary must be generated FIRST — see below. Build
 * the persona request, post a PENDING AI_REPLY with replyToId = humanCommentId,
 * then resolve with the CALLER'S key and PATCH COMPLETE/FAILED. Order is
 * guaranteed: human (already) -> PENDING loading -> reply.
 */
export async function runAtAiReply(
  args: RunAtAiReplyArgs,
): Promise<ReplyResult> {
  const {
    postId,
    humanCommentId,
    communityPersonaPrompt,
    callerUsername,
    callerApiKey,
    humanCommentBody,
    image,
  } = args;

  let context: ContextResponse;
  try {
    context = await getContext(postId);
  } catch (err) {
    return {
      ok: false,
      aiCommentId: null,
      errorMessage: 'AI 응답 실패 — 컨텍스트를 불러오지 못했습니다',
      errorKind: 'unknown',
    };
  }

  // ===================== AI-8: lazy summarization (M4) =====================
  // When the active segment exceeds the 128K product threshold (summaryNeeded),
  // generate an AI_SUMMARY turn and open a new segment BEFORE building the reply
  // request (L3 lazy / FR-7: performed with THIS caller's key, server is
  // key-blind). ensureSummary returns the now-active segment's context — the
  // reassembled (summary opening turn + bubbles after) context (AI-9) on a
  // winner OR 409-loser, or the unchanged pre-summary context on a graceful
  // summary failure. We then build the reply request from that context.
  if (context.summaryNeeded) {
    const summaryRes = await ensureSummary({
      postId,
      communityPersonaPrompt,
      callerUsername,
      callerApiKey,
      currentContext: context,
    });
    context = summaryRes.context;
  }
  // =========================================================================

  // The @AI human turn should already be inside context.contents because we
  // fetched AFTER it was committed. We only append defensively if the caller
  // tells us the snapshot predates it (rare race) AND we were given the body.
  //
  // EXCEPTION (Step 7 / 7.1): when an image was freshly uploaded on THIS turn,
  // FORCE the appended turn even if the text already matches — the context
  // snapshot has the text but NEVER the image bytes, so the image must ride
  // along here. Image-only @AI (empty body + inlineData) is valid: an empty
  // body yields a valid user turn with the inlineData part, so we do NOT skip.
  const lastTurn = context.contents[context.contents.length - 1];
  const alreadyPresent =
    !!lastTurn &&
    lastTurn.role === 'user' &&
    typeof humanCommentBody === 'string' &&
    lastTurn.text.includes(humanCommentBody);

  const appended = image
    ? { username: callerUsername, body: humanCommentBody ?? '', image }
    : !alreadyPresent && typeof humanCommentBody === 'string'
      ? { username: callerUsername, body: humanCommentBody }
      : undefined;

  const request = buildGeminiRequest({
    personaPrompt: communityPersonaPrompt,
    context,
    appended,
  });

  const clientId = makeClientId();
  const userId = useAuthStore.getState().userId ?? undefined;

  let aiCommentId: string;
  try {
    const pending = await postComment(
      postId,
      {
        type: 'AI_REPLY',
        body: '',
        status: 'PENDING',
        replyToId: humanCommentId,
        clientId,
      },
      userId ?? '',
    );
    aiCommentId = pending.id;
  } catch (err) {
    return {
      ok: false,
      aiCommentId: null,
      errorMessage: 'AI 응답 실패 — 잠시 후 재시도',
      errorKind: 'unknown',
    };
  }

  return resolveAiBubble({
    aiCommentId,
    clientId,
    apiKey: callerApiKey,
    request,
  });
}

// ---------------------------------------------------------------------------
// Re-export the token estimator so callers (e.g. Composer) can pre-compute a
// tokenCount for the bubbles they post without importing gemini directly.
// ---------------------------------------------------------------------------
export { estimateTokens };
