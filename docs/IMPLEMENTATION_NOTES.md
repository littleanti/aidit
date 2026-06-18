# Aidit — 구현 노트 (IMPLEMENTATION_NOTES.md)

> 관련 문서: [PRD.md](./PRD.md), [TRD.md](./TRD.md), [PLAN.md](./PLAN.md), [WIREFRAME.md](./WIREFRAME.md)
> 상태: M1–M5 구현 완료 · 최초 작성 2026-06-17 · 최종 수정 2026-06-18
> 이 문서는 **실제 구현 결과**가 스펙(PRD/TRD/PLAN) 대비 어떻게 확정·추가·변경되었는지, 그리고 개발 중 발견·수정한 버그를 기록한다. 스펙 문서가 "권장/미확정"으로 남긴 항목의 **확정값**과, 통합 과정에서 추가한 소소한 보조 자산을 포함한다.

---

## 변경 이력 (Changelog)

> 최신 항목이 맨 위. 태그: **[feat]** 기능 추가 · **[fix]** 버그 수정 · **[test]** 테스트 · **[docs]** 문서 · **[chore]** 설정. 각 항목은 상세 절(§)을 가리킨다.

### 2026-06-18
- **[feat]** 네비게이션/검색/프로필: 도달 가능한 검색 페이지(`/search`), 프로필 페이지(`/me`: 로그아웃·API 키 변경·내 커뮤니티·내 글), PostCard→커뮤니티 링크, `authStore.updateKey`, `GET /users/:id/posts`·`/users/:id/communities`. (commit `f281c45`, §4.2, §5)
- **[fix]** 피드 응답 형태 불일치: `toFeedCard`가 중첩 `community{}`/`author{}`를 반환했으나 `PostListItem`은 평탄(`communitySlug` 등) → 홈 피드 커뮤니티 라벨 공백. 서버를 평탄 동결 계약에 맞춤. (commit `f281c45`, §4.2-7)
- **[fix]** `POST /posts` 201 응답에 최상위 `authorId` 누락 (Post DTO 계약 드리프트): `GET /posts/:id`는 이미 `authorId`를 포함하도록 고쳤으나 형제 `POST /posts` 직렬화기는 `communityId`만 보내 `authorId` 없는 Post 반환. `rest.ts`가 런타임 검증 없이 캐스팅해 tsc가 못 잡는 재발 드리프트 클래스. 직렬화기를 동결 Post DTO에 맞춤. (§4.2-8, `server/src/routes/posts.ts`)
- **[docs]** 본 구현 노트에 변경 이력(Changelog) 절 추가 — 날짜·역순 정리.

### 2026-06-17

