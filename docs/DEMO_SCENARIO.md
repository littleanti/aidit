# Aidit 데모 시나리오 — "Code Agent 잘 쓰는 법" 협업 스레드

> 목적: 주제 커뮤니티에서 게시글·댓글로 의견을 주고받으며, 각자 자신의 AI(BYOK)를 협업용·반론용으로
> 끌어들이고, 최종적으로 스레드 논의가 **하나의 마크다운 문서**로 정리되는 흐름을 3개 창으로 시연한다.
> Playwright 자동화로 A·B·C 세 명의 게스트 사용자를 각각 별도 브라우저 창에서 구동한다.

---

## 1. 등장인물 & 창 배치

모니터 해상도 **3440×1440 (울트라와이드 1대)** 기준, 가로 3분할:

| 창 | 인물 | 닉네임 | 역할 | window-position | window-size |
|----|------|--------|------|-----------------|-------------|
| 왼쪽 | **A** | `아라` | 커뮤니티 개설자·질문자 | `0,0` | `1146,1392` |
| 가운데 | **B** | `바다` | 답변자 1 (프롬프트/워크플로 팁) | `1147,0` | `1146,1392` |
| 오른쪽 | **C** | `찬` | 답변자 2 (프로세스/안전 팁) | `2294,0` | `1146,1392` |

- 높이 1392는 Windows 작업표시줄(~48px)을 뺀 값. 작업표시줄 자동숨김이면 1440 사용.
- 각 인물은 **별도의 `chromium.launch()` 인스턴스**(별도 user-data 격리)여야 한다.
  게스트 신원·BYOK 키·페르소나가 전부 localStorage에 저장되므로, 브라우저 인스턴스를 분리하면
  자동으로 3명의 독립 게스트가 된다. (`aidit-auth`, `aidit-user-personas` 키)
- 실제 창 3개가 떠야 하므로 **headed 모드**, `viewport: null` + `--window-size/--window-position` 사용.

```ts
// 창 1개 띄우기 예시 (A 기준)
const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=0,0', '--window-size=1146,1392'],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
```

## 2. 사전 준비 (녹화 전, 오프스크린)

1. 백엔드 기동: `cd backend && npm run dev` (포트 3001). 프론트: `cd frontend && npm run dev` (포트 5173).
2. **깨끗한 DB 권장**: 커뮤니티 이름 중복 시 409가 나므로, 재촬영 시 `backend/prisma/dev.db`를 리셋하거나
   커뮤니티 이름/슬러그에 실행마다 suffix를 붙인다. (영상용은 suffix 없는 깔끔한 이름 권장 → DB 리셋)
3. **실제 Google AI Studio 키 3개** 준비 — A·B·C가 **각기 다른 키**를 사용한다
   (키는 창별 localStorage에 저장되고, AI 호출은 각 사용자의 키로 나간다 — BYOK 시연 포인트).

   | 인물 | API 키 (환경변수로 주입) |
   |------|--------|
   | A (아라) | `$DEMO_KEY_A` |
   | B (바다) | `$DEMO_KEY_B` |
   | C (찬) | `$DEMO_KEY_C` |

   > ⚠ 실키를 문서/스크립트에 하드코딩하지 말 것. 오케스트레이션 스크립트(`frontend/e2e/demo-scenario.mjs`)는
   > 키를 환경변수 `DEMO_KEY_A/B/C`에서 읽는다. 실행 예:
   > `$env:DEMO_KEY_A="AIza..."; $env:DEMO_KEY_B="..."; $env:DEMO_KEY_C="..."; node e2e/demo-scenario.mjs`
   > 데모 종료 후 키는 폐기(rotate)한다.

※ B의 페르소나 슬롯 설정은 **녹화에 포함**한다 — Phase 1에서 A의 커뮤니티 생성과 병행 진행 (아래 참조).

## 3. 시나리오 타임라인

표기: **[AI ON/OFF]** = Composer의 `AI 모드 설정` 팝오버 내 `AI에게 묻기` 스위치 상태.
길이는 중간 답변은 `짧게`, 마지막 문서 생성만 `길게`.

### Phase 0 — 게스트 로그인 (3창 동시 진행 가능)

| 창 | 행동 |
|----|------|
| A/B/C | `http://localhost:5173/login` 접속 → **게스트 탭** → 닉네임(`아라`/`바다`/`찬`) 입력 → **각자 자신의 API 키**(§2의 키 표 참조) 입력 → `[ 시작하기 ]` |

### Phase 1 — A: 커뮤니티 생성 (시나리오 1) ‖ B: 페르소나 슬롯 설정 (병행)

두 창이 **동시에 진행**되어 3분할 화면이 함께 움직이는 구간이다.

