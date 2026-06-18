// ============================================================================
// E2E shared helpers (WP XC-T J1/J2/J3).
//
// The single most important helper is mockGemini(): it intercepts the BYOK
// direct browser->Gemini call (generativelanguage.googleapis.com) with
// page.route, so the journeys run with a DUMMY key and NEVER hit a real model.
// This is what lets the full "post -> AI reply", "@AI -> reply", and
// "128K -> summary -> summary-based answer" flows run hermetically.
// ============================================================================
import type { Page, Route } from '@playwright/test';

/** The Google Generative Language host the BYOK client calls directly. */
export const GEMINI_HOST_GLOB = '**generativelanguage.googleapis.com/**';

export interface GeminiMockOptions {
  /** Text returned for a :generateContent call (the AI reply / summary body). */
  reply?: string;
  /** totalTokens returned for a :countTokens call. */
  totalTokens?: number;
  /**
   * Optional per-call override. Receives the call index (0-based, across BOTH
   * generateContent calls) and returns the reply text for that call. Lets J3
   * return a summary on call #0 and the summary-based answer on call #1.
   */
  replyForCall?: (index: number) => string;
}

/**
 * Install a route that fulfills every Gemini REST call locally.
 *  - :generateContent  -> { candidates: [{ content: { parts: [{ text }] } }] }
 *  - :countTokens      -> { totalTokens }
 * No real network egress to Google happens; no real key is validated.
 */
export async function mockGemini(page: Page, opts: GeminiMockOptions = {}): Promise<void> {
  const { reply = 'MOCKED_AI_REPLY', totalTokens = 10, replyForCall } = opts;
  let generateCalls = 0;

  await page.route(GEMINI_HOST_GLOB, async (route: Route) => {
    const url = route.request().url();

    if (url.includes(':generateContent')) {
      const idx = generateCalls++;
      const text = replyForCall ? replyForCall(idx) : reply;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
        }),
      });
      return;
    }

    if (url.includes(':countTokens')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalTokens }),
      });
      return;
    }

    // Any other Gemini path: succeed empty so nothing leaks to the network.
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/**
 * Log in through the UI. The Login form posts the username to the Aidit server
 * (real local backend) and stores the DUMMY key locally (L1 — never sent to the
 * server). The key only needs to be non-empty: all Gemini calls are mocked.
 */
export async function login(
  page: Page,
  username: string,
  apiKey = 'AIza-DUMMY-E2E-KEY',
): Promise<void> {
  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#apiKey').fill(apiKey);
  await page.getByRole('button', { name: '시작하기' }).click();
  // Login navigates to '/' on success.
  await page.waitForURL('**/');
}

/** Unique-ish suffix so repeated runs don't collide on unique usernames/slugs. */
export function uniq(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** The persisted User.id from the auth store (localStorage), for direct API seeding. */
export async function getUserId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('aidit-auth');
    return raw ? (JSON.parse(raw).state?.userId ?? '') : '';
  });
}

/**
 * Drive the real UI to create a community + a post, returning the new postId.
 * primaryAi=false unchecks the "1차 AI 답변 받기" toggle so only explicit @AI
 * calls produce AI bubbles (keeps J2/J3 assertions unambiguous).
 */
export async function createCommunityAndPost(
  page: Page,
  opts: { primaryAi?: boolean } = {},
): Promise<string> {
  const slug = uniq('e2e-c-');
  // Community NAME is now unique (server returns 409 DUPLICATE_NAME on a
  // duplicate), so each call must use a fresh name or J1/J2/J3 would collide.
  const name = uniq('E2E 커뮤니티 ');
  await page.goto('/create-community');
  await page.getByPlaceholder('예) 집밥 레시피').fill(name);
  await page.getByPlaceholder('home-cooking').fill(slug);
  await page
    .getByPlaceholder(/당신은 친절한 요리 전문가/)
    .fill('당신은 친절한 셰프입니다. 항상 한국어로 간결하게 답하세요.');
  await page.getByRole('button', { name: '커뮤니티 만들기' }).click();
  await page.waitForURL(new RegExp(`/c/${slug}`));

  await page.goto(`/c/${slug}/create-post`);
  await page.getByPlaceholder('제목을 입력하세요').fill('E2E 제목');
  await page.getByPlaceholder('내용을 입력하세요').fill('E2E 본문 — 답을 들려주세요.');
  const toggle = page.getByRole('checkbox');
  if ((await toggle.count()) > 0) {
    const on = await toggle.isChecked();
    if (opts.primaryAi && !on) await toggle.check();
    if (!opts.primaryAi && on) await toggle.uncheck();
  }
  await page.getByRole('button', { name: '게시하기' }).click();
  await page.waitForURL(/\/p\/.+/);
  return page.url().split('/p/')[1];
}

/**
 * Push the post's active segment over the 128K product threshold by posting a
 * comment with a large tokenCount directly via the API (key-blind: x-user-id
 * only). After this, GET /context reports summaryNeeded === true.
 */
export async function seedOverThreshold(page: Page, postId: string): Promise<void> {
  const userId = await getUserId(page);
  const res = await page.request.post(`/api/posts/${postId}/comments`, {
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    data: {
      type: 'HUMAN',
      body: '(긴 토론이 쌓였습니다)',
      clientId: uniq('seed-'),
      tokenCount: 200_000,
    },
  });
  if (!res.ok()) throw new Error(`seed failed: ${res.status()} ${await res.text()}`);
}