**라이브 검증 (실제 Gemini 키, claude-in-chrome MCP + Playwright)** — commit `6a19d3a`
- **[fix]** 페이지네이션 envelope 미해제: `getPosts`/`getCommunityPosts`/`getComments`가 `{items}`를 배열로 반환 안 함 → 커뮤니티 페이지 크래시·홈 빈 화면·스레드 로딩 실패. (§4.1-3, `frontend/src/api/rest.ts`)
- **[fix]** PENDING AI 버블 빈 본문 거부 → `@AI`/1차 답변 400으로 미생성. PENDING이면 빈 본문 허용. (§4.1-4, `server/src/routes/comments.ts`)
- **[fix]** `GET /posts/:id`에 `authorId`/`communityId` 누락 → 1차 AI 답변(FR-4.3/수용 #3) 미발화. 스칼라 FK 포함. (§4.1-5, `server/src/routes/posts.ts`)
- **[fix]** 모바일 하단 탭바가 Composer 전송 버튼 가림 → 폰에서 클릭 불가. 탭바 위로 올림. (§4.1-6, `frontend/src/components/Composer.tsx`)
- **[test]** E2E J1/J2/J3를 실제 UI 흐름(`createCommunityAndPost`/`seedOverThreshold`)으로 재작성 + 실키 `real-key-byok.spec.ts` 추가 → **E2E 4/4 green**. (§6)

**문서화** — commit `4000d01`
- **[docs]** 구현 노트 최초 작성(스펙 대비 확정/추가/변경, 버그, 스택 버전, 실행 방법) + TRD §4(`x-user-id`·`/metrics`)·PLAN §9(DoD 현황) 갱신.

**M5 — 다듬기** — commit `45a5ece`
- **[feat]** 지표+VisitEvent(BE-13), hot decay(XC-8), CSP 헤더/메타(XC-3), 레이트리밋(XC-9), PWA(FE-13), DOMPurify sanitize(XC-3), 빈/에러/오프라인 상태(FE-14), 클라 계측(XC-10), MIT 헤더(XC-11), 통합 테스트(XC-T). (§2.2, §3, §5, §6)
- **[fix]** CSP·레이트리밋 플러그인 캡슐화로 전역 훅 미적용(L2 위반) → `fastify-plugin`으로 de-encapsulate. (§4-1)

**M4 — 요약 엔진** — commit `08e2d27`
- **[feat]** 128K 지연 요약(AI-6/8/9, 호출자 키), 세그먼트 전환(BE-5s)·요약 멱등 가드 409(BE-7), `segment.opened`(RT-8), SummaryBubble + ~120K 임박 배지(FE-13a). (§3)
- **[fix]** `CreateCommentRequest.segmentExpected` 타입 정정. (§4-2)

**M3 — AI 코어** — commit `bdf8843`
- **[feat]** BYOK GeminiClient(브라우저→Google 직접, AI-1/3), `buildContents` 조립 chokepoint + 프롬프트 인젝션 가드(AI-4/XC-4), `/context`(BE-12)·`PATCH /comments`(BE-8, clientId/userId 인가), 1차 답변(AI-5)·`@AI` 흐름(AI-7). (§2.1, §3)

**M2 — 실시간** — commit `7ee79bd`
- **[feat]** per-post SSE(transport·pubsub·publish), `POST/GET /comments`(seq·clientId 멱등, BE-6/11), `/stream` 스냅샷 재생+라이브(RT-4/6), threadStore·ChatBubble·Composer·Thread.

**M1 — 골격** — commit `f516d67`
- **[feat]** Fastify+Prisma 스캐폴드, 개정 스키마(L12: `clientId`·`personaIcon`·`VisitEvent`), `/auth/session`·커뮤니티·글·홈 피드 라우트, React 셸·`api/types.ts`·`rest.ts`·authStore·Login·피드/커뮤니티/생성 페이지. (§1, §2.1)

**초기 스캐폴드** — commit `7e3455e`
- **[chore]** repo init, `.gitignore`(`.omc/`·`tmp/` 제외), MIT LICENSE, README, docs.

---

## 0. 마일스톤 ↔ 커밋 매핑

| 마일스톤 | 커밋 | 검증 |
|----------|------|------|
| 초기 스캐폴드 | `chore: initial project scaffold …` | — |
| **M1** 골격 | `feat(M1): skeleton …` | 백엔드 typecheck + boot smoke(/health, /auth/session) · 프론트 typecheck + build |
| **M2** 실시간 | `feat(M2): thread / realtime …` | clientId 멱등 + SSE 스냅샷 재생/라이브 fan-out smoke |
| **M3** AI 코어 | `feat(M3): AI core …` | `/context` 형상 + PATCH(clientId/userId) 인가 smoke |
| **M4** 요약 | `feat(M4): summary engine …` | 세그먼트 전환 + FR-7.2 제외 + 409 가드 + segment.opened 순서 smoke |
| **M5** 다듬기 | `feat(M5): polish …` | 양측 테스트 green + build + CSP/지표/레이트리밋 smoke |

---

## 1. 확정 기술 스택 버전

TRD §2는 스택을 "권장"으로만 명시했다. 실제 설치·검증된 버전:

**Backend (`server/`)** — Node 20 ESM
- `fastify` ^5.2, `@fastify/cors` ^10, `fastify-plugin` ^5 (전역 훅 de-encapsulation용 — §4 버그 참조)
- `prisma` / `@prisma/client` ^6.2, datasource = SQLite (PoC, `server/prisma/dev.db`)
- dev: `tsx` ^4, `typescript` ^5.7, test: `vitest` ^2.1

**Frontend (`frontend/`)** — Vite SPA
- `react` ^18.3, `react-router-dom` ^6.30, `zustand` ^4.5
- `dompurify` ^3.4 + `marked` ^18 (마크다운 sanitize 파이프라인, XC-3)
- dev/build: `vite` ^5.4, `@vitejs/plugin-react` ^4, `tailwindcss` ^3.4, `vite-plugin-pwa` ^1.3
- test: `vitest` ^2.1 + `jsdom`, E2E: `@playwright/test` ^1.61

> 모델 ID 상수는 단일 출처(`frontend/src/config/model.ts`)에만 존재: `MODEL = "gemini-3.1-flash-lite"` (L7).

---

## 2. API 계약 — 확정 / 추가 / 변경

### 2.1 행위자 인증: `x-user-id` 헤더 (TRD §4 "username" 대체 — 구속력)

TRD §4 표는 인증 칼럼을 "username"으로 적었으나, **실제 구현은 영속화된 `User.id`를 `x-user-id` 헤더로 전달**한다. 이는 L11("`me` 식별자 = `User.id`")과 정합한다.
- `POST /auth/session`이 `{ id, username }`을 반환 → 클라이언트(`authStore`)가 `userId` 영속화.
- 모든 쓰기 요청은 `x-user-id: <User.id>`를 보낸다. **API 키는 어떤 헤더/바디/로그에도 절대 포함되지 않는다(L1).**
- 인가: 커뮤니티 편집은 `creatorId === x-user-id`; 사람 댓글 PATCH는 `authorId === x-user-id`; AI 버블(authorId=null) PATCH는 발신 `clientId` 매칭(L12).

### 2.2 추가 엔드포인트 (BE-13, TRD §4 표에 미열거)

| Method · Path | 설명 | 인증 |
|---------------|------|------|
| `POST /metrics/visit` | 인증 앱 오픈 시 `VisitEvent(userId, date=YYYY-MM-DD)` 일별 멱등 기록(upsert) | `x-user-id` |
| `GET /metrics` | §8 KPI 집계 반환(아래 형상) | - |

`GET /metrics` 응답 형상(실제):
```jsonc
{
  "postCount": 0,
  "avgAtAiRepliesPerPost": 0,        // 글당 평균 AI_REPLY 수
  "avgUniqueCommentersPerThread": 0, // 스레드당 고유 사람 댓글자 수
  "summarySuccessRate": null,        // COMPLETE AI_SUMMARY / 전체 AI_SUMMARY
  "authorD1RetentionRate": null,     // 첫 글 익일 VisitEvent 보유 작성자 비율
  "geminiSuccessRate": null,         // 클라 이벤트 기반 — 서버 DB로 산출 불가, best-effort(null)
  "p95PropagationMs": null,          // 동일 — 서버 단독 산출 불가(null)
  "unavailable": {}                  // null KPI에 대한 사유 표기
}
```
> `geminiSuccessRate`, `p95PropagationMs`는 BYOK·클라 측정 지표라 서버 DB만으로는 산출되지 않아 `null`로 노출하고 `unavailable`에 사유를 둔다. 클라이언트 계측(`frontend/src/lib/metrics.ts`)이 best-effort로 이벤트를 발행한다(XC-10).

### 2.3 개발 프록시

- REST 베이스 `/api`. Vite dev 프록시 `/api → http://localhost:3001` (rewrite로 `^/api` 제거 — 서버는 `/api` prefix를 두지 않음).
- SSE 구독도 동일 출처(`/api/posts/:id/stream`)로 CSP `connect-src 'self'` 안에서 동작.

---

## 3. 주요 구현 결정 (스펙 보강)

- **요약 세그먼트 멱등(BE-7/BE-5s)**: AI_SUMMARY는 **새 세그먼트 N+1의 첫(최저 seq) 버블**로 들어가고, 헬퍼 `openSummarySegment(db, input, segmentExpected)`(`server/src/domain/segment.ts`)가 한 트랜잭션에서 (a) 활성 N 비활성화, (b) N+1 활성 생성(요약 토큰으로 `tokenSum` 시드), (c) `N+1.summaryCommentId` 연결을 수행. `segmentExpected !== active.index`면 **409 `{ segmentIndex, summaryCommentId }`** 반환(이중 개시 방지). 성공 시 `comment.created` → `segment.opened`를 **seq 순서대로** 발행(RT-8).
- **컨텍스트 조립(BE-12)**: `server/src/domain/contextAssembler.ts`가 활성 세그먼트만 조립. seg0 = 원본 글 user turn + seg0 버블; seg≥1 = "지금까지 요약: …" user turn + 그 이후 버블(이전 히스토리 제외, FR-7.2). PENDING/FAILED AI 버블은 컨텍스트에서 제외(COMPLETE만).
- **CSP 적용 방식(XC-3, L2)**: 서버는 `onSend` 훅(`server/src/plugins/security.ts`)으로 **모든 응답**에 CSP 헤더 부여. SPA는 빌드 시 `vite.config.ts`의 주입 플러그인이 `dist/index.html`에 `<meta http-equiv>`로 동일 CSP 주입(`apply: 'build'`이므로 **dev HMR은 영향 없음**). 확정 CSP:
  ```
  default-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com;
  script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  ```
- **레이트 리미팅 기본값(XC-9)**: 인메모리(단일 인스턴스). `POST /posts` 10회/분/identity(슬라이딩 윈도우), `POST /communities` 1회/3분/identity(쿨다운). 초과 시 429 + `Retry-After`. 읽기/댓글 게시는 비제한(실시간 데모 매끄러움 위해).
- **마크다운 sanitize chokepoint(XC-3)**: `frontend/src/lib/sanitize.ts`의 `renderMarkdownSafe(md)`(marked → DOMPurify 엄격 allowlist) + `SafeMarkdown` 컴포넌트가 **유일한** `dangerouslySetInnerHTML` 경로. 모든 사용자 콘텐츠(ChatBubble/SummaryBubble/PostCard/Thread 원본 본문)가 이를 경유. `javascript:`/`data:`/`iframe`/`script`/이벤트 핸들러 제거, 실패 시 평문 폴백.
- **hot decay(XC-8)**: 읽기 시점 재계산 방식 채택(PoC). hot 피드 반환 시 `ageDecay`를 반영해 정렬이 현재 경과시간을 반영하도록 함(커서 페이지네이션 유지).
- **토큰 카운팅(AI-3)**: `countTokens` 우선, 폴백 `Math.ceil(text.length/4)`(`estimateTokens`). 버블 게시 시 `tokenCount`를 함께 보내 서버가 활성 세그먼트 `tokenSum` 누적.

---

## 4. 개발 중 수정한 버그

1. **CSP·레이트리밋 플러그인 캡슐화로 전역 훅 미적용 (M5, L2 위반)**
   - 증상: `app.register(security)` / `app.register(rateLimit)`로 등록 시 Fastify가 플러그인 컨텍스트를 **캡슐화**해, `onSend`(CSP)·`onRequest`(레이트리밋) 훅이 **형제 라우트와 `/health`에 적용되지 않았다.** 결과적으로 응답에 CSP 헤더가 없고(키 유출 1차 완화책 무력화), `POST /posts`가 429를 내지 않았다(연속 게시 모두 201).
   - 수정: 두 플러그인 export를 `fastify-plugin`(`fp`)로 감싸 훅을 **de-encapsulate** → 앱 전역 적용. `fastify-plugin` ^5를 `server` 의존성에 추가. `app.ts` 변경 없음(등록 순서는 이미 올바름).
   - 파일: `server/src/plugins/security.ts`, `server/src/plugins/rateLimit.ts`, `server/package.json`.
   - 발견 경로: M5 검증(verify) 패스의 부팅 스모크(실제 리스닝 서버에서 CSP 헤더·429 부재 확인).

2. **`CreateCommentRequest.segmentExpected` 타입 오류 (M4)**
   - `frontend/src/api/types.ts`의 댓글 게시 요청 타입에서 `segmentExpected` 표기가 엔진의 요약 게시 호출과 어긋나 typecheck 단계에서 정정.

> 그 외 M1–M4 검증에서는 라우트/도메인 소스의 기능 버그가 발견되지 않았다(독립 구현 산출물이 계약대로 통합됨). 대부분의 검증은 typecheck/build/부팅 스모크에서 무수정 통과.

### 4.1 라이브 런타임 검증(실제 Gemini 키)에서 발견·수정한 버그

빌드/타입체크만으로는 드러나지 않았고, **실제 키로 앱을 구동(claude-in-chrome MCP + Playwright)** 했을 때 비로소 나타난 런타임 통합 버그들이다. 모두 수정 후 재검증 green.

3. **페이지네이션 envelope 미해제 — 피드/스레드 (`{items}` vs 배열)**
   - 증상: 서버 목록 엔드포인트는 `{ items: [...] }`를 반환하는데 `rest.ts`의 `getPosts`/`getCommunityPosts`/`getComments`가 이를 `PostListItem[]`/`Comment[]`로 **그대로** 반환(타입과 런타임 불일치). 결과: 커뮤니티 상세가 `posts.map is not a function`로 **크래시**, 홈 피드는 `.length` 가드 덕에 크래시는 면했으나 **글이 있어도 빈 화면**, Thread는 `getComments`가 객체라 **"스레드를 불러오지 못했습니다"** 로딩 실패.
   - 수정: 세 함수가 `Array.isArray(r) ? r : r.items ?? []`로 정규화(다음 커서는 마지막 항목 id로 클라가 도출하므로 안전). 파일: `frontend/src/api/rest.ts`.
4. **PENDING AI 버블 빈 본문 거부 → `@AI`/1차 답변 400 (FR-6.2 위반)**
   - 증상: 엔진이 로딩 버블을 `body:''`(PENDING)로 먼저 게시한 뒤 COMPLETE 시 PATCH로 본문을 채우는데, `POST /comments`가 본문을 **무조건 비어있지 않게** 요구해 `{"error":"body is required"}` 400 → AI 답변이 전혀 생성되지 않음.
   - 수정: `status === 'PENDING'`일 때 빈 본문 허용(텍스트는 PATCH로 도착). 파일: `server/src/routes/comments.ts`.
5. **`GET /posts/:id`에 `authorId` 누락 → 1차 AI 답변 미발화 (FR-4.3 / 수용 #3 위반)**
   - 증상: 글 상세 응답이 `author:{id,username}`만 주고 최상위 `authorId`(및 `communityId`) 스칼라를 누락. Thread의 1차 답변 가드 `post.authorId === me`가 `undefined === me`로 항상 거짓 → **작성자 키 1차 AI 답변이 전혀 발화되지 않음**.
   - 수정: 상세 응답에 `authorId`/`communityId` 포함(Post DTO와 일치). 파일: `server/src/routes/posts.ts`.
6. **모바일에서 하단 탭바가 Composer 전송 버튼을 가림 (NFR-1)**
   - 증상: Thread의 Composer가 `sticky bottom-0`인데 모바일 고정 하단 탭바(`fixed bottom-0 z-20`)와 겹쳐 **전송 버튼이 탭바에 가려 클릭 불가**(Playwright Pixel 7에서 pointer-intercept로 발견; 데스크톱은 탭바 `tablet:hidden`이라 비노출).
   - 수정: Composer를 모바일에서 탭바 위로 올림(`sticky bottom-16 z-30 tablet:bottom-0`). 파일: `frontend/src/components/Composer.tsx`.

### 4.2 네비게이션/검색/프로필 + 피드 형태 (2026-06-18)

검색·프로필 도달성 보강과 함께, **서버 직렬화기 ↔ 동결 `frontend/src/api/types.ts` DTO 드리프트**가 다시 드러났다. `rest.ts`의 `request<T>`가 런타임 검증 없이 응답을 `T`로 캐스팅하므로 tsc가 잡지 못하고 **브라우저 런타임에서만** 표면화되는 재발 버그 클래스다(§4.1-3/5와 동일 뿌리).

7. **피드 응답 형태 불일치 — `toFeedCard` 중첩 vs `PostListItem` 평탄**
   - 증상: 서버 `toFeedCard`가 `community{}`/`author{}` 중첩 객체를 반환했으나 동결 `PostListItem`은 평탄 필드(`communityId`/`communitySlug`/`communityName`/`communityPersonaIcon`/`authorId`/`authorUsername`)로 고정. 캐스팅 때문에 tsc는 통과했으나 런타임에서 홈/커뮤니티/유저 피드 카드의 **커뮤니티 라벨이 공백**으로 렌더.
   - 수정: 서버 `toFeedCard` 직렬화기를 평탄 동결 계약에 맞춰 평탄 필드를 직접 내보냄. (commit `f281c45`)
8. **`POST /posts` 201 응답에 최상위 `authorId` 누락 — Post DTO 계약 드리프트**
   - 증상: 동결 `Post` DTO는 `authorId: string`을 **필수**로 선언하고 `GET /posts/:id`는 이미 이를 포함하도록 고쳐졌으나(Thread의 1차 답변 가드 `post.authorId === me` 때문), 형제 `POST /posts` 201 직렬화기는 `communityId`만 보내고 `authorId`를 누락 → `authorId` 없는 Post 반환. `rest.ts`가 런타임 검증 없이 캐스팅해 tsc 미검출. 오늘 시점에는 잠복(CreatePost는 `post.id`만 읽고 이동, 이후 Thread가 `GET /posts/:id`로 재조회해 `authorId` 확보)이나, POST 응답 Post를 그대로 렌더하는 경로가 생기면 조용히 깨지는 정확히 그 재발 드리프트 클래스.
   - 수정: `POST /posts`의 `reply.code(201).send({...})`에 `authorId: post.authorId` 추가(`GET /posts/:id`와 동일하게 직렬화기를 동결 Post DTO에 정렬). 라이브 검증: `POST /posts`가 이제 최상위 `authorId` 반환. 양측 typecheck clean. 파일: `server/src/routes/posts.ts`.

---

## 5. 스펙에 없던 추가 보조 자산

구현 응집을 위해 PLAN의 WP 파일 목록 외에 도입한 소규모 자산:

- `frontend/src/stores/postIntentStore.ts` — CreatePost의 "1차 AI 답변 받기" 토글 값을 Thread로 전달(스레드 진입 후 1회 trigger). (FR-4.3 보조)
- `frontend/src/engine/retryAiBubble.ts` — FAILED AI 버블 재시도(같은 버블 재호출 → PATCH) 보조. (FE-12 retry 보조)
- `frontend/src/lib/SafeMarkdown.tsx` — `renderMarkdownSafe` 래퍼 컴포넌트(XC-3 렌더 편의).
- `frontend/src/components/states/` — `EmptyState` / `ErrorState` / `LoadingState` / `OfflineBanner` (FE-14 재사용 컴포넌트 집합).
- `server/src/domain/segment.ts::openSummarySegment` — 요약 전환 트랜잭션 헬퍼(BE-5s/BE-7 응집).
- `frontend/src/pages/Search.tsx` — 도달 가능한 검색 페이지(`/search`). (2026-06-18)
- `frontend/src/pages/Profile.tsx` — 프로필 페이지(`/me`: 로그아웃·API 키 변경·내 커뮤니티·내 글). (2026-06-18)
- `frontend/src/pages/Community.tsx` — 이제 `CommunitySearch`도 export하고 slug 없는 진입 시 리다이렉트 처리. (2026-06-18)
- `frontend/src/stores/authStore.ts::updateKey` — localStorage API 키 갱신(L1 유지, 키 미전송). (2026-06-18)
- 백엔드 `GET /users/:id/posts`·`GET /users/:id/communities` — 프로필 "내 글/내 커뮤니티" 조회용. 각각 평탄 `PostListItem`/`Community` 형상(후자에 비계약 `postCount` 가산 필드 — 무해 additive). (2026-06-18)

---

## 6. 테스트 현황 (XC-T)

- **백엔드 (`server/`, vitest, app.inject + 격리 SQLite): 22/22 green**
  - `contract.test.ts` (10): clientId 멱등, `/context` seg0(#5) vs seg≥1 제외(#7), PATCH 인가(사람/AI/오인가 403), 요약 409 가드, `/auth/session {id,username}`, key-blind.
  - `sse.test.ts` (4): `comment.created/updated/segment.opened` seq 순서 수신, afterSeq/Last-Event-ID 재생.
  - `hotScore.test.ts` (8): 정렬/decay 단조성.
- **프론트 (`frontend/`, vitest + jsdom, rest/gemini 모킹): 28 green**
  - `engine/contextEngine.test.ts`: buildContents XC-4 격리, 순서(사람→PENDING→reply), `ensureSummary` 409 재조회·지연(호출자 키), AI-9 재조립.
  - `api/gemini.test.ts`: 401/403/429 에러 매핑, 토큰 추정.
  - `lib/sanitize.test.ts`: `<script>`/`onerror`/`javascript:` 제거.
  - `stores/threadStore.test.ts`: seq/id/clientId dedupe.
- **E2E (`frontend/e2e/`, Playwright): 4/4 green (실행 검증 완료)**
  - **J1/J2/J3 (Gemini `page.route` 모킹, 더미 키)**: 로그인→커뮤니티 생성→글 작성→스레드 흐름을 실제 UI로 구동. J1 1차 답변(FR-4.3), J2 사람-먼저→@AI 답변(FR-6.2), J3 128K 초과→색 구분 요약 띠(`role="separator"`)→요약 기반 답변(FR-7). 초기 스캐폴드는 실 UI와 맞지 않는 셀렉터(`/post/` 등)·시드 가정으로 실행 시 실패했으나, `helpers.createCommunityAndPost`/`seedOverThreshold`로 자체 데이터를 만들도록 재작성해 green.
  - **`real-key-byok.spec.ts` (실제 Gemini 키, env `GEMINI_TEST_KEY`로 opt-in, 키 미커밋)**: 실제 BYOK `@AI` 흐름을 구동하며 (1) 서버가 키를 절대 수신하지 않음(key-blind, 모든 `/api` URL·헤더·바디 검사), (2) `generativelanguage.googleapis.com`로 **직접** 호출 발생, (3) AI_REPLY가 COMPLETE에 도달함을 단언. 키 부재 시 자동 skip(=CI 안전).
  - 실행 절차: `frontend/e2e/README.md`. 게이트: 모킹 J1/J2/J3 + (키 제공 시) 실키 스펙.

---

## 7. 실행 방법

```bash
# Backend (http://localhost:3001)
cd server
npm install
npx prisma generate && npx prisma migrate dev   # SQLite dev.db
npm run dev        # tsx watch
npm test           # vitest (격리 test.db)

# Frontend (http://localhost:5173, /api → :3001 프록시)
cd frontend
npm install
npm run dev
npm test           # vitest
npm run build      # tsc && vite build (PWA SW + manifest 산출)

# E2E (선택) — 절차는 frontend/e2e/README.md
```

로그인 시 입력한 **Google AI Studio API 키는 localStorage에만 저장**되고 서버로 전송되지 않는다. 키는 브라우저에서 호출 시점에만 메모리로 사용되어 Google로 직접 전송된다.

---

## 8. 알려진 제약 / 후속 (PoC 범위)

- **브라우저 E2E·실키 레인**: 실행 검증 완료(§6, 4/4 green). 실키 스펙은 `GEMINI_TEST_KEY` env로만 동작하며 CI에서는 자동 skip — CI 자동 게이트는 모킹 J1/J2/J3 + vitest.
- **`geminiSuccessRate`·`p95PropagationMs`**: 서버 DB 단독 산출 불가 → 클라 계측(XC-10) 집계 파이프라인은 PoC에서 best-effort(서버는 `null` 노출).
- **단일 인스턴스 pub/sub·레이트리밋**: 인메모리(L10). 다중 인스턴스 시 Redis seam 교체 필요.
- **SQLite PoC**: datasource 추상화로 Postgres 교체 예정(L10).