**B 창 — 내 AI 페르소나 슬롯 저장** (10단계 반론 시연용, FR-12 기능 소개):

1. `/me/settings` 이동 → PERSONA 섹션으로 스크롤.
2. 슬롯 1 입력:
   - 이름: `반대 토론자` (placeholder `이름 (예: 반대 토론자)`인 입력란)
   - 프롬프트: `당신은 상대 주장의 허점을 찾는 반대 토론자입니다. 정중하지만 날카롭게 반례를 제시하세요.`
3. 해당 슬롯의 `[ 저장 ]` 클릭 → 저장 확인.
4. 홈(`/`)으로 복귀해 대기.

**A 창 — 커뮤니티 생성**: `/create-community`로 이동해 입력:

- 이름: `AI를 잘 다루는 방법`
- 주소(slug): `ai-mastery`
- 설명: `AI 도구를 더 잘 쓰는 노하우를 모으는 곳`
- **AI 페르소나 프롬프트** (커뮤니티 페르소나 = AI 전문가):
  > `당신은 10년 경력의 AI 도구 활용 전문가입니다. 개발자들이 AI 코딩 에이전트를 효과적으로 쓰도록 구체적인 예시와 함께 실용적으로 답합니다. 한국어로 답변하세요.`
- AI 아이콘: `🤖`
- `[ 커뮤니티 만들기 ]` → `/c/ai-mastery` 도착.

### Phase 2 — A: 게시글 작성 (시나리오 2)

A가 커뮤니티 페이지에서 글쓰기 → `/c/ai-mastery/create-post`:

- 제목: `Code Agent 잘쓰는법 알려줘요`
- 본문: `Code Agent 잘쓰는 팁 공유좀. 요즘 쓰기 시작했는데 감이 잘 안 잡히네요.`
- **`게시 후 AI 1차 답변 받기` 체크박스는 해제** (스토리라인상 B·C의 답변으로 시작하기 위해).
- `[ 게시하기 ]` → `/p/:postId` 도착. **이 postId를 B·C 창에 전달** (오케스트레이터가 URL 공유).

B·C 창도 같은 `/p/:postId`로 이동해 스레드를 띄운다.

### Phase 3 — 댓글 대화 (시나리오 3~16)

각 발화는 Composer 텍스트영역(`댓글 입력`)에 입력 후 전송. AI ON인 발화는 사람 댓글이 먼저 붙고,
이어서 왼쪽 정렬 `[AI] >` 버블이 스트리밍으로 나타난다. **다음 발화는 이전 발화(및 AI 답변)가
자기 창에 보인 뒤에 시작**한다.

| # | 창 | AI | 페르소나 | 발화 내용 |
|---|----|----|----------|-----------|
| 3 | B | **ON**·짧게 | 없음 | `Code Agent 잘 쓰려면 일단 프롬프트가 명확해야 해요. "로그인 고쳐줘"보다 "로그인 실패 시 에러 메시지가 안 뜨는 버그를 고쳐줘"처럼요. AI야, 모호한 프롬프트와 명확한 프롬프트 예시를 한 쌍씩 보여줘.` |
| 4 | C | **ON**·짧게 | 없음 | `프로젝트 시작 전에 그라운드 룰을 정해두는 게 좋아요. 저는 "문서 먼저 → 구현 → 검증 → 개발 로그 남기기 → 푸시" 순서를 강제해요. AI야, 이런 그라운드 룰 문서 예시를 보여줘.` |
| 5 | A | **ON**·짧게 | 없음 | `둘 다 고마워요! 바로 적용해볼게요. 그런데 이런 그라운드 룰은 어디에 저장해두는 게 좋아? CLAUDE.md 같은 데 넣으면 되나?` |
| 6 | B | OFF | — | `그리고 큰 작업은 한 번에 시키지 말고 잘게 쪼개세요. "결제 기능 만들어줘" 대신 계획부터 세우게 하고, 단계별로 승인하면서 가는 게 사고가 안 나요.` |
| 7 | C | **ON**·짧게 | 없음 | `Agent가 코드 고친 뒤엔 꼭 typecheck랑 테스트를 돌리게 하세요. "다 됐다"는 말만 믿으면 안 돼요. AI야, 커밋 전에 돌릴 만한 검증 체크리스트를 짧게 만들어줘.` |
| 8 | B | OFF | — | `컨텍스트 관리도 중요해요. 관련 없는 파일까지 다 읽게 하면 답이 산으로 가요. 작업에 필요한 파일 경로를 직접 짚어주면 훨씬 정확해집니다.` |
| 9 | C | OFF | — | `커밋을 자주 하세요. Agent가 한 번에 많이 고치다 망가뜨려도 커밋 단위로 롤백하면 되니까요. 작은 단위 커밋이 곧 세이브 포인트예요.` |
| 10 | B | **ON**·짧게 | **`반대 토론자`** | `근데 제 팁들이 항상 옳은 건 아닐 수 있어요. AI야, 지금까지 이 스레드에 나온 팁들의 허점이나 반례를 한번 지적해봐.` |
| 11 | C | OFF | — | `에러가 나면 메시지를 요약하지 말고 스택트레이스 전체를 그대로 붙여넣으세요. Agent는 사람보다 긴 로그를 잘 읽어요.` |
| 12 | B | OFF | — | `반복하는 작업 패턴은 스킬이나 스크립트로 만들어두세요. 매번 같은 지시를 타이핑하는 대신 한 번 정의해두고 재사용하는 거죠.` |
| 13 | C | OFF | — | `보안도요. API 키나 시크릿을 프롬프트나 코드에 직접 넣지 마세요. 환경변수로 빼고, Agent한테도 "시크릿은 하드코딩 금지" 룰을 알려두세요.` |
| 14 | B | OFF | — | `작업 난이도에 맞는 모델을 고르세요. 단순 리네이밍에 최고급 모델은 낭비고, 아키텍처 설계를 경량 모델에 맡기면 품질이 떨어져요.` |
| 15 | C | OFF | — | `마지막으로, Agent 결과물은 반드시 사람이 리뷰하세요. diff를 안 읽고 머지하는 순간부터 코드베이스 주인이 내가 아니게 됩니다.` |
| 16 | A | **ON**·**길게** | 없음 | `와 팁이 정말 많이 모였네요. AI야, 지금까지 이 스레드에 나온 팁을 전부 정리해서 "Code Agent 사용 가이드" 문서로 만들어줘. 마크다운 제목, 목차, 섹션 구조를 갖춰서 부탁해.` |

