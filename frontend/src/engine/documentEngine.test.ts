// ============================================================================
// FR-13 — documentEngine tests.
//
// Mirrors contextEngine.test.ts: the network seam (rest.ts) and the LLM seam
// (llm.generateContent) are mocked so NO key, network call, or model call ever
// happens. LlmError keeps its real implementation (the engine branches on
// `instanceof`).
//
// Covered:
//   FR-13.2 : condensation runs on the CALLER'S key and posts the finished text.
//   FR-13.3 : title comes from the first '# heading', else the post title.
//   FR-13.4 : provenance (segmentIndex + sourceSeq) accompanies the document.
//   FR-13.7 : any failure writes NOTHING (no document posted) and reports a
//             UI-safe message — the thread is never touched.
//   FR-13.8 : XC-4 isolation — the directive rides in systemInstruction only;
//             discussion text stays in data turns.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContextResponse, DocumentDetail } from '../api/types';

vi.mock('../api/llm', async () => {
  const actual = await vi.importActual<typeof import('../api/llm')>('../api/llm');
  return { ...actual, generateContent: vi.fn() };
});

vi.mock('../api/rest', async () => {
  const actual = await vi.importActual<typeof import('../api/rest')>('../api/rest');
  return { ...actual, getContext: vi.fn(), postDocument: vi.fn() };
});

import {
  condenseToDocument,
  extractTitle,
  stripLeadingTitle,
  DOCUMENT_DIRECTIVE,
} from './documentEngine';
import { generateContent, LlmError } from '../api/llm';
import { getContext, postDocument, ApiError } from '../api/rest';
import { useAuthStore } from '../stores/authStore';
import { useLangStore } from '../stores/langStore';

const mockGenerate = vi.mocked(generateContent);
const mockGetContext = vi.mocked(getContext);
const mockPostDocument = vi.mocked(postDocument);

const PERSONA = 'You are a kind cooking chef persona.';
const KEY = 'test-key-never-leaves-the-browser';

function ctx(over: Partial<ContextResponse> = {}): ContextResponse {
  return {
    segmentIndex: 0,
    contents: [
      { role: 'user', text: '「아라」: Code Agent 잘 쓰는 법 알려줘' },
      { role: 'model', text: '컨텍스트를 먼저 주는 것이 중요합니다.' },
      { role: 'user', text: '「바다」: 저는 계획을 먼저 세우게 합니다.' },
    ],
    tokenSum: 1_000,
    summaryNeeded: false,
    ...over,
  };
}

function doc(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc-1',
    communityId: 'com-1',
    communitySlug: 'cooking',
    communityName: 'Cooking',
    postId: 'post-1',
    postTitle: 'Code Agent 잘 쓰는 법',
    authorId: 'user-1',
    authorUsername: '아라',
    title: 'Code Agent 사용 가이드',
    segmentIndex: 0,
    sourceSeq: 3,
    createdAt: new Date(0).toISOString(),
    body: '# Code Agent 사용 가이드\n\n## 1. 프롬프트\n- 컨텍스트를 먼저 준다.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useLangStore.setState({ lang: 'ko' });
  useAuthStore.setState({ userId: 'user-1' });
});

// --- extractTitle (FR-13.3) ------------------------------------------------

describe('extractTitle', () => {
  it('takes the first level-1 heading', () => {
    expect(extractTitle('# Code Agent 사용 가이드\n\n## 섹션\n본문')).toBe(
      'Code Agent 사용 가이드',
    );
  });

  it('tolerates leading blank lines before the heading', () => {
    expect(extractTitle('\n\n#   제목입니다  \n본문')).toBe('제목입니다');
  });

  it('returns null when there is no heading', () => {
    expect(extractTitle('본문만 있는 문서입니다.')).toBeNull();
  });

  it('ignores a level-2 heading', () => {
    expect(extractTitle('## 섹션 제목\n본문')).toBeNull();
  });

  it('does NOT pick up a section heading that follows body text', () => {
    // A '# ' appearing after real prose is a section of a document whose title
    // was never emitted — falling back to the post title is the correct answer.
    expect(extractTitle('머리말 문장입니다.\n\n# 뒤늦은 제목\n')).toBeNull();
  });

  it('ignores an empty heading', () => {
    expect(extractTitle('#   \n본문')).toBeNull();
  });
});

// --- stripLeadingTitle (render-time de-duplication) ------------------------

describe('stripLeadingTitle', () => {
  it('removes the leading title heading and its blank lines', () => {
    expect(stripLeadingTitle('# 제목\n\n본문입니다.')).toBe('본문입니다.');
  });

  it('keeps section headings intact', () => {
    expect(stripLeadingTitle('# 제목\n\n## 섹션\n본문')).toBe('## 섹션\n본문');
  });

  it('leaves a body-only document untouched', () => {
    expect(stripLeadingTitle('본문만 있습니다.\n\n# 뒤늦은 제목')).toBe(
      '본문만 있습니다.\n\n# 뒤늦은 제목',
    );
  });

  it('leaves a document whose first heading is level 2 untouched', () => {
    expect(stripLeadingTitle('## 섹션\n본문')).toBe('## 섹션\n본문');
  });

  it('handles an empty document', () => {
    expect(stripLeadingTitle('')).toBe('');
  });
});

// --- condenseToDocument ----------------------------------------------------

