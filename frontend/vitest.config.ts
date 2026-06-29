import { defineConfig } from 'vitest/config';

// Dedicated Vitest config (kept separate from vite.config.ts so the PWA/CSP
// build plugins never run during unit tests). jsdom gives us a DOM for the
// sanitize (DOMPurify) and zustand store tests; the engine/contract tests mock
// rest.ts and llm.ts so NO real network/LLM call is ever made.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // The Playwright browser specs live under e2e/ and must NOT be collected by
    // Vitest (they import @playwright/test, a different runner).
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    clearMocks: true,
    restoreMocks: true,
  },
});
