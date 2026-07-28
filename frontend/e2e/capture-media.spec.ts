// ============================================================================
// README media capture (not a test — a deterministic screenshot/GIF tool).
//
// Produces the images the README embeds, so the product is legible in 5 seconds
// without opening a video:
//   docs/assets/thread.png     — the chat-room thread with a real AI reply
//   docs/assets/document.png   — a condensed discussion document (FR-13)
//   docs/assets/community.png  — the community [게시글|문서] tab
//   docs/assets/condense/*.png — frame sequence for the condense-flow GIF
//
// It runs against the Vite dev server with the Aidit REST API and the LLM host
// STUBBED (same technique as j4-document.spec.ts), which means:
//   * no backend, no DB, no API key, no real model call,
//   * byte-identical output on every run — regenerating the media after a UI
//     change is one command, and diffs are meaningful.
//
// Usage:
//   npm run media           (frontend/) — needs the dev server already running
//   npm run media:gif       — turns docs/assets/condense/*.png into thread.gif
//
// It is EXCLUDED from `npm run e2e` (testIgnore in playwright.config.ts) so a
// media refresh never gates the test suite.
// ============================================================================
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, '..', '..', 'docs', 'assets');
const FRAMES = resolve(ASSETS, 'condense');

const POST_ID = 'post-demo';
const DOC_ID = 'doc-demo';
const SLUG = 'code-agent';

const DOC_MARKDOWN = `# Code Agent 사용 가이드

## 1. 프롬프트 작성
- **컨텍스트를 먼저** 준다. 파일 경로·에러 메시지·기대 결과를 한 번에.
- 원하는 산출물 형태(패치/설명/테스트)를 명시한다.

## 2. 워크플로
1. 계획을 먼저 세우게 하고, 사람이 계획을 검토한다
2. 작은 단위로 변경 → 매번 검증한다

| 단계 | 도구 | 사람이 하는 일 |
|---|---|---|
| 계획 | 대화 | 범위 합의 |
| 실행 | 에이전트 | 결과 검증 |

## 미해결 질문
- 테스트를 먼저 쓰게 할까? 의견이 갈렸다.
`;

const community = {
  id: 'com-1',
  slug: SLUG,
  name: 'Code Agent',
  description: '코드 에이전트를 실무에서 잘 쓰는 법을 모으는 커뮤니티',
  personaPrompt:
    '너는 코드 에이전트를 매일 쓰는 시니어 개발자다. 구체적인 예시와 함께 간결하게 답한다.',
  personaIcon: '🤖',
  creatorId: 'user-ara',
  createdAt: new Date('2026-07-20T00:00:00Z').toISOString(),
};

const post = {
  id: POST_ID,
  communityId: community.id,
  authorId: 'user-ara',
  title: 'Code Agent 잘 쓰는 법, 각자 노하우 모아봐요',
  body: '에이전트한테 일을 맡길 때 각자 어떻게 하시나요? 저는 계획을 먼저 세우게 합니다.',
  score: 12,
  commentCount: 4,
  hotScore: 8,
  createdAt: new Date('2026-07-27T00:00:00Z').toISOString(),
  community,
  author: { id: 'user-ara', username: '아라' },
  bookmarked: false,
  voted: false,
};

