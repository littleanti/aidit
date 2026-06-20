# Aidit — Design System (v2, 그린 인광 CRT 레트로 터미널)

> **2026-06-19. 이 문서는 v1(로고 기반 인디고-바이올렛 리브랜딩, `#6848F8`/그라디언트 "A")을
> 전면 대체(supersede)한다.** 더 이상 인디고-바이올렛·블루→바이올렛 그라디언트·`brand-*` 토큰은
> 사용하지 않는다. 새 단일 출처(SoT)는 **그린 인광 CRT 레트로 터미널** 미감이며, 색·타이포·표면·모션
> 사양은 모두 본 문서로 정의한다. 시각 레퍼런스는
> `레트로 스타일 UI 리디자인/Aidit Retro.dc.html` 및 `AiditScreen.dc.html`(dc.html spec)이다.

---

## 0. 디자인 의도 (Design thesis)

Aidit을 **그린 인광 CRT 터미널**로 재해석한다. 80년대 모노크롬 단말기 — 어두운 청록빛 인광 패널 위에
밝은 녹색 글자가 살짝 번지며(글로우), 미세한 스캔라인과 가장자리 비네팅이 깔리고, 커서가 깜빡인다.
커뮤니티 = 셸 세션, 글 = `POST` 레코드, 피드 = `feed --sort=...` 명령의 출력처럼 다룬다.

- **단일 미감(딱 하나의 기억점)**: *phosphor green on black + scanline glow*. 화려함은 색이 아니라
  **빛(글로우)·고정폭 타이포·터미널 관용구**(`aidit@yoon:~$`, `>_`, `[ 게시하기 ]`, `// 글`, `— EOF —`)로 만든다.
- **절제된 액센트**: 기본은 전부 녹색 단계. **앰버(`term-amber`)는 "활성/주의" 한 곳에만**(활성 탭,
  체크박스 ON, 키 경고). **레드(`term-red`)는 파괴적 동작에만**(로그아웃, 첨부 제거, 실패).
- **대문자 라벨**: 키커/배지는 대문자 + 넓은 자간(`POST`, `PERSONA`, `API KEY`, `ONE POMODORO CYCLE`).

---

## 1. 컬러 토큰 (term-*)

Tailwind `theme.extend.colors.term`로 정의하고, 모든 화면에서 raw hex 대신 **`term-*` 토큰/유틸 클래스**
(`bg-term-panel`, `text-term-fg`, `border-term-line` 등)로만 사용한다. 순백/순흑은 쓰지 않는다.

### 1.1 텍스트 (전경 / 인광 단계)

| 토큰 | HEX | 용도 |
| --- | --- | --- |
| `term-fg-bright` | `#9affc4` | 제목·강조 헤딩(약한 글로우 동반) |
| `term-glow` | `#5cff9a` | 워드마크·입력 글자·커서·아이콘 스트로크(가장 밝은 인광) |
| `term-fg` | `#36c46f` | **DEFAULT 본문**(`color` 기본값), 일반 텍스트 |
| `term-dim` | `#1f9d56` | 보조 텍스트·메타·카운트 |
| `term-dim-2` | `#1c8f4d` | 라벨·섹션 키커(`커뮤니티`, `제목`, `// 글`) |
| `term-dim-3` | `#157a3f` | 미세 메타·도움말(가장 약한 단계) |
| `term-faint` | `#176a3b` | 프롬프트 접두·placeholder·배지 글자·`/c/` |

### 1.2 표면 (패널 / 적층)

| 토큰 | HEX | 용도 |
| --- | --- | --- |
| `term-bg` | `#04130b` | 앱 배경 기준색(아래 그라디언트의 베이스) |
| `term-panel` | `#08220f` | 카드·리스트 항목·열린 패널 배경 |
| `term-sunken` | `#04130b` | 입력/textarea/검색창 배경(움푹) |
| `term-nav` | `#061a0d` | 하단 탭바·Composer 배경 |
| `term-modal` | `#06160c` | 로그인 모달 패널 배경 |
| `term-chart` | `#06140a` | 차트/썸네일 칩 내부 면 |

**앱 배경 그라디언트** (`bg-term-screen`, body / 디바이스 셸에 적용):
`radial-gradient(125% 80% at 50% -5%, #0c2a18 0%, #04130b 58%, #020a06 100%)`

