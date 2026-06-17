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
import { getContext, postComment, patchComment } from '../api/rest';
import { useAuthStore } from '../stores/authStore';

// ---------------------------------------------------------------------------
// AI-4 + XC-4: buildGeminiRequest — the assembly chokepoint.
// ---------------------------------------------------------------------------

/** An optional new user turn to append to the context (e.g. an @AI comment
 *  that may not yet be reflected in the fetched context snapshot). It is ALWAYS
 *  mapped to role:'user' with the speaker prefix — it can never become system. */
export interface AppendedTurn {
  username: string;
  body: string;
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
  if (appended) {
    contents.push({
      role: 'user',
      parts: [{ text: speakerPrefix(appended.username, appended.body) }],
    });
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

  // ===================== M4 SEAM (summarization) =====================
  // When the active segment exceeds the 128K product threshold, a summary
  // AI_SUMMARY turn must be generated and a new segment opened BEFORE we build
  // the reply request, so the new segment's context (opening summary + recent
  // bubbles) is what we send. In M3 we deliberately do NOT summarize — we just
  // proceed with the current (full) context.
  if (context.summaryNeeded) {
    // TODO(M4): await ensureSummary({ postId, context, apiKey: callerApiKey });
    //           then re-fetch context = await getContext(postId);
    // M3: proceed without summarizing.
  }
  // ===================================================================

  // The @AI human turn should already be inside context.contents because we
  // fetched AFTER it was committed. We only append defensively if the caller
  // tells us the snapshot predates it (rare race) AND we were given the body.
  const lastTurn = context.contents[context.contents.length - 1];
  const alreadyPresent =
    !!lastTurn &&
    lastTurn.role === 'user' &&
    typeof humanCommentBody === 'string' &&
    lastTurn.text.includes(humanCommentBody);

  const appended =
    !alreadyPresent && typeof humanCommentBody === 'string'
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
