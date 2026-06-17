import { test, expect, type Request } from '@playwright/test';

// ============================================================================
// REAL-KEY BYOK end-to-end check (opt-in; NOT part of the mocked CI suite).
//
// Unlike j1/j2/j3 (which mock Gemini), this spec drives the full journey
// against a REAL Google Gemini call using a key supplied via env:
//   GEMINI_TEST_KEY=<key> npx playwright test real-key-byok --config e2e/playwright.config.ts
// It is skipped automatically when GEMINI_TEST_KEY is absent, so it never runs
// in CI and the key is never stored in the repo.
//
// Asserts the core BYOK invariants on a live system:
//  1) the Aidit server (/api/*) NEVER receives the key (key-blind, L1)
//  2) a request goes DIRECTLY to generativelanguage.googleapis.com (BYOK)
//  3) the @AI flow yields a COMPLETE AI_REPLY bubble (human-first → reply)
// ============================================================================

const KEY = process.env.GEMINI_TEST_KEY;
const stamp = Date.now();
const SLUG = `cook-pw-${stamp}`;

test.skip(!KEY, 'GEMINI_TEST_KEY not set — skipping real-key BYOK check');

test('BYOK @AI flow: key-blind server + direct Google call + COMPLETE reply', async ({
  page,
}) => {
  const apiRequests: Request[] = [];
  let googleCallSeen = false;
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/')) apiRequests.push(req);
    if (url.includes('generativelanguage.googleapis.com')) googleCallSeen = true;
  });

  // --- Login (username + key; key persists to localStorage only) -----------
  await page.goto('/login');
  await page.getByPlaceholder('닉네임').fill('pw-tester');
  await page.getByPlaceholder('AIza...').fill(KEY!);
  await page.getByRole('button', { name: '시작하기' }).click();
  await expect(page).toHaveURL(/\/$/);

  // --- Create a community with a cooking persona ---------------------------
  await page.goto('/create-community');
  await page.getByPlaceholder('예) 집밥 레시피').fill('PW 요리방');
  await page.getByPlaceholder('home-cooking').fill(SLUG);
  await page
    .getByPlaceholder('이 커뮤니티가 어떤 곳인지 한 줄로 소개해 보세요.')
    .fill('Playwright BYOK 검증용 커뮤니티');
  await page
    .getByPlaceholder(/당신은 친절한 요리 전문가/)
    .fill(
      '당신은 친절한 3분 요리 셰프입니다. 항상 한국어로 단계별로 간결하게 설명하세요.',
    );
  await page.getByRole('button', { name: '커뮤니티 만들기' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${SLUG}`));

  // --- Create a post (with the "1차 AI 답변 받기" toggle as-is) -------------
  await page.goto(`/c/${SLUG}/create-post`);
  await page.getByPlaceholder('제목을 입력하세요').fill('계란 요리 추천');
  await page
    .getByPlaceholder('내용을 입력하세요')
    .fill('계란이랑 소금만 있어요. 간단한 거 추천해 주세요.');
  await page.getByRole('button', { name: '게시하기' }).click();
  await expect(page).toHaveURL(/\/p\/.+/);
  const postId = page.url().split('/p/')[1];

  // --- Post an @AI comment -> human-first bubble, then AI reply ------------
  const composer = page.getByRole('textbox', { name: '댓글 입력' });
  await composer.fill('@AI 계란 스크램블 3단계로 알려줘');
  await page.getByRole('button', { name: '전송' }).click();

  // Human bubble appears immediately (optimistic, right side).
  await expect(page.getByText('@AI 계란 스크램블 3단계로 알려줘')).toBeVisible();

  // --- Wait for the AI_REPLY to reach COMPLETE on the server ---------------
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/posts/${postId}/comments`);
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.items ?? []);
        const ai = items.find(
          (c: { type: string; status: string; body: string }) =>
            c.type === 'AI_REPLY' && c.status === 'COMPLETE',
        );
        return ai?.body?.length ?? 0;
      },
      { timeout: 25_000, intervals: [1000] },
    )
    .toBeGreaterThan(10);

  // The AI bubble renders in the thread (persona/AI badge present).
  await expect(page.getByText('AI', { exact: true }).first()).toBeVisible();

  // --- Invariants ----------------------------------------------------------
  // (2) A direct browser->Google call happened.
  expect(googleCallSeen, 'a direct generativelanguage.googleapis.com call should occur').toBe(true);

  // (1) The Aidit server NEVER received the key (URL, headers, or body).
  for (const req of apiRequests) {
    expect(req.url(), 'key must not appear in any /api URL').not.toContain(KEY!);
    const headerBlob = JSON.stringify(req.headers());
    expect(headerBlob, 'key must not appear in any /api header').not.toContain(KEY!);
    const post = req.postData() ?? '';
    expect(post, 'key must not appear in any /api request body').not.toContain(KEY!);
  }
});