### 1.3 보더 / 구분선

| 토큰 | HEX | 용도 |
| --- | --- | --- |
| `term-line` | `#114e2b` | 헤더/탭바/Composer 구분선, 대화 디바이더 |
| `term-border` | `#1c7a42` | **기본 카드·입력 외곽선** |
| `term-border-dim` | `#185c33` | 점선(dashed) 첨부/빈상태, 스크롤바 thumb |
| `term-active` | `#2bd46f` | **활성/CTA 보더**(전송·게시·만들기 버튼, 포커스 강조) |

### 1.4 액센트 / 시맨틱

| 토큰 | HEX | 용도 |
| --- | --- | --- |
| `term-amber` | `#ffcf4a` | **활성 탭·체크박스 ON·`@AI` 마크·키 경고 강조**(유일한 비녹색 강조) |
| `term-amber-line` | `#6e5a1e` | 경고 박스 보더 |
| `term-amber-bg` | `rgba(60,48,10,0.4)` | 경고 박스 배경(틴트) |
| `term-red` | `#ff7a7a` | **파괴적 동작 텍스트**(로그아웃·`[x]` 제거·AI 실패) |
| `term-red-line` | `#5a2530` | 파괴적 버튼/배지 보더 |
| `term-red-bg` | `rgba(60,12,16,0.35)` | 파괴적 버튼 배경(틴트) |

### 1.5 CTA 그라디언트 & 글로우

- **시그니처 CTA 면** (`bg-term-cta`): `linear-gradient(180deg, #155230 0%, #0c3a20 100%)`
  — 전송/게시/만들기/시작하기 버튼 배경. 보더 `term-active`, 글자 `term-fg-bright`,
  `text-shadow` 글로우 + `box-shadow: 0 0 14px rgba(43,212,111,0.28)`.
- **글로우 표현**(텍스트): 헤딩·CTA·워드마크는 `text-shadow:0 0 6~8px rgba(92,255,154,0.4~0.6)`.
  전역 본문에는 아주 미세한 `text-shadow:0 0 1px rgba(54,196,111,0.35)`로 인광 번짐을 깐다.
- **글로우 표현**(아이콘): 로고 마크 SVG에 `filter:drop-shadow(0 0 3~5px rgba(92,255,154,0.7))`.

### 1.6 채팅 버블 색 (Thread)

| 발신 | 보더 | 배경 | 글자 |
| --- | --- | --- | --- |
| 본인(me) | `term-active` `#2bd46f` | `bg-term-cta`(그라디언트) | `#c8ffe0` |
| 타인(peer) | `term-border` `#1c7a42` | `term-panel` `#08220f` | `term-fg` `#36c46f` |
| AI | `term-amber-line` `#6e5a1e` | `rgba(60,48,10,0.22)`(앰버 틴트) | `term-fg-bright` `#9affc4` |
| 실패 | `term-red-line` | `term-red-bg` | `term-red` |

라벨 색: AI = `term-amber`(`생산성 [AI] >`), 타인 = `term-dim`(`minji >`). 본인 메타 읽음 표시 `✓ {time}`는 `term-dim-3`.

### 1.7 토큰 매핑 (v1 → v2, 회귀 제거용)

| v1 (제거 대상) | v2 |
| --- | --- |
| `brand-500 #6848F8` / `bg-brand` | `term-glow`(아이콘/강조) · `bg-term-cta`(CTA) · `term-active`(활성) |
| `bg-brand-gradient`(블루→바이올렛) | `bg-term-cta`(녹색 세로 그라디언트) |
| `brand-600` 링크/라벨 텍스트 | `term-fg-bright` / `term-amber`(활성) |
| `bg-brand-50` / `brand-*` 틴트(AI 버블) | AI 앰버 틴트 `rgba(60,48,10,0.22)` + `term-amber-line` |
| `ink #15132E`(워드마크) | `term-glow #5cff9a`(워드마크) |
| `canvas #F6F5FB`(앱 배경) | `bg-term-screen`(녹색 CRT 그라디언트) |
| `from-amber-50 via-brand-50 to-brand-100`(요약 밴드) | 앰버 틴트 패널 + `term-amber` 라벨 |

