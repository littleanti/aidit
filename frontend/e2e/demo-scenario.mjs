// docs/DEMO_SCENARIO.md 오케스트레이션 스크립트.
// 실행: cd frontend && node e2e/demo-scenario.mjs
// 3440×1440 모니터에 A/B/C 창 3분할 → 게스트 BYOK 로그인 → 커뮤니티/게시글 → 16턴 대화 → AI 문서 생성.
// ffmpeg(ddagrab+NVENC, draw_mouse=0)로 전체 화면 녹화. 종료는 stdin 'q' (kill 금지).
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const OUT_MP4 = 'D:/yoon/codes/Aidit/Aidit/demo-aidit.mp4';
const RECORD = process.env.DEMO_NO_RECORD !== '1';

// 실측 작업영역(PowerShell WorkingArea): 3374x1440 at (66,0) — 작업표시줄이 왼쪽 66px,
// 하단엔 없음. DPI 100%. 창 3개로 작업영역을 가로 3분할하고, 이웃 창을 FUDGE만큼 겹쳐
// Windows의 보이지 않는 리사이즈 테두리로 생기는 창 사이 틈을 가린다. 높이는 전체 1440.
const WORK = { x: 66, w: 3374, h: 1440 };
const FUDGE = 8;

function tileWindows(x0, w, h, n, fudge) {
  const base = Math.floor(w / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const left = x0 + i * base;
    const width = i === n - 1 ? w - i * base : base;
    out.push({
      x: Math.max(0, left - (i > 0 ? fudge : 0)),
      w: width + (i > 0 ? fudge : 0) + (i < n - 1 ? fudge : 0),
      h,
    });
  }
  return out;
}
const TILES = tileWindows(WORK.x, WORK.w, WORK.h, 3, FUDGE);

// BYOK 키는 커밋 유출 방지를 위해 환경변수로 주입한다(하드코딩 금지).
//   Windows PowerShell:  $env:DEMO_KEY_A="AIza..."; $env:DEMO_KEY_B="..."; $env:DEMO_KEY_C="..."; node e2e/demo-scenario.mjs
//   bash:                DEMO_KEY_A=AIza... DEMO_KEY_B=... DEMO_KEY_C=... node e2e/demo-scenario.mjs
const USERS = {
  A: { nick: '아라', key: process.env.DEMO_KEY_A || '', tile: TILES[0] },
  B: { nick: '바다', key: process.env.DEMO_KEY_B || '', tile: TILES[1] },
  C: { nick: '찬', key: process.env.DEMO_KEY_C || '', tile: TILES[2] },
};
for (const [who, u] of Object.entries(USERS)) {
  if (!u.key) { console.error(`[demo] 환경변수 DEMO_KEY_${who} 가 필요합니다.`); process.exit(1); }
}

const COMMUNITY = {
  name: 'AI를 잘 다루는 방법',
  slug: 'ai-mastery',
  description: 'AI 도구를 더 잘 쓰는 노하우를 모으는 곳',
  persona:
    '당신은 10년 경력의 AI 도구 활용 전문가입니다. 개발자들이 AI 코딩 에이전트를 효과적으로 쓰도록 구체적인 예시와 함께 실용적으로 답합니다. 한국어로 답변하세요.',
  icon: '🤖',
};

const POST = {
  title: 'Code Agent 잘쓰는법 알려줘요',
  body: 'Code Agent 잘쓰는 팁 공유좀. 요즘 쓰기 시작했는데 감이 잘 안 잡히네요.',
};

const B_PERSONA = {
  name: '반대 토론자',
  prompt: '당신은 상대 주장의 허점을 찾는 반대 토론자입니다. 정중하지만 날카롭게 반례를 제시하세요.',
};

