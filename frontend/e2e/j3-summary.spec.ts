// ============================================================================
// J3 — >128K -> color-distinct summary bubble -> summary-based answer
//        (FR-7 / AI-6 / AI-8 / AI-9).
//
// When the active segment crosses the 128K product threshold (GET /context
// reports summaryNeeded), the next @AI caller (L3 lazy, key-blind server) must:
//   1. generate an AI_SUMMARY with its (mocked) key and open a NEW segment,
//   2. render that summary as a COLOR-DISTINCT full-width band (SummaryBubble:
//      role="separator", aria-label "대화 요약 경계", amber->purple gradient),
//   3. answer the new question from (summary opening turn + bubbles after) —
//      the summary-based answer (AI-9 reassembly).
//
// We seed the over-threshold state by posting a comment with a large tokenCount
// (helpers.seedOverThreshold), then mock the LLM provider so call #0 returns
// the SUMMARY and call #1 returns the summary-based ANSWER.
// ============================================================================
import { test, expect } from '@playwright/test';
import {
  login,
  mockLlm,
  uniq,
  createCommunityAndPost,
  seedOverThreshold,
} from './helpers';

const SUMMARY_TEXT = 'J3 condensed summary of the discussion so far.';
const ANSWER_TEXT = 'J3 answer derived from the summary baseline.';
const HUMAN_TEXT = '@AI 위 내용을 토대로 결론이 뭐야?';

test('J3: crossing 128K renders a distinct summary band then a summary-based answer', async ({
  page,
}) => {
  // call #0 = the AI_SUMMARY; call #1 = the summary-based @AI answer (AI-9).
  await mockLlm(page, {
    replyForCall: (i) => (i === 0 ? SUMMARY_TEXT : ANSWER_TEXT),
    totalTokens: 200_000,
  });

  await login(page, uniq('j3user'));

  // Own community + post, primary AI off, then push the active segment over 128K.
  const postId = await createCommunityAndPost(page, { primaryAi: false });
  await seedOverThreshold(page, postId);

  // Send an @AI comment — the trigger that performs the lazy summary FIRST
  // (AI-8) and then answers from the reassembled context (AI-9).
  const composer = page.getByLabel('댓글 입력');
  await composer.fill(HUMAN_TEXT);
  await page.getByRole('button', { name: '전송' }).click();

  // 1) The summary band appears and is COLOR-DISTINCT (SummaryBubble:
  //    role="separator", aria-label "대화 요약 경계", gradient utility class).
  const summaryBand = page.getByRole('separator', { name: '대화 요약 경계' });
  await expect(summaryBand).toBeVisible({ timeout: 15_000 });
  await expect(summaryBand.getByText(SUMMARY_TEXT, { exact: false })).toBeVisible();
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