> **하드코딩 잔재 금지**: `#7c3aed` · `#6d28d9` · `#6848F8` · `purple-*` · `violet-*` · `blue-600` ·
> `brand-*` · `bg-brand-gradient` · `canvas` · `ink` 가 코드에 남아 있지 않은지 확인한다.

---

## 2. 타이포그래피 — 시스템 모노스페이스 (NO 웹폰트 CDN)

CRT 미감의 핵심은 **고정폭(monospace)** 이다. 단, dc.html spec은 편의상 JetBrains Mono를 jsDelivr CDN
woff2(`tokens/fonts.css`)로 링크하지만, **프로덕션 프론트엔드는 웹폰트 CDN을 쓰지 않는다.**

- **divergence from dc.html**: CSP(스크립트/connect 잠금) + PWA 오프라인 요건 + 외부 폰트 CDN 차단
  정책상, JetBrains Mono를 CDN으로 불러오지 **않는다.** 대신 **시스템 모노 스택**으로 동일한 고정폭
  인상을 만든다. (별도 woff2를 `frontend/public/fonts/`로 self-host 하기 전까지 시스템 스택이 기본.)
- **본문/UI 스택** (`font-mono` = 전역 기본):
  `'JetBrains Mono', 'D2Coding', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
  'Liberation Mono', 'Noto Sans KR', monospace`
  — JetBrains Mono / D2Coding은 **로컬에 설치돼 있으면** 사용되고, 없으면 OS 기본 고정폭으로 폴백.
  한글 폴백으로 `Noto Sans KR`를 스택 끝에 둔다(설치돼 있을 때만).
- **개성은 글꼴 다운로드가 아니라** 자간·굵기·터미널 관용구로 만든다:
  - 워드마크 `AIDIT`: `font-bold`, `tracking-[0.18em~0.3em]`(넓은 자간), `text-term-glow` + 글로우.
  - 키커/배지: 대문자 + `tracking-[0.1em~0.15em]`, `text-term-faint`/`term-dim-2`.
  - 수치·시간·ID: 고정폭이 기본이므로 자연히 `tabular`. 필요 시 `tabular-nums`.
- 스케일(px): 헤딩 22~24 / 화면 제목 18~20 / 카드 제목 15~17 / 본문 13~14 / 메타 11~12 / 배지 9~10.

> **i18n 주의 (M17):** 대문자 + 넓은 자간(`tracking-[0.1em~0.15em]`) 관용구는 **라틴 문자 라벨에만** 적용한다.
> 한글 키커/배지에는 `tracking-normal` 이하로 유지한다(KO 글리프에서 넓은 자간은 가독성을 해침).
> 현재 지원 로케일은 **한국어(KO) + 영어(EN)** 두 가지이며, 폰트 스택 끝의 `'Noto Sans KR'`이 KO 폴백을 담당한다.
> 향후 일본어·중국어 등 추가 CJK 로케일을 지원할 경우 `'Noto Sans JP'`/`'Noto Sans SC'`를 스택에
> 추가하고, 해당 로케일에서도 자간·대문자 규칙이 라틴 전용임을 재확인한다.

---

## 3. CRT 트리트먼트 (스캔라인 · 비네팅 · 글로우 · 커서)

CRT 질감은 **앱 셸(디바이스 프레임) 최상위에 2겹 오버레이**로 깐다. 콘텐츠 위에 `pointer-events:none`로
얹어 인터랙션을 방해하지 않는다.

- **스캔라인** (`z-index:30`, `pointer-events:none`):
  `background-image: repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0 2px, rgba(0,0,0,0.16) 2px 3px)`
  — 2px 간격의 미세 가로 줄무늬.
- **비네팅** (`z-index:29`, `pointer-events:none`):
  `background: radial-gradient(125% 100% at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.55) 100%)`
  — 가장자리로 갈수록 어두워지는 화면 곡률 인상.
- **인광 글로우**: 본문 전역 `text-shadow:0 0 1px rgba(54,196,111,0.35)`, 헤딩/CTA/워드마크는 더 강한
  녹색 글로우(§1.5), 활성 CTA 면은 `box-shadow` 녹색 발광.
