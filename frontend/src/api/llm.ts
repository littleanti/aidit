// ============================================================================
// AI-1 + AI-3: BYOK LLM client.
//
// L1 (key-blind): EVERY call here is a fetch() FROM THE BROWSER, DIRECTLY to
// LLM_BASE, with the user's own key as the ?key=<USER_KEY> query param.
// The key is ALWAYS passed in at call time (function arg). It is NEVER stored
// in module scope, NEVER logged, and NEVER placed in an error message.
//
// Provider is abstracted via config (LLM_MODEL / LLM_BASE); the default
// provider is Google Gemini and the wire shapes below follow its REST API.
// ============================================================================

import { LLM_BASE, GENERATION_CONFIG, LLM_MODEL } from '../config/model';
import { useLangStore } from '../stores/langStore';
import { ai as aiDict } from '../i18n/dicts/ai';

// ---- Wire types (subset of the LLM provider's REST shapes we use) ----

/** A single content part: either text OR inline image bytes (base64, no
 *  data: prefix). The inlineData variant rides ONLY on a fresh-upload @AI turn. */
export type LlmPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** A single turn of conversation content. */
export interface LlmContent {
  role: 'user' | 'model';
  parts: LlmPart[];
}

/** systemInstruction is a single content block (no role). */
export interface LlmSystemInstruction {
  parts: Array<{ text: string }>;
}

export interface GenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

// ---- Error model (AI-1) ----

export type LlmErrorKind = 'invalid_key' | 'quota' | 'network' | 'unknown';

/**
 * Typed error for all LLM failures. `userMessage` is safe to surface in the
 * UI (Korean). The raw key is NEVER referenced here.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly userMessage: string;
  readonly status?: number;
  constructor(
    kind: LlmErrorKind,
    userMessage: string,
    opts?: { status?: number; cause?: unknown },
  ) {
    super(userMessage);
    this.name = 'LlmError';
    this.kind = kind;
    this.userMessage = userMessage;
    this.status = opts?.status;
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

// AI error messages are lang-aware: the UI-safe userMessage follows the active
// UI language (i18n). Sourced from the 'ai' i18n dict so the strings live in one
// place. The raw key is NEVER referenced in any of these (L1).
const USER_MESSAGES: Record<'ko' | 'en', Record<LlmErrorKind, string>> = {
  ko: {
    invalid_key: aiDict.ko.err_invalid_key,
    quota: aiDict.ko.err_quota,
    network: aiDict.ko.err_network,
    unknown: aiDict.ko.err_unknown,
  },
  en: {
    invalid_key: aiDict.en.err_invalid_key,
    quota: aiDict.en.err_quota,
    network: aiDict.en.err_network,
    unknown: aiDict.en.err_unknown,
  },
};

/** Current-language LLM error message map (snapshot of langStore). Non-React:
 *  reads useLangStore.getState() so callers in this module need no hook. */
export function userMessages(): Record<LlmErrorKind, string> {
  return USER_MESSAGES[useLangStore.getState().lang];
}

/** Convenience: the current-language message for a single error kind. */
export function userMessage(kind: LlmErrorKind): string {
  return userMessages()[kind];
}

/** Map an HTTP status to a typed LlmError. Never includes the key. */
function errorFromStatus(status: number): LlmError {
  let kind: LlmErrorKind;
  if (status === 401 || status === 403) kind = 'invalid_key';
  else if (status === 429) kind = 'quota';
  else kind = 'unknown';
  return new LlmError(kind, userMessage(kind), { status });
}

/**
 * POST to an LLM model endpoint with the key as a query param.
 * Wraps transport/HTTP failures into a typed LlmError. The key never
 * appears in any thrown message or log.
 */