describe('condenseToDocument — happy path', () => {
  it('generates on the CALLER key, extracts the title, and posts with provenance', async () => {
    mockGetContext.mockResolvedValue(ctx({ segmentIndex: 2 }));
    mockGenerate.mockResolvedValue(
      '# Code Agent 사용 가이드\n\n## 1. 프롬프트\n- 컨텍스트를 먼저 준다.',
    );
    mockPostDocument.mockResolvedValue({ document: doc() });

    const res = await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'Code Agent 잘 쓰는 법',
      apiKey: KEY,
    });

    expect(res.ok).toBe(true);
    expect(res.document?.id).toBe('doc-1');

    // The caller's key was used for the generation.
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0]![0]!.apiKey).toBe(KEY);

    // FR-13.3 + FR-13.4: title from the heading, provenance from the context.
    const [postId, body] = mockPostDocument.mock.calls[0]!;
    expect(postId).toBe('post-1');
    expect(body.title).toBe('Code Agent 사용 가이드');
    expect(body.segmentIndex).toBe(2);
    expect(body.sourceSeq).toBe(3); // 3 context turns condensed
    expect(body.body).toContain('## 1. 프롬프트');
    expect(body.clientId).toMatch(/^doc-/);
  });

  it('falls back to the post title when the markdown has no heading', async () => {
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockResolvedValue('제목 없이 본문만 생성된 경우입니다.');
    mockPostDocument.mockResolvedValue({ document: doc() });

    await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'Code Agent 잘 쓰는 법',
      apiKey: KEY,
    });

    expect(mockPostDocument.mock.calls[0]![1]!.title).toBe('Code Agent 잘 쓰는 법');
  });

  it('trims the generated markdown before saving', async () => {
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockResolvedValue('\n\n# 제목\n본문\n\n  ');
    mockPostDocument.mockResolvedValue({ document: doc() });

    await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(mockPostDocument.mock.calls[0]![1]!.body).toBe('# 제목\n본문');
  });
});

describe('condenseToDocument — XC-4 isolation (FR-13.8)', () => {
  it('puts persona + directive in systemInstruction and NEVER discussion text', async () => {
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockResolvedValue('# 제목\n본문');
    mockPostDocument.mockResolvedValue({ document: doc() });

    await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    const call = mockGenerate.mock.calls[0]![0]!;
    const system = call.systemInstruction ?? '';

    // Persona and the app-controlled directive are present...
    expect(system).toContain(PERSONA);
    expect(system).toContain(DOCUMENT_DIRECTIVE.ko);
    // ...and NO discussion content leaked into the system role. Speaker turns
    // are matched in their prefixed form ('「name」') so the assertion cannot be
    // fooled by an incidental substring of the app directive.
    expect(system).not.toContain('「아라」');
    expect(system).not.toContain('「바다」');
    expect(system).not.toContain('Code Agent 잘 쓰는 법 알려줘');
    expect(system).not.toContain('계획을 먼저 세우게 합니다');
    expect(system).not.toContain('컨텍스트를 먼저 주는 것이 중요합니다');

    // The discussion is present, as DATA turns with their original roles.
    const roles = call.contents.map((c) => c.role);
    expect(roles).toEqual(['user', 'model', 'user']);
    const flat = call.contents
      .flatMap((c) => c.parts.map((p) => ('text' in p ? p.text : '')))
      .join('\n');
    expect(flat).toContain('「아라」');
    expect(flat).toContain('「바다」');
  });

  it('uses the active UI language directive (en)', async () => {
    useLangStore.setState({ lang: 'en' });
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockResolvedValue('# Title\nBody');
    mockPostDocument.mockResolvedValue({ document: doc() });

    await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(mockGenerate.mock.calls[0]![0]!.systemInstruction).toContain(
      DOCUMENT_DIRECTIVE.en,
    );
  });
});

describe('condenseToDocument — failures write NOTHING (FR-13.7)', () => {
  it('context fetch failure: no LLM call, no document', async () => {
    mockGetContext.mockRejectedValue(new ApiError(500, 'boom', null));

    const res = await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('context');
    expect(res.errorMessage).toBeTruthy();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockPostDocument).not.toHaveBeenCalled();
  });

  it('empty context: refuses up front without spending the user tokens', async () => {
    mockGetContext.mockResolvedValue(ctx({ contents: [] }));

    const res = await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('empty');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockPostDocument).not.toHaveBeenCalled();
  });

  it('LlmError surfaces its user message and posts no document', async () => {
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockRejectedValue(
      new LlmError('invalid_key', 'AI 응답 실패 — 키를 확인하세요'),
    );

    const res = await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('generate');
    expect(res.errorMessage).toBe('AI 응답 실패 — 키를 확인하세요');
    expect(mockPostDocument).not.toHaveBeenCalled();
  });

  it('a blank generation is treated as a failure, not an empty document', async () => {
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockResolvedValue('   \n  ');

    const res = await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('generate');
    expect(mockPostDocument).not.toHaveBeenCalled();
  });

  it('save failure reports the save stage', async () => {
    mockGetContext.mockResolvedValue(ctx());
    mockGenerate.mockResolvedValue('# 제목\n본문');
    mockPostDocument.mockRejectedValue(new ApiError(429, 'rate limited', null));

    const res = await condenseToDocument({
      postId: 'post-1',
      communityPersonaPrompt: PERSONA,
      postTitle: 'fallback',
      apiKey: KEY,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe('save');
    expect(res.errorMessage).toBeTruthy();
  });
});