- **블링킹 커서** (`.term-cursor`): 폭 ~8px의 발광 녹색 블록, `step-end`로 깜빡임.
  ```css
  @keyframes termBlink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  .term-cursor { display:inline-block; width:8px; background:#5cff9a;
    box-shadow:0 0 6px rgba(92,255,154,0.7); animation:termBlink 1s step-end infinite; }
  @media (prefers-reduced-motion: reduce){ .term-cursor{ animation:none } }
  ```
  프롬프트 줄(`aidit@yoon:~$ feed --sort=popular ▌`)·주소 추천(`/c/home-cooking ▌`) 등에 붙인다.
- **스크롤바**(웹킷): `width:7px`, thumb `#185c33`(=`term-border-dim`), track `#04130b`, `border-radius:0`.
- **placeholder**: `color:#176a3b`(=`term-faint`), `opacity:1`.
- **코너**: `border-radius` 2~4px로 거의 각진 형태(터미널 박스 느낌). pill 금지.

---

## 4. 적용 지점 (컴포넌트)

| 영역 | 적용 |
| --- | --- |
| **앱 셸**(`AppLayout`/디바이스 프레임) | `bg-term-screen` + 스캔라인/비네팅 오버레이 2겹 + 전역 본문 글로우. |
| **헤더** | 좌: 로고 마크 SVG(번개형 "A" path) + `AIDIT` 워드마크(`term-glow`, 넓은 자간). 우: `[ {user} ]` 또는 `[ Login ]`(로그아웃 시 `term-amber`). 하단 `border-term-line`. |
| **하단 탭바**(홈/검색/작성/나) | `bg-term-nav` + 상단 `border-term-line`. 라인 아이콘 SVG + 라벨. 활성 = `term-amber`, 비활성 = `term-dim-2`. |
| **피드/탭**(인기·최신) | 탭 컨테이너 `border-term-line`. 활성 탭 = `term-amber` 글자 + `rgba(255,207,74,0.06)` 배경 + 하단 `term-amber` 보더. 비활성 = `term-dim-2`. 상단에 `ShellPrompt` 컴포넌트 렌더링(아래 참조). |
| **`ShellPrompt`** (전 주요 화면 공통) | 모든 주요 화면 **최상단**에 고정 렌더링되는 재사용 컴포넌트. 형식: `aidit@<user>:~$ <command> ▌` — `<user>`는 인증 스토어에서 주입(미인증 시 `'guest'` 폴백). 커서(`.term-cursor`)는 §3 blinking cursor 스펙 그대로. 글자 색 `term-faint`(접두), `term-dim`(명령), 커서 `term-glow`. **명령어는 번역하지 않는다**(터미널 관용구; UGC 인자 — 슬러그·검색어·글 번호 등 — 만 현재 언어 값을 그대로 보간). 화면별 명령 매핑: <br>• 피드(인기/최신) → `feed --sort=popular` / `feed --sort=new` <br>• 커뮤니티 상세 → `feed r/<slug>` <br>• 검색 → `grep -ri "<query>"` <br>• 글 상세(스레드) → `tail -f /p/<id>` <br>• 글 작성 → `post --new [r/<slug>]` <br>• 커뮤니티 생성 → `mkdir /c/new` <br>• 내 프로필 → `whoami` <br>• 로그인 화면 → `login` |
| **카드(POST/커뮤니티/내 글)** | `bg-term-panel` + `border-term-border` + radius 2px. 상단에 음각 라벨 배지(`POST`/`PERSONA`/`API KEY`, `term-faint`, 카드 보더 위에 겹침). 제목 `term-fg-bright` + 글로우, 메타 `term-dim`. |
| **CTA 버튼**(게시·만들기·시작하기·전송) | `bg-term-cta`(녹색 세로 그라디언트) + `border-term-active` + `term-fg-bright` 글자 + 글로우 + box-shadow. 라벨은 `[ 게시하기 ]`처럼 대괄호 래핑. |
| **2차/토글 버튼** | `border-term-border` + `term-fg`/`term-dim`. 체크박스는 `[X]`/`[ ]` 글리프(ON = `term-amber`). |
| **파괴적 버튼**(로그아웃·`[x]` 제거) | `border-term-red-line` + `bg-term-red-bg` + `term-red` 글자. |
| **입력/textarea/검색** | `bg-term-sunken` + `border-term-border` + 글자 `term-glow`, placeholder `term-faint`. 검색은 `>` 프롬프트 접두. radius 2px. |
| **채팅 버블**(`ChatBubble`) | §1.6 표 — 본인=CTA 그라디언트, 타인=패널, AI=앰버 틴트(`[AI]` 라벨 `term-amber`). 본인 읽음 `✓ {time}` `term-dim-3`. |
| **요약/AI 안내**(`SummaryBubble`) | 앰버 틴트 패널 + `term-amber` 라벨. AI 로딩은 점/스파클 대신 터미널풍 인디케이터. |
| **로그인 모달** | `bg-term-modal` + `border-term-active` + 강한 box-shadow 글로우. 로고 락업 + `[ 시작하기 ]` CTA. `[x]` 닫기. 키 경고 = 앰버 박스. |
| **이모지 → SVG** | 모든 장식 이모지(🏠🔍＋👤🤖🍳📌✨ 등)는 **인라인 라인 SVG**(currentColor, stroke 1.5~1.7)로 교체. 텍스트 글리프(`▲`·`✓`·`▾`·`‹`·`⋯`·`[x]`·`>`)는 모노폰트로 그대로 사용 가능. |
| **`LangToggle`** (언어 전환) | `[ KO \| EN ]` 세그먼트 컨트롤. 활성 세그먼트 = `text-term-amber`(앰버, §1.4), 비활성 = `text-term-dim` + hover `text-term-bright`. 브래킷·구분자(`[`, `\|`, `]`)는 `term-faint`로 담아 터미널 관용구 유지. 기존 `AppLayout` 2차 버튼(`border-term-border`, `bg-term-panel`, radius 2px)과 동일한 표면 스타일. `variant='header'`는 헤더 우측 `[ {user} ]` 영역 옆에 삽입, `variant='setting'`은 프로필/설정 화면 "언어 / Language" 행에 삽입(WIREFRAME.md §9 참조). 버튼 전체 터치 타깃 ≥ 44px. |
| **테마/메타** | `index.html` `theme-color` + manifest `theme_color` → `#04130b`(터미널 배경). |

