// ============================================================================
// J1 — post -> primary AI reply (FR-4.3 / AI-5).
//
// A logged-in author creates a community + post with the "1차 AI 답변 받기"
// toggle ON. On entering the thread the engine fires the PRIMARY reply with the
// author's (mocked) key; the thread should then show an AI reply bubble whose
// text is exactly what our LLM mock returned.
//
// The LLM provider is mocked via page.route on generativelanguage.googleapis.com,
// so this runs with a DUMMY key and never calls a real model. Boot a local
// frontend + backend first (see e2e/README.md).
// ============================================================================
import { test, expect } from '@playwright/test';
import { login, mockLlm, uniq, createCommunityAndPost } from './helpers';

const AI_REPLY = 'J1 primary AI reply from the persona.';

test('J1: creating a post triggers a primary AI reply bubble', async ({ page }) => {
  await mockLlm(page, { reply: AI_REPLY });

  await login(page, uniq('j1user'));

  // Create a community + post with the primary-AI toggle ON (FR-4.3).
  await createCommunityAndPost(page, { primaryAi: true });

  // The primary AI reply (AI_REPLY) appears as a bubble in the thread.
  // It starts PENDING (typing indicator) then resolves to COMPLETE with text.
  await expect(page.getByText(AI_REPLY)).toBeVisible({ timeout: 15_000 });
});
