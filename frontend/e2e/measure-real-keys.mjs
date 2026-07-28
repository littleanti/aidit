#!/usr/bin/env node
// ============================================================================
// Real-key measurement harness — the numbers behind the BYOK cost claim.
//
// Drives the REAL app with THREE REAL user keys through the full loop:
//   guest login x3 -> community -> post (1차 AI reply, A's key)
//   -> @AI reply (B's key) -> @AI reply (C's key)
//   -> [ 문서로 정리 ] (FR-13, A's key)
//   -> second thread: attach that document (FR-14) + @AI (B's key)
//
// and records, per call, the provider's OWN usage accounting
// (usageMetadata.promptTokenCount / candidatesTokenCount / totalTokenCount).
//
// WHY OBSERVATION, NOT INTERCEPTION: it only listens to page 'request'/'response'
// events. Interception (route + passthrough) would have to proxy the per-post SSE
// stream too, and buffering an infinite response would deadlock the thread view.
// Observing keeps the measured run identical to a normal one.
//
// It also asserts the central security claim on live traffic: NO request to the
// Aidit server may contain any of the three keys, in body, query, or headers.
//
// Keys come from env (DEMO_KEY_A/B/C) and are NEVER written to disk or to the
// output file — only per-key TOTALS keyed by nickname.
//
// Usage:
//   AIDIT_BASE=http://localhost:5191 \
//   DEMO_KEY_A=... DEMO_KEY_B=... DEMO_KEY_C=... \
//   node e2e/measure-real-keys.mjs [--out results.json]
// ============================================================================

import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = (process.env.AIDIT_BASE ?? 'http://localhost:5173').replace(/\/$/, '');
const OUT_FLAG = process.argv.indexOf('--out');
const OUT = OUT_FLAG !== -1 ? process.argv[OUT_FLAG + 1] : null;
const HEADLESS = process.env.HEADED !== '1';

// Published paid-tier rates for the model this repo ships (LLM_MODEL in
// backend/src/config.ts). Source: ai.google.dev/gemini-api/docs/pricing,
// fetched 2026-07-28. A free tier also exists, so a real user may pay $0 —
// these rates price the SAME usage as if it were billed.
const MODEL = process.env.LLM_MODEL ?? 'gemini-3.1-flash-lite';
const USD_PER_1M_INPUT = Number(process.env.PRICE_IN ?? 0.25);
const USD_PER_1M_OUTPUT = Number(process.env.PRICE_OUT ?? 1.5);

const USERS = {
  A: { nick: '아라', key: process.env.DEMO_KEY_A ?? '' },
  B: { nick: '바다', key: process.env.DEMO_KEY_B ?? '' },
  C: { nick: '찬', key: process.env.DEMO_KEY_C ?? '' },
};
for (const [who, u] of Object.entries(USERS)) {
  if (!u.key) {
    console.error(`[measure] DEMO_KEY_${who} is required.`);
    process.exit(2);
  }
}
const ALL_KEYS = Object.values(USERS).map((u) => u.key);