---

## 5. 품질 바닥선 (Quality floor)

- **반응형**: 모바일 360–430px 우선. 가로 스크롤 금지(넓은 표/차트는 자체 컨테이너에서 스크롤).
- **터치 타깃 ≥ 44px**: 탭바 항목·전송 버튼·CTA·닫기 등 인터랙션 요소는 시각 radius가 작아도
  히트 영역 44px 이상 확보.
- **포커스 가시성**: `focus-visible`에 `term-active`(`#2bd46f`) 링/보더로 명확한 키보드 포커스 표시.
  CRT 오버레이는 `pointer-events:none`이므로 포커스/클릭을 가리지 않는다.
- **prefers-reduced-motion**: 커서 블링크 등 모든 애니메이션을 `@media (prefers-reduced-motion: reduce)`
  에서 정지. 스캔라인/비네팅/글로우는 **정적**이라 모션 우려 없음.
- **대비**: 본문은 어두운 패널 위 `term-fg`(`#36c46f`) 이상, 강조는 `term-fg-bright`/`term-glow`로
  충분한 명도 차 확보. 가장 약한 `term-faint`는 placeholder·장식 메타 등 비필수 텍스트에만 사용.
- **로케일 텍스트 오버플로**: EN 문자열은 KO 대비 최대 40 % 길어질 수 있다. 버튼·배지·카드 제목 등
  고정 폭 컨테이너는 `overflow-hidden text-ellipsis whitespace-nowrap`(한 줄) 또는 `line-clamp-*`(복수 줄)로
  처리한다. "가로 스크롤 금지" 규칙은 로케일과 무관하게 적용된다.
- **날짜·숫자 포맷**: 렌더링 시 `new Intl.DateTimeFormat(lang)` / `new Intl.NumberFormat(lang)` 을 사용한다.
  하드코딩된 `'YYYY.MM.DD'` / `'1,234'` 형식 문자열은 허용하지 않는다.
- **회귀 금지**: 기존 정렬 보정(`UI-ALIGNMENT-AUDIT.md`)과 라우팅·폼 검증·BYOK·SSE·요약 로직은 불변.
  **표현 계층(클래스/마크업/이모지→SVG)만** 변경한다.
</content>
</invoke>
