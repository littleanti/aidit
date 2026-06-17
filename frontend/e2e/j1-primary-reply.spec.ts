// ============================================================================
// J1 — post -> primary AI reply (FR-4.3 / AI-5).
//
// A logged-in author creates a post; right after creation the engine fires the
// PRIMARY reply with the author's (mocked) key. The thread should then show an
// AI reply bubble whose text is exactly what our Gemini mock returned.
//
// Gemini is mocked via page.route on generativelanguage.googleapis.com, so this
// runs with a DUMMY key and never calls a real model. See e2e/README.md for how
// to boot the local server + frontend this drives.
// ============================================================================
import { test, expect } from '@playwright/test';
import { login, mockGemini, uniq } from './helpers';

const AI_REPLY = 'J1 primary AI reply from the persona.';

test('J1: creating a post triggers a primary AI reply bubble', async ({ page }) => {
  await mockGemini(page, { reply: AI_REPLY });

  await login(page, uniq('j1user'));

  // Navigate to post creation. (Selector resilience: the scaffold targets the
  // create-post route directly; adjust if the UI gates it behind a community.)
  await page.goto('/create-post');

  // Fill the post form. These fields are documented assumptions (see README);
  // the spec uses accessible/labelled selectors with text fallbacks.
  const title = page.getByLabel(/제목|title/i).first();
  const body = page.getByLabel(/내용|본문|body/i).first();
  await title.fill('J1 E2E post title');
  await body.fill('J1 E2E post body — please reply.');

  // Submit creates the post and routes to the thread (/post/:id or /t/:id).
  await page.getByRole('button', { name: /작성|등록|게시|create|post/i }).click();

  // The primary AI reply (AI_REPLY) should appear as a bubble in the thread.
  // It starts PENDING (typing indicator) then resolves to COMPLETE with text.
  await expect(page.getByText(AI_REPLY)).toBeVisible({ timeout: 15_000 });
});