// 시나리오 타임라인 3~16 (docs/DEMO_SCENARIO.md §3 Phase 3)
const TURNS = [
  { n: 3, who: 'B', ai: true, length: '짧게', text: 'Code Agent 잘 쓰려면 일단 프롬프트가 명확해야 해요. "로그인 고쳐줘"보다 "로그인 실패 시 에러 메시지가 안 뜨는 버그를 고쳐줘"처럼요. AI야, 모호한 프롬프트와 명확한 프롬프트 예시를 한 쌍씩 보여줘.', probe: '프롬프트가 명확해야' },
  { n: 4, who: 'C', ai: true, length: '짧게', text: '프로젝트 시작 전에 그라운드 룰을 정해두는 게 좋아요. 저는 "문서 먼저 → 구현 → 검증 → 개발 로그 남기기 → 푸시" 순서를 강제해요. AI야, 이런 그라운드 룰 문서 예시를 보여줘.', probe: '그라운드 룰을 정해두는' },
  { n: 5, who: 'A', ai: true, length: '짧게', text: '둘 다 고마워요! 바로 적용해볼게요. 그런데 이런 그라운드 룰은 어디에 저장해두는 게 좋아? CLAUDE.md 같은 데 넣으면 되나?', probe: '어디에 저장해두는' },
  { n: 6, who: 'B', ai: false, text: '그리고 큰 작업은 한 번에 시키지 말고 잘게 쪼개세요. "결제 기능 만들어줘" 대신 계획부터 세우게 하고, 단계별로 승인하면서 가는 게 사고가 안 나요.', probe: '잘게 쪼개세요' },
  { n: 7, who: 'C', ai: true, length: '짧게', text: 'Agent가 코드 고친 뒤엔 꼭 typecheck랑 테스트를 돌리게 하세요. "다 됐다"는 말만 믿으면 안 돼요. AI야, 커밋 전에 돌릴 만한 검증 체크리스트를 짧게 만들어줘.', probe: 'typecheck랑 테스트' },
  { n: 8, who: 'B', ai: false, text: '컨텍스트 관리도 중요해요. 관련 없는 파일까지 다 읽게 하면 답이 산으로 가요. 작업에 필요한 파일 경로를 직접 짚어주면 훨씬 정확해집니다.', probe: '컨텍스트 관리도' },
  { n: 9, who: 'C', ai: false, text: '커밋을 자주 하세요. Agent가 한 번에 많이 고치다 망가뜨려도 커밋 단위로 롤백하면 되니까요. 작은 단위 커밋이 곧 세이브 포인트예요.', probe: '커밋을 자주' },
  { n: 10, who: 'B', ai: true, length: '짧게', persona: '반대 토론자', text: '근데 제 팁들이 항상 옳은 건 아닐 수 있어요. AI야, 지금까지 이 스레드에 나온 팁들의 허점이나 반례를 한번 지적해봐.', probe: '허점이나 반례' },
  { n: 11, who: 'C', ai: false, text: '에러가 나면 메시지를 요약하지 말고 스택트레이스 전체를 그대로 붙여넣으세요. Agent는 사람보다 긴 로그를 잘 읽어요.', probe: '스택트레이스 전체' },
  { n: 12, who: 'B', ai: false, text: '반복하는 작업 패턴은 스킬이나 스크립트로 만들어두세요. 매번 같은 지시를 타이핑하는 대신 한 번 정의해두고 재사용하는 거죠.', probe: '스킬이나 스크립트로' },
  { n: 13, who: 'C', ai: false, text: '보안도요. API 키나 시크릿을 프롬프트나 코드에 직접 넣지 마세요. 환경변수로 빼고, Agent한테도 "시크릿은 하드코딩 금지" 룰을 알려두세요.', probe: '시크릿을 프롬프트나' },
  { n: 14, who: 'B', ai: false, text: '작업 난이도에 맞는 모델을 고르세요. 단순 리네이밍에 최고급 모델은 낭비고, 아키텍처 설계를 경량 모델에 맡기면 품질이 떨어져요.', probe: '난이도에 맞는 모델' },
  { n: 15, who: 'C', ai: false, text: '마지막으로, Agent 결과물은 반드시 사람이 리뷰하세요. diff를 안 읽고 머지하는 순간부터 코드베이스 주인이 내가 아니게 됩니다.', probe: '반드시 사람이 리뷰' },
  { n: 16, who: 'A', ai: true, length: '길게', text: '와 팁이 정말 많이 모였네요. AI야, 지금까지 이 스레드에 나온 팁을 전부 정리해서 "Code Agent 사용 가이드" 문서로 만들어줘. 마크다운 제목, 목차, 섹션 구조를 갖춰서 부탁해.', probe: '문서로 만들어줘' },
];

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[demo ${ts()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 녹화 ----------
function startRecording() {
  const rec = spawn('ffmpeg', [
    '-y',
    '-init_hw_device', 'd3d11va',
    '-filter_complex', 'ddagrab=framerate=30:draw_mouse=0',
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '19',
    OUT_MP4,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  rec.stderr.on('data', (d) => { err += d; });
  rec.getErr = () => err;
  return rec;
}

async function stopRecording(rec) {
  await sleep(3000); // 엔딩 여유
  rec.stdin.write('q');
  const code = await new Promise((r) => rec.on('exit', r));
  log(`recording stopped (ffmpeg exit ${code})`);
  if (code !== 0) console.log(rec.getErr().split('\n').slice(-10).join('\n'));
}

// ---------- 공통 헬퍼 ----------
async function launchWindow(tile) {
  const browser = await chromium.launch({
    headless: false,
    args: [
      `--window-position=${tile.x},0`,
      `--window-size=${tile.w},${tile.h}`,
    ],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  return { browser, page };
}

async function guestLogin(page, nick, key) {
  await page.goto(`${BASE}/login`);
  const guestTab = page.getByRole('tab', { name: '게스트' });
  await guestTab.waitFor({ state: 'visible', timeout: 15000 });
  await guestTab.click();
  const nickInput = page.locator('#nickname');
  await nickInput.click();
  await nickInput.pressSequentially(nick, { delay: 60 });
  await page.locator('#apiKey').fill(key);
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

// 직전 발화가 이 창에 보일 때까지 대기 (실시간 반영 안 되면 reload 폴백)
async function waitForText(page, text, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  const loc = page.getByText(text).last();
  for (;;) {
    if (await loc.isVisible().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`waitForText timeout: ${text}`);
    await sleep(2500);
    if (await loc.isVisible().catch(() => false)) return;
    await page.reload().catch(() => {});
    await sleep(1500);
  }
}

const aiBubbleCount = (page) => page.getByText('[AI]').count();

// AI 답변: 새 [AI] 버블 출현 → 본문 텍스트 안정화(스트리밍 종료)까지 대기
async function waitForAiReply(page, prevCount, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while ((await aiBubbleCount(page)) <= prevCount) {
    if (Date.now() > deadline) throw new Error('AI bubble did not appear');
    await sleep(1000);
  }
  let last = '';
  let stable = 0;
  while (stable < 3) {
    if (Date.now() > deadline) throw new Error('AI reply did not stabilize');
    await sleep(2000);
    const txt = await page.locator('main').innerText().catch(() => '');
    if (txt && txt === last) stable += 1;
    else { stable = 0; last = txt; }
  }
}

// 팝오버는 스위치 토글/라디오 선택 직후 닫힐 수 있으므로, 각 조작 전에 다시 연다.
async function ensureMenuOpen(page) {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'AI 모드 설정' }).click();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await sleep(500); // 등장 연출
  }
  return dialog;
}

// Composer의 AI 팝오버 상태를 원하는 값으로 세팅
async function setAiState(page, { ai, length, persona }) {
  let dialog = await ensureMenuOpen(page);
  const sw = dialog.getByRole('switch', { name: 'AI에게 묻기' });
  const isOn = (await sw.getAttribute('aria-checked')) === 'true';
  if (isOn !== ai) { await sw.click(); await sleep(500); }

  if (ai && length) {
    dialog = await ensureMenuOpen(page);
    await dialog.getByRole('radio', { name: length }).click();
    await sleep(500);
  }
  if (ai && persona) {
    dialog = await ensureMenuOpen(page);
    await dialog
      .getByRole('radiogroup', { name: '내 AI 페르소나 선택' })
      .getByRole('radio', { name: persona })
      .click();
    await sleep(500);
  }
  // 팝오버가 아직 열려 있으면 닫는다.
  if (await page.getByRole('dialog').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
}

async function sendComment(page, text) {
  const box = page.getByLabel('댓글 입력');
  await box.click();
  await box.pressSequentially(text, { delay: 18 });
  await sleep(400);
  await page.getByRole('button', { name: '전송' }).click();
}

// ---------- 메인 ----------
const rec = RECORD ? startRecording() : null;
if (rec) { log('recording started'); await sleep(2000); }

let browsers = [];
try {
  // Phase 0 — 창 3개 + 게스트 로그인
  log('Phase 0: launching windows');
  const [wA, wB, wC] = await Promise.all([
    launchWindow(USERS.A.tile), launchWindow(USERS.B.tile), launchWindow(USERS.C.tile),
  ]);
  browsers = [wA.browser, wB.browser, wC.browser];
  const P = { A: wA.page, B: wB.page, C: wC.page };

  log('Phase 0: guest logins');
  await Promise.all([
    guestLogin(P.A, USERS.A.nick, USERS.A.key),
    guestLogin(P.B, USERS.B.nick, USERS.B.key),
    guestLogin(P.C, USERS.C.nick, USERS.C.key),
  ]);
  await sleep(1500);

  // Phase 1 — A: 커뮤니티 생성 ‖ B: 페르소나 슬롯 저장 (병행)
  log('Phase 1: A creates community / B saves persona slot (parallel)');
  const createCommunity = async () => {
    await P.A.goto(`${BASE}/create-community`);
    const name = P.A.locator('#name');
    await name.click();
    await name.pressSequentially(COMMUNITY.name, { delay: 40 });
    await P.A.locator('#slug').fill(COMMUNITY.slug);
    await P.A.locator('#description').pressSequentially(COMMUNITY.description, { delay: 15 });
    await P.A.locator('#persona-prompt').pressSequentially(COMMUNITY.persona, { delay: 8 });
    await P.A.locator('#personaIcon').fill(COMMUNITY.icon);
    await sleep(800);
    await P.A.getByRole('button', { name: '커뮤니티 만들기' }).click();
    // 부하(창3+녹화)로 생성→네비게이션이 느릴 수 있어 넉넉히 대기. 그래도 create
    // 페이지에 남아 있으면(중복 등) 이름/슬러그에 suffix를 붙여 재시도.
    try {
      await P.A.waitForURL(`**/c/${COMMUNITY.slug}`, { timeout: 20000 });
    } catch {
      const suf = `${Date.now() % 1000}`;
      log(`community not created (likely name conflict) — retrying with suffix -${suf}`);
      await P.A.locator('#name').fill(`${COMMUNITY.name} ${suf}`);
      await P.A.locator('#slug').fill(`${COMMUNITY.slug}-${suf}`);
      COMMUNITY.slug = `${COMMUNITY.slug}-${suf}`;
      await sleep(500);
      await P.A.getByRole('button', { name: '커뮤니티 만들기' }).click();
      await P.A.waitForURL(`**/c/${COMMUNITY.slug}`, { timeout: 20000 });
    }
    log(`community created: /c/${COMMUNITY.slug}`);
  };
  const savePersonaSlot = async () => {
    await P.B.goto(`${BASE}/me/settings`);
    const nameInput = P.B.getByPlaceholder('이름 (예: 반대 토론자)').first();
    await nameInput.scrollIntoViewIfNeeded();
    await nameInput.click();
    await nameInput.pressSequentially(B_PERSONA.name, { delay: 40 });
    const promptBox = P.B.getByPlaceholder(/^예\) 당신은/).first();
    await promptBox.click();
    await promptBox.pressSequentially(B_PERSONA.prompt, { delay: 10 });
    await sleep(500);
    await P.B.getByRole('button', { name: '저장' }).first().click();
    await sleep(800);
    await P.B.goto(BASE);
    log('B persona slot saved');
  };
  await Promise.all([createCommunity(), savePersonaSlot()]);
  await sleep(1500);

  // Phase 2 — A: 게시글 작성
  log('Phase 2: A creates post');
  await P.A.goto(`${BASE}/c/${COMMUNITY.slug}/create-post`);
  const title = P.A.getByPlaceholder('제목을 입력하세요');
  await title.click();
  await title.pressSequentially(POST.title, { delay: 35 });
  const body = P.A.getByPlaceholder('내용을 입력하세요');
  await body.click();
  await body.pressSequentially(POST.body, { delay: 20 });
  const firstReply = P.A.getByRole('checkbox');
  if (await firstReply.isChecked()) await firstReply.uncheck();
  await sleep(800);
  await P.A.getByRole('button', { name: '게시하기' }).click();
  await P.A.waitForURL(/\/p\//, { timeout: 25000 });
  const postUrl = P.A.url();
  log(`post created: ${postUrl}`);

  await Promise.all([P.B.goto(postUrl), P.C.goto(postUrl)]);
  await sleep(2000);

  // Phase 3 — 타임라인 3~16
  let prevProbe = POST.body.slice(0, 12);
  for (const turn of TURNS) {
    const page = P[turn.who];
    log(`turn ${turn.n} (${turn.who}, AI ${turn.ai ? 'ON' : 'OFF'}${turn.persona ? `, persona=${turn.persona}` : ''})`);
    await waitForText(page, prevProbe); // 직전 발화가 이 창에 보이는지
    await sleep(1500); // 시청 페이스
    const before = turn.ai ? await aiBubbleCount(page) : 0;
    await setAiState(page, { ai: turn.ai, length: turn.length, persona: turn.persona });
    await sendComment(page, turn.text);
    await waitForText(page, turn.probe, 30000); // 내 댓글 커밋 확인
    if (turn.ai) {
      log(`turn ${turn.n}: waiting for AI reply...`);
      await waitForAiReply(page, before, turn.n === 16 ? 300000 : 180000);
      log(`turn ${turn.n}: AI reply done`);
    }
    prevProbe = turn.probe;
    await sleep(1000);
  }

  // 엔딩 — A 창에서 최종 문서 버블 스크롤 리뷰
  log('ending: scroll through final document on A');
  await waitForText(P.A, TURNS.at(-1).probe);
  for (let i = 0; i < 10; i++) { await P.A.mouse.wheel(0, -700); await sleep(500); }
  await sleep(1500);
  for (let i = 0; i < 14; i++) { await P.A.mouse.wheel(0, 700); await sleep(600); }
  await sleep(3000);

  log('demo complete');
} catch (e) {
  console.error(`[demo ${ts()}] FAILED:`, e);
  process.exitCode = 1;
} finally {
  if (rec) await stopRecording(rec);
  for (const b of browsers) await b.close().catch(() => {});
}
