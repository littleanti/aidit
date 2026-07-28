import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The backend's port is an operator setting (backend/.env → PORT), so it cannot be
// hardcoded here: a machine running the API on 3002 made `npm run e2e` die with
// "Timed out waiting 60000ms from config.webServer" while both servers were
// perfectly healthy — the health probe was simply pointed at the wrong port.
function backendPort(): number {
  if (process.env.AIDIT_E2E_API_PORT) return Number(process.env.AIDIT_E2E_API_PORT);
  // Candidates relative to CWD rather than __dirname: Playwright's config loader
  // does not reliably provide __dirname, and a silent resolve() failure here shows
  // up as an unexplained 60s webServer timeout instead of an error.
  for (const rel of ['../backend/.env', '../../backend/.env', 'backend/.env']) {
    try {
      const env = readFileSync(resolve(process.cwd(), rel), 'utf8');
      const m = env.match(/^\s*PORT\s*=\s*"?(\d+)"?/m);
      if (m) return Number(m[1]);
    } catch {
      // Try the next candidate; a fresh clone has no .env at all.
    }
  }
  return 3001;
}

const API_PORT = backendPort();

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
  // Boot the servers the journeys need, so `npm run e2e` is ONE command instead
  // of "start the backend, start Vite, then run the tests" (which meant the suite
  // silently depended on whatever the developer had running — including stale
  // code). Skipped when AIDIT_E2E_BASE_URL points at an already-running app.
  //
  // reuseExistingServer keeps a LOCAL loop fast, but a pipeline run (AIDIT_PIPELINE=1)
  // refuses to reuse: it must exercise this commit's build, not whatever a
  // developer left running on the port.
  ...(process.env.AIDIT_E2E_BASE_URL
    ? {}
    : {
        webServer: [
          {
            command: 'npm run dev',
            cwd: '..',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.AIDIT_PIPELINE,
            timeout: 60_000,
            // Keep Vite's /api proxy pointed at the port the API actually uses; its
            // own default is 3001 and would 502 every request on a 3002 setup.
            env: { VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
          },
          {
            // dev:once, NOT dev: `tsx watch` launched through Playwright's webServer
            // printed its npm banner and then never bound the port (the run sat in
            // the 60s wait while a directly-spawned instance came up in ~3s). A test
            // harness has no use for a file watcher either — it runs one build.
            command: 'npm run dev:once',
            cwd: '../../backend',
            // 127.0.0.1, NOT localhost: the backend honours HOST (default
            // 127.0.0.1 in backend/.env) and binds IPv4 only, while `localhost`
            // resolves to ::1 first — the probe then gets ECONNREFUSED ::1 for the
            // full 60s even though the server is up and answering on IPv4.
            url: `http://127.0.0.1:${API_PORT}/health`,
            reuseExistingServer: !process.env.AIDIT_PIPELINE,
            timeout: 60_000,
          },
        ],
      }),
  // Single worker keeps the shared backend state deterministic across journeys.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
});
