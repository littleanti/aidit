// ============================================================================
// J4 (FR-13) — discussion document condensation, end to end in the browser.
//
// Unlike J1–J3 this spec is FULLY HERMETIC: it stubs the Aidit REST API with
// page.route in addition to the LLM host, so it needs only the Vite dev server
// (no backend, no DB). That makes it the UI-level counterpart to the server
// contract tests (backend/test/documents.test.ts) and the engine unit tests
// (src/engine/documentEngine.test.ts): here we verify what a real user sees.
//
// Covered:
//   * the [ 문서로 정리 ] menu item appears for a logged-in NON-author (FR-13.1)
//   * condensation runs on the user's key, POSTs the finished markdown, and
//     navigates to /d/:id (FR-13.2)
//   * the request carries the discussion as DATA turns while the directive stays
//     in systemInstruction (FR-13.8 / XC-4), and carries NO api key (L1)
//   * the document screen renders markdown + provenance + a thread link (13.6)
//   * the community [게시글|문서] tab lists documents and links through (13.6)
//   * with no key stored, nothing is generated and nothing is posted
// ============================================================================
import { test, expect, type Page } from '@playwright/test';

const POST_ID = 'post-e2e-1';
const DOC_ID = 'doc-e2e-1';
const SLUG = 'code-agent';

const DOC_MARKDOWN = `# Code Agent 사용 가이드

## 1. 프롬프트 작성
- 컨텍스트를 **먼저** 준다.
- 원하는 산출물 형태를 명시한다.

## 2. 워크플로
1. 계획을 먼저 세우게 한다
2. 작은 단위로 검증한다

| 단계 | 도구 |
|---|---|
| 계획 | 대화 |
| 실행 | 에이전트 |

## 미해결 질문
- 테스트를 먼저 쓰게 할까?
`;

const community = {
  id: 'com-1',
  slug: SLUG,
  name: 'Code Agent',
  description: '코드 에이전트 팁 커뮤니티',
  personaPrompt: '너는 친절한 시니어 개발자다.',
  personaIcon: '🤖',
  creatorId: 'other-user',
  createdAt: new Date('2026-07-01T00:00:00Z').toISOString(),
};

const post = {
  id: POST_ID,
  communityId: community.id,
  // authored by someone ELSE — proves the menu item is not author-gated.
  authorId: 'other-user',
  title: 'Code Agent 잘 쓰는 법',
  body: '팁을 모아봅시다.',
  score: 3,
  commentCount: 2,
  hotScore: 1,
  createdAt: new Date('2026-07-20T00:00:00Z').toISOString(),
  community,
  author: { id: 'other-user', username: '바다' },
  bookmarked: false,
  voted: false,
};

const comments = [
  {
    id: 'c1',
    postId: POST_ID,
    authorId: 'other-user',
    authorUsername: '바다',
    type: 'HUMAN',
    status: 'COMPLETE',
    body: '컨텍스트를 먼저 주는 게 중요합니다.',
    tokenCount: 10,
    segmentId: 'seg-0',
    replyToId: null,
    clientId: null,
    seq: 1,
    createdAt: new Date('2026-07-20T00:01:00Z').toISOString(),
  },
  {
    id: 'c2',
    postId: POST_ID,
    authorId: 'third-user',
    authorUsername: '찬',
    type: 'HUMAN',
    status: 'COMPLETE',
    body: '저는 계획을 먼저 세우게 합니다.',
    tokenCount: 10,
    segmentId: 'seg-0',
    replyToId: null,
    clientId: null,
    seq: 2,
    createdAt: new Date('2026-07-20T00:02:00Z').toISOString(),
  },
];

const context = {
  segmentIndex: 0,
  contents: [
    { role: 'user', text: '「바다」: Code Agent 잘 쓰는 법 / 팁을 모아봅시다.' },
    { role: 'user', text: '「바다」: 컨텍스트를 먼저 주는 게 중요합니다.' },
    { role: 'user', text: '「찬」: 저는 계획을 먼저 세우게 합니다.' },
  ],
  tokenSum: 300,
  summaryNeeded: false,
};

