// ============================================================================
// FR-13 — discussion document condensation ("논의 문서 응결").
//
// Turns an accumulated thread into ONE markdown document using the CALLER'S own
// key (BYOK). This is the product's north-star action: the discussion stops
// being a chat log and becomes a reusable community asset.
//
// It deliberately reuses the existing machinery instead of growing a parallel
// path:
//   * context assembly     -> rest.getContext (the same active-segment context
//                             an @AI reply would answer from)
//   * request construction -> contextEngine.buildLlmRequest (so the XC-4
//                             persona/system vs. content/user split is enforced
//                             in exactly ONE place, as documented there)
//   * the LLM call         -> llmStatus.generateContent (status-tracked wrapper)
//
// XC-4: the document directive is APP-CONTROLLED text that rides in
// systemInstruction next to the community persona. Every piece of discussion
// content stays a role:'user'/'model' data turn. No user text can promote itself
// to a system role here, because this module never assembles systemInstruction
// itself — buildLlmRequest does.
//
// NOT summarization (AI-6): condensation NEVER posts a bubble, never opens a
// segment, and never consumes a `seq`. It is read-only against the thread and
// writes to a separate table (TRD §4.3), so the realtime/ordering contract (L4)
// is untouched. A failure therefore cannot damage the discussion (FR-13.7).
// ============================================================================

import { LlmError } from '../api/llm';
import { getContext, postDocument } from '../api/rest';
import type { DocumentDetail } from '../api/types';
import { generateContent } from './llmStatus';
import { buildLlmRequest } from './contextEngine';
import { useAuthStore } from '../stores/authStore';
import { useLangStore } from '../stores/langStore';
import { track } from '../lib/metrics';
import { tn } from '../i18n/tn';
import { ai as aiDict } from '../i18n/dicts/ai';

/** App-controlled condensation directive per UI language (see ai dict). */
export const DOCUMENT_DIRECTIVE: Record<'ko' | 'en', string> = {
  ko: aiDict.ko.document_directive,
  en: aiDict.en.document_directive,
};

/**
 * Pull the document title out of generated markdown.
 *
 * Looks for the FIRST level-1 ATX heading (`# Title`) anywhere in the leading
 * part of the document — models occasionally emit a blank line or a stray
 * preamble before it. Returns null when there is none, so the caller can fall
 * back to the post title (FR-13.3).
 */
export function extractTitle(markdown: string): string | null {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match) {
      const title = match[1]!.trim();
      if (title !== '') return title.slice(0, 300);
    }
    // Only scan the head of the document: a `# ` that appears after real body
    // text is a section heading of a document whose title was never emitted.
    if (line.trim() !== '' && !line.startsWith('#')) break;
  }
  return null;
}

/**
 * Drop the document's own leading `# Title` line for rendering.
 *
 * The stored markdown keeps its title heading (it is a self-contained document
 * that should survive export/copy), but the Document screen already shows the
 * title as the card heading — rendering both prints it twice. Only a heading
 * that comes BEFORE any body text is removed, so section headings are untouched.
 */
export function stripLeadingTitle(markdown: string): string {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (/^#\s+.+/.test(line)) {
      return lines.slice(i + 1).join('\n').replace(/^\n+/, '');
    }
    // First non-blank line is body text — there is no leading title to strip.
    return markdown;
  }
  return markdown;
}

export interface CondenseToDocumentArgs {
  postId: string;
  /** Persona of the post's community — goes ONLY into systemInstruction. */
  communityPersonaPrompt: string;
  /** Fallback title when the markdown has no '# heading' (FR-13.3). */
  postTitle: string;
  /** The CALLER'S key (call-time only; never stored, logged, or sent to Aidit). */
  apiKey: string;
}

export type CondenseFailureStage = 'context' | 'empty' | 'generate' | 'save';