async function postModel<T>(
  method: string,
  apiKey: string,
  body: unknown,
): Promise<T> {
  const url = `${LLM_BASE}/models/${LLM_MODEL}:${method}?key=${encodeURIComponent(
    apiKey,
  )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    // fetch rejects only on network-level failures (offline, DNS, CORS).
    throw new LlmError('network', userMessage('network'), { cause });
  }

  if (!res.ok) {
    // Drain the body so the connection is freed, but DO NOT surface it
    // (could echo back request fields); map purely on status.
    await res.text().catch(() => undefined);
    throw errorFromStatus(res.status);
  }

  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new LlmError('unknown', userMessage('unknown'), {
      status: res.status,
      cause,
    });
  }
}

// ---- generateContent ----

export interface GenerateContentArgs {
  /** User's own LLM key. Call-time only. NEVER stored/logged. */
  apiKey: string;
  /** Persona / system prompt (L6: persona lives ONLY here). */
  systemInstruction?: string;
  contents: LlmContent[];
  generationConfig?: GenerationConfig;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/**
 * Call models/{LLM_MODEL}:generateContent and return the first candidate's text.
 * L6: the persona prompt is passed as systemInstruction, never as a content turn.
 */
export async function generateContent(
  args: GenerateContentArgs,
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: args.contents,
    generationConfig: { ...GENERATION_CONFIG, ...args.generationConfig },
  };
  if (args.systemInstruction !== undefined) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }

  const data = await postModel<GenerateContentResponse>(
    'generateContent',
    args.apiKey,
    body,
  );

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('');

  if (!text) {
    throw new LlmError('unknown', userMessage('unknown'));
  }
  return text;
}

// ---- Token counting (AI-3) ----

export interface CountTokensArgs {
  apiKey: string;
  contents: LlmContent[];
  systemInstruction?: string;
}

interface CountTokensResponse {
  totalTokens?: number;
}

// Token estimation for the 128K segment budget. TRD §6.4 is the SoT for these
// constants; they were calibrated OFFLINE against the provider's countTokens on
// 2026-07-28. On its cost, precisely: Vertex AI / Firebase AI Logic documents "no
// charge for calling countTokens" (3000 RPM quota), while the Gemini Developer API
// docs — what this file calls — say nothing about countTokens billing. Free of
// charge still burns RPM quota shared with generateContent.
//
// So we deliberately do NOT call countTokens per message; the only runtime call is
// pingLlm()'s connectivity probe, once per key (FR-8). That means the local
// estimate has to be good enough — and the
// previous `chars/4` was not. chars/4 is a Latin rule of thumb; measured against
// gemini-3.1-flash-lite, Korean runs ~1.7-1.9 chars/token while English runs
// ~4.5-5.2. It under-counted app content by 39.4% in aggregate (worst single
// sample -58%), pushing the 128K trigger far past the policy point and effectively
// disabling FR-7 on Korean threads.
//
// The constants are fitted on APP-SHAPED samples (comments, AI replies, condensed
// documents) — NOT on this repo's documentation, which tokenizes ~1.5x denser and
// produced a coefficient that over-counted real content by ~34% in a first pass.
//
// KEEP IN SYNC with backend/src/domain/tokenEstimate.ts — the server sums its own
// estimate into ContextSegment.tokenSum, which is what GET /context compares
// against the threshold. Divergence makes the two disagree about when to summarize.

/** Chars per token for dense scripts (Hangul, CJK ideographs, kana). */
const DENSE_CHARS_PER_TOKEN = 1.3;
/** Chars per token for everything else (Latin, digits, punctuation, markdown). */
const REST_CHARS_PER_TOKEN = 4.5;

/** Hangul syllables + jamo, CJK ideographs, kana. The coefficient was calibrated
 *  on Hangul (the app ships ko/en); CJK/kana are grouped with it as a similar-
 *  density approximation rather than a measured result. */
const DENSE_SCRIPT = /[가-힣ᄀ-ᇿ㄰-㆏぀-ヿ一-鿿]/g;

/**
 * Estimate the token count of `text` (TRD §6.4).
 *
 * Measured accuracy over 10 app-shaped samples: +7.9% in aggregate (deliberately
 * conservative), -3%..+22% per message, mean absolute error 9%. Under-counting is
 * the unsafe direction, so the residual bias is kept positive.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const dense = (text.match(DENSE_SCRIPT) ?? []).length;
  const rest = text.length - dense;
  return Math.ceil(dense / DENSE_CHARS_PER_TOKEN + rest / REST_CHARS_PER_TOKEN);
}

/** Sum the estimated tokens across all content parts. */
function estimateContentsTokens(
  contents: LlmContent[],
  systemInstruction?: string,
): number {
  let total = systemInstruction ? estimateTokens(systemInstruction) : 0;
  for (const c of contents) {
    for (const p of c.parts) total += estimateTokens('text' in p ? p.text : '');
  }
  return total;
}

/**
 * Call models/{LLM_MODEL}:countTokens and return totalTokens.
 * Throws a typed LlmError on failure (use countTokensWithFallback to be safe).
 */
export async function countTokens(args: CountTokensArgs): Promise<number> {
  const body: Record<string, unknown> = { contents: args.contents };
  if (args.systemInstruction !== undefined) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }

  const data = await postModel<CountTokensResponse>(
    'countTokens',
    args.apiKey,
    body,
  );
  if (typeof data.totalTokens !== 'number') {
    throw new LlmError('unknown', userMessage('unknown'));
  }
  return data.totalTokens;
}

/**
 * Try the countTokens API; on ANY failure fall back to the local estimate.
 * Never throws — token counting is best-effort for the 128K threshold check.
 */
export async function countTokensWithFallback(
  args: CountTokensArgs,
): Promise<number> {
  try {
    return await countTokens(args);
  } catch {
    return estimateContentsTokens(args.contents, args.systemInstruction);
  }
}
