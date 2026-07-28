import { defineConfig, devices } from '@playwright/test';

// Config for the README media generator (capture-media.spec.ts).
//
// It lives in its own config because the main config's `testIgnore` excludes the
// capture spec — a media refresh must never gate `npm run e2e`, and Playwright
// applies testIgnore even to an explicitly named file.
//
// Fixed viewport + deviceScaleFactor so regenerated screenshots are the same
// size as the committed ones (a UI diff shows up as an image diff, not a resize).
const BASE_URL = process.env.AIDIT_E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: '.',
  testMatch: '**/capture-media.spec.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Pixel 7'],
    // Crisper README images than the device default.
    deviceScaleFactor: 2,
  },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