export interface CondenseResult {
  ok: boolean;
  /** The persisted document on success. */
  document?: DocumentDetail;
  /** UI-safe message on failure. */
  errorMessage?: string;
  /** Which step failed (tests / observability). */
  stage?: CondenseFailureStage;
}

/**
 * FR-13.2: condense the thread's active context into a stored markdown document.
 *
 * Steps:
 *  1. GET /posts/:id/context — the active segment, same as an @AI reply sees.
 *     An empty context is refused up front: there is nothing to condense, and
 *     spending the user's tokens to produce an empty document is worse than a
 *     clear message.
 *  2. buildLlmRequest with the community persona + DOCUMENT_DIRECTIVE appended
 *     as the caller's "user persona" slot — that slot exists precisely for
 *     app/user text that belongs in systemInstruction, so XC-4 holds and the
 *     mapping stays in one place. No appended data turn: the discussion is
 *     already the context.
 *  3. generateContent with the caller's key.
 *  4. POST the finished markdown with provenance (segmentIndex + sourceSeq).
 *
 * On any failure NOTHING is written and the thread is untouched (FR-13.7).
 */
export async function condenseToDocument(
  args: CondenseToDocumentArgs,
): Promise<CondenseResult> {
  const { postId, communityPersonaPrompt, postTitle, apiKey } = args;

  let context;
  try {
    context = await getContext(postId);
  } catch {
    return {
      ok: false,
      stage: 'context',
      errorMessage: tn('ai.doc_fail_context'),
    };
  }

  if (!context.contents || context.contents.length === 0) {
    return { ok: false, stage: 'empty', errorMessage: tn('ai.doc_fail_empty') };
  }

  const lang = useLangStore.getState().lang;
  const request = buildLlmRequest({
    personaPrompt: communityPersonaPrompt,
    // XC-4: app-controlled directive, systemInstruction only (never a data turn).
    userPersonaPrompt: DOCUMENT_DIRECTIVE[lang],
    context,
    // A document is inherently long-form; ask for the unbounded length level so
    // the per-length maxOutputTokens cap doesn't truncate the guide mid-section.
    length: 'long',
  });

  track('document_invoked');

  let markdown: string;
  try {
    markdown = await generateContent({
      apiKey,
      systemInstruction: request.systemInstruction,
      contents: request.contents,
      generationConfig: request.generationConfig,
    });
  } catch (err) {
    track('document_failure', {
      stage: 'generate',
      ...(err instanceof LlmError ? { kind: err.kind } : {}),
    });
    return {
      ok: false,
      stage: 'generate',
      errorMessage:
        err instanceof LlmError ? err.userMessage : tn('ai.doc_fail_generate'),
    };
  }

  const body = markdown.trim();
  if (body === '') {
    track('document_failure', { stage: 'generate' });
    return {
      ok: false,
      stage: 'generate',
      errorMessage: tn('ai.doc_fail_generate'),
    };
  }

  // FR-13.3: prefer the generated '# heading', else the post title.
  const title = extractTitle(body) ?? postTitle;

  // provenance (FR-13.4). `sourceSeq` is the count of context turns condensed:
  // the server's context payload has no per-turn seq, and the turn count is the
  // honest, monotonic measure of "how much of the thread this covers" for the
  // active segment. segmentIndex pins WHICH segment those turns came from.
  const sourceSeq = context.contents.length;

  const userId = useAuthStore.getState().userId ?? undefined;
  try {
    const res = await postDocument(
      postId,
      {
        title,
        body,
        segmentIndex: context.segmentIndex,
        sourceSeq,
        clientId: makeClientId(),
      },
      userId ?? '',
    );
    track('document_success');
    return { ok: true, document: res.document };
  } catch {
    track('document_failure', { stage: 'save' });
    return { ok: false, stage: 'save', errorMessage: tn('ai.doc_fail_save') };
  }
}

/** Idempotency key so a retried POST cannot duplicate a document (TRD §4.3). */
function makeClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `doc-${crypto.randomUUID()}`;
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
