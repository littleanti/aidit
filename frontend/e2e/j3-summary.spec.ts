// ============================================================================
// J3 — >128K -> color-distinct summary bubble -> summary-based answer
//        (FR-7 / AI-6 / AI-8 / AI-9).
//
// When the active segment crosses the 128K product threshold (the server's GET
// /context reports summaryNeeded), the next @AI caller (L3 lazy, key-blind
// server) must:
//   1. generate an AI_SUMMARY with its (mocked) key and open a NEW segment,
//   2. render that summary as a COLOR-DISTINCT full-width band (SummaryBubble:
//      role="separator", aria-label "대화 요약 경계", amber->purple gradient),
//   3. answer the new question from (summary opening turn + bubbles after) —
//      i.e. the summary-based answer (AI-9 reassembly).
//
// We mock Gemini so call #0 returns the SUMMARY and call #1 returns the
// summary-based ANSWER. Reaching summaryNeeded requires a thread already over
// the threshold; see README for how to seed that fixture state.
// ============================================================================
import { test, expect } from '@playwright/test';
import { login, mockGemini, uniq } from './helpers';

const SUMMARY_TEXT = 'J3 condensed summary of the discussion so far.';
const ANSWER_TEXT = 'J3 answer derived from the summary baseline.';
const HUMAN_TEXT = '@AI given everything above, what should we do?';

test('J3: crossing 128K renders a distinct summary band then a summary-based answer', async ({
  page,
}) => {
  // call #0 = the AI_SUMMARY; call #1 = the summary-based @AI answer (AI-9).
  await mockGemini(page, {
    replyForCall: (i) => (i === 0 ? SUMMARY_TEXT : ANSWER_TEXT),
    // a large token count nudges any client-side threshold checks past 128K.
    totalTokens: 200_000,
  });

  await login(page, uniq('j3user'));

  // Open the OVER-THRESHOLD thread fixture (summaryNeeded === true). The seed
  // for this state is documented in README (a post whose active segment
  // tokenSum > 128_000). Navigate to it here.
  await page.goto('/');
  await page.locator('a[href*="/post/"], a[href*="/t/"]').first().click();

  // Send an @AI comment — this is the trigger that performs the lazy summary
  // FIRST (AI-8) and then answers (AI-9).
  const composer = page.getByLabel('댓글 입력');
  await composer.fill(HUMAN_TEXT);
  await page.getByRole('button', { name: '전송' }).click();

  // 1) The summary band appears and is COLOR-DISTINCT: SummaryBubble renders a
  //    role="separator" with aria-label "대화 요약 경계" and the gradient band.
  const summaryBand = page.getByRole('separator', { name: '대화 요약 경계' });
  await expect(summaryBand).toBeVisible({ timeout: 15_000 });
  await expect(summaryBand.getByText(SUMMARY_TEXT, { exact: false })).toBeVisible();
  // visual distinctness assertion: the band carries the gradient utility class.
  await expect(summaryBand.locator('.bg-gradient-to-r').first()).toBeVisible();

  // 2) The summary-based ANSWER appears (built from summary + after, AI-9) and
  //    is positioned BELOW the summary boundary.
  const answer = page.getByText(ANSWER_TEXT, { exact: false });
  await expect(answer).toBeVisible({ timeout: 15_000 });

  const bandBox = await summaryBand.boundingBox();
  const answerBox = await answer.first().boundingBox();
  if (bandBox && answerBox) {
    expect(answerBox.y).toBeGreaterThan(bandBox.y);
  }
});