function bubble(
  over: Partial<{
    id: string;
    authorId: string | null;
    authorUsername: string | null;
    type: string;
    status: string;
    body: string;
    seq: number;
    minutesAgo: number;
  }>,
) {
  const minutesAgo = over.minutesAgo ?? 10;
  return {
    id: over.id ?? 'c',
    postId: POST_ID,
    // An AI bubble is identified by authorId === null (L1), so an EXPLICIT null
    // must survive — `?? default` would swallow it and render the AI answer as a
    // human message, misrepresenting the product in the captured media.
    authorId: 'authorId' in over ? (over.authorId ?? null) : 'user-bada',
    authorUsername:
      'authorUsername' in over ? (over.authorUsername ?? null) : '바다',
    type: over.type ?? 'HUMAN',
    status: over.status ?? 'COMPLETE',
    body: over.body ?? '',
    tokenCount: 40,
    segmentId: 'seg-0',
    replyToId: null,
    clientId: null,
    seq: over.seq ?? 1,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

const comments = [
  bubble({
    id: 'c1',
    authorId: 'user-bada',
    authorUsername: '바다',
    body: '저는 파일 경로랑 에러 전문을 먼저 다 붙여줘요. 그것만 해도 헛다리 짚는 게 확 줄어요.',
    seq: 1,
    minutesAgo: 12,
  }),
  bubble({
    id: 'c2',
    authorId: 'user-chan',
    authorUsername: '찬',
    body: '반대로 저는 계획부터 시키는 게 더 컸어요. 계획을 사람이 한 번 보고 나면 큰 실수가 거의 없어요.',
    seq: 2,
    minutesAgo: 9,
  }),
  bubble({
    id: 'c3',
    authorId: 'user-ara',
    authorUsername: '아라',
    body: '@AI 지금까지 나온 두 방식을 비교해줘. 언제 어느 쪽이 더 나아?',
    seq: 3,
    minutesAgo: 5,
  }),
  bubble({
    id: 'c4',
    authorId: null,
    authorUsername: null,
    type: 'AI_REPLY',
    body: `두 방식은 **문제의 성격**에 따라 갈립니다.

- **컨텍스트 우선**: 원인이 코드 안에 있는 버그 수정에 유리합니다. 경로·스택트레이스를 먼저 주면 탐색 비용이 사라집니다.
- **계획 우선**: 여러 파일을 건드리는 기능 추가·리팩터링에 유리합니다. 방향이 틀렸을 때의 낭비가 가장 크기 때문입니다.

실무에서는 둘을 합쳐 \`컨텍스트 → 계획 → 사람 검토 → 작은 단위 실행\` 순서를 씁니다.`,
    seq: 4,
    minutesAgo: 4,
  }),
];

const context = {
  segmentIndex: 0,
  contents: [
    { role: 'user', text: `「아라」: ${post.title} / ${post.body}` },
    ...comments.map((c) => ({
      role: c.type === 'AI_REPLY' ? 'model' : 'user',
      text: c.type === 'AI_REPLY' ? c.body : `「${c.authorUsername}」: ${c.body}`,
    })),
  ],
  tokenSum: 2_400,
  summaryNeeded: false,
};

const documentPayload = {
  id: DOC_ID,
  communityId: community.id,
  communitySlug: SLUG,
  communityName: community.name,
  communityPersonaIcon: community.personaIcon,
  postId: POST_ID,
  postTitle: post.title,
  authorId: 'user-ara',
  authorUsername: '아라',
  title: 'Code Agent 사용 가이드',
  segmentIndex: 0,
  sourceSeq: context.contents.length,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  body: DOC_MARKDOWN,
};

const feedCard = {
  id: POST_ID,
  title: post.title,
  body: post.body,
  score: 12,
  commentCount: 4,
  hotScore: 8,
  createdAt: post.createdAt,
  communityId: community.id,
  communitySlug: SLUG,
  communityName: community.name,
  communityPersonaIcon: community.personaIcon,
  authorId: 'user-ara',
  authorUsername: '아라',
  voted: false,
};

async function seed(page: Page, opts: { documents?: boolean } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'aidit-auth',
      JSON.stringify({
        state: {
          userId: 'user-ara',
          username: '아라',
          token: 'demo-token',
          googleApiKey: 'demo-key',
        },
        version: 0,
      }),
    );
    // Pin ko so the captured media matches the product's primary language.
    window.localStorage.setItem(
      'aidit-lang',
      JSON.stringify({ state: { lang: 'ko' }, version: 0 }),
    );

    // Stub EventSource so the stream reports a HEALTHY open connection.
    //
    // A page.route-fulfilled SSE response is a COMPLETE body, so the real
    // EventSource opens and then immediately hits EOF -> error -> the
    // "연결이 끊겼습니다 — 다시 연결 중…" banner would sit in every screenshot,
    // making a working app look broken. The comment snapshot already comes from
    // GET /comments, so a connection that opens and stays quiet is the accurate
    // steady state to portray.
    class OpenEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readyState = 1;
      url: string;
      withCredentials = false;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      private listeners = new Map<string, Set<(e: Event) => void>>();

      constructor(url: string | URL) {
        this.url = String(url);
        setTimeout(() => {
          const event = new Event('open');
          this.onopen?.(event);
          this.listeners.get('open')?.forEach((l) => l(event));
        }, 30);
      }
      addEventListener(type: string, listener: (e: Event) => void): void {
        let set = this.listeners.get(type);
        if (!set) {
          set = new Set();
          this.listeners.set(type, set);
        }
        set.add(listener);
      }
      removeEventListener(type: string, listener: (e: Event) => void): void {
        this.listeners.get(type)?.delete(listener);
      }
      dispatchEvent(): boolean {
        return true;
      }
      close(): void {
        this.readyState = 2;
      }
    }
    (window as unknown as { EventSource: unknown }).EventSource = OpenEventSource;
  });

  const documents = opts.documents === false ? [] : [documentPayload];

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace(/^\/api/, '');
      const method = req.method();
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });

      if (method === 'POST' && path === `/posts/${POST_ID}/documents`) {
        return json({ document: documentPayload }, 201);
      }
      if (path === `/documents/${DOC_ID}`) return json({ document: documentPayload });
      if (path === `/communities/${SLUG}/documents`) {
        return json({
          items: documents.map((d) => ({
            ...d,
            preview:
              'Code Agent 사용 가이드 1. 프롬프트 작성 컨텍스트를 먼저 준다. 파일 경로·에러 메시지·기대 결과를 한 번에.',
          })),
          nextCursor: null,
        });
      }
      if (path === `/posts/${POST_ID}`) return json(post);
      if (path === `/posts/${POST_ID}/context`) return json(context);
      if (path === `/posts/${POST_ID}/comments`) return json({ items: comments });
      if (path === `/posts/${POST_ID}/stream`) {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'retry: 100000\n\n',
        });
      }
      if (path === `/communities/${SLUG}`) return json(community);
      if (path === `/communities/${SLUG}/posts`) return json([feedCard]);
      if (path === '/communities') return json([community]);
      if (path === '/posts') return json({ items: [feedCard], nextCursor: null });
      if (method === 'POST') return json({});
      return json({ items: [], nextCursor: null });
    },
  );

  await page.route('**generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes(':generateContent')) {
      // Small delay so the GIF actually shows the "정리 중…" state.
      await new Promise((r) => setTimeout(r, 900));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: DOC_MARKDOWN }] } }],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalTokens: 2400 }),
    });
  });
}

