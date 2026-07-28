import { defineConfig, devices } from '@playwright/test';

// ============================================================================
// WP XC-T (E2E scaffold) — Playwright config for the three core journeys
// J1/J2/J3. These specs MOCK the LLM provider endpoint via page.route on
// generativelanguage.googleapis.com so NO real BYOK key is ever needed and no
// real LLM call is made. They drive a LOCALLY-RUNNING frontend + backend
// (see e2e/README.md for how to start them).
//
// BASE_URL points at the Vite dev server (default http://localhost:5173). It is
// overridable so the same specs can run against a preview/prod build.
// ============================================================================
const BASE_URL = process.env.AIDIT_E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // capture-media.spec.ts is a media generator (README screenshots + GIF frames),
  // not a test. It must never gate `npm run e2e`; run it via `npm run media`.
  testIgnore: '**/capture-media.spec.ts',
  // Mobile-first product (L9: 360–430px). Default to a phone viewport.
  use: {
    baseURL: BASE_URL,
    ...devices['Pixel 7'],
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Single worker keeps the shared backend state deterministic across journeys.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
});
