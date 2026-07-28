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
>
> **2026-06-19 그린 인광 CRT 레트로 터미널 (v0.5)** — 인디고-바이올렛 로고 리브랜딩(v0.4)을
> **전면 대체**한다. 비주얼 아이덴티티를 **그린 인광 CRT 터미널** 미감으로 재정렬한다. 핵심 변경:
> ① **브랜드 컬러 바이올렛/인디고(#7c3aed·#6848F8) → 그린 인광 팔레트(`term-*`)** — 어두운 청록 패널 +
> 밝은 녹색 글자 + 스캔라인/비네팅/글로우, ② **앰버(`term-amber`)는 활성/주의에만**, **레드(`term-red`)는
> 파괴적 동작에만**, ③ **시스템 모노스페이스**(웹폰트 CDN 없음), ④ 헤더/모달 로고는 번개형 "A" SVG 마크 +
> `AIDIT` 워드마크 락업, ⑤ 모든 장식 이모지는 라인 SVG로 교체. **색·타이포·표면·모션 사양의 단일 출처는
> [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) (v2)** 이며, 아래 본문에 남아 있는 바이올렛/`#7c3aed`/`brand` 표현은
> 모두 해당 문서의 `term-*` 토큰으로 읽는다. 시각 레퍼런스: `레트로 스타일 UI 리디자인/Aidit Retro.dc.html`.

---

## 0. 화면 인벤토리 & 내비게이션

```
Login(모달) ─▶ Home ──┬──▶ Search ──┬──▶ Community(상세) ──▶ Thread
                      │             └──▶ CreateCommunity ──▶ Community
                      ├──▶ Thread (인기글 직접 진입)
                      └──▶ CreatePost  ──▶ Thread (게시 후)

Thread ──[ 문서로 정리 ]──▶ Document(/d/:id)      Community(상세) ──[문서 탭]──▶ Document

하단 탭바(모바일):  [🏠 홈]  [🔍 검색]  [＋ 작성]  [👤 나]
상단바 우측:  ● LLM  [ {username} ] ─▶ /me (나)  ·  [ KO | EN ]  ·   비로그인 시 [ Login ] ─▶ 로그인 모달
```
> **2026-06-20 — i18n 언어 토글 (M17)** — 상단바 우측에 `[ KO | EN ]` 세그먼트 컨트롤(`LangToggle variant="header"`)을 추가한다. 활성 언어는 `text-term-amber`, 비활성은 `text-term-dim hover:text-term-bright`(터미널 앰버 브래킷 미감). 선택은 `langStore`(zustand persist, `localStorage` 키 `'aidit-lang'`)에 저장되며, 명시적 선택이 브라우저 기본값을 항상 덮어쓴다. 언어 변경 시 AI 페르소나 답변과 요약도 선택된 언어로 출력된다(UGC는 번역하지 않음). 모바일에서는 공간 절약을 위해 레이블 없이 `KO`/`EN` 두 글자만 표시한다.

> **상단바 username 진입점(2026-06-19)** — 로그인 상태에서 상단바 우측의 `[ {username} ]`은 **`/me`(나) 페이지로 이동하는 링크**다(`hover:text-term-bright`). 비로그인 시에는 같은 자리에 `[ Login ]`(`openLogin()`)이 표시된다.
> **LLM 연결 표식(2026-06-19)** — 로그인 상태에서 `[ {username} ]` **바로 좌측**에 LED 점 + `LLM` 라벨 배지(`LlmStatusBadge`)를 표시한다. **가장 최근 실제 LLM 쿼리**(`llm.generateContent`) 결과를 반영: 성공=`● 연결됨`(초록 인광 `glow`), 실패(`LlmError`)=`● 끊김`(`text-term-danger`, `animate-pulse`), 아직 호출 없음=`○ 미확인`(`text-term-faint`). hover 시 한국어 툴팁. 세션 한정(하드 리로드 시 `미확인` 초기화). **로그인/키 설정 시 키당 1회 연결 테스트**(`pingLlm` = `countTokens`, 생성 비용 0)를 돌려 첫 `@AI` 호출 전에도 배지가 즉시 연결/끊김을 표시. §9 참조.
> **Option A 동선(2026-06-19)** — **'작성' 탭(＋)은 글 작성(`/create-post`)으로 직결**한다(예전 `/create-community` 진입 폐기). **커뮤니티 만들기는 검색 화면에서만** 진입한다(상시 `[+ 커뮤니티 만들기]` 버튼 + 무결과 인라인 CTA). 데스크톱 사이드바도 "커뮤니티 만들기" 대신 **"작성"(`/create-post`, IconWrite)** 을 두며 순서는 **홈 / 검색 / 작성 / 나**. `/create-post`·`/create-community` 라우트는 **둘 다 유지**(만들기는 검색·커뮤니티 편집에서 계속 사용). **로그인은 별도 페이지가 아니라 모달 오버레이**(§1)로 어디서든 열린다(`/login` 직접 접근/딥링크는 호환 유지).

---

## 1. Login (로그인 = username + Google API Key) — **모달 오버레이 (Option A)**

> **2026-06-19** — 로그인은 **별도 페이지가 아니라 앱 위에 뜨는 모달 오버레이**다. 헤더의
> `[ Login ]`(`text-term-amber`)이나 쓰기 게이트에서 `openLogin()`으로 열리며, 폼 본체는
> `LoginForm`(닉네임/API키/경고/발급링크/제출 로직)으로 추출되어 모달·페이지 양쪽에서 공유된다.
> 오버레이: `fixed inset-0 z-[60]` + 딤 `bg-[rgba(2,8,5,0.82)]`, 중앙 카드
> `border border-term-cta bg-[#06160c] rounded-[3px] shadow-[0_0_32px_rgba(43,212,111,0.28)]`,
> 우상단 `[x]`(닫기), A-mark + `AIDIT`(glow-lg) + 부제. **배경/[x] 클릭으로 닫힘**(카드 클릭은 전파 차단),
> 제출 성공 시 닫힘. `/login` 라우트는 유지되어 페이지 셸에서 동일 `LoginForm`을 렌더(딥링크 호환,
> 성공 시 `/`로 이동). 상태는 신규 `uiStore`(`loginOpen/openLogin/closeLogin`)가 보유.
> **2026-06-20 — 실인증(JWT) 폼**: `LoginForm`은 `username` + `password`(+ 회원가입 모드는 **`비밀번호 확인`** 추가) 입력. 회원가입은 두 비밀번호가 **일치해야** 제출(불일치 시 인라인 빨간 힌트 `aria-invalid` + 가입 차단), 비밀번호 8자 이상. LLM API 키는 동일 폼의 **선택 필드**(BYOK 로컬 저장). 로그인/회원가입 토글. **세션 만료/무효 시**(시크릿 교체·이전 세션) 인증 요청 401이면 자동으로 세션 정리(LLM 키 보존) + 이 모달이 다시 열린다 — "로그인된 듯 보이나 쓰기가 401"인 좀비 상태 방지.

```
┌──── 모달 오버레이 (딤 배경 위) ───┐
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
- 미로그인도 홈/스레드 **열람**은 가능 → 쓰기/`@AI` 시점에 **로그인 모달**로 유도. 글 작성 게이트는
  하드 리다이렉트(`navigate('/login')`) 대신 **"로그인이 필요해요" 안내 + `[ 로그인 ]` 버튼(`openLogin()`)** 으로 그 자리에서 모달을 띄운다.

---

## 2. Home (인기 피드 + 커뮤니티 검색)

> **2026-07-17 업데이트**: 홈 상단을 다른 페이지와 동일한 리듬으로 통일 — 고정 상단바(`PageHeaderBar`)는 **제목 "홈"**, 그 아래 ShellPrompt(`feed --sort=…`), 그 아래 **[인기|최신] 본문 세그먼트 탭**(검색 화면 tablist와 동일 스타일) → 피드. 탭은 더 이상 sticky가 아니다(전환 시 목록 리셋·최상단 복귀라 실영향 낮음). 아래 와이어의 "[인기] [최신]" 상단바 표현은 이 업데이트 이전 기준.

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

> **2026-07-17 업데이트 (FR-1.4)**: `/search`는 이제 **[커뮤니티|게시글] 탭**을 가진 통합 검색이다(제목 "검색"). 게시글 탭은 제목·본문 부분일치(`GET /posts?q=&sort=new`), 최신순, `[ 더 보기 ]` 커서 페이지네이션. 결과 카드 = 제목 + 커뮤니티명 + `u/{author} · 점수 {score} · 댓글 {count}` 메타 → `/p/:id`. 커뮤니티 만들기 CTA·커뮤니티 결과 리스트는 커뮤니티 탭에서만 노출. 아래 와이어는 커뮤니티 탭 기준.

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
│ ┌──────────┬──────────┐     │ ← 본문 탭 (2026-07-27, FR-13.6)
│ │ 게시글    │  문서 3  │     │
│ └──────────┴──────────┘     │
│ ── 인기글 ──                 │
│ ┌─ PostCard ─┐ ...          │
└────────────────────────────┘
```

> **2026-07-27 (FR-13.6)** — 커뮤니티 상세에 **[게시글 | 문서]** 본문 세그먼트 탭을 추가한다(검색 화면 tablist와 동일 스타일: `role="tablist"`, `min-h-[44px] flex-1`, 활성 amber 언더라인 + 배경). "게시글" 탭은 기존 글 목록 그대로. **"문서" 탭**은 `GET /communities/:slug/documents`로 응결 문서를 최신순 표시하며, 카드 = 문서 제목 + 본문 미리보기 2줄 + `u/{author} · {relativeTime}` → `/d/:documentId`. 문서가 없으면 EmptyState("아직 응결된 문서가 없습니다" + 힌트: 스레드 메뉴의 `[ 문서로 정리 ]`). 탭 레이블의 개수 배지는 문서 목록을 처음 불러온 뒤에만 표시한다.

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

## 5. CreatePost (글 작성) — **'작성' 탭 직결 · 커뮤니티 피커 · 이미지 첨부 (Option A)**

> **2026-06-19** — 하단 '작성' 탭(＋)에서 곧장 도달한다. slug 라우트(커뮤니티 고정 진입)면 기존
> **커뮤니티 잠금 표시**를 유지(피커 없음). slug 없는 일반 작성이면 예전 `<select>` 대신 **펼침형
> 커뮤니티 피커**를 쓰고, 이미지 첨부 드롭존을 둔다. 가입/접근 가능한 **커뮤니티가 0개**면 피커 대신
> 검색으로 가는 **빈상태 보조 링크**를 보여준다.

```
┌──────────────────────────────────┐
│ ‹ 글 작성                          │
│ 커뮤니티                            │  ← slug 고정 진입이면 잠금 표시(피커 없음)
│ ┌──────────────────────────────┐ │
│ │ r/cooking            ▾ 변경    │ │  ← 선택 필드(없으면 '커뮤니티 선택' placeholder)
│ └──────────────────────────────┘ │
│   ▾ 펼침 패널(변경 클릭 시)         │
│   ┌────────────────────────────┐ │
│   │ > ( cook…  )                │ │  ← 이름 부분일치 필터(클라, 대소문자 무시)
│   │ [*] r/cooking               │ │  ← [*]=선택됨 / [ ]=아님
│   │ [ ] r/cookware              │ │
│   │ (일치 없음 → "일치하는 …없어요") │
│   └────────────────────────────┘ │
│   ── 커뮤니티 0개일 때(피커 대신) ── │
│   ! 가입한 커뮤니티가 없어요 ·       │  ← /search 로 가는 보조 링크(text-term-amber)
│     검색에서 만들기 →               │
│ 제목 ( 계란만 있을 때 뭐 해먹지?)     │
│ ┌──────────────────────────────┐ │
│ │ 본문…                          │ │
│ └──────────────────────────────┘ │
│ ┌── [+] 이미지 첨부 (점선 드롭존) ─┐ │  ← <input type=file accept="image/*">
│ │ PNG · JPG                      │ │     uploadImage(file,userId)→imageUrl
│ └──────────────────────────────┘ │
│ 🖼 cooking.png · 이미지 · 첨부됨 [x] │  ← 업로드 후 썸네일 칩([x]로 제거)
│  ☑ 게시 후 AI 1차 답변 받기         │ ← 기본 ON (FR-4.3)
│  AI 답변 길이                        │ ← firstAi ON일 때만 노출 (FR-11)
│  [ 짧게 ][ 보통 ][ 길게 ]            │ ← 세그먼트 3버튼, 기본=보통(활성=term-amber)
│        [  게시하기  ]               │
└──────────────────────────────────┘
```
- **AI 응답 길이(FR-11)**: `firstAi` 체크박스가 ON일 때만 그 아래에 **3단계 세그먼트 버튼**(`짧게`/`보통`/`길게`, 기본 `보통`)을 노출한다. 라벨 텍스트("len" 등) 없이 세 버튼만 두며(자명), `role="radiogroup"`에 `aria-label`을 단다. 선택값은 게시 시 `setFirstAiReply(post.id, firstAi)`와 함께 길이 핸드오프(예: `postIntentStore` 확장)로 넘겨 Thread의 1차 발화(`runPrimaryReply`)에 전달한다. 활성 버튼=`term-amber`, 비활성=`term-dim hover:term-bright`. **기본 `보통`은 지시문·토큰 상한을 모두 추가하지 않아 현행 동작과 동일**(FR-11.2).
- **커뮤니티 피커**(slug 없을 때): 선택 필드 행(`bg-term-input border border-term-border`) 왼쪽=선택된
  이름(없으면 placeholder, `text-term-bright`), 오른쪽=`▾ 변경`(`text-term-dim`). 클릭 시 펼침 패널 토글
  (상태 `pickerOpen`/`pickerQuery`, 선택은 기존 `selectedCommunityId` 유지). 패널은 `> ` 프롬프트 검색
  입력 + 행별 `[*]`/`[ ]` 마크 목록(클릭 → 선택·닫힘·쿼리 초기화). 목록은 기존 `getCommunities()` 사용.
- **빈상태 보조 링크**: slug 없는 작성 + 로드 후 `communities.length===0`일 때만 피커 대신
  `! 가입한 커뮤니티가 없어요 · 검색에서 만들기 →`(`text-term-amber`)를 `/search`로 노출. 1개 이상이면 숨김.
- **이미지 첨부**(Composer 댓글 이미지와 동일 패턴/URL 처리 재사용): 점선 드롭존 `[+] 이미지 첨부`
  (`border-dashed border-term-border`, 안내 'PNG · JPG') → 파일 선택 → `uploadImage(file, userId)` →
  반환 `imageUrl` 상태 저장 + 썸네일 칩(`[x]` 제거). 업로드 실패는 `text-term-danger` 문구. 제출 시
  `postPost({ communityId, title, body, imageUrl }, userId)`로 전송.
- **비로그인 게이트**: 하드 리다이렉트 없이 "로그인이 필요해요" 안내 + `[ 로그인 ]`(`openLogin()`)로 모달 유도(§1).
**게시 인터랙션 (FR-4.2/4.3)**
```
[게시] → ① POST /posts (먼저 등록) → ② Thread로 즉시 이동
        → ③ (작성자 키) LLM 호출, 상단 원본 아래 ‹⟳ ChefBot 입력 중…›
        → ④ 응답 도착 → ‹ChefBot🍳: 계란이면 …› 좌버블 등록 (SSE로 전원 동기화)
```

---

## 6. Thread (★ 핵심: 상단 원본 + 채팅방형 댓글) — **v0.3 리디자인**

```
┌────────────────────────────┐
│ ‹  Aidit 사용자 경험에 대한…  🔖 ⋯│  ← 글 상세 헤더(뒤로·제목 중앙·북마크·메뉴)
│ ┌──────────────────────────┐ │
│ │ 📌 원본 게시글             │ │  ← 음각 라벨(term-faint/amber)
│ │ Aidit에서 가장 좋았던 점은?  │ │  ← 제목(굵게)
│ │ (👤) 익명 사용자 · 1시간 전  ♡12 💬8 │ │ ← 아바타+작성자·시간 / 우측 좋아요·댓글
│ └──────────────────────────┘ │  (카드: 흰 배경, 라운드, 옅은 그림자)
│ ──────── 대화 ────────        │  ← 평범한 인플로우 구분선(점프 컨트롤 없음)
│                            │
│ (🟢)타인 사용자 A            │  ← 타인 = 좌, 아바타 좌측
│  └‹ 깔끔한 UI가 마음에 들어요  │     회색 버블, 꼬리 좌하
│    1시간 전                  │
│                            │
│        나 ▶ 저는 AI 요약이…›┐(👩)│  ← 본인 = 우, 아바타 우측
│              1시간 전 ✓     │     CTA 그라디언트 채움, 꼬리 우하, 읽음 ✓
│                            │
│ (🟣)Aidit AI [AI]           │  ← AI = 좌, 그라데이션 로봇 아바타 + AI 배지
│  └‹ 핵심 포인트는 … (앰버 틴트) │
│    59분 전              ┌──┐│
│                       │ ↑ ││  ← 점프 칩(스크롤 방향, 단일 슬롯)
│ (🟣)Aidit AI [AI]      └──┘│
│  └‹ ✨ AI가 답변을 작성 중…┌──┐│
│ ──────────────────────│ ↓ │┘  ← 내리면 ↓·올리면 ↑, 멈추면 1초 후 사라짐
│ (＋) ( 메시지를 입력하세요…  ) (↑)│  ← Composer: ＋첨부·입력·CTA 전송(term-cta)
└────────────────────────────┘
```

> **(2026-06-22) 스크롤 점프 — 우측 하단 방향식 단일 점프 칩(Option A).** 긴 스레드에서 위/아래 끝까지
> 이동하기 위해 스크롤 영역 우측 하단에 **사각 칩 하나**를 띄우되 **스크롤 방향**을 따른다 — 내리면 `↓`(맨 아래로),
> 올리면 `↑`(맨 위로). 슬롯에는 항상 한 개만 뜬다. 상태는 단일 `activeChip`(`'none' | 'top' | 'bottom'`)이며,
> 매 스크롤의 `scrollTop` 변화량 `dY`의 **부호로 방향을 판정**한다(deadzone 2px 미만은 미세 떨림으로 보고 현재 칩
> 유지). **속도 임계값도, reach 게이팅도 쓰지 않는다 — 오직 방향만.** 끝까지 남은 거리와 무관하게, 올리면 `↑`·
> 내리면 `↓`가 뜬다(맨 위/맨 아래에선 그 방향으로의 스크롤 자체가 불가능하므로 해당 칩은 자연히 안 뜬다).
> **`sticky bottom-3` + `h-0` 래퍼**로 스크롤 끝에 여분 공간을 만들지 않고, 안쪽 박스를 그 하단에 `absolute`로
> 앵커한다. 스크롤이 멈추면 **1초 후 페이드아웃**(스크롤마다 idle 타이머 재무장)하고, 숨김 상태(`activeChip==='none'`)
> 에선 `opacity-0` + `pointer-events-none` + `tabIndex -1`로 완전히 비활성화해 읽는 동안 버블을 가리지 않는다.
> 칩은 `bg-term-card/85 backdrop-blur`(반투명 + 블러)로 버블 위에 떠도 분리되며, hover 시 `shadow-glow-soft`.
> `jumpTo`는 `isProgrammatic` 플래그로 **자기 트리거(스무스 스크롤이 만든 스크롤 이벤트)를 차단**하고 탭 즉시 칩을
> 숨긴 뒤, 스크롤 컨테이너(`scrollRef`)를 양 끝으로 `scrollTo`(top→`{top:0}`, bottom→`{top:scrollHeight}`)한다.
> `prefers-reduced-motion`이면 smooth→auto. 라벨·아이콘·`onClick`은 `activeChip`에 따라 스왑한다
> (`↑`=`M6 15l6-6 6 6`, `↓`=`M6 9l6 6 6-6`). `─ 대화 ─` 구분선은 점프 컨트롤 없는 평범한 인플로우 구분선으로 둔다.
> aria-label은 `thread.jumpTopAria` / `thread.jumpBottomAria`(KO/EN).

### 6.1 버블 타입별 스타일 (v0.3)
| 타입 | 위치 | 아바타 | 색/표시 |
|------|------|--------|---------|
| 본인 사람댓글 | 우측 | 우측(본인) | **CTA 그라디언트 채움**(`bg-term-cta`/`border-term-active`), 꼬리 우하, 메타에 **읽음 ✓** |
| 타인 사람댓글 | 좌측 | 좌측(시드색) | 패널(`bg-term-panel`/`border-term-border`), 상단 작성자명, 꼬리 좌하 |
| AI 답변 | 좌측 | 좌측(SVG 로봇) | 앰버 틴트(`rgba(60,48,10,0.22)` 테두리 `term-amber-line`) + 페르소나명 + `[AI]` 라벨(`term-amber`) |
| **AI 요약** | 좌측(전폭 띠) | 없음 | **앰버 틴트 패널 + `term-amber` ≈요약≈ 라벨**(색 구분, FR-7.4) |
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
 t4  LLM 응답 → ‹AI 답변› 으로 placeholder 교체, SSE 전원 동기화
```

---

## 6.3 비주얼 리팩토링 사양 (v0.3, 2026-06-18)

> ⚠️ **색·비주얼 아이덴티티는 v2(그린 인광 CRT 터미널)로 대체됨.** 아래 B~F에 등장하는
> `bg-brand`·`text-brand`·`bg-purple-*`·`border-purple-200`·`accent-violet-600`·`from-violet-500`
> 등 **모든 바이올렛/퍼플 색 클래스는 [DESIGN-SYSTEM.md §1·§4](./DESIGN-SYSTEM.md)의 `term-*` 토큰으로
> 읽는다**(본인 버블 → `bg-term-cta`/`border-term-active`, AI 버블 → 앰버 틴트 + `term-amber-line`,
> `text-brand` → `term-fg-bright`/`term-amber`, 아바타 그라데이션 → `term-glow` 마크). 아래 명세 중
> **레이아웃·구조·인터랙션(행 배치, 헤더 구성, 메타행, 로딩 흐름)은 그대로 유효**하며 색만 v2로 매핑한다.
> 기존 동작·라우팅·BYOK·SSE·상태 로직은 **불변**(L1/L4/L5 그대로). 순수 표현 계층만 변경.

### A. 디자인 토큰 (전역) — **v2 그린 인광 CRT로 대체**

> ⚠️ 아래 표의 v0.3/v0.4 바이올렛 토큰(`brand.DEFAULT #7c3aed` 등)은 **더 이상 유효하지 않다.**
> 색 토큰의 단일 출처는 **[DESIGN-SYSTEM.md §1 컬러 토큰(`term-*`)](./DESIGN-SYSTEM.md)** 이다.

| 영역 | v2 적용 (term-*) | 적용처 |
|------|------------------|--------|
| 본인 버블 | `bg-term-cta`(녹색 세로 그라디언트) + `border-term-active` | 본인 측 채팅 버블 |
| 전송/CTA | `bg-term-cta` + `term-fg-bright` 글자 + 녹색 글로우 | 전송·게시·만들기·시작하기 |
| 로고/워드마크 | `term-glow #5cff9a` + drop-shadow 글로우 | 헤더·모달 로고 락업 |
| 활성 탭/내비 | `term-amber #ffcf4a` | 인기/최신 활성 탭, 하단 탭 활성 |
| AI 버블·배지 | 앰버 틴트 `rgba(60,48,10,0.22)` + `term-amber-line` + `[AI]` 라벨 | AI 답변·요약 |
| `index.html` `theme-color` / manifest | **`#04130b`**(터미널 배경) | PWA 상태바 |

`tailwind.config.js`의 `theme.extend.colors.term`을 정의하면 `bg-term-*`/`text-term-*`/`border-term-*`이
전 컴포넌트에 반영된다(AppLayout 셸·로고, BottomTabBar 활성색, Composer/ChatBubble, Login 등).
**하드코딩된 `#7c3aed`·`#6848F8`·`purple-*`·`violet-*`·`blue-600`·`brand-*` 잔재가 없는지** 확인한다.

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
[‹ 뒤로]  [ 글 제목(중앙, 1줄 truncate, font-semibold) ]  [🔖 북마크]
```
- 컨테이너: `flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2`.
- 뒤로: `navigate(-1)` 동작, `h-9 w-9` 터치 타깃, ‹ chevron(SVG/문자).
- 제목: `flex-1 truncate text-center text-base font-semibold text-slate-900` = `post.title`.
- **북마크 🔖** (VR-3, 2026-06-19 구현됨): **백엔드 연동 완료** — POST/DELETE `/posts/:id/bookmark` 호출. 초기값 `post.bookmarked`(서버 계산). 낙관적 토글, 로그인 필요(`openLogin()`). 실패 시 상태 롤백 + 토스트 "북마크 처리에 실패했습니다."
- **편집/삭제 슬롯 없음 (2026-06-26 이동)**: 작성자 편집/삭제 액션은 **헤더에 두지 않는다**. 헤더의 역할은 길찾기(뒤로)+정체성(제목)으로 한정하고, 소유자 액션은 글 스코프의 올바른 자리인 **원본 게시글 카드 메타행의 `[⋯]` 오버플로 메뉴**(§6.3-D)로 옮겼다. (직전 2026-06-26 [feat]에서 헤더에 `[ 편집 ]`/`[ 삭제 ]` 알약을 뒀으나 좁은 헤더에서 제목을 잘리게 하고 시각적으로 과해 같은 날 [refactor]로 카드로 이동.)

### D. 원본 게시글 카드 (Thread.tsx `<article>` 재스타일)
```
┌ (카드: rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-3, mx-3 my-3) ┐
│ 📌 원본 게시글            ← inline-flex, text-xs font-semibold text-brand, 📌 아이콘
│ {personaIcon} {community.name} · r/{slug}  ← 카테고리(커뮤니티) 링크 → /c/{slug}
│ {post.title}              ← text-base font-bold text-slate-900 (mt-1)
│ {SafeMarkdown(post.body)} ← mt-2 text-sm text-slate-700 (있을 때만)
│ ─ 메타행(mt-3 flex items-center gap-2 text-xs text-slate-500) ─
│ (Avatar sm, seed=authorName) u/{authorName} · {상대시간}   [우측 ml-auto] ▲{score} 💬{commentCount} [⋯]
└────────────────────────────────────────────────────────┘
```
- **소유자 오버플로 메뉴 `[⋯]` (2026-06-26)**: 메타행 우측(`▲점수 💬댓글수`) 끝에 **작성자에게만**(`myUserId && post.authorId === myUserId`) `[⋯]` 아이콘 버튼을 둔다(`aria-label`=`thread.moreActionsAria`). 클릭 시 Composer AI 메뉴와 동일한 팝오버 패턴(`relative` 컨테이너 + `absolute` 드롭다운, 바깥 클릭/Esc 닫힘, `aria-expanded`, `role` 지정 `thread.ownerMenuAria`)으로 메뉴를 연다(아이콘 없이 라벨만): `[ 편집 ]`(`thread.editLabel` → `/create-post` + state `{editPostId}`) / `[ 삭제 ]`(`thread.deleteLabel`, danger색). 메뉴 행은 ≥44px 터치 타깃. **삭제는 메뉴 안에서 2단계 확인** — `삭제할까요?`(`thread.deleteConfirm`) + `[ 확인 ]`(`thread.deleteConfirmYes`)·`[ 취소 ]`(`thread.deleteCancel`). 확인 시 `DELETE /posts/:id` → 성공 시 `/c/{slug}`(없으면 `/`)로 이동, 실패 시 `thread.deleteFailed` 토스트. 진행 중 버튼 비활성화.
- 좋아요/점수: `▲ + post.score`. **(2026-06-19) 이제 인터랙티브 추천 토글 버튼** — PostCard(피드)·Thread(원본 글) 양쪽에서 클릭 시 `POST/DELETE /posts/:id/upvote` 토글. 로그인 필요(`openLogin()`), 낙관적 갱신+실패 롤백, `voted=true`면 `text-term-amber` 강조. `score`는 실시간 vote count. PostCard는 카드 전체가 navigate 대상이므로 버튼이 `stopPropagation`+`preventDefault`.
- 댓글 수: `post.commentCount`. (Post DTO에 존재.)
- **카테고리(커뮤니티) 링크 (2026-06-23)**: 코너 라벨 아래·제목 위에 글의 커뮤니티(=카테고리)를 한 줄로 표시한다 — `{personaIcon} {community.name} · r/{slug}` (PostCard 커뮤니티 라인과 동일 패턴: `text-xs text-term-dim hover:text-term-bright`). 문자를 누르면 `/c/{slug}` 커뮤니티 페이지로 이동하는 `<Link>`. `community`가 아직 해결되지 않았으면(폴백) 라인을 생략한다.
- **글 이미지(2026-06-19)**: `post.imageUrl`이 있으면 본문 아래 `<img>`(`max-w-full rounded-[2px] border border-term-border`).
  src/베이스 경로 처리는 ChatBubble의 댓글 이미지 렌더 방식을 그대로 따른다(동일 업로드 경로/프록시).
  PostCard(홈/커뮤니티 리스트)도 제목 아래 작은 썸네일(`h-32` 정도, `object-cover`, `rounded-[2px] border`)로 선택 표시.

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
- placeholder: AI OFF면 `메시지 보내기…`, ON이면 `@AI 메시지 보내기…`(i18n `thread.placeholderHuman`/`placeholderAi`). 입력 앞에 `>` 프롬프트 접두(`term-faint`, 장식).
- **2026-06-23 — AI 모드를 입력창에 통합(트레일링 팝오버)**: 기존 "입력 위 컨트롤 행(`[X] AI 모드` 토글 + 길이 세그먼트) + 입력 내부 `@AI` 칩" **적층 구조를 폐기**하고, AI 컨트롤을 **입력 바 우측의 트레일링 `[🤖 AI ⌄]` 칩 하나**로 접는다. 칩을 탭하면 입력 바 위로 **한 줄 팝오버**가 열린다 — `[🤖 AI]` 사용/끄기 토글 + 구분선 + `[ 짧게 ][ 보통 ][ 길게 ]` 길이(FR-11).
  ```
  ┌ 팝오버 (입력 바 위, bottom-full) ───┐
  │ [🤖 AI] │ [ 짧게 ][ 보통 ][ 길게 ]    │
  └─────────────────────────────────────┘
   [+]  > @AI 메시지 보내기…   [🤖 AI ⌄]   [↑]
  ```
  - **상태 신호 동기화**: AI ON이면 트레일링 칩·입력 보더 `term-amber` + placeholder `@AI 메시지 보내기…`, OFF면 `term-border` 녹색 + `메시지 보내기…`. 길이 활성=`[보통]`(대괄호 + `term-amber`), 비활성=`term-dim`. **AI OFF면 길이 버튼 비활성**(disabled, `role="radiogroup"`/`role="switch"` + `aria-label`).
  - **키 기반 기본값**: 스레드 진입 시 BYOK LLM 키가 있으면 AI **ON**, 없으면 **OFF**로 시작(세션 한정·postId별 override 유지). 토글은 명시값을 `aiModeStore`에 기록.
  - **키 없음 가드 — AI 켜기 차단**: BYOK LLM 키가 없으면 **AI를 켤 수 없다**. 팝오버에서 AI 토글을 눌러도 켜지지 않고(OFF 유지), **팝오버 안에 앰버 경고**(`thread.aiNoKeyHint` + `키 등록하기 →` → `/me/settings`)만 뜬다(기존 전송 시 토스트에서 이동). 키 없는 사용자의 댓글은 항상 일반 댓글로 등록.
  - **수동 `@AI` 단축 제거**: 본문에 `@AI`를 타이핑해 라우팅하던 경로와 멘션 안내 행(`mentionIndicator`)을 삭제. AI 여부는 **오직 토글**로 결정(`wantsAI = aiMode`).
  - 모드·길이 상태 모두 세션 한정·postId별·미영속. 팝오버 버튼 터치 타깃 ≥44px, 길이 선택 시 자동 닫힘, 바깥 클릭/Esc로 닫힘. 기본 `보통`은 지시문·토큰 상한을 추가하지 않아 현행 동작과 동일(FR-11.2).

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

## 9. 프로필 (/me) — **탭형 활동 피드 + 설정 진입점 (2026-06-21 v0.6)**

> **v0.6 리디자인** — API Key·언어·로그아웃 설정을 `/me/settings`(§9.1)로 분리하고,
> /me 본문을 **[ communities | posts | bookmarks ]** 세 탭의 무한 스크롤 피드로 전환한다.
> 탭 UI·IntersectionObserver sentinel·opaque nextCursor·로딩/EOF 상태는 **Home 피드 패턴과 동일**.
> 비로그인 시 기존과 동일한 `EmptyState`("로그인이 필요해요") 표시.

```
┌────────────────────────────┐
│ $ whoami                   │  ← ShellPrompt 헤더 (term-dim)
│ > yoon                     │  ← 로그인 사용자명 (term-amber)
│                    [ ⚙ ]   │  ← 우상단 설정 진입점 → /me/settings
│ ──────────────────────────  │
│ [ communities ][ posts ][ bookmarks ] │  ← 세그먼트 탭 컨트롤
│   ^^(활성=term-amber 밑줄)             │     비활성=term-dim, hover=term-bright
│ ──────────────────────────  │
│  (활성 탭 콘텐츠 — 아래 참조)   │
└────────────────────────────┘
  [🏠]   [🔍]   [＋]   [👤]
```

### 탭 1 — communities

```
┌────────────────────────────┐
│ $ whoami                   │
│ > yoon              [ ⚙ ] │
│ ──────────────────────────  │
│ [ communities ][ posts ][ bookmarks ] │
│ ──────────────────────────  │
│ $ ls ~/communities         │  ← 탭별 ShellPrompt (term-dim)
│                            │
│ ┌────────────────────────┐ │
│ │ r/cooking   🍳 ChefBot  │ │  ← CommunityCard (PostCard 스타일)
│ │ 친절한 3분 요리 셰프       │ │
│ │ 멤버 · 240글              │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ r/devlife   👩‍💻 SrDev    │ │
│ │ 시니어 개발자 페르소나       │ │
│ │ 멤버 · 41글               │ │
│ └────────────────────────┘ │
│          ⟳ 로딩 중…         │  ← sentinel(IntersectionObserver) 트리거
│  ─────── EOF ───────        │  ← 마지막 페이지 도달 시
│  (빈상태: "가입한 커뮤니티가    │
│           없어요")           │
└────────────────────────────┘
```

### 탭 2 — posts

```
│ [ communities ][ posts ][ bookmarks ] │
│ ──────────────────────────  │
│ $ ls ~/posts               │
│                            │
│ ┌────────────────────────┐ │
│ │ r/cooking · 2h          │ │  ← PostCard (Home 피드와 동일)
│ │ 자취 요리 3분 레시피 모음  │ │
│ │ ▲ 128  💬 24            │ │
│ └────────────────────────┘ │
│          ⟳ 로딩 중…         │
│  ─────── EOF ───────        │
│  (빈상태: "작성한 글이 없어요") │
```

### 탭 3 — bookmarks

```
│ [ communities ][ posts ][ bookmarks ] │
│ ──────────────────────────  │
│ $ ls ~/bookmarks           │
│                            │
│ ┌────────────────────────┐ │
│ │ r/cooking · ChefBot🍳  │ │  ← PostCard (북마크 시각순)
│ │ 자취 요리 3분 레시피 모음  │ │
│ │ ▲ 128  💬 24            │ │
│ └────────────────────────┘ │
│          ⟳ 로딩 중…         │
│  ─────── EOF ───────        │
│  (빈상태: "북마크한 글이 없어요") │
```

### 인터랙션 규칙
- **탭 전환**: 클릭 즉시 활성 탭 변경. 해당 탭이 아직 로드되지 않았으면 **처음 진입 시 1페이지만 fetch**(지연 로드). 이미 로드된 탭은 캐시 유지(탭 재클릭 시 재요청 없음).
- **무한 스크롤**: `usePagedList` 훅 — `items`, `cursor`, `loading`, `done`, `error`, `sentinelRef`, `loadMore`를 캡슐화. 세 탭 모두 이 훅을 사용. sentinel `<div ref={sentinelRef} />` 뷰포트 진입 → `loadMore()` 호출 → cursor 이어 붙임.
- **커서 페이지네이션**: `GET /users/:id/communities?cursor=`, `GET /users/:id/posts?cursor=`, `GET /users/:id/bookmarks?cursor=` — 각각 `{ items, nextCursor }` 반환. `nextCursor`가 `null`이면 EOF.
  - communities: `createdAt desc, id desc`로 정렬; cursor = community.createdAt(ms) + community.id.
  - posts: `createdAt desc, id desc`; cursor = post.createdAt(ms) + post.id (피드 패턴 동일).
  - bookmarks: **bookmark 행 기준** `bookmark.createdAt desc, bookmark.id desc`; cursor = bookmark.createdAt(ms) + bookmark.id (post.createdAt 아님).
- **설정 진입점**: 헤더 우상단 `[ ⚙ ]`(`text-term-dim hover:text-term-bright`, 터치 타깃 ≥44px) → `/me/settings`로 이동.
- **비로그인**: 탭 렌더 없이 `EmptyState`("로그인이 필요해요 / [로그인]`openLogin()`") 표시.

---

## 9.1 설정 (/me/settings) — **신규 화면 (2026-06-21 v0.6)**

> API Key·언어·로그아웃을 /me에서 분리한 전용 설정 페이지.
> 라우트: `/me/settings` — `AppLayout` 그룹 안에 등록(`src/App.tsx`).
> 소스: `src/pages/Settings.tsx`.

```
┌────────────────────────────┐
│ ‹ /me              settings│  ← 헤더: 좌=[ ‹ /me ] 뒤로 링크, 우=워드마크
│ ──────────────────────────  │
│ $ cat ~/.config            │  ← ShellPrompt (term-dim)
│                            │
│ ── API Key ──               │
│ 🔑 Google AI Studio         │
│ ( ••••••••••••  ) [변경]     │  ← 마스킹(로컬 전용); 변경 클릭 → 인라인 입력 토글
│ ⚠ 키는 이 기기에만 저장됩니다  │  ← term-dim 경고 문구
│                            │
│ ── MY AI PERSONA ──         │
│ 슬롯 1: (이름   )            │  ← 슬롯 3개, 각각 이름 + 프롬프트 textarea
│ (프롬프트 textarea)          │
│ [ 저장 ] [ 비우기 ]           │
│ … 슬롯 2 · 슬롯 3 동일 …      │
│ ⚠ 이 기기(localStorage)에만  │  ← 로컬 전용 안내 (BYOK 키와 동일 철학)
│   저장됩니다                  │
│                            │
│ ── Language ──              │
│ 언어 / Language              │
│ [ KO | EN ]                 │  ← LangToggle variant="setting" (term-amber 활성)
│                            │
│ ── 계정 ──                   │
│ [로그아웃]                    │  ← term-red border, 클릭 → username+key 삭제 → /login
└────────────────────────────┘
  [🏠]   [🔍]   [＋]   [👤]
```

### 동작 규칙
- **뒤로 링크** `[ ‹ /me ]`: `navigate('/me')` (또는 `navigate(-1)`). `text-term-dim hover:text-term-bright`, 터치 타깃 ≥44px.
- **API Key 섹션**: 마스킹·localStorage 갱신 동작은 기존 /me의 것과 **완전 동일**. BYOK 로컬 전용 보장 불변.
- **Language**: `LangToggle variant="setting"` 재사용. 활성=`text-term-amber`, 비활성=`text-term-dim`. 선택 즉시 `langStore.setLang()` → `localStorage` + `document.documentElement.lang` 갱신.
- **로그아웃**: `username + googleApiKey` 삭제 후 `/login`으로 이동. 스타일 `border border-term-red text-term-red hover:bg-term-red/10`(위험 동작 표시).
- **ShellPrompt**: `$ cat ~/.config` (번역 없음 — 커맨드는 i18n 대상 외).
- **i18n 키** (`src/i18n/dicts/profile.ts`에 추가):
  - `settings.title` (ko: "설정" / en: "Settings")
  - `settings.back` (ko: "‹ /me" / en: "‹ /me")
  - `settings.apiKey.label` (ko: "API Key" / en: "API Key")
  - `settings.apiKey.warning` (ko: "키는 이 기기에만 저장됩니다" / en: "Key is stored on this device only")
  - `settings.language.label` (ko: "언어 / Language" / en: "언어 / Language")
  - `settings.logout` (ko: "로그아웃" / en: "Logout")

---

**2026-06-19 업데이트**: "북마크한 글" 섹션 추가.

**2026-06-20 업데이트 (M17)**: "언어 / Language `[ KO | EN ]`" 행 추가.

**2026-06-21 업데이트 (v0.6)**: /me 전면 리디자인 — 탭형 활동 피드(communities / posts / bookmarks) + `usePagedList` 무한 스크롤 + 커서 페이지네이션 + 탭별 ShellPrompt. 설정(API Key·Language·Logout)을 `/me/settings`(§9.1)로 분리. /me 헤더에 `[ ⚙ ]` 설정 진입점 추가.

**2026-07-17 업데이트 (FR-12)**: §9.1 설정에 **MY AI PERSONA** 섹션 추가 — 개인 페르소나 3슬롯(이름+프롬프트), localStorage 전용(`aidit-user-personas`). Composer AI 메뉴에는 페르소나 선택 행(`[없음]` + 저장된 슬롯 이름, 기본 없음, 세션 한정)이 추가되어 선택된 페르소나가 해당 스레드의 `@AI` 답변 systemInstruction에 커뮤니티 페르소나 다음 순서로 결합된다.

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
| `LangToggle`(header/setting variant) | AppLayout 상단바, Profile(/me) | FR-10 |
| `LengthSelector`(short/normal/long) | CreatePost(1차), Composer(@AI) | FR-11 |

---

## 11. 반응형 규칙
- **<768px**: 단일 컬럼, 하단 탭바, 검색은 전체화면 시트. Thread가 기본 풀스크린 채팅.
- **≥1024px**: 2–3 컬럼(좌 내비 / 중앙 피드·스레드 / 우 커뮤니티 검색·정보).
- 버블 최대폭 78%, 요약 버블은 전폭 띠. 터치 타깃 ≥44px(NFR-1).
```

---

## 12. 디자인 시스템 v0.3 — **전 화면 적용 (구현 단일 출처)**

> 2026-06-18 채팅 UI 리디자인(§6.3)에서 확립한 비주얼 언어를 **나머지 모든 화면**
> (Login · Home · Search · Community · CreatePost · CreateCommunity · Profile · AppLayout · 상태 컴포넌트)
> 에 일관되게 전파한다. **표현 계층만 변경** — 라우팅/스토어/엔진/SSE/BYOK/검증 로직 불변.
>
> ⚠️ **색·표면·타이포는 v2(그린 인광 CRT 터미널)로 대체됨.** 아래 12.1/12.2의
> `bg-white`·`border-slate-*`·`bg-brand`·`text-brand`·`accent-violet-600`·`border-t-brand` 등
> 라이트·바이올렛 표현은 모두 **[DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)의 `term-*` 토큰으로 읽는다**
> (카드 → `bg-term-panel`/`border-term-border`, 1차 버튼 → `bg-term-cta`/`border-term-active`,
> 입력 → `bg-term-sunken`, `text-brand` → `term-fg-bright`/`term-amber`, 앱 배경 → `bg-term-screen` +
> 스캔라인/비네팅). **컴포넌트 구조·radius 통일·화면별 델타(어떤 요소를 카드/버튼/입력으로 묶는지)는
> 그대로 유효**하며 색·표면만 v2로 매핑한다.

### 12.1 공유 토큰 (그대로 적용)
| 요소 | 표준 클래스 | 비고 |
|------|-------------|------|
| **카드 / 리스트 항목** | `rounded-2xl border border-slate-200 bg-white shadow-sm` | 기존 `rounded-lg`/`rounded-xl`·무그림자 → 통일. hover: `hover:border-slate-300` |
| **클릭형 리스트 항목** | 위 + `transition active:bg-slate-50 hover:border-brand/40` | 커뮤니티·글 리스트 |
| **입력 / textarea / select** | `rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand` | 기존 `rounded-lg` → `rounded-xl` 통일 |
| **1차 버튼(primary)** | `rounded-xl bg-brand text-white font-semibold hover:bg-brand-dark disabled:opacity-50` | 높이 `min-h-[44px]`/`py-2.5` |
| **2차 버튼(secondary)** | `rounded-xl border border-slate-300 text-slate-700 hover:border-brand hover:text-brand` | |
| **위험 버튼(danger)** | `rounded-xl border border-red-200 text-red-600 hover:bg-red-50` | 로그아웃 |
| **섹션 제목** | `text-sm font-semibold text-slate-700` | |
| **안내/경고 박스** | `rounded-xl bg-amber-50 ... text-amber-800`(키 경고) / `rounded-xl bg-slate-100`(페르소나 안내) | radius 통일 |
| **Avatar** | §6.3 B의 `Avatar` 컴포넌트 재사용 | 사용자/프로필/커뮤니티 신원 표시 |

### 12.2 화면별 델타
- **Login**: 폼을 카드(`rounded-2xl border bg-white shadow-sm p-6`)로 감싸고 상단에 바이올렛
  로고 락업(작은 `A` 배지 + "Aidit"). 입력/버튼 §12.1 적용. 키 경고/링크 유지.
- **Home**: 탭(인기/최신) 활성 인디케이터 `border-brand text-brand` 유지(자동 바이올렛). PostCard는
  이미 v0.3 카드 → 변경 없음. EmptyState 1차 버튼 §12.1.
- **Search / CommunitySearch**: 검색 입력 §12.1(돋보기 아이콘 접두 선택), 결과 항목을 카드형
  클릭 리스트로(PersonaBadge 유지). "결과 없음" 박스 radius 통일.
- **Community(상세)**: 헤더에 큰 PersonaBadge(`lg`) 유지, "이 커뮤니티에 글쓰기" 1차 버튼, 페르소나
  박스 카드화. 글 리스트 항목을 카드형(제목·요약·메타)으로 — 가능하면 작성자 `Avatar sm` 추가.
- **CreatePost**: 모든 입력/select/textarea §12.1, 게시 버튼 1차 버튼, AI 1차답변 토글 액센트
  `accent-violet-600`(또는 `text-brand`).
- **CreateCommunity**: 입력/슬러그/설명/아이콘 §12.1, PersonaEditor textarea도 정합, 만들기 1차 버튼.
- **Profile**: 헤더의 `👤` 이모지 → 사용자 `Avatar md`(seed=username). API 키/로그아웃 섹션 카드화,
  내 커뮤니티/내 글 리스트 카드형(이미 일부 적용). 마스킹/로컬 키 로직 불변.
- **AppLayout / BottomTabBar**: 로고 바이올렛(자동), 활성 탭 `text-brand`(자동). 데스크톱 사이드바
  활성/hover 정합. 구조 변경 없음.
- **상태 컴포넌트(Empty/Error/Loading/Offline)**: 스피너 `border-t-brand`(자동), 배너/카드 radius를
  `rounded-xl`로 통일. 동작 불변.

### 12.3 불변 (회귀 금지)
- 라우팅, 폼 검증, 제출 핸들러, 스토어, BYOK 키 흐름(마스킹·localStorage), 인증 가드, 무한 스크롤,
  디바운스 검색, SSE — 전부 그대로. 클래스/마크업(표현)만 변경.

---

## 13. 논의 문서 응결 (FR-13) — Thread 메뉴 + Document 화면 (2026-07-27)

### 13.1 Thread 상단 메뉴 — 액션 추가

기존 `⋯` 메뉴는 **작성자에게만** 보이는 `[ 편집 ]`/`[ 삭제 ]` 전용이었다. FR-13.1은 응결을 **모든 로그인 사용자**에게 열어야 하므로 메뉴의 노출 조건을 바꾼다.

```
[‹]        게시글 제목        [🔖] [⋯]
                                    │
                    ┌───────────────┴────────────┐
                    │ [ 문서로 정리 ]              │ ← 로그인 사용자 전원 (FR-13.1)
                    │ ─────────────────────────── │
                    │ [ 편집 ]                    │ ← 작성자만
                    │ [ 삭제 ]                    │ ← 작성자만
                    └────────────────────────────┘
```

- 메뉴 트리거(`⋯`)는 이제 **로그인 상태면 항상** 노출된다(비로그인은 미노출 — 실행 시 로그인 모달을 띄우는 대신 진입점을 감춘다). 작성자 전용 항목만 내부에서 게이팅되고, 구분선(`border-t border-term-border`)으로 소유자 액션과 분리한다.
- 메뉴 폭은 항목 문자열이 길어졌으므로 `w-28` → `w-36`.
- **실행 중 상태**: `[ 문서로 정리 ]`를 누르면 항목이 `[ 정리 중… ]`(disabled, `text-term-faint`)로 바뀌고 메뉴는 열린 상태를 유지한다. 완료 시 메뉴를 닫고 `/d/:documentId`로 이동한다.
- **실패**(FR-13.7): 메뉴를 닫고 기존 AI 토스트(`showAiToast`)로 알린다. 스레드 상태는 무변경.
- **키 없음**: 키가 없으면 LLM을 호출하지 않고 "문서 정리에는 LLM 키가 필요합니다 — 설정에서 등록하세요" 토스트만 띄운다(1차 AI 답변의 `primaryAiNoKey`와 동일 패턴).

### 13.2 Document 화면 (`/d/:documentId`)

```
┌────────────────────────────┐
│ ‹        문서               │ ← PageHeaderBar (제목 = "문서")
│ $ cat /d/3f9a…             │ ← ShellPrompt
│ ┌────────────────────────┐ │
│ │ ★ 응결된 문서            │ │ ← 코너 태그 (원본 게시글 카드와 동일 리듬)
│ │ Code Agent 사용 가이드   │ │ ← title (text-term-title glow)
│ │ 🍳 r/cooking            │ │ ← 커뮤니티 링크
│ │ u/아라 · 3분 전          │ │ ← author · relativeTime
│ │ ────────────────────── │ │
│ │ ## 1. 프롬프트 작성       │ │ ← SafeMarkdown (GFM, 기존 렌더러 재사용)
│ │ - 컨텍스트를 먼저 …       │ │
│ │ …                       │ │
│ │ ────────────────────── │ │
│ │ [ 원본 스레드 보기 ]      │ │ ← /p/:postId
│ └────────────────────────┘ │
│  출처: 세그먼트 #0 · 버블 17까지 │ ← provenance (FR-13.4) text-term-faint
└────────────────────────────┘
```

- 마크다운은 스레드 버블과 **동일한 `SafeMarkdown` + `prose-chat`**(marked + DOMPurify)로 렌더한다 — 새 렌더 경로도, 새 타이포 클래스도 만들지 않는다. 넓은 표/코드는 카드 안에서만 가로 스크롤.
- **제목 중복 제거**: 저장된 마크다운은 자기 완결성을 위해 첫 줄 `# 제목`을 그대로 보존하지만, 화면에는 카드 제목(h2)이 이미 있으므로 렌더 시 **선행 제목 줄만 제거**한다(`stripLeadingTitle`). 본문 중간의 `#`는 건드리지 않는다.
- **출처 표기**(FR-13.4)는 화면 최하단에 작게 둔다: 응결 시점의 세그먼트 index와 마지막 `seq`. "이 문서가 스레드의 어디까지인지"를 사용자가 확인할 수 있어야 갱신본을 만들 판단이 선다.
- 로딩=`LoadingState`, 404=`EmptyState`(문서 없음 + 홈으로), 그 외 오류=`ErrorState`(재시도). 기존 상태 컴포넌트 재사용.
- 라우트는 `AppLayout` 안에 두어 하단 탭바/상단바가 유지된다.

### 13.3 불변 (회귀 금지)

- 스레드의 버블 렌더링·SSE·`seq` 정렬·요약 배지, Composer 동작, 북마크/추천 로직 — **전부 무변경**. 문서 응결은 읽기 전용으로 컨텍스트를 소비하고 별도 테이블에 쓴다.
- BYOK 키 흐름 불변: 키는 localStorage에서 호출 직전에만 읽히고 서버로 가지 않는다.
