# Aidit E2E (Playwright) — J1 / J2 / J3

End-to-end **scaffold** for the three core product journeys. These specs drive a
**locally running** Aidit backend + frontend in a real (mobile-viewport)
browser, and **mock the LLM provider endpoint** so no real Google API key is needed
and no real LLM call is ever made.

| Spec | Journey | Asserts |
|------|---------|---------|
| `j1-primary-reply.spec.ts` | Post → primary AI reply (FR-4.3 / AI-5) | After creating a post, the primary AI reply bubble (mocked text) appears in the thread. |
| `j2-at-ai-reply.spec.ts` | `@AI` → human-first then AI bubble (FR-6.2 / AI-7) | The human `@AI` comment is committed **first**, then the AI reply bubble appears **below** it. |
| `j3-summary.spec.ts` | >128K → color-distinct summary band → summary-based answer (FR-7 / AI-6/8/9) | A `role="separator"` summary band (amber→purple gradient) renders, then a summary-based answer appears below it. |

## Why these are a scaffold (not part of the green gate)

Running a full browser E2E here is heavy and flaky, so **the milestone's automated
green gate is the Vitest unit/contract/integration suite** (`npm test` in
`frontend/`), which already covers the same engine contracts (XC-4, AI-6/7/8/9,
sanitize, store dedupe) hermetically. These Playwright specs are written,
type-clean, and documented so they can be run on demand against a live stack.

## How the LLM mock works (key-blind, no real key)

`helpers.ts → mockLlm(page)` installs `page.route('**generativelanguage.googleapis.com/**')`:

- `:generateContent` → `{ candidates: [{ content: { parts: [{ text }] } }] }`
- `:countTokens` → `{ totalTokens }`

So the BYOK browser→LLM provider call is intercepted in-page. A **dummy key**
(`AIza-DUMMY-E2E-KEY`) is entered at login; it is stored locally only (L1) and
never sent to the Aidit server. J3 uses `replyForCall` to return the **summary**
on call #0 and the **summary-based answer** on call #1.

## Prerequisites

```bash
# from repo root — install Playwright browsers once
cd frontend
npx playwright install chromium
```

## Running

1. **Start the backend** (Fastify, port 3001) from `server/`:
   ```bash
   cd server
   npm run dev            # or: npm run build && npm start
   ```
2. **Start the frontend** (Vite dev server, port 5173) from `frontend/`:
   ```bash
   cd frontend
   npm run dev
   ```
   The dev server proxies `/api → http://localhost:3001` (strips `^/api`).
3. **Run the specs** from `frontend/`:
   ```bash
   npm run e2e            # = playwright test --config e2e/playwright.config.ts
   ```
   Override the target with `AIDIT_E2E_BASE_URL` (e.g. a `vite preview` build).

## Fixture / seed assumptions

These specs use accessible, text-based locators with fallbacks, but they assume
some seeded state. Adjust the navigation/selectors to your local seed:

- **J1** navigates to `/create-post`. If post creation is gated behind selecting
  a community in your build, create/select a community first.
- **J2** opens the most-recent post via the first `a[href*="/post/"]` link on
  Home. Seed at least one post (any community) before running.
- **J3** needs a thread whose **active segment is already over the 128K
  threshold** so the server's `GET /posts/:id/context` returns
  `summaryNeeded: true`. Seed a post whose active `ContextSegment.tokenSum >
  128_000` (e.g. via a seed script that inserts comments with large
  `tokenCount`s, or by lowering the threshold in a test build). Without this
  fixture J3 will not trigger the lazy-summary branch.

## Selector contract (documented assumptions)

- Login: `#username`, `#apiKey`, button `시작하기`.
- Composer: textarea `aria-label="댓글 입력"`, send button `aria-label="전송"`.
- Summary band: `role="separator"`, `aria-label="대화 요약 경계"`, gradient class
  `.bg-gradient-to-r` (color-distinctness).
- Create-post form: title field labelled `제목/title`, body labelled
  `내용/본문/body`, submit button matching `작성|등록|게시|create|post`. If your
  form uses different labels, update `j1-primary-reply.spec.ts`.

## Type-checking the specs

The specs are excluded from the app build (`frontend/tsconfig.json` includes only
`src`) and from Vitest collection (`vitest.config.ts` excludes `e2e/**`). To
type-check them in isolation:

```bash
cd frontend
npx tsc --noEmit --project e2e/tsconfig.json
```
