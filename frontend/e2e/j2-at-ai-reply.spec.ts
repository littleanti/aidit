// ============================================================================
// J2 — @AI -> human-first then AI bubble (FR-6.1 / FR-6.2 / AI-7).
//
// CONTRACT under test: when a user posts a comment containing '@AI', the HUMAN
// comment is committed FIRST (human-first ordering), and only AFTER that does
// the AI reply bubble appear. We assert both bubbles are present AND that the
// human bubble is ordered before the AI bubble in the DOM.
//
// Gemini is mocked (page.route), so a DUMMY key is sufficient and no real model
// call is made.
// ============================================================================
import { test, expect } from '@playwright/test';
import { login, mockGemini, uniq } from './helpers';

const HUMAN_TEXT = '@AI what is the answer here?';
const AI_REPLY = 'J2 AI answer to the mention.';

test('J2: @AI comment shows the human bubble first, then the AI reply', async ({ page }) => {
  await mockGemini(page, { reply: AI_REPLY });

  await login(page, uniq('j2user'));

  // Open an existing thread. The scaffold assumes a seeded/most-recent post is
  // reachable from Home; adjust the navigation for your seed (see README).
  await page.goto('/');
  await page.locator('a[href*="/post/"], a[href*="/t/"]').first().click();

  // Type an @AI comment in the Composer and send it.
  const composer = page.getByLabel('댓글 입력');
  await composer.fill(HUMAN_TEXT);
  await page.getByRole('button', { name: '전송' }).click();

  // 1) Human bubble appears (committed first, FR-6.2).
  const humanBubble = page.getByText(HUMAN_TEXT, { exact: false });
  await expect(humanBubble).toBeVisible();

  // 2) AI reply bubble appears AFTER (AI-7 order: human -> PENDING -> reply).
  const aiBubble = page.getByText(AI_REPLY, { exact: false });
  await expect(aiBubble).toBeVisible({ timeout: 15_000 });

  // 3) DOM order: the human comment is positioned before the AI reply. We use
  //    bounding boxes (vertical position) since the thread is a chat column.
  const humanBox = await humanBubble.first().boundingBox();
  const aiBox = await aiBubble.first().boundingBox();
  expect(humanBox, 'human bubble must be laid out').not.toBeNull();
  expect(aiBox, 'AI bubble must be laid out').not.toBeNull();
  if (humanBox && aiBox) {
    expect(humanBox.y).toBeLessThan(aiBox.y);
  }
});
