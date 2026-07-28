# Aidit E2E & measurement (Playwright)

Five journey specs plus three non-test tools (media capture, real-key measurement,
recorded demo). Everything drives a real browser at a mobile viewport (Pixel 7).

```bash
cd frontend
npx playwright install chromium   # once

npm run e2e          # journey specs — boots the backend + Vite itself
npm run media        # regenerate README screenshots + GIF frames
npm run media:gif    # frames -> docs/assets/condense.gif (needs ffmpeg)
npm run measure:keys # real-key token/cost measurement (needs 3 real keys)
```

## Specs

All five specs pass from a cold `npm run e2e` (the real-key one skips unless
`LLM_TEST_KEY` is set); verified 2026-07-28 including the real-key run.

| Spec | Journey | Needs a live stack? |
|------|---------|---------------------|
| `j1-primary-reply.spec.ts` | Post → primary AI reply (FR-4.3 / AI-5) | **Yes** — real backend + DB |
| `j2-at-ai-reply.spec.ts` | `@AI` → human bubble first, then the AI reply (FR-6.2 / AI-7) | **Yes** |
| `j3-summary.spec.ts` | >128K → summary band → summary-based answer (FR-7 / AI-6/8/9) | **Yes** |
| `j4-document.spec.ts` | **FR-13** 문서 응결 (4 cases) + **FR-14** 문서 재투입 (2 cases) | **No — hermetic** |
| `real-key-byok.spec.ts` | BYOK with a REAL key: key-blind server + direct provider call | **Yes** + a real key |

`j4-document.spec.ts` stubs the Aidit REST API in addition to the LLM host, so it
needs only the dev server — no backend, no DB, no key. That is why it is the spec
used to verify the document features in a constrained environment.

## Server startup is automatic

`playwright.config.ts` declares a `webServer` pair (Vite on 5173, backend on
`/health`), so `npm run e2e` is one command instead of "start two servers first"
(which silently made the suite depend on whatever a developer had running).

Three things the config has to get right, each of which broke the self-boot path
once (all three surfaced as the same useless message — `Timed out waiting 60000ms
from config.webServer` — while both servers were healthy):

- **The backend port is derived from `backend/.env` (`PORT`)**, not hardcoded. A
  machine running the API on 3002 got a health probe aimed at 3001 forever.
  Override with `AIDIT_E2E_API_PORT`. Vite's `/api` proxy target is injected from
  the same value.
- **`127.0.0.1`, never `localhost`.** The backend honours `HOST` (default
  `127.0.0.1`) and binds IPv4 only, while `localhost` resolves to `::1` first — the
  probe collects `ECONNREFUSED ::1` for the full timeout. `curl` hides this by
  falling back to IPv4.
- **`npm run dev:once`, not `npm run dev`.** `tsx watch` launched through
  `webServer` printed its npm banner and never bound the port; a directly spawned
  instance was up in ~3s. A harness has no use for a file watcher.

Two escape hatches:

- `AIDIT_E2E_BASE_URL=http://localhost:5190` — run against an already-running app
  and skip startup entirely (what the hermetic specs use here).
- `AIDIT_PIPELINE=1` — refuse to reuse a server that is already listening: a
  pipeline must exercise *this commit's* build. `deploy/pipeline.sh --with-e2e`
  sets it.

## Two things every spec must handle

- **Auth mode.** The login form differs by operator setting: guest (default) renders
  `#nickname` with no password, signup mode renders `#username` + `#password`.
  `helpers.ts → login()` detects and handles both — an earlier version filled
  `#username` unconditionally, so J1–J3 could only pass in signup mode.
- **UI language.** `langStore` derives its first-visit default from
  `navigator.language`, and Playwright's locale is en-US, so Korean selectors miss
  ('게스트' renders as 'Guest'). `login()` and `j4-document.spec.ts` both pin
  `localStorage('aidit-lang')` to `ko` before the first navigation.

Direct API seeding (e.g. `seedOverThreshold`) must send
`Authorization: Bearer <token>` from the auth store — `x-user-id` alone returns 401.

## The LLM mock (key-blind, no real key)

`helpers.ts → mockLlm(page)` routes `**generativelanguage.googleapis.com/**`:

- `:generateContent` → `{ candidates: [{ content: { parts: [{ text }] } }] }`
- `:countTokens` → `{ totalTokens }`

The BYOK browser→provider call is intercepted in-page, so a **dummy key**
(`AIza-DUMMY-E2E-KEY`) entered at login is enough; it stays local (L1) and never
reaches the Aidit server. J3 uses `replyForCall` to return the **summary** on call
#0 and the **summary-based answer** on call #1.

`j4-document.spec.ts` handles the LLM host itself (recording + fulfilling in ONE
handler) because Playwright runs routes last-registered-first, so a separate
recorder would be shadowed by `mockLlm`.

`real-key-byok.spec.ts` is the deliberate exception: a real key, no mock, proving
the un-mocked path.

## Non-test tools

### `capture-media.spec.ts` — README images

Stubs REST + LLM and photographs the real UI, so the output is identical on every
run and a UI change surfaces as an image diff. It has its **own config**
(`playwright.media.config.ts`) and is excluded from the main config via
`testIgnore` — regenerating media must never gate the test suite.

Two things it fakes carefully, both learned the hard way:

- **EventSource is stubbed open.** A `page.route`-fulfilled SSE response is a
  *complete* body, so the real EventSource opens then immediately hits EOF — and
  the "연결이 끊겼습니다" banner ends up in every screenshot of a working app.
- **An AI bubble is `authorId === null`.** A stub helper written as
  `authorId: null ?? 'user-x'` swallowed the null and rendered the AI answer as a
  human message.

### `measure-real-keys.mjs` — token/cost measurement

Drives three browser contexts with three **real** keys through the whole loop
(community → post + primary reply → 9-turn discussion → condense → the same
question with and without an attached document) and records the provider's own
`usageMetadata` per call, grouped by call kind.

- **Observation only** (`page.on('request'|'response')`), never interception:
  proxying the per-post SSE stream would buffer an infinite response and hang the
  thread view.
- Waits on **observed LLM completions**, not DOM text. Counting `[AI]` in the DOM
  is wrong — the Composer's active AI chip renders the same token, so the wait
  returns before the call finishes and the next `reload` aborts it (that bug lost
  two calls in an early run).
- Also asserts the security claim on live traffic: no request to the Aidit server
  may contain a key, in body, query, or headers.
- Keys come from `DEMO_KEY_A/B/C` and are **never** written to the output JSON or
  the logs; totals are keyed by nickname.

Measured results are published in the root README ("성능 실측 C").

### `demo-scenario.mjs` — recorded demo

Three tiled windows + ffmpeg screen capture, per `docs/DEMO_SCENARIO.md`. Not a
test; it exists to produce the demo video.