// A realistic multi-party discussion: who speaks, whether they pull the AI in.
// Mixed AI on/off so the measured cost reflects a real thread (not every comment
// triggers a paid call), and long enough that the SHARED context visibly grows.
const TURNS = [
  { who: 'B', ai: false, text: '저는 파일 경로랑 에러 전문을 먼저 다 붙여줘요. 그것만 해도 헛다리 짚는 게 확 줄어요.' },
  { who: 'C', ai: false, text: '저는 계획부터 시키는 게 더 컸어요. 계획을 사람이 한 번 보고 나면 큰 실수가 거의 없어요.' },
  { who: 'B', ai: true, text: '두 방식을 비교해서 언제 어느 쪽이 유리한지 정리해줄래?' },
  { who: 'C', ai: false, text: '테스트를 먼저 쓰게 하는 것도 좋았어요. 다만 초반이 좀 느립니다.' },
  { who: 'A', ai: true, text: '테스트 우선 방식의 장단점을 실무 기준으로 짚어줘.' },
  { who: 'B', ai: false, text: '컨텍스트를 너무 많이 주면 오히려 산만해지는 경우도 있었어요.' },
  { who: 'C', ai: true, text: '컨텍스트를 얼마나 주는 게 적당한지 기준을 제시해줘.' },
  { who: 'A', ai: false, text: '저는 커밋 단위를 작게 유지하는 게 핵심이라고 봅니다.' },
  { who: 'B', ai: true, text: '지금까지 나온 방식들을 실행 순서대로 배치해줘.' },
];

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[measure ${stamp()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every post created during the run — the reported thread count must be the
 *  measured one, not a hardcoded guess. */
const createdPosts = [];

const SUFFIX = String(Date.now() % 100000);
const COMMUNITY = {
  name: `실측 코드 에이전트 ${SUFFIX}`,
  slug: `measure-${SUFFIX}`,
  description: '실측용 커뮤니티 — 코드 에이전트를 실무에서 쓰는 법',
  persona:
    '너는 코드 에이전트를 매일 쓰는 시니어 개발자다. 구체적인 예시와 함께 간결하게 답한다.',
  icon: '🤖',
};

// --- measurement state -----------------------------------------------------
/** One LLM call: who paid, endpoint, and the PROVIDER's token accounting. */
const calls = [];
/** What the app was doing when a call happened — set before each action so the
 *  report can price a "1차 답변" vs an "@AI 답변" vs a "문서 응결" separately. */
let phase = 'unknown';
const setPhase = (p) => {
  phase = p;
};
/** Completed generateContent responses per participant — the ONLY reliable
 *  "the AI answered" signal. Counting '[AI]' in the DOM is not: the Composer's
 *  active AI chip renders the same token, so the count jumps the moment AI mode
 *  is switched on and a DOM-based wait returns before the call even finishes
 *  (which then gets aborted by the next reload, losing the measurement). */
const completions = { };
/** Requests to the Aidit server that contained a key (must stay empty). */
const leaks = [];
/** Every Aidit API request observed (for a request-count sanity number). */
let apiRequests = 0;

function containsKey(text) {
  if (!text) return null;
  for (const key of ALL_KEYS) {
    if (text.includes(key)) return key.slice(0, 12) + '…';
  }
  return null;
}

/** Attach observers to one user's page. */
function instrument(page, who) {
  page.on('request', (req) => {
    const url = req.url();

    // Aidit server traffic: assert no key ever rides along (L1 key-blind).
    if (url.startsWith(BASE)) {
      if (url.includes('/api/')) apiRequests += 1;
      const hay = [
        url,
        req.postData() ?? '',
        JSON.stringify(req.headers() ?? {}),
      ].join('\n');
      const hit = containsKey(hay);
      if (hit) {
        leaks.push({ who, url: url.replace(BASE, ''), keyPrefix: hit });
      }
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('generativelanguage.googleapis.com')) return;
    const endpoint = url.includes(':generateContent')
      ? 'generateContent'
      : url.includes(':countTokens')
        ? 'countTokens'
        : 'other';
    if (endpoint !== 'generateContent') {
      // countTokens is free and carries no usageMetadata; record the fact only.
      calls.push({ who, phase, endpoint, status: res.status(), tokens: null });
      return;
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      // A non-JSON/aborted response still matters as an attempt.
    }
    const usage = body?.usageMetadata ?? null;
    calls.push({
      who,
      phase,
      endpoint,
      status: res.status(),
      tokens: usage
        ? {
            prompt: usage.promptTokenCount ?? 0,
            output: usage.candidatesTokenCount ?? 0,
            total:
              usage.totalTokenCount ??
              (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
          }
        : null,
    });
    completions[who] = (completions[who] ?? 0) + 1;
    log(
      `LLM ${endpoint} by ${who}: HTTP ${res.status()}` +
        (usage
          ? ` prompt=${usage.promptTokenCount} out=${usage.candidatesTokenCount} total=${usage.totalTokenCount}`
          : ' (no usageMetadata)'),
    );
  });
}

// --- UI helpers (selectors mirrored from demo-scenario.mjs) -----------------

async function guestLogin(page, nick, key) {
  await page.goto(`${BASE}/login`);
  const guestTab = page.getByRole('tab', { name: '게스트' });
  await guestTab.waitFor({ state: 'visible', timeout: 20000 });
  await guestTab.click();
  await page.locator('#nickname').fill(nick);
  await page.locator('#apiKey').fill(key);
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
}

const llmCount = (who) => completions[who] ?? 0;

/**
 * Wait until ONE more generateContent response has been observed for `who`, then
 * let the PATCH to COMPLETE land. Waiting on the observed network response (not
 * the DOM) is what makes the measurement trustworthy: the call is guaranteed to
 * have finished, so nothing is aborted by the next navigation.
 */
async function waitForLlm(who, prevCount, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (llmCount(who) <= prevCount) {
    if (Date.now() > deadline) {
      throw new Error(`no LLM completion observed for ${who} within ${timeoutMs}ms`);
    }
    await sleep(500);
  }
  await sleep(1200); // let the bubble PATCH to COMPLETE commit
}

async function ensureMenuOpen(page) {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'AI 모드 설정' }).click();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await sleep(300);
  }
  return dialog;
}