test.beforeAll(() => {
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
});

test('capture: thread', async ({ page }) => {
  await seed(page);
  await page.goto(`/p/${POST_ID}`);
  // Scroll to the AI answer: the point of the screenshot is the shared-context
  // AI reply, which is the LAST bubble and sits below the fold on a phone
  // viewport. The thread scrolls the WINDOW (no inner scroll container), so
  // scrollIntoView on the element is not enough — drive the window to the end.
  await expect(page.getByText('두 방식은').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(ASSETS, 'thread.png') });
});

test('capture: document', async ({ page }) => {
  await seed(page);
  await page.goto(`/d/${DOC_ID}`);
  await expect(page.getByRole('table')).toBeVisible();
  // In a fullPage shot the sticky bottom tab bar lands on top of the LAST line,
  // which here is the provenance note ("출처: 세그먼트 #0 · …") — the one line
  // that proves FR-13.4. Add capture-only bottom padding so nothing is occluded.
  await page.evaluate(() => {
    document.body.style.paddingBottom = '96px';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ASSETS, 'document.png'), fullPage: true });
});

test('capture: community documents tab', async ({ page }) => {
  await seed(page);
  await page.goto(`/c/${SLUG}`);
  await page.getByRole('tab', { name: /문서/ }).click();
  await expect(page.getByRole('link', { name: /Code Agent 사용 가이드/ })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ASSETS, 'community.png') });
});

test('capture: condense flow frames (GIF source)', async ({ page }) => {
  await seed(page);
  await page.goto(`/p/${POST_ID}`);
  await expect(page.getByText('두 방식은').first()).toBeVisible();

  let frame = 0;
  const shoot = async (holdFrames = 1) => {
    for (let i = 0; i < holdFrames; i += 1) {
      await page.screenshot({
        path: resolve(FRAMES, `${String(frame).padStart(3, '0')}.png`),
      });
      frame += 1;
    }
  };

  // 1) thread as the user sees it (hold, so the GIF opens on a readable frame)
  await shoot(4);

  // 2) open the overflow menu
  await page.getByRole('button', { name: '게시글 관리' }).click();
  await expect(
    page.getByRole('menuitem', { name: /문서로 정리/ }),
  ).toBeVisible();
  await shoot(3);

  // 3) click condense → the item switches to the busy label
  const clicked = page
    .getByRole('menuitem', { name: /문서로 정리/ })
    .click();
  await page.waitForTimeout(120);
  await shoot(3);
  await clicked;

  // 4) land on the document
  await page.waitForURL(`**/d/${DOC_ID}`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Code Agent 사용 가이드' }),
  ).toBeVisible();
  await shoot(4);

  // 5) scroll through the document body
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 180);
    await page.waitForTimeout(90);
    await shoot(1);
  }
  await shoot(4);
});