**엔딩 샷**: 16번의 AI 버블이 마크다운(헤딩·목차·섹션)으로 렌더링된 "문서"를 스트리밍으로 완성하는 장면.
A 창을 천천히 스크롤하며 마무리.

### 시연 포인트 요약

- **커뮤니티 페르소나**(Phase 1): 모든 AI 답변이 "AI 전문가" 톤으로 나오는 근거.
- **BYOK**(Phase 0): 각자 자기 키로 로그인 — 서버에 키가 없어도 각 사용자의 AI가 동작.
- **협업용 AI**(3, 4, 7단계): 사람이 팁을 말하고, 자기 AI에게 예시/체크리스트 생성을 시킴.
- **반론용 AI**(10단계): B가 발화별 페르소나 선택으로 `반대 토론자`를 붙여 스레드 내용 반박.
- **공유 컨텍스트**(5, 10, 16단계): AI가 "이 스레드에서 지금까지 나온 이야기"를 알고 답함.
- **문서 산출**(16단계): 스레드 논의 → 마크다운 가이드 문서.

## 4. Playwright 구현 노트

### 셀렉터 치트시트 (data-testid 없음 — role/label/placeholder 사용)

```ts
// 로그인 (/login)
page.getByRole('tab', { name: '게스트' })
page.locator('#nickname')                      // 닉네임
page.locator('#apiKey')                        // BYOK 키 (placeholder 'AIza...')
page.getByRole('button', { name: '시작하기' })

// 커뮤니티 생성 (/create-community)
page.locator('#name'); page.locator('#slug'); page.locator('#description')
page.locator('#persona-prompt')                // AI 페르소나 프롬프트 (필수)
page.locator('#personaIcon')
page.getByRole('button', { name: '커뮤니티 만들기' })

// 게시글 작성 (/c/ai-mastery/create-post)
page.getByPlaceholder('제목을 입력하세요')
page.getByPlaceholder('내용을 입력하세요')
page.getByRole('checkbox')                     // 'AI 1차 답변 받기' (페이지 유일 체크박스) → uncheck
page.getByRole('button', { name: '게시하기' })

// 스레드 Composer (/p/:postId)
page.getByLabel('댓글 입력')                    // textarea. Enter=전송, Shift+Enter=줄바꿈
page.getByRole('button', { name: '전송' })
page.getByRole('button', { name: 'AI 모드 설정' })       // [AI] 칩 → 팝오버
page.getByRole('switch', { name: 'AI에게 묻기' })         // 팝오버 내 on/off
page.getByRole('radio', { name: '짧게' })                 // 길이: 짧게/보통/길게
page.getByRole('radiogroup', { name: '내 AI 페르소나 선택' })
  .getByRole('radio', { name: '반대 토론자' })            // 발화별 페르소나

// 설정 (/me/settings) — B 페르소나 슬롯
page.getByPlaceholder('이름 (예: 반대 토론자)')  // 슬롯 이름 (첫 번째)
// 슬롯 프롬프트 textarea + 같은 슬롯의 '저장' 버튼
```

