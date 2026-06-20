// ============================================================================
// AI-1 + AI-3: BYOK Google Gemini client.
//
// L1 (key-blind): EVERY call here is a fetch() FROM THE BROWSER, DIRECTLY to
// GEMINI_BASE, with the user's own key as the ?key=<USER_KEY> query param.
// The key is ALWAYS passed in at call time (function arg). It is NEVER stored
// in module scope, NEVER logged, and NEVER placed in an error message.
// ============================================================================

import { GEMINI_BASE, GENERATION_CONFIG, MODEL } from '../config/model';
import { useLangStore } from '../stores/langStore';
import { ai as aiDict } from '../i18n/dicts/ai';

// ---- Wire types (subset of the Gemini REST shapes we use) ----

/** A single content part: either text OR inline image bytes (base64, no
 *  data: prefix). The inlineData variant rides ONLY on a fresh-upload @AI turn. */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** A single turn of conversation content. */
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** systemInstruction is a single content block (no role). */
export interface GeminiSystemInstruction {
  parts: Array<{ text: string }>;
}

export interface GenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

// ---- Error model (AI-1) ----

export type GeminiErrorKind = 'invalid_key' | 'quota' | 'network' | 'unknown';

/**
 * Typed error for all Gemini failures. `userMessage` is safe to surface in the
 * UI (Korean). The raw key is NEVER referenced here.
 */
export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  readonly userMessage: string;
  readonly status?: number;
  constructor(
    kind: GeminiErrorKind,
    userMessage: string,
    opts?: { status?: number; cause?: unknown },
  ) {
    super(userMessage);
    this.name = 'GeminiError';
    this.kind = kind;
    this.userMessage = userMessage;
    this.status = opts?.status;
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

// AI error messages are lang-aware: the UI-safe userMessage follows the active
// UI language (i18n). Sourced from the 'ai' i18n dict so the strings live in one
// place. The raw key is NEVER referenced in any of these (L1).
const USER_MESSAGES: Record<'ko' | 'en', Record<GeminiErrorKind, string>> = {
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

/** Current-language Gemini error message map (snapshot of langStore). Non-React:
 *  reads useLangStore.getState() so callers in this module need no hook. */
export function userMessages(): Record<GeminiErrorKind, string> {
  return USER_MESSAGES[useLangStore.getState().lang];
}

/** Convenience: the current-language message for a single error kind. */
export function userMessage(kind: GeminiErrorKind): string {
  return userMessages()[kind];
}

/** Map an HTTP status to a typed GeminiError. Never includes the key. */
function errorFromStatus(status: number): GeminiError {
  let kind: GeminiErrorKind;
  if (status === 401 || status === 403) kind = 'invalid_key';
  else if (status === 429) kind = 'quota';
  else kind = 'unknown';
  return new GeminiError(kind, userMessage(kind), { status });
}

/**
 * POST to a Gemini model endpoint with the key as a query param.
 * Wraps transport/HTTP failures into a typed GeminiError. The key never
 * appears in any thrown message or log.
 */
async function postModel<T>(
  method: string,
  apiKey: string,
  body: unknown,
): Promise<T> {
  const url = `${GEMINI_BASE}/models/${MODEL}:${method}?key=${encodeURIComponent(
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
    throw new GeminiError('network', userMessage('network'), { cause });
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
    throw new GeminiError('unknown', userMessage('unknown'), {
      status: res.status,
      cause,
    });
  }
}

// ---- generateContent ----

export interface GenerateContentArgs {
  /** User's own Gemini key. Call-time only. NEVER stored/logged. */
  apiKey: string;
  /** Persona / system prompt (L6: persona lives ONLY here). */
  systemInstruction?: string;
  contents: GeminiContent[];
  generationConfig?: GenerationConfig;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/**
 * Call models/{MODEL}:generateContent and return the first candidate's text.
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
    throw new GeminiError('unknown', userMessage('unknown'));
  }
  return text;
}

// ---- Token counting (AI-3) ----

export interface CountTokensArgs {
  apiKey: string;
  contents: GeminiContent[];
  systemInstruction?: string;
}

interface CountTokensResponse {
  totalTokens?: number;
}

/** Local heuristic fallback: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sum the estimated tokens across all content parts. */
function estimateContentsTokens(
  contents: GeminiContent[],
  systemInstruction?: string,
): number {
  let total = systemInstruction ? estimateTokens(systemInstruction) : 0;
  for (const c of contents) {
    for (const p of c.parts) total += estimateTokens('text' in p ? p.text : '');
  }
  return total;
}

/**
 * Call models/{MODEL}:countTokens and return totalTokens.
 * Throws a typed GeminiError on failure (use countTokensWithFallback to be safe).
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
    throw new GeminiError('unknown', userMessage('unknown'));
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
