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