function documentPayload(over: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    communityId: community.id,
    communitySlug: SLUG,
    communityName: community.name,
    communityPersonaIcon: community.personaIcon,
    postId: POST_ID,
    postTitle: post.title,
    authorId: 'me-user',
    authorUsername: '아라',
    title: 'Code Agent 사용 가이드',
    segmentIndex: 0,
    sourceSeq: 3,
    createdAt: new Date('2026-07-27T00:00:00Z').toISOString(),
    body: DOC_MARKDOWN,
    ...over,
  };
}

/**
 * Seed a logged-in session (and optionally a BYOK key) before any app code runs.
 *
 * Also pins the UI language to ko. Without this the app follows the browser
 * locale (en-US under Playwright) and every assertion on a Korean label would be
 * testing the wrong dictionary rather than the feature.
 */
async function seedSession(page: Page, opts: { key?: string | null } = {}) {
  const key = opts.key === undefined ? 'test-key' : opts.key;
  await page.addInitScript(
    ([apiKey]) => {
      window.localStorage.setItem(
        'aidit-auth',
        JSON.stringify({
          state: {
            userId: 'me-user',
            username: '아라',
            token: 'e2e-token',
            googleApiKey: apiKey,
          },
          version: 0,
        }),
      );
      window.localStorage.setItem(
        'aidit-lang',
        JSON.stringify({ state: { lang: 'ko' }, version: 0 }),
      );
    },
    [key],
  );
}

interface ApiStubs {
  /** Bodies of every POST /posts/:id/documents the page issued. */
  documentPosts: Array<Record<string, unknown>>;
  /** Bodies of every POST /posts/:id/comments the page issued. */
  postedComments: Array<Record<string, unknown>>;
  /** Raw request bodies sent to the LLM host. */
  llmRequests: Array<Record<string, unknown>>;
}

/**
 * Stub every Aidit REST route the thread/document/community screens touch.
 *
 * NOTE the URL PREDICATE instead of a '**' glob: under Vite the app's own source
 * modules are served from paths like /src/api/rest.ts, which a '**\/api/**' glob
 * would also match — intercepting those replaces the app's code and the page
 * never boots. Matching on `pathname.startsWith('/api/')` hits only real calls.
 */
async function stubApi(
  page: Page,
  opts: {
    documents?: ReturnType<typeof documentPayload>[];
    llmReply?: string;
  } = {},
): Promise<ApiStubs> {
  const stubs: ApiStubs = { documentPosts: [], postedComments: [], llmRequests: [] };
  const documents = opts.documents ?? [];
  const llmReply = opts.llmReply ?? DOC_MARKDOWN;

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = req.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    // --- documents ---------------------------------------------------------
    if (method === 'POST' && path === `/posts/${POST_ID}/documents`) {
      stubs.documentPosts.push(req.postDataJSON());
      return json({ document: documentPayload() }, 201);
    }
    if (method === 'GET' && path === `/documents/${DOC_ID}`) {
      return json({ document: documentPayload() });
    }
    if (method === 'GET' && path === `/communities/${SLUG}/documents`) {
      return json({
        items: documents.map((d) => ({
          ...d,
          preview: 'Code Agent 사용 가이드 1. 프롬프트 작성 컨텍스트를 먼저 준다.',
        })),
        nextCursor: null,
      });
    }

    // --- thread / community ------------------------------------------------
    if (method === 'GET' && path === `/posts/${POST_ID}`) return json(post);
    if (method === 'GET' && path === `/posts/${POST_ID}/context`) return json(context);
    if (method === 'GET' && path === `/posts/${POST_ID}/comments`) {
      return json({ items: comments });
    }
    // Posting a comment must return a real Comment DTO: the @AI flow needs the
    // committed comment's id to attach the reply to (a bare {} silently stops
    // the flow before any LLM call).
    if (method === 'POST' && path === `/posts/${POST_ID}/comments`) {
      const sent = req.postDataJSON() as { body?: string; clientId?: string };
      return json(
        {
          id: `posted-${stubs.postedComments.length + 1}`,
          postId: POST_ID,
          authorId: 'me-user',
          authorUsername: '아라',
          type: 'HUMAN',
          status: 'COMPLETE',
          body: sent.body ?? '',
          tokenCount: 10,
          segmentId: 'seg-0',
          replyToId: null,
          clientId: sent.clientId ?? null,
          seq: comments.length + stubs.postedComments.push(sent),
          createdAt: new Date('2026-07-27T01:00:00Z').toISOString(),
        },
        201,
      );
    }
    if (method === 'PATCH' && path.startsWith('/comments/')) {
      return json({ id: path.split('/').pop(), status: 'COMPLETE' });
    }
    if (path === `/posts/${POST_ID}/stream`) {
      // Keep the SSE connection open but silent: the snapshot already came from
      // GET /comments, and the UI must not depend on live frames here.
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 100000\n\n',
      });
    }
    if (method === 'GET' && path === `/communities/${SLUG}`) return json(community);
    if (method === 'GET' && path === `/communities/${SLUG}/posts`) {
      return json([
        {
          id: POST_ID,
          title: post.title,
          body: post.body,
          score: 3,
          commentCount: 2,
          hotScore: 1,
          createdAt: post.createdAt,
          communityId: community.id,
          communitySlug: SLUG,
          communityName: community.name,
          authorId: 'other-user',
          authorUsername: '바다',
        },
      ]);
    }
    if (method === 'GET' && path === '/communities') return json([community]);

      // Everything else (metrics, refresh, feeds) — harmless empty answers.
      if (method === 'POST') return json({}, 200);
      return json({ items: [], nextCursor: null });
    },
  );

  // The BYOK browser->provider call. Handled here (rather than via mockLlm) so
  // recording and fulfilling live in ONE handler — Playwright runs routes
  // last-registered-first, and a separate recorder would be shadowed.
  await page.route('**generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes(':generateContent')) {
      stubs.llmRequests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: llmReply }] } }],
        }),
      });
    }
    if (url.includes(':countTokens')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalTokens: 10 }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return stubs;
}

