// ============================================================================
// E2E shared helpers (WP XC-T J1/J2/J3).
//
// The single most important helper is mockLlm(): it intercepts the BYOK
// direct browser->LLM call (generativelanguage.googleapis.com) with
// page.route, so the journeys run with a DUMMY key and NEVER hit a real model.
// This is what lets the full "post -> AI reply", "@AI -> reply", and
// "128K -> summary -> summary-based answer" flows run hermetically.
// ============================================================================
import type { Page, Route } from '@playwright/test';

/** The Google Generative Language host the BYOK client calls directly. */
export const LLM_HOST_GLOB = '**generativelanguage.googleapis.com/**';

export interface LlmMockOptions {
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
 * Install a route that fulfills every LLM REST call locally.
 *  - :generateContent  -> { candidates: [{ content: { parts: [{ text }] } }] }
 *  - :countTokens      -> { totalTokens }
 * No real network egress to Google happens; no real key is validated.
 */
export async function mockLlm(page: Page, opts: LlmMockOptions = {}): Promise<void> {
  const { reply = 'MOCKED_AI_REPLY', totalTokens = 10, replyForCall } = opts;
  let generateCalls = 0;

  await page.route(LLM_HOST_GLOB, async (route: Route) => {
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

    // Any other LLM path: succeed empty so nothing leaks to the network.
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/**
 * Log in through the UI. The Login form posts the nickname/username to the Aidit
 * server (real local backend) and stores the DUMMY key locally (L1 — never sent to
 * the server). The key only needs to be non-empty: all LLM calls are mocked.
 *
 * BOTH auth modes are handled, because the form differs by mode and the mode is an
 * operator setting (AUTH_SIGNUP_REQUIRED / VITE_AUTH_SIGNUP_REQUIRED):
 *   - guest (default)  → [게스트] tab, `#nickname`, no password
 *   - signup required  → [로그인] tab, `#username` + `#password`
 * An earlier version filled `#username` unconditionally, so J1–J3 could only pass
 * in signup mode and failed with a 30s "waiting for locator('#username')" timeout
 * on a default stack — a harness bug that read like a product failure.
 */
export async function login(
  page: Page,
  username: string,
  apiKey = 'AIza-DUMMY-E2E-KEY',
  password = 'e2e-pw-12345',
): Promise<void> {
  // Pin the UI language BEFORE the first navigation. langStore derives its
  // first-visit default from navigator.language, and Playwright's browser locale is
  // en-US, so every Korean selector below would miss ('게스트' renders as 'Guest').
  // j4-document.spec.ts pins the same key for the same reason.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'aidit-lang',
      JSON.stringify({ state: { lang: 'ko' }, version: 0 }),
    );
  });

  await page.goto('/login');

  // The [게스트] tab is present in both modes; guest is preselected when signup is
  // not required. Decide by which field the form actually renders.
  const guestTab = page.getByRole('tab', { name: '게스트' });
  await guestTab.waitFor({ state: 'visible', timeout: 20000 });
  await guestTab.click();

  const nickname = page.locator('#nickname');
  const isGuestMode = await nickname
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (isGuestMode) {
    await nickname.fill(username);
    await page.locator('#apiKey').fill(apiKey);
  } else {
    await page.getByRole('tab', { name: '로그인' }).click();
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('#apiKey').fill(apiKey);
  }

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
 * The persisted JWT from the auth store. Direct API seeding must carry it: write
 * routes authenticate with `Authorization: Bearer <token>` and answer 401 without
 * it. `x-user-id` alone used to be enough and no longer is.
 */
export async function getAuthToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('aidit-auth');
    return raw ? (JSON.parse(raw).state?.token ?? '') : '';
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
  const token = await getAuthToken(page);
  const res = await page.request.post(`/api/posts/${postId}/comments`, {
    headers: {
      'x-user-id': userId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      type: 'HUMAN',
      body: '(긴 토론이 쌓였습니다)',
      clientId: uniq('seed-'),
      tokenCount: 200_000,
    },
  });
  if (!res.ok()) throw new Error(`seed failed: ${res.status()} ${await res.text()}`);
}