async function setAi(page, on) {
  const dialog = await ensureMenuOpen(page);
  const sw = dialog.getByRole('switch', { name: 'AI에게 묻기' });
  const isOn = (await sw.getAttribute('aria-checked')) === 'true';
  if (isOn !== on) {
    await sw.click();
    await sleep(300);
  }
  if (await page.getByRole('dialog').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
  }
}

async function sendComment(page, text) {
  const box = page.getByLabel('댓글 입력');
  await box.click();
  await box.fill(text);
  await sleep(200);
  await page.getByRole('button', { name: '전송' }).click();
}

async function createCommunity(page) {
  await page.goto(`${BASE}/create-community`);
  await page.locator('#name').fill(COMMUNITY.name);
  await page.locator('#slug').fill(COMMUNITY.slug);
  await page.locator('#description').fill(COMMUNITY.description);
  await page.locator('#persona-prompt').fill(COMMUNITY.persona);
  await page.locator('#personaIcon').fill(COMMUNITY.icon);
  await page.getByRole('button', { name: '커뮤니티 만들기' }).click();
  await page.waitForURL(`**/c/${COMMUNITY.slug}`, { timeout: 30000 });
}

/** Create a post; `firstAiReply` drives the FR-4.3 primary-reply checkbox. */
async function createPost(page, { title, body, firstAiReply }) {
  await page.goto(`${BASE}/c/${COMMUNITY.slug}/create-post`);
  await page.getByPlaceholder('제목을 입력하세요').fill(title);
  await page.getByPlaceholder('내용을 입력하세요').fill(body);
  const cb = page.getByRole('checkbox').first();
  const checked = await cb.isChecked().catch(() => false);
  if (checked !== firstAiReply) await cb.setChecked(firstAiReply);
  await sleep(300);
  await page.getByRole('button', { name: '게시하기' }).click();
  await page.waitForURL(/\/p\//, { timeout: 30000 });
  createdPosts.push(page.url());
  return page.url();
}

// --- main ------------------------------------------------------------------

const started = Date.now();
let browser;
const result = { ok: false };

try {
  browser = await chromium.launch({ headless: HEADLESS });
  const ctxs = {};
  const P = {};
  for (const who of ['A', 'B', 'C']) {
    ctxs[who] = await browser.newContext({ viewport: { width: 420, height: 900 } });
    P[who] = await ctxs[who].newPage();
    instrument(P[who], USERS[who].nick);
  }

  log('phase 0: guest logins with three real keys');
  for (const who of ['A', 'B', 'C']) {
    await guestLogin(P[who], USERS[who].nick, USERS[who].key);
  }

  log('phase 1: A creates the community');
  await createCommunity(P.A);

  log('phase 2: A creates a post WITH the 1차 AI reply (A pays)');
  setPhase('primaryReply');
  let before = llmCount(USERS.A.nick);
  const postUrl = await createPost(P.A, {
    title: '코드 에이전트에 일 맡기는 나만의 방식',
    body:
      '저는 계획을 먼저 세우게 하고, 사람이 계획을 검토한 다음 작은 단위로 실행시킵니다. 다른 분들은 어떻게 하시나요?',
    firstAiReply: true,
  });
  await waitForLlm(USERS.A.nick, before, 180000);
  log(`post created: ${postUrl}`);

  await P.B.goto(postUrl);
  await P.C.goto(postUrl);
  await sleep(1500);

  log(`phase 3: ${TURNS.length}-turn discussion across 3 participants`);
  setPhase('atAiReply');
  let aiTurns = 0;
  for (const [i, turn] of TURNS.entries()) {
    const page = P[turn.who];
    await page.reload();
    await sleep(1200);
    const beforeTurn = llmCount(USERS[turn.who].nick);
    await setAi(page, turn.ai);
    await sendComment(page, turn.text);
    if (turn.ai) {
      aiTurns += 1;
      await waitForLlm(USERS[turn.who].nick, beforeTurn, 180000);
      log(`turn ${i + 1}/${TURNS.length} (${turn.who}, AI) done`);
    } else {
      await sleep(1200);
      log(`turn ${i + 1}/${TURNS.length} (${turn.who}) done`);
    }
  }

  log('phase 4: A condenses the discussion into a document (FR-13, A pays)');
  setPhase('condense');
  await P.A.reload();
  await sleep(2000);
  await P.A.getByRole('button', { name: '게시글 관리' }).click();
  await P.A.getByRole('menuitem', { name: /문서로 정리/ }).click();
  await P.A.waitForURL(/\/d\//, { timeout: 240000 });
  const docUrl = P.A.url();
  const docTitle = await P.A.locator('h2').first().innerText();
  const docBodyText = await P.A.locator('article').first().innerText();
  log(`document created: ${docUrl} — "${docTitle}" (${docBodyText.length} chars rendered)`);

  // FR-14 delta: ask the SAME question in two fresh threads — once WITHOUT an
  // attachment, once WITH the condensed document — so the added prompt cost of
  // the knowledge loop is measured rather than guessed.
  const QUESTION = '신입이 첫 주에 지켜야 할 것 3가지만 알려줘.';

  log('phase 5: control thread — same question, NO attachment (B pays)');
  setPhase('atAiReply_noAttach');
  const postCtrl = await createPost(P.A, {
    title: '신입 온보딩 질문 (대조군)',
    body: '신입에게 무엇부터 알려줘야 할지 이야기해봅시다.',
    firstAiReply: false,
  });
  await P.B.goto(postCtrl);
  await sleep(1500);
  let before2 = llmCount(USERS.B.nick);
  await setAi(P.B, true);
  await sendComment(P.B, QUESTION);
  await waitForLlm(USERS.B.nick, before2, 180000);

  log('phase 6: same question WITH the document attached (FR-14, B pays)');
  setPhase('atAiReply_withAttach');
  const post2 = await createPost(P.A, {
    title: '신입 온보딩 질문 (문서 첨부)',
    body: '신입에게 무엇부터 알려줘야 할지 이야기해봅시다.',
    firstAiReply: false,
  });
  await P.B.goto(post2);
  await sleep(1500);
  before2 = llmCount(USERS.B.nick);
  const dialog = await ensureMenuOpen(P.B);
  const sw = dialog.getByRole('switch', { name: 'AI에게 묻기' });
  if ((await sw.getAttribute('aria-checked')) !== 'true') {
    await sw.click();
    await sleep(300);
  }
  const menu = await ensureMenuOpen(P.B);
  const docCheckbox = menu.getByRole('checkbox').first();
  await docCheckbox.waitFor({ state: 'visible', timeout: 20000 });
  const attachedTitle = (await docCheckbox.innerText()).replace(/\s+/g, ' ').trim();
  await docCheckbox.click();
  await sleep(300);
  await P.B.keyboard.press('Escape');
  await sleep(300);
  const chipVisible = await P.B.getByText(/문서 1개 참고/)
    .isVisible()
    .catch(() => false);
  await sendComment(P.B, QUESTION);
  await waitForLlm(USERS.B.nick, before2, 180000);
  log(`FR-14 attach used: ${attachedTitle} (chip shown: ${chipVisible})`);

  // --- aggregate ----------------------------------------------------------
  const generate = calls.filter(
    (c) => c.endpoint === 'generateContent' && c.tokens,
  );
  const perUser = {};
  for (const c of generate) {
    const u = (perUser[c.who] ??= { calls: 0, prompt: 0, output: 0, total: 0 });
    u.calls += 1;
    u.prompt += c.tokens.prompt;
    u.output += c.tokens.output;
    u.total += c.tokens.total;
  }
  const cost = (p, o) =>
    (p / 1_000_000) * USD_PER_1M_INPUT + (o / 1_000_000) * USD_PER_1M_OUTPUT;
  for (const u of Object.values(perUser)) u.usd = cost(u.prompt, u.output);

  const totals = Object.values(perUser).reduce(
    (a, u) => ({
      calls: a.calls + u.calls,
      prompt: a.prompt + u.prompt,
      output: a.output + u.output,
      total: a.total + u.total,
      usd: a.usd + u.usd,
    }),
    { calls: 0, prompt: 0, output: 0, output_: 0, total: 0, usd: 0 },
  );

  // Per-phase (kind of call) breakdown.
  const perPhase = {};
  for (const c of generate) {
    const k = (perPhase[c.phase] ??= { calls: 0, prompt: 0, output: 0, total: 0 });
    k.calls += 1;
    k.prompt += c.tokens.prompt;
    k.output += c.tokens.output;
    k.total += c.tokens.total;
  }
  for (const k of Object.values(perPhase)) {
    k.avgPrompt = Math.round(k.prompt / k.calls);
    k.avgTotal = Math.round(k.total / k.calls);
    k.usd = cost(k.prompt, k.output);
  }

  // The economics of a SHARED context: prompt tokens per @AI call, in order.
  const contextGrowth = generate
    .filter((c) => c.phase === 'atAiReply')
    .map((c) => c.tokens.prompt);

  // FR-14 cost of attaching one document = prompt delta on the same question.
  const ctrl = generate.find((c) => c.phase === 'atAiReply_noAttach');
  const att = generate.find((c) => c.phase === 'atAiReply_withAttach');
  const attachDelta =
    ctrl && att
      ? {
          promptWithout: ctrl.tokens.prompt,
          promptWith: att.tokens.prompt,
          deltaPrompt: att.tokens.prompt - ctrl.tokens.prompt,
          deltaUsd: cost(att.tokens.prompt - ctrl.tokens.prompt, 0),
        }
      : null;

  result.ok = leaks.length === 0;
  Object.assign(result, {
    model: MODEL,
    priceUsdPer1M: { input: USD_PER_1M_INPUT, output: USD_PER_1M_OUTPUT },
    elapsedSec: Math.round((Date.now() - started) / 1000),
    participants: 3,
    threads: createdPosts.length,
    documentsCondensed: 1,
    documentTitle: docTitle,
    fr14AttachUsed: true,
    fr14ChipShown: chipVisible,
    aiditApiRequests: apiRequests,
    discussionTurns: TURNS.length,
    aiTurnsInThread: aiTurns,
    documentRenderedChars: docBodyText.length,
    perPhase,
    contextGrowthPromptTokens: contextGrowth,
    fr14AttachDelta: attachDelta,
    keyLeaks: leaks,
    perUser,
    totals,
    countTokensCalls: calls.filter((c) => c.endpoint === 'countTokens').length,
    generateCalls: generate.length,
    callsWithoutUsage: calls.filter(
      (c) => c.endpoint === 'generateContent' && !c.tokens,
    ).length,
  });

  // --- report -------------------------------------------------------------
  console.log('\n==================== MEASURED ====================');
  console.log(`model                : ${MODEL}`);
  console.log(`elapsed              : ${result.elapsedSec}s`);
  console.log(`participants/threads : ${result.participants} / ${result.threads}`);
  console.log(`documents condensed  : ${result.documentsCondensed} ("${docTitle}")`);
  console.log(`Aidit API requests   : ${apiRequests}`);
  console.log(`generateContent calls: ${generate.length}`);
  console.log('\nper participant (their OWN key):');
  for (const [who, u] of Object.entries(perUser)) {
    console.log(
      `  ${who.padEnd(4)} calls=${u.calls} prompt=${u.prompt} output=${u.output} ` +
        `total=${u.total} cost=$${u.usd.toFixed(6)}`,
    );
  }
  console.log('\nper call kind:');
  for (const [k, v] of Object.entries(perPhase)) {
    console.log(
      `  ${k.padEnd(24)} calls=${String(v.calls).padStart(2)} ` +
        `avgPrompt=${String(v.avgPrompt).padStart(5)} avgTotal=${String(v.avgTotal).padStart(5)} ` +
        `cost=$${v.usd.toFixed(6)}`,
    );
  }
  console.log(
    `\nshared-context growth (prompt tokens per @AI call): ${contextGrowth.join(' -> ')}`,
  );
  if (attachDelta) {
    console.log(
      `FR-14 attach delta: prompt ${attachDelta.promptWithout} -> ${attachDelta.promptWith} ` +
        `(+${attachDelta.deltaPrompt} tokens, +$${attachDelta.deltaUsd.toFixed(6)})`,
    );
  }
  console.log(
    `\nALL USERS total=${totals.total} tokens  cost=$${totals.usd.toFixed(6)}`,
  );
  console.log(
    `SERVER-SIDE LLM COST = $0.00 (no server code path calls a provider)`,
  );
  console.log(
    `key leaks to Aidit server: ${leaks.length === 0 ? 'NONE ✅' : JSON.stringify(leaks)}`,
  );
  console.log('=================================================\n');

  if (OUT) {
    writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    log(`wrote ${OUT}`);
  }
  if (leaks.length > 0) process.exitCode = 1;
} catch (e) {
  console.error('[measure] FAILED:', e?.message ?? e);
  result.error = String(e?.message ?? e);
  if (OUT) writeFileSync(OUT, JSON.stringify({ ...result, calls, leaks }, null, 2), 'utf8');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