test.describe('J4 — 논의 문서 응결 (FR-13)', () => {
  test('a non-author condenses the thread and lands on the document', async ({
    page,
  }) => {
    await seedSession(page);
    const stubs = await stubApi(page);

    await page.goto(`/p/${POST_ID}`);
    await expect(page.getByText('Code Agent 잘 쓰는 법').first()).toBeVisible();

    // FR-13.1: the overflow menu opens for a logged-in NON-author, and the
    // author-only actions are absent.
    await page.getByRole('button', { name: '게시글 관리' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: /문서로 정리/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /삭제/ })).toHaveCount(0);

    await menu.getByRole('menuitem', { name: /문서로 정리/ }).click();

    // FR-13.2: navigates to the new document.
    await page.waitForURL(`**/d/${DOC_ID}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Code Agent 사용 가이드' }),
    ).toBeVisible();

    // The POST carried the finished markdown + provenance, and NO api key (L1).
    expect(stubs.documentPosts).toHaveLength(1);
    const posted = stubs.documentPosts[0]!;
    expect(posted.body).toContain('## 1. 프롬프트 작성');
    expect(posted.title).toBe('Code Agent 사용 가이드');
    expect(posted.segmentIndex).toBe(0);
    expect(posted.sourceSeq).toBe(3);
    expect(JSON.stringify(posted)).not.toContain('test-key');

    // FR-13.8 / XC-4: the directive is in systemInstruction; the discussion is
    // in data turns and never in the system role.
    expect(stubs.llmRequests).toHaveLength(1);
    const llmReq = stubs.llmRequests[0]!;
    const systemText = JSON.stringify(llmReq.systemInstruction ?? '');
    expect(systemText).toContain('마크다운 문서로 정리');
    expect(systemText).not.toContain('「바다」');
    expect(systemText).not.toContain('「찬」');
    expect(JSON.stringify(llmReq.contents)).toContain('「찬」');
  });

  test('the document screen renders markdown, provenance and a thread link', async ({
    page,
  }) => {
    await seedSession(page);
    await stubApi(page);

    await page.goto(`/d/${DOC_ID}`);

    // The title shows ONCE — as the card heading. The markdown's own leading
    // '# title' is stripped at render time so it is not printed twice.
    await expect(
      page.getByRole('heading', { name: 'Code Agent 사용 가이드' }),
    ).toHaveCount(1);
    // markdown structure actually rendered (heading, list, table)
    await expect(page.getByRole('heading', { name: '1. 프롬프트 작성' })).toBeVisible();
    await expect(page.getByText('원하는 산출물 형태를 명시한다.')).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('cell', { name: '에이전트' })).toBeVisible();
    // provenance (FR-13.4)
    await expect(page.getByText(/세그먼트 #0/)).toBeVisible();
    // back to the source thread
    await page.getByRole('link', { name: /원본 스레드 보기/ }).click();
    await page.waitForURL(`**/p/${POST_ID}`);
  });

  test('the community [게시글|문서] tab lists documents and links through', async ({
    page,
  }) => {
    await seedSession(page);
    await stubApi(page, { documents: [documentPayload()] });

    await page.goto(`/c/${SLUG}`);
    await expect(page.getByRole('tab', { name: '게시글' })).toBeVisible();

    await page.getByRole('tab', { name: /문서/ }).click();
    const card = page.getByRole('link', { name: /Code Agent 사용 가이드/ });
    await expect(card).toBeVisible();
    // the tab label picks up the loaded count
    await expect(page.getByRole('tab', { name: /문서 1/ })).toBeVisible();

    await card.click();
    await page.waitForURL(`**/d/${DOC_ID}`);
  });

  test('without a stored key nothing is generated and nothing is posted', async ({
    page,
  }) => {
    await seedSession(page, { key: null });
    const stubs = await stubApi(page);

    await page.goto(`/p/${POST_ID}`);
    await page.getByRole('button', { name: '게시글 관리' }).click();
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /문서로 정리/ })
      .click();

    await expect(page.getByText(/LLM 키가 필요합니다/)).toBeVisible();
    expect(stubs.documentPosts).toHaveLength(0);
    expect(stubs.llmRequests).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/p/${POST_ID}$`));
  });
});

