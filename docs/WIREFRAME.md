# Aidit — Wireframe & Interaction Spec

> Companion to [PRD.md](./PRD.md) & [TRD.md](./TRD.md). Mobile-first (360–430px). ASCII low-fi wireframes.
> 범례: `[버튼]` `(입력)` `‹좌버블›` `›우버블‹` `≈요약버블≈` `⟳로딩`
>
> **2026-06-18 비주얼 리디자인 (v0.3)** — 게시글(Thread) 화면을 레퍼런스 모바일 채팅 UI에 맞춰
> 리팩토링한다. 핵심 변경: ① **브랜드 컬러 블루(#2563eb) → 바이올렛(#7c3aed)**, ② 모든 버블에
> **아바타** 추가(타인/AI=좌, 본인=우), ③ Thread 상단을 **글 상세 헤더**(‹뒤로 · 제목 · 북마크 · ⋯)로,
> ④ 원본 게시글 카드에 **📌 라벨 + 아바타 + 좋아요/댓글 카운트 + 북마크**, ⑤ Composer를
> **알약형 입력 + ＋첨부 + 바이올렛 원형 전송**, ⑥ 본인 버블 **읽음 체크(✓)**, AI 타이핑
> **✨ 반짝임 인디케이터**. 정확한 토큰/클래스 사양은 **§6.3 비주얼 리팩토링 사양**을 단일 출처로 따른다.

---

## 0. 화면 인벤토리 & 내비게이션

```
Login ──▶ Home ──┬──▶ Community(검색결과/상세) ──▶ Thread
                 ├──▶ Thread (인기글 직접 진입)
                 ├──▶ CreatePost  ──▶ Thread (게시 후)
                 └──▶ CreateCommunity ──▶ Community

하단 탭바(모바일):  [🏠 홈]  [🔍 검색]  [＋ 작성]  [👤 나]
```

---

## 1. Login (로그인 = username + Google API Key)

```
┌────────────────────────────┐
│            Aidit            │
│   하나의 AI를 함께 쓰는 커뮤니티  │
│                            │
│  사용자 이름                  │
│ (  e.g. yoon              ) │
│                            │
│  Google AI Studio API Key   │
│ ( ••••••••••••••••        ) │
│  ⚠ 키는 이 기기(localStorage)  │
│    에만 저장되며 서버로 전송되지  │
│    않습니다.                  │
│                            │
│        [  시작하기  ]         │
│                            │
│  키 발급받기 → aistudio.google │
└────────────────────────────┘
```
- 검증: 둘 다 입력 시 활성. (선택) "시작하기" 시 `countTokens` 1회로 키 유효성 가벼운 확인.
- 저장: `localStorage{ username, googleApiKey }`. 서버에는 username만 upsert(`POST /auth/session`).
- 미로그인도 홈/스레드 **열람**은 가능 → 쓰기/`@AI` 시점에 이 화면으로 유도.

---

## 2. Home (인기 피드 + 커뮤니티 검색)

**모바일** (검색은 상단 진입 / 데스크톱은 우측 패널)
```
┌────────────────────────────┐
│ Aidit            (🔍) (👤) │  ← 탭: 인기 | 최신
│ ──────────────────────────  │
│ ┌────────────────────────┐ │
│ │ r/cooking · ChefBot🍳   │ │  ← 커뮤니티 · 페르소나 배지
│ │ 자취 요리 3분 레시피 모음   │ │  ← 제목
│ │ ▲ 128  💬 24  · 2h      │ │  ← score / 댓글 / 시간
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ r/devlife · SrDev👩‍💻     │ │
│ │ 모노레포 빌드 느림 해결법    │ │
│ │ ▲ 96   💬 41  · 5h      │ │
│ └────────────────────────┘ │
│  ⋯ (무한 스크롤, 커서)        │
└────────────────────────────┘
  [🏠]   [🔍]   [＋]   [👤]
```

**데스크톱 (≥1024px)** — 우측 커뮤니티 검색 패널
```
┌───────────────────────────┬──────────────────┐
│  [인기] [최신]              │ 커뮤니티 검색       │
│  ┌─ PostCard ─┐            │ ( cook…         ) │
│  │ ...        │            │ ─────────────── │
│  └────────────┘            │ • r/cooking 🍳   │
│  ┌─ PostCard ─┐            │ • r/cookware     │
│  │ ...        │            │ [+ 커뮤니티 만들기] │
│  └────────────┘            │                  │
└───────────────────────────┴──────────────────┘
```
- **FR-1.1** 인기 정렬(hotScore). **FR-1.2** 검색 부분일치. **FR-1.3** 열람은 비로그인 허용.

---

## 3. Community 검색 / 상세

```
┌────────────────────────────┐
│ (🔍 cook                  ) │
│ ──────────────────────────  │
│ • r/cooking 🍳  멤버글 240   │
│ • r/cookware    멤버글 12    │
│ ──────────────────────────  │
│ 결과 없음? [+ 'cook' 만들기] │
└────────────────────────────┘
        │ (커뮤니티 선택)
        ▼
┌────────────────────────────┐
│ ‹ r/cooking   🍳 ChefBot    │
│ "친절한 3분 요리 셰프 페르소나" │ ← personaPrompt 요약(생성자는 ✎편집)
│ ──────────────────────────  │
│ [＋ 이 커뮤니티에 글쓰기]      │
│ ── 인기글 ──                 │
│ ┌─ PostCard ─┐ ...          │
└────────────────────────────┘
```

---

## 4. CreateCommunity (사용자 생성 + 페르소나)

```
┌────────────────────────────┐
│ ‹ 커뮤니티 만들기             │
│ 이름        ( 요리 초보      ) │
│ 주소(slug)  ( r/cook-newbie ) │  ← 고유, 자동 제안
│ 설명        ( 자취 요리...   ) │
│ ──────────────────────────  │
│ 🤖 AI 페르소나 프롬프트        │
│ ┌────────────────────────┐ │
│ │ 너는 친절한 3분 요리 셰프.  │ │  ← FR-3.1/3.2: 모든 AI 호출
│ │ 초보 눈높이로 단계별 설명…   │ │     의 systemInstruction
│ └────────────────────────┘ │
│        [  만들기  ]          │
└────────────────────────────┘
```

---

## 5. CreatePost (글 작성)

```
┌────────────────────────────┐
│ ‹ r/cooking 에 글쓰기         │
│ 제목 ( 계란만 있을 때 뭐 해먹지?) │
│ ┌────────────────────────┐ │
│ │ 본문…                    │ │
│ └────────────────────────┘ │
│  ☑ 게시 후 AI 1차 답변 받기   │ ← 기본 ON (FR-4.3)
│        [  게시하기  ]         │
└────────────────────────────┘
```
**게시 인터랙션 (FR-4.2/4.3)**
```
[게시] → ① POST /posts (먼저 등록) → ② Thread로 즉시 이동
        → ③ (작성자 키) Gemini 호출, 상단 원본 아래 ‹⟳ ChefBot 입력 중…›
        → ④ 응답 도착 → ‹ChefBot🍳: 계란이면 …› 좌버블 등록 (SSE로 전원 동기화)
```

---

## 6. Thread (★ 핵심: 상단 원본 + 채팅방형 댓글) — **v0.3 리디자인**

```
┌────────────────────────────┐
│ ‹  Aidit 사용자 경험에 대한…  🔖 ⋯│  ← 글 상세 헤더(뒤로·제목 중앙·북마크·메뉴)
│ ┌──────────────────────────┐ │
│ │ 📌 원본 게시글             │ │  ← 바이올렛 라벨
│ │ Aidit에서 가장 좋았던 점은?  │ │  ← 제목(굵게)
│ │ (👤) 익명 사용자 · 1시간 전  ♡12 💬8 │ │ ← 아바타+작성자·시간 / 우측 좋아요·댓글
│ └──────────────────────────┘ │  (카드: 흰 배경, 라운드, 옅은 그림자)
│ ─────── 대화 ───────          │
│                            │
│ (🟢)타인 사용자 A            │  ← 타인 = 좌, 아바타 좌측
│  └‹ 깔끔한 UI가 마음에 들어요  │     회색 버블, 꼬리 좌하
│    1시간 전                  │
│                            │
│        나 ▶ 저는 AI 요약이…›┐(👩)│  ← 본인 = 우, 아바타 우측
│              1시간 전 ✓     │     바이올렛 채움, 꼬리 우하, 읽음 ✓
│                            │
│ (🟣)Aidit AI [AI]           │  ← AI = 좌, 그라데이션 로봇 아바타 + AI 배지
│  └‹ 핵심 포인트는 … (연보라)  │
│    59분 전                  │
│                            │
│ (🟣)Aidit AI [AI]           │  ← AI 답변 로딩(PENDING)
│  └‹ ✨ AI가 답변을 작성 중… •••│
│ ──────────────────────────  │
│ (＋) ( 메시지를 입력하세요…  ) (↑)│  ← Composer: ＋첨부·알약입력·바이올렛 전송
└────────────────────────────┘
```

### 6.1 버블 타입별 스타일 (v0.3)
| 타입 | 위치 | 아바타 | 색/표시 |
|------|------|--------|---------|
| 본인 사람댓글 | 우측 | 우측(본인) | **바이올렛 채움**(`bg-brand`/흰 글씨), 꼬리 우하, 메타에 **읽음 ✓** |
| 타인 사람댓글 | 좌측 | 좌측(시드색) | 회색(`bg-slate-100`), 상단 작성자명, 꼬리 좌하 |
| AI 답변 | 좌측 | 좌측(그라데이션 로봇) | 연보라(`bg-purple-50` 테두리`purple-200`) + 페르소나명 + "AI" 배지 |
| **AI 요약** | 좌측(전폭 띠) | 없음 | **앰버→보라 그라데이션 + ≈요약≈ 라벨**(색 구분, FR-7.4) |
| 로딩(사람) | 해당 위치 | 해당 | `⟳ 입력 중…` 점 애니메이션 |
| 로딩(AI) | 좌측 | 로봇 | **`✨ AI가 답변을 작성하고 있어요… •••`** |
| 실패 | 해당 위치 | 해당 | 빨강 테두리(`border-red-400`/`bg-red-50`) + `↻ 재시도` |

> 버블 최대폭 78%, 아바타는 `h-8 w-8`(32px) 원형, 버블과 `gap-2`. 본인 행은 `flex-row-reverse`로
> 버블 우측·아바타 더 우측. 타인/AI 행은 아바타 좌측·버블 우측.

### 6.2 @AI 인터랙션 타임라인 (FR-6.2)
```
사용자가 "@AI ..." 전송
 t0  › 내 댓글 ‹  우측 즉시 등록 (먼저 보임)
 t1  ‹ ⟳ 입력 중…  좌측 PENDING placeholder
 t2  GET /context → 128K 판정
 t3  (초과 시) §7 요약 분기 먼저
 t4  Gemini 응답 → ‹AI 답변› 으로 placeholder 교체, SSE 전원 동기화
```

---

## 6.3 비주얼 리팩토링 사양 (v0.3, 2026-06-18) — **구현 단일 출처**

> 레퍼런스 이미지 2종(모바일 채팅형 게시글 UI) 분석 결과. 아래 토큰/클래스를 **그대로** 구현한다.
> 기존 동작·라우팅·BYOK·SSE·상태 로직은 **불변**(L1/L4/L5 그대로). 순수 표현 계층만 변경.

### A. 디자인 토큰 (전역)
| 토큰 | Before | After | 적용처 |
|------|--------|-------|--------|
| `brand.DEFAULT` | `#2563eb` (blue-600) | **`#7c3aed`** (violet-600) | 본인 버블, 전송 버튼, 로고, 활성 탭, 링크 |
| `brand.dark` | `#1d4ed8` | **`#6d28d9`** (violet-700) | hover/pressed |
| AI 액센트 | `purple-*` | `purple-*` 유지 | AI 버블·배지·요약 |
| `index.html` `theme-color` | `#0f172a` | **`#7c3aed`** | PWA 상태바 |

`tailwind.config.js`의 `colors.brand`만 교체하면 `bg-brand`/`text-brand`/`border-brand` 전부 자동 반영
(AppLayout 로고, BottomTabBar 활성색, Composer/ChatBubble 본인측, Login 버튼 등). **하드코딩된 blue-600
잔재가 없는지** 확인.

### B. Avatar 컴포넌트 (신규 `frontend/src/components/Avatar.tsx`)
원형 아바타. **Tailwind purge 안전을 위해 색상은 동적 문자열 금지** — 아래 정적 클래스 배열에서 선택.
```
props: { kind: 'user' | 'me' | 'ai'; seed?: string | null; size?: 'sm'|'md'; className? }
size: sm = h-7 w-7 text-[13px], md = h-8 w-8 text-sm (기본 md)
```
- **user/me**: 시드(username) 해시로 팔레트 인덱스 선택 → 정적 클래스 사용. 내용은 사람 실루엣 SVG
  (또는 username 첫 글자 이니셜, 흰 글씨). 팔레트(정적, 6색):
  `['bg-violet-500','bg-emerald-500','bg-sky-500','bg-rose-500','bg-amber-500','bg-indigo-500']`
  해시: `seed`의 코드포인트 합 `% 6`. seed 없으면 `bg-slate-400`.
- **ai**: `bg-gradient-to-br from-violet-500 to-purple-600`, 흰 로봇 글리프(🤖 또는 SVG).
- 공통: `flex shrink-0 items-center justify-center rounded-full text-white`. 터치 무관(표시용, `aria-hidden`).

### C. Thread 글 상세 헤더 (Thread.tsx `<header>` 교체)
기존 `PersonaBadge`만 있던 헤더 → 글 상세 헤더로 교체:
```
[‹ 뒤로]  [ 글 제목(중앙, 1줄 truncate, font-semibold) ]  [🔖 북마크]  [⋯ 메뉴]
```
- 컨테이너: `flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2`.
- 뒤로: `navigate(-1)` 동작, `h-9 w-9` 터치 타깃, ‹ chevron(SVG/문자).
- 제목: `flex-1 truncate text-center text-base font-semibold text-slate-900` = `post.title`.
- 북마크: **로컬 토글(useState, 표시용)** — 채워짐/비움 토글, `aria-pressed`. 백엔드 미연동(주석 명시).
- 메뉴(⋯): 표시용 버튼, 현재 동작 없음(placeholder, `aria-label`만). 페르소나 정보는 이 메뉴/원본 카드로 이전.

### D. 원본 게시글 카드 (Thread.tsx `<article>` 재스타일)
```
┌ (카드: rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-3, mx-3 my-3) ┐
│ 📌 원본 게시글            ← inline-flex, text-xs font-semibold text-brand, 📌 아이콘
│ {post.title}              ← text-base font-bold text-slate-900 (mt-1)
│ {SafeMarkdown(post.body)} ← mt-2 text-sm text-slate-700 (있을 때만)
│ ─ 메타행(mt-3 flex items-center gap-2 text-xs text-slate-500) ─
│ (Avatar sm, seed=authorName) u/{authorName} · {상대시간}   [우측 ml-auto] ▲{score} 💬{commentCount}
└────────────────────────────────────────────────────────┘
```
- 좋아요/점수: 기존 `post.score`를 `▲`(또는 하트) 아이콘과 함께 표시(읽기 전용, 기존과 동일 비기능).
- 댓글 수: `post.commentCount`. (Post DTO에 존재.)

### E. ChatBubble (행 레이아웃 전면 교체)
행 컨테이너: `flex w-full items-end gap-2 px-2 py-1` + 본인이면 `flex-row-reverse`.
1. **아바타**(행 끝): `<Avatar kind={isAi?'ai':side==='right'?'me':'user'} seed={authorUsername} size="md" />`.
   - PENDING/연속 동일 작성자 묶음 최적화는 범위 외(매 버블 아바타 표시로 단순화).
2. **버블 묶음**(`flex max-w-[78%] flex-col`):
   - 좌측 헤더(타인=작성자명, AI=페르소나명+`AI`배지) — 기존 유지, 아바타로 이동했으므로 이모지 중복 제거.
   - 버블 surface:
     - 본인(우): `bg-brand text-white rounded-2xl rounded-br-md`.
     - 타인(좌): `bg-slate-100 text-slate-800 rounded-2xl rounded-bl-md`.
     - AI(좌): `bg-purple-50 text-slate-800 border border-purple-200 rounded-2xl rounded-bl-md`.
     - 실패: `!border !border-red-400 !bg-red-50 !text-red-900` 오버라이드(기존 유지).
   - 메타행: 시간 + **본인 COMPLETE면 읽음 `✓`**(`text-brand`/`opacity-70`), 실패면 `↻ 재시도`.
3. **AI 로딩(PENDING)**: 점 3개 대신 `✨ AI가 답변을 작성하고 있어요… •••` (sparkle + 점 애니메이션).
   사람 PENDING은 기존 `⟳ 입력 중…` 유지.

### F. Composer (입력 행 재스타일)
- 컨테이너 배경/토글행은 유지하되 색을 바이올렛 계열로(`accent-violet-600`, `text-brand`).
- 입력 행: 왼쪽 **＋ 첨부 버튼**(`h-9 w-9 rounded-full text-slate-400`, 표시용 placeholder — 동작 없음, 주석 명시)
  + **알약형 입력**(`flex-1 rounded-full border bg-slate-50 px-4`) + **원형 전송 버튼**
  (`h-11 w-11 rounded-full bg-brand`(@AI/AI모드면 `bg-purple-600`) `text-white`, ↑ 아이콘).
- placeholder: `메시지를 입력하세요…` (AI모드면 `AI에게 메시지 보내기…`). 기존 @AI 칩/감지 로직 유지.

### G. 변경 없음(불변)
- 라우팅, 스토어, 엔진(contextEngine/retry), SSE, BYOK 키 흐름, 요약 트리거 로직, 접근성 터치≥44px.
- SummaryBubble은 토큰만 정합(이미 amber→purple). PersonaBadge는 `bg-brand/10`로 자동 바이올렛.

---

## 7. 자동 요약 (128K) — Thread 내 표현 (FR-7)

```
│ ‹유저A  …긴 토론…           │
│          나 ▶ › …많은 댓글… ‹│
│                            │
│ ╔══════════════════════════╗│  ← 새 세그먼트 경계
│ ║ ≈ AI 요약 (여기까지)  🟣   ║│  ← 색 구분 요약 버블(FR-7.4)
│ ║ 지금까지: 계란 요리 5가지   ║│
│ ║ 합의=간장계란밥, 미해결=…   ║│
│ ╚══════════════════════════╝│
│  ─ 이후 대화는 위 요약 기준 ─  │  ← 안내 마이크로카피
│                            │
│          나 ▶ › @AI 더 매운맛?‹│  ← 요약 이후 @AI
│ ‹ChefBot🍳 (요약+이후만 참조) │  ← 답변(FR-7.2)
```

**트리거 UX (FR-7.3 지연 요약)**
- 활성 세그먼트 토큰이 ~120K 근접 시 Composer 위 배지: `🟣 곧 대화가 요약됩니다`.
- 다음 `@AI` 전송 시: `⟳ 요약 정리 중…` → 요약 버블 등록 → 이어서 답변 로딩.
- 요약은 **`@AI` 호출자 키로** 수행됨을 툴팁으로 고지(비용 투명성, 리스크 완화).

---

## 8. 빈/에러/로딩 상태

```
빈 홈:      "아직 인기글이 없어요. [＋ 첫 글 쓰기]"
빈 스레드:   원본만 + "첫 댓글을 남겨보세요 / @AI 로 질문해보세요"
키 무효:    ‹↻ AI 응답 실패 — 키를 확인하세요  [설정]›   (사람댓글은 유지)
쿼터 초과:   ‹↻ 호출 한도 — 잠시 후 재시도›
오프라인:    상단 띠 "오프라인 — 재연결 중…", SSE Last-Event-ID 재생
```

---

## 9. 프로필/설정 (👤)

```
┌────────────────────────────┐
│ 👤 yoon                     │
│ • 내가 만든 커뮤니티           │
│ • 내 글 / 내 댓글             │
│ ──────────────────────────  │
│ 🔑 API Key  ( ••••  )[변경]  │  ← localStorage 갱신
│ [로그아웃] (username+key 삭제) │
└────────────────────────────┘
```

---

## 10. 컴포넌트 → 요구사항 추적

| 컴포넌트 | 화면 | 요구 |
|----------|------|------|
| `PostCard` | Home/Community | FR-1.1 |
| `CommunitySearch` | Home/검색 | FR-1.2 |
| `LoginForm` | Login | FR-2 |
| `PersonaEditor` | CreateCommunity | FR-3 |
| `PostComposer` | CreatePost | FR-4 |
| `Avatar`(user/me/ai) | Thread/원본카드 | FR-5 (v0.3 비주얼) |
| `ChatBubble`(left/right/ai/summary) | Thread | FR-5, FR-7.4 |
| `Composer`(@AI 감지) | Thread | FR-6 |
| `SummaryBubble` | Thread | FR-7 |
| `useThreadStream`(SSE) | Thread | FR-5.4 |
| `contextEngine`(128K·요약·답변) | Thread | FR-6, FR-7 |

---

## 11. 반응형 규칙
- **<768px**: 단일 컬럼, 하단 탭바, 검색은 전체화면 시트. Thread가 기본 풀스크린 채팅.
- **≥1024px**: 2–3 컬럼(좌 내비 / 중앙 피드·스레드 / 우 커뮤니티 검색·정보).
- 버블 최대폭 78%, 요약 버블은 전폭 띠. 터치 타깃 ≥44px(NFR-1).
```