### AI 모드 동작 규칙 (스크립트 작성 시 주의)

- 키가 저장돼 있으면 스레드 진입 시 **AI 모드가 기본 ON**이다. 따라서 OFF 발화(6, 8, 9, 11~15)는
  전송 전에 팝오버를 열어 스위치를 **꺼야** 한다. 상태는 postId 단위로 유지되므로 매번 확인 후 토글.
- `@AI` 텍스트 토큰은 트리거가 아니다. 오직 스위치 상태로 결정된다.
- 페르소나 선택(10단계)은 세션 한정이므로, 10단계 직후 B의 다음 발화(12) 전에 `없음`으로 되돌린다.
- AI 답변 대기: 새 `[AI] >` 버블의 텍스트가 나타나고 스트리밍이 멈출 때까지
  `expect(...).toBeVisible({ timeout: 60_000 })` + 텍스트 안정화 폴링. 실키 호출이므로 타임아웃 넉넉히.

### 3창 동기화 (subagent 오케스트레이션)

- **postId 전달**: A가 게시 후 `page.url()`에서 `/p/:postId`를 추출 → 오케스트레이터가 B·C에 전달.
- **턴 순서 보장**: 각 발화 전에 "직전 발화 텍스트가 내 창에 보이는가"를 대기 조건으로 삼는다.
  다른 사용자의 댓글이 실시간 반영되지 않으면 `page.reload()` 후 재확인하는 폴백을 넣는다
  (2~3초 간격 폴링 + reload).
- 3개 subagent 대신 **단일 스크립트에서 3개 browser 인스턴스**를 순차 제어하는 편이 턴 순서 보장이
  쉽다. subagent 3개로 갈 경우, 각 agent에게 "N번 발화 텍스트 확인 → M번 발화 수행" 식의
  단계별 계약을 명시할 것.
- 녹화 페이스: 발화 사이 2~3초 `waitForTimeout`을 넣어 시청자가 따라올 수 있게 한다.
  타이핑도 `pressSequentially(text, { delay: 25 })`로 자연스럽게.

### 전체 화면 녹화 자동화 (검증 완료)

오케스트레이션 스크립트가 데모 시작 전 ffmpeg를 스폰하고, 종료 시 stdin에 `q`를 보내
mp4를 정상 finalize한다. **GPU 캡처(ddagrab) + NVENC** 조합으로 3440×1440 @ ~30fps 실측 확인
(CPU 방식 gdigrab은 ~13fps로 부적합). `draw_mouse=0`으로 **마우스 커서는 캡처하지 않는다.**

```ts
import { spawn } from 'node:child_process';

// ① 데모 시작 전 — 녹화 시작
const rec = spawn('ffmpeg', [
  '-y',
  '-init_hw_device', 'd3d11va',
  '-filter_complex', 'ddagrab=framerate=30:draw_mouse=0',   // 마우스 숨김
  '-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '19',
  'demo-aidit.mp4',
], { stdio: ['pipe', 'ignore', 'ignore'] });
await new Promise(r => setTimeout(r, 2000)); // 녹화 안정화 버퍼

// ... 데모 시나리오 실행 ...

// ② 엔딩 샷 후 2~3초 여유 → 녹화 종료
await new Promise(r => setTimeout(r, 3000));
rec.stdin.write('q');                        // kill 금지 — 파일 깨짐
await new Promise(r => rec.on('exit', r));
```

### 실행 순서 요약

1. 백엔드/프론트 기동 확인 (`GET http://localhost:5173` 200).
2. **녹화 시작**: ffmpeg(ddagrab, 마우스 숨김) 스폰 + 2초 안정화 대기.
3. 창 3개 launch (위치/크기 지정) → 3창 동시 게스트 로그인 (Phase 0).
4. Phase 1 병행: A는 커뮤니티 생성, B는 `/me/settings`에서 `반대 토론자` 슬롯 저장 (둘 다 녹화 포함).
5. A: 게시글 작성 → postId 공유 → B·C 스레드 진입.
6. 타임라인 3~16 순차 실행 (AI 스위치/페르소나/길이 상태를 발화마다 명시적으로 세팅).
7. 16번 AI 문서 버블 완성 후 A 창 스크롤로 엔딩.
8. **녹화 종료**: 3초 여유 후 ffmpeg stdin에 `q` → exit 대기 → mp4 확인.