test.describe('J5 — 문서를 컨텍스트로 재투입 (FR-14)', () => {
  test('attaching a document sends it as a leading reference turn', async ({
    page,
  }) => {
    await seedSession(page);
    const stubs = await stubApi(page, { documents: [documentPayload()] });

    await page.goto(`/p/${POST_ID}`);
    await expect(page.getByText('컨텍스트를 먼저 주는 게 중요합니다.')).toBeVisible();

    // Open the Composer AI popover and attach the community document.
    await page.getByRole('button', { name: 'AI 모드 설정' }).click();
    const menu = page.getByRole('dialog', { name: 'AI 모드 설정' });
    await expect(menu.getByText(/참고 문서 0\/3/)).toBeVisible();
    await menu.getByRole('checkbox', { name: /Code Agent 사용 가이드/ }).click();
    await expect(menu.getByText(/참고 문서 1\/3/)).toBeVisible();

    // Close the popover — the chip is the reminder that a doc rides along.
    await page.keyboard.press('Escape');
    await expect(page.getByText(/문서 1개 참고/)).toBeVisible();

    // Send an @AI message.
    await page.getByRole('textbox', { name: '댓글 입력' }).fill('정리된 내용 기준으로 알려줘');
    await page.getByRole('button', { name: '전송' }).click();

    // The LLM request must carry the document FIRST, as a user turn, and the
    // document body must NOT be in systemInstruction (XC-4 / FR-14.5).
    await expect
      .poll(() => stubs.llmRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const req = stubs.llmRequests[0] as {
      systemInstruction?: unknown;
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
    };
    const firstTurn = req.contents[0]!;
    expect(firstTurn.role).toBe('user');
    expect(firstTurn.parts[0]!.text).toContain('참고 문서');
    expect(firstTurn.parts[0]!.text).toContain('# Code Agent 사용 가이드');
    expect(firstTurn.parts[0]!.text).toContain('컨텍스트를 **먼저** 준다');
    expect(JSON.stringify(req.systemInstruction ?? '')).not.toContain(
      '프롬프트 작성',
    );

    // The attachment is per-utterance: the chip is gone after sending.
    await expect(page.getByText(/문서 1개 참고/)).toHaveCount(0);
  });

  test('with no documents the row explains how to create one', async ({ page }) => {
    await seedSession(page);
    await stubApi(page, { documents: [] });

    await page.goto(`/p/${POST_ID}`);
    await page.getByRole('button', { name: 'AI 모드 설정' }).click();
    const menu = page.getByRole('dialog', { name: 'AI 모드 설정' });
    await expect(menu.getByText(/응결된 문서가 없어요/)).toBeVisible();
    await expect(menu.getByText(/문서로 정리/)).toBeVisible();
  });
});
