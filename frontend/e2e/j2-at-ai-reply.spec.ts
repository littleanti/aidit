// ============================================================================
// J2 — @AI -> human-first then AI bubble (FR-6.1 / FR-6.2 / AI-7).
//
// CONTRACT under test: when a user posts a comment containing '@AI', the HUMAN
// comment is committed FIRST (human-first ordering), and only AFTER that does
// the AI reply bubble appear. We assert both bubbles are present AND that the
// human bubble is ordered before the AI bubble in the chat column.
//
// The LLM provider is mocked (page.route), so a DUMMY key suffices and no real
// model call is made.
// ============================================================================
import { test, expect } from '@playwright/test';
import { login, mockLlm, uniq, createCommunityAndPost } from './helpers';

const HUMAN_TEXT = '@AI 이 토론의 핵심이 뭐야?';
const AI_REPLY = 'J2 AI answer to the mention.';

test('J2: @AI comment shows the human bubble first, then the AI reply', async ({ page }) => {
  await mockLlm(page, { reply: AI_REPLY });

  await login(page, uniq('j2user'));

  // Own community + post (primary AI off so the only AI bubble is the @AI reply).
  await createCommunityAndPost(page, { primaryAi: false });

  // Type an @AI comment in the Composer and send it.
  const composer = page.getByLabel('댓글 입력');
  await composer.fill(HUMAN_TEXT);
  await page.getByRole('button', { name: '전송' }).click();

  // 1) Human bubble appears (committed first, FR-6.2).
  //
  // Scoped to the bubble's <p>, NOT getByText over the page: the Composer clears
  // its textarea only after the POST resolves (Composer 6.1.6), while the
  // optimistic bubble renders immediately — so for a moment the same text lives in
  // BOTH the bubble and the textarea, and an unscoped getByText fails strict mode.
  const humanBubble = page.getByRole('paragraph').filter({ hasText: HUMAN_TEXT });
  await expect(humanBubble.first()).toBeVisible();

  // 2) AI reply bubble appears AFTER (AI-7 order: human -> PENDING -> reply).
  const aiBubble = page.getByText(AI_REPLY, { exact: false });
  await expect(aiBubble).toBeVisible({ timeout: 15_000 });

  // 3) Chat-column order: the human comment sits above the AI reply.
  const humanBox = await humanBubble.first().boundingBox();
  const aiBox = await aiBubble.first().boundingBox();
  expect(humanBox, 'human bubble must be laid out').not.toBeNull();
  expect(aiBox, 'AI bubble must be laid out').not.toBeNull();
  if (humanBox && aiBox) {
    expect(humanBox.y).toBeLessThan(aiBox.y);
  }
});
