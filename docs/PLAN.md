# Aidit — 구현 계획서 (PLAN.md)

> 관련 문서: [PRD.md](./PRD.md), [TRD.md](./TRD.md), [WIREFRAME.md](./WIREFRAME.md), [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md)
> 상태: PoC · 버전: 0.2 · 날짜: 2026-06-16
> **구현 상태(2026-06-17): M1–M5 전부 구현·검증·커밋 완료.** 스펙 대비 확정/추가/변경 사항과 수정한 버그는 [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md)에 정리(§9 완료 정의의 실제 충족 현황 포함).
> 본 계획서는 5개 영역 계획(Backend / Realtime / Frontend / AI-Engine / Cross-cutting)을 종합한 것으로, 세 개의 원본 문서에 엄격히 근거한다. 원본 문서 내부에서 충돌이 있는 경우(특히 TRD §3 스키마 vs. TRD §4.1 멱등성), 본 계획서가 그 충돌을 명시적으로 해소하며 그 결정은 **구속력(binding)** 을 가진다.

---

## 1. 개요 (Introduction)

Aidit은 모바일 우선 Reddit형 커뮤니티 PWA로, 각 게시글이 채팅방형 댓글 스레드를 열고 여러 사용자가 스레드마다 **하나의 공유 AI 컨텍스트**를 함께 쌓아간다. 모든 LLM 호출은 **BYOK(Bring Your Own Key)** 방식이다: 브라우저가 사용자 본인 키로 Google Gemini를 직접 호출하며, Aidit 서버는 키를 보거나 저장하거나 중계하지 않는다. 활성 컨텍스트 세그먼트가 **128K 토큰**을 초과하면, 다음 `@AI` 호출자의 키로 **지연(lazy)** AI 요약 버블이 생성되고 새 컨텍스트 세그먼트가 열린다.

본 문서는 작업을 **5개 영역**, **57개 작업 패키지(Work Package, WP)** 로 분해하고, PRD §12에 매핑된 **5개 마일스톤(M1→M5)** 에 배치한다. 아키텍처는 **확정(locked)** 되어 있다: 신규 Node 20 + Fastify + Prisma 백엔드(서버는 key-blind, CRUD + post별 SSE 릴레이 + 컨텍스트 경계 SoT만 담당); React 18 + TypeScript + Vite 모바일 우선 PWA 프론트엔드; 128K 활성 컨텍스트 토큰에서의 지연 요약; 생성자 소유 페르소나의 사용자 생성 커뮤니티; 모델 ID `gemini-3.1-flash-lite`; MIT 라이선스; 키 유출 완화책으로 CSP `connect-src`를 Google 도메인으로 제한.

본 개정판(v0.2)은 리뷰에서 제기된 4개 커버리지 갭, 3개 순서(ordering) 이슈, 3개 데이터 모델 불일치를 해소한다. 구속력 있는 해결안:
- **`me` 식별자**: `POST /auth/session`이 영속화된 `User.id`를 반환하고, 프론트엔드는 `authStore`에 `userId`를 영속화하며, 본인 버블 판정은 `authorId === userId`로 한다(FR-5.2 / 수용기준 #4). 더 이상 가정이 아니다.
- **`clientId` 저장**: Prisma 스키마가 TRD §3에서 **벗어나** `Comment.clientId`(post별 unique)를 추가한다. 이는 구속력을 가지며 "TRD §3 그대로"라는 문구를 대체한다 — TRD §4.1 멱등성과, (authorId가 null인) AI 버블의 PATCH 인가를 위해 필요하다.
- **페르소나 아이콘**: Prisma 스키마에 `Community.personaIcon`(문자열, 이모지/짧은 토큰, nullable, 기본 컨벤션)을 추가한다. `PersonaBadge`의 데이터 소스다.
- **작성자 D1 지표**: 인증된 앱 오픈 시 기록되는 최소한의 append-only `VisitEvent`(userId, date)가 D1 재방문율(PRD §8)의 데이터 기반을 제공한다.

---

## 2. 핵심 원칙 & 확정 결정 (Guiding Principles & Locked Decisions)

| # | 결정 | 출처 | 계획상 결과 |
|---|------|------|-------------|
| L1 | **서버는 key-blind**(BYOK). 어떤 모델에도 `apiKey` 필드 없음; 요청 바디/헤더/로그에 절대 없음. | TRD §0, §8; FR-2.2 | 서버는 텍스트 결과만 저장. XC-1 리뷰 체크리스트 + XC-2 로그 redaction 테스트로 강제. |
| L2 | **CSP `connect-src 'self' https://generativelanguage.googleapis.com`** 가 1차 키 유출 완화책. | TRD §8; NFR-2 | XC-3가 CSP 헤더/메타 설정; XC-4가 조립 chokepoint에서 프롬프트 인젝션 방어. |
| L3 | **지연 128K 요약** — 다음 `@AI` 호출자 키로 수행. 일반 사람 댓글은 즉시 요약 없이 `tokenSum`을 128K 너머로 밀 수 있음. | FR-7.3; TRD §6.2 | AI-6가 답변 전 요약을 오케스트레이션; BE-7이 활성 세그먼트당 요약 1개 강제. |
| L4 | **`seq`가 순서·SSE 재생·멱등성의 단일 출처(SoT)**. | TRD §3, §7 | BE가 `seq` 부여; RT가 `afterSeq`/`Last-Event-ID`로 재생. |
| L5 | **`ContextSegment`가 요약 경계의 SoT**; post당 `isActive=true`는 정확히 1개; `tokenSum`이 128K 판정 기준. | TRD §3, §6.1 | BE-5 세그먼트 생명주기; AI-4/AI-7 활성 세그먼트 기준 조립. |
| L6 | **페르소나 = `systemInstruction`**; 사용자 콘텐츠는 항상 데이터(user turn). | FR-3.2; TRD §5.1, §8 | AI-4가 역할 매핑; XC-4가 페르소나 덮어쓰기 방지. |
| L7 | **모델 ID `gemini-3.1-flash-lite`**, 단일 config 상수. | PRD A-1; TRD §5 | AI-2 config 모듈; 다른 곳에 하드코딩 금지. |
| L8 | **MIT 라이선스.** | PRD §1; TRD §13 | XC-11이 LICENSE + 헤더 추가. |
| L9 | **모바일 우선(360–430px), 터치 ≥44px, PWA(선택).** | NFR-1; WIREFRAME | FE-1 레이아웃 셸; FE-13 PWA. |
| L10 | **SQLite(PoC) → Postgres(확장)**, 무상태 서버, 인메모리 pub/sub → Redis. | TRD §2, NFR-4 | BE-1 Prisma datasource 추상화; RT-2 pub/sub 인터페이스 seam. |
| L11 | **`me` 식별자 = 영속화된 `User.id`** — `/auth/session`이 반환, 클라이언트에 영속화. | FR-5.2; 리뷰 갭 해소 | BE-3 + FE-3 (§1 참조). |
| L12 | **스키마가 TRD §3에서 벗어남**: `Comment.clientId`, `Community.personaIcon` 추가; `VisitEvent` 추가. | 리뷰 불일치 해소 | BE-2 (구속력). |

---

## 3. 아키텍처 한눈에 보기 (Architecture at a Glance)

- **시스템 다이어그램 & 데이터 흐름**: TRD §1 (브라우저→Google 직접; 서버 CRUD + SSE 릴레이 + SoT).
- **스택**: TRD §2 (React/TS/Vite/Zustand/Tailwind; Node/Fastify; Prisma/SQLite→Postgres; SSE; 인메모리→Redis pub/sub).
- **데이터 모델**: TRD §3 **(L12로 개정됨)** (BE-2 참조).
- **컨텍스트/요약 엔진**: TRD §6 (지연 128K, 세그먼트 경계, manager.py 포팅 조립).
- **실시간**: TRD §7 (post별 SSE, 스냅샷 재생 후 라이브, `Last-Event-ID` 복구).
- **프론트엔드 구조**: TRD §10.

---

## 4. 마일스톤 로드맵 (M1 → M5)

PRD §12에 매핑. 각 마일스톤은 순서 있는 작업 패키지, 목표, 종료 기준을 나열한다. 디렉터리 정규화(구속력): 백엔드는 `server/` 아래, 프론트엔드/AI/엔진은 `frontend/src/` 아래. RT 영역의 `server/src/realtime/*`와 BE-10 `server/src/sse/*`는 **하나의 서브시스템**이다(§6 참조). 중복되는 테스트 WP는 **통합**되며(§6 참조) 중복 생성하지 않는다.

### M1 — 골격 (로컬 인증, 커뮤니티 생성, 글 작성, 홈 피드)
PRD §12.1 · PRD 수용기준 #1, #2 매핑.

| 순서 | WP | 제목 | 종료 관련 |
|------|----|------|-----------|
| 1 | BE-1 | 프로젝트 스캐폴드, Fastify+Prisma, datasource 설정 | 서버 부팅 |
| 2 | BE-2 | Prisma 스키마(개정) + 마이그레이션 | DB 준비 |
| 3 | BE-3 | `POST /auth/session` (upsert + **`id` 반환**) | 식별자 계약 |
| 4 | BE-9a | hotScore 순수 재계산 함수 (분리, §6 참조) | 정렬 유틸 준비 |
| 5 | BE-4 | 커뮤니티: 생성/검색/PATCH | FR-3, FR-1.2 |
| 6 | BE-5 | 게시글 + ContextSegment seg#0 생명주기 | FR-4.2 |
| 7 | BE-9b | `POST /posts/:id/upvote` 라우트 (인증) | hot 업데이트 |
| 8 | FE-1 | 앱 셸, 라우터, 모바일 레이아웃, 탭바 | 내비게이션 |
| 9 | FE-2 | API 클라이언트(`rest.ts`) + `api/types.ts` (incl. `userId`) | 계약 |
| 10 | FE-3 | authStore(`{userId, username, googleApiKey}` 영속화) + 로그인 | FR-2, L11 |
| 11 | FE-4 | 홈 피드 (PostCard, hot/new 탭, cursor) | FR-1.1 |
| 12 | FE-5 | 커뮤니티 검색/상세 + PersonaBadge (`personaIcon` 사용) | FR-1.2, FR-3 |
| 13 | FE-6 | CreateCommunity (PersonaEditor, personaIcon 입력) | FR-3.1 |
| 14 | FE-7 | CreatePost | FR-4.1 |

**M1 종료 기준**: 로그인이 `{userId,username,key}`를 영속화; 커뮤니티 생성/검색 동작; 글 작성이 스레드 라우트 반환; 홈 hot 피드가 cursor로 렌더; 서버 어디에도 apiKey 필드 없음(XC-1 스폿 체크).

### M2 — 스레드 / 실시간 (채팅 댓글, 좌/우 버블, SSE)
PRD §12.2 · 수용기준 #4 및 FR-5.4 매핑.

| 순서 | WP | 제목 | 종료 관련 |
|------|----|------|-----------|
| 1 | RT-1 | SSE 전송 스캐폴드 + pub/sub 인터페이스(`PubSub` seam) | RT-2/RT-3 기반 |
| 2 | RT-2 | 인터페이스 뒤의 인메모리 pub/sub 구현 | 단일 인스턴스 |
| 3 | RT-3 | Publish seam (`publish(postId, event)`) — BE 쓰기에서 사용 | 디커플링 지점 |
| 4 | BE-6 | `POST /posts/:id/comments` (HUMAN 경로, clientId 멱등, RT-3 통한 publish) | FR-5, 멱등성 |
| 5 | BE-10/RT-4 | `GET /posts/:id/stream` 엔드포인트 (스냅샷 재생 + 라이브) | FR-5.4 |
| 6 | RT-5 | 이벤트 스키마(`comment.created/updated`, `segment.opened`) | TRD §7 |
| 7 | RT-6 | `Last-Event-ID` / `afterSeq` 재접속 재생 | 복구 |
| 8 | BE-11 | `GET /posts/:id/comments?afterSeq=` 페이지네이션 | NFR-3 |
| 9 | FE-8 | threadStore (버블, 활성 세그먼트) | 상태 |
| 10 | FE-9 | ChatBubble (left/right/ai/summary) + `authorId===userId` 기반 bubbleSide | FR-5.2 |
| 11 | RT-7/FE-10 | `useThreadStream` EventSource 훅 (구독+재생) | FR-5.4 |
| 12 | FE-11 | Composer (댓글 게시, 낙관적 우측 버블) | FR-5, FR-6.3 |

**M2 종료 기준**: 한 스레드를 보는 두 브라우저가 새 버블을 P95 < 1.5초에 확인(NFR); 본인 댓글은 우측, 타인/AI는 좌측 렌더; 재접속 시 놓친 버블 재생; clientId 재요청은 동일 버블 반환.

### M3 — AI 코어 (BYOK Gemini 1차 답변 + `@AI` 답변)
PRD §12.3 · 수용기준 #3, #5, BYOK 매핑.

| 순서 | WP | 제목 | 종료 관련 |
|------|----|------|-----------|
| 1 | AI-1 | GeminiClient 전송 (fetch→Google, 401/403/429 에러 매핑) | BYOK 호출 |
| 2 | AI-2 | 모델/config 상수(`gemini-3.1-flash-lite`) | L7 |
| 3 | AI-3 | countTokens + `chars/4` 폴백 | FR-7 토큰 기준 |
| 4 | AI-4 | `buildContents` 조립 chokepoint (역할, 화자 접두) | FR-6.1 |
| 5 | XC-4 | AI-4 chokepoint에서 프롬프트 인젝션 격리 가드 (deps: AI-4) | TRD §8 |
| 6 | BE-12 | `GET /posts/:id/context` (segmentIndex, contents, tokenSum, summaryNeeded) | TRD §6.2 |
| 7 | BE-8 | `PATCH /comments/:id` (status/body; clientId/userId 인가) | FR-6.2 |
| 8 | AI-5 | 1차 답변 흐름 (글 생성 → 페르소나 → PENDING → PATCH) | FR-4.3 |
| 9 | AI-7 | `@AI` 답변 흐름 (감지, 사람 먼저, 컨텍스트, PENDING, 답변, PATCH) | FR-6 |
| 10 | FE-12 | 로딩/타이핑 + 실패/재시도 버블 상태 | NFR-5 |

**M3 종료 기준**: 글 생성 시 작성자 키로 1차 AI 버블 생성; `@AI`가 (원본+기존 AI+기존 사람) 기반 답변을 생성하되 사람 버블 먼저 등록 → 로딩 → 답변 순서; 무효 키 → FAILED, 사람 댓글 보존; 모든 호출이 브라우저→Google.

### M4 — 요약 엔진 (128K 카운팅, 지연 요약, 세그먼트 전환)
PRD §12.4 · 수용기준 #6, #7 매핑.

| 순서 | WP | 제목 | 종료 관련 |
|------|----|------|-----------|
| 1 | BE-5s | AI_SUMMARY 게시 시 세그먼트 개시 전환 (BE-5 확장) | TRD §6 |
| 2 | BE-7 | 요약 멱등 가드 (활성 세그먼트당 AI_SUMMARY 1개; 409 + 현재 세그먼트 payload) | TRD §6.5 |
| 3 | AI-8 | `@AI` 경로에서 지연 요약 감지 (tokenSum>128K) | FR-7.1/7.3 |
| 4 | AI-6 | 요약 오케스트레이션 (요약 호출 → AI_SUMMARY 게시 → 409 재조회 → 재조립) | FR-7.1/7.3, TRD §6.3 |
| 5 | AI-9 | 요약 후 컨텍스트 재조립 (요약 + 요약 이후 버블만) | FR-7.2 |
| 6 | RT-8 | `segment.opened` 전파를 종단 간 연결 | TRD §7 |
| 7 | FE-13a | SummaryBubble 색 구분 + "요약 경계" + 요약 임박 배지(~120K) | FR-7.4 |

**M4 종료 기준**: 활성 토큰 >128K에서 다음 `@AI`가 색 구분 요약 버블을 생성(1개만, 동시 패자는 409 받고 재조립)한 뒤 (요약 + 이후)만 기반으로 답변; `segment.opened`가 모든 시청자에게 도달.

### M5 — 다듬기 (hot 정렬, 검색, 에러/로딩, PWA, 지표)
PRD §12.5 · 수용기준 보완 + NFR + 지표 + 라이선스 매핑.

| 순서 | WP | 제목 | 종료 관련 |
|------|----|------|-----------|
| 1 | BE-13 | 지표 엔드포인트 + 인증 앱 오픈 시 `VisitEvent` 기록 | PRD §8 |
| 2 | XC-8 | hotScore decay 잡/리프레시 다듬기 | TRD §9 |
| 3 | FE-14 | 빈/에러/오프라인 상태 (SSE 재접속 배너 포함) | WIREFRAME §8 |
| 4 | FE-13 | PWA (vite-plugin-pwa, manifest, 설치) | NFR-1 |
| 5 | XC-3 | CSP 헤더/메타 마무리 + DOMPurify 마크다운 | L2, NFR-2 |
| 6 | XC-9 | 레이트 리미팅 (글/커뮤니티 쿨다운) | TRD §8 |
| 7 | XC-10 | 지표 계측 (클라이언트 이벤트 → §8 KPI) | PRD §8 |
| 8 | XC-11 | MIT LICENSE + 헤더 | L8 |
| 9 | XC-T | **통합 테스트 스위트** (unit/contract/integration/E2E) | TRD §12 |

**M5 종료 기준**: 모든 PRD §13 수용 항목이 E2E(J1/J2/J3)로 통과; CSP 강제; 작성자 D1 기반 포함 지표 존재; PWA 설치 가능; LICENSE 존재; 통합 테스트 green.

---

## 5. 상세 작업 패키지 (Detailed Work Packages)

> 5개 영역 57개 WP. 누락 없음. 본 개정에서 도입한 분리: **BE-9 → BE-9a(순수 함수) + BE-9b(인증 라우트)**; **BE-5 → BE-5(seg#0) + BE-5s(요약 전환)**. 테스트 WP는 **XC-T로 통합**(중복된 BE-13test/AI-10/XC-5/XC-6/XC-7/RT-8test 범위 대체 — 아래 RT-8은 런타임 `segment.opened` 연결이며 테스트가 아님).

### Backend (`server/`)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| BE-1 | 스캐폴드 | Fastify+TS, Prisma 초기화, datasource 추상화(SQLite PoC→Postgres), config, health | — | `server/src/app.ts`, `server/src/config.ts`, `server/prisma/schema.prisma`(init) | S |
| BE-2 | 스키마+마이그레이션(개정) | TRD §3 스키마 **+ L12 변경** 구현: `Comment.clientId String?` + `@@unique([postId, clientId])`; `Community.personaIcon String?`(기본 컨벤션은 FE에서 적용); `VisitEvent{id,userId,date,@@unique([userId,date])}`. **어떤 모델에도 `apiKey` 필드 없음.** 마이그레이션 생성. | BE-1 | `server/prisma/schema.prisma`, `server/prisma/migrations/*` | M |
| BE-3 | Auth 세션 | `POST /auth/session`: username으로 User upsert, **`{ id, username }` 반환**. 키 절대 미수령. 계약상 `id`를 `me` 식별자로 문서화. | BE-2 | `server/src/routes/auth.ts` | S |
| BE-4 | 커뮤니티 | `GET /communities?q=`(부분 일치), `POST /communities`(name/slug/personaPrompt/personaIcon), `PATCH /communities/:id`(userId 통한 생성자 전용). | BE-2, BE-3 | `server/src/routes/communities.ts` | M |
| BE-5 | 게시글 + seg#0 | `POST /posts`(먼저 등록, `ContextSegment` index 0 활성 자동 생성), `GET /posts/:id`, `GET /communities/:slug/posts`, `GET /posts?sort=hot&cursor=`. | BE-2, BE-9a | `server/src/routes/posts.ts`, `server/src/domain/segment.ts` | M |
| BE-5s | 세그먼트 개시 전환 | AI_SUMMARY 댓글 수락 시 현재 세그먼트 비활성화, 세그먼트 N+1 개시(활성), `summaryCommentId` 연결. | BE-5, BE-6, BE-7 | `server/src/domain/segment.ts` | M |
| BE-6 | 댓글 게시(HUMAN) | `POST /posts/:id/comments`: `seq` 부여, 활성 `segmentId` 해석, `tokenCount` 영속화, **`clientId` 멱등 강제(재요청 시 기존 반환)**, `tokenSum` 갱신, RT-3 seam 통한 publish. | BE-2, BE-3, RT-1, RT-3 | `server/src/routes/comments.ts` | M |
| BE-7 | 요약 가드 | 활성 세그먼트에 요약이 없을 때만 AI_SUMMARY 수락; 동시 패자 → **409 + 현재/신규 활성 세그먼트 payload**. 승자에서 BE-5s 트리거. | BE-5, BE-6 | `server/src/routes/comments.ts`, `server/src/domain/segment.ts` | M |
| BE-8 | 댓글 PATCH | `PATCH /comments/:id` PENDING→COMPLETE/FAILED, 본문 갱신. **인가: 사람 버블은 `authorId===userId`; AI 버블(authorId null)은 발신 `clientId` 매칭**(L12로 영속화). | BE-2, BE-6 | `server/src/routes/comments.ts` | S |
| BE-9a | hotScore 함수 | TRD §9 기준 순수 재계산 `hotScore(score, commentCount, createdAt)`. | BE-2 | `server/src/domain/hotScore.ts` | S |
| BE-9b | Upvote 라우트 | `POST /posts/:id/upvote`(userId 통한 인증), BE-9a로 재계산, 영속화. | BE-3, BE-9a, BE-5 | `server/src/routes/posts.ts` | S |
| BE-11 | 댓글 페이지네이션 | `GET /posts/:id/comments?afterSeq=` `seq` 기준 keyset, 페이지 크기 50. | BE-2, BE-6 | `server/src/routes/comments.ts` | S |
| BE-12 | 컨텍스트 조립 엔드포인트 | `GET /posts/:id/context` → 활성 세그먼트 기준 `{ segmentIndex, contents[], tokenSum, summaryNeeded }`(TRD §6.2). | BE-2, BE-5, BE-6 | `server/src/routes/context.ts`, `server/src/domain/contextAssembler.ts` | M |
| BE-13 | 지표 + VisitEvent | 인증 앱 오픈 시 `VisitEvent(userId, date)` 기록(일별 멱등); §8 KPI용 읽기 엔드포인트(글당 평균 @AI, 스레드당 고유 댓글자, 요약 성공률, 작성자 **D1 재방문율** = 첫 글 이후 익일 VisitEvent). | BE-2, BE-3 | `server/src/routes/metrics.ts` | M |

### Realtime (`server/src/realtime/*`, BE-10 SSE와 통합)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| RT-1 | SSE 전송 스캐폴드 | EventSource 호환 `text/event-stream` 배관, 연결 레지스트리, heartbeat. | BE-1 | `server/src/realtime/transport.ts` | M |
| RT-2 | Pub/sub 구현 | `PubSub` 인터페이스 뒤의 인메모리 pub/sub(Redis 교체 가능). | RT-1 | `server/src/realtime/pubsub.ts` | S |
| RT-3 | Publish seam | BE 쓰기에서 사용하는 `publish(postId, event)` API(BE-6를 stream 엔드포인트에서 디커플). | RT-2 | `server/src/realtime/publish.ts` | S |
| BE-10/RT-4 | Stream 엔드포인트 | `GET /posts/:id/stream`: `afterSeq`로 스냅샷 재생 후 라이브 구독. **BE-6에 의존**(BE-6 이벤트를 소비), 역방향 아님. | RT-1, RT-2, RT-3, BE-6 | `server/src/realtime/stream.ts` (== `server/src/sse/*`) | M |
| RT-5 | 이벤트 스키마 | 타입 지정된 `comment.created` / `comment.updated` / `segment.opened`. | RT-2 | `server/src/realtime/events.ts` | S |
| RT-6 | 재접속 재생 | `Last-Event-ID`(=seq) 갭 재생. | RT-4, RT-5, BE-11 | `server/src/realtime/stream.ts` | S |
| RT-7/FE-10 | 클라이언트 stream 훅 | `useThreadStream` EventSource 구독 + 재생 + seq 기반 dedupe. | RT-4, RT-5, FE-8 | `frontend/src/stream/useThreadStream.ts` | M |
| RT-8 | segment.opened 연결 | BE-5s에서 pub/sub를 거쳐 클라이언트까지 `segment.opened` 종단 간 전파. | BE-5s, RT-5, RT-4 | `server/src/realtime/publish.ts`, `frontend/src/stream/useThreadStream.ts` | S |

### Frontend (`frontend/src/`)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| FE-1 | 앱 셸 | 라우터, 모바일 우선 레이아웃, 하단 탭바, 반응형 규칙(<768 / ≥1024). | — | `frontend/src/App.tsx`, `frontend/src/layout/*` | M |
| FE-2 | API 클라이언트 + 타입 | `rest.ts`, `api/types.ts` — **`SessionResponse{ id, username }`**, Comment/Community/Post DTO(`personaIcon`, 댓글 게시 요청의 `clientId` 포함). | BE-3..BE-13 계약 | `frontend/src/api/rest.ts`, `frontend/src/api/types.ts` | M |
| FE-3 | authStore + 로그인 | `{ userId, username, googleApiKey }` 영속화(키는 로컬 전용); LoginForm; 키 경고 카피; 로그아웃 시 전부 삭제. | FE-2, BE-3 | `frontend/src/stores/authStore.ts`, `frontend/src/pages/Login.tsx` | M |
| FE-4 | 홈 피드 | PostCard, hot/new 탭, cursor 무한 스크롤. | FE-1, FE-2 | `frontend/src/pages/Home.tsx`, `frontend/src/components/PostCard.tsx` | M |
| FE-5 | 커뮤니티 검색/상세 | CommunitySearch, **`personaIcon` 사용 PersonaBadge**(null이면 기본 이모지) 포함 상세. | FE-2, FE-4 | `frontend/src/pages/Community.tsx`, `frontend/src/components/PersonaBadge.tsx` | M |
| FE-6 | CreateCommunity | **personaIcon 피커/입력** 포함 PersonaEditor, slug 제안. | FE-2, FE-5 | `frontend/src/pages/CreateCommunity.tsx`, `frontend/src/components/PersonaEditor.tsx` | M |
| FE-7 | CreatePost | 제목/본문, "1차 AI 답변 받기" 토글(기본 ON). | FE-2 | `frontend/src/pages/CreatePost.tsx` | S |
| FE-8 | threadStore | 버블 리스트, 활성 세그먼트, 낙관적 삽입, seq dedupe. | FE-2 | `frontend/src/stores/threadStore.ts` | M |
| FE-9 | ChatBubble | left/right/ai/summary 변형; **`bubbleSide = authorId===authStore.userId ? right : left`**(AI는 항상 left); AI 버블에 `personaIcon` 사용 PersonaBadge. | FE-3, FE-8, FE-5 | `frontend/src/components/ChatBubble.tsx` | M |
| FE-11 | Composer | 댓글 입력, `@AI` 감지, 낙관적 우측 버블, `clientId` 전송. | FE-8, FE-9 | `frontend/src/components/Composer.tsx` | M |
| FE-12 | AI 상태 | 로딩/타이핑 애니메이션, FAILED + 재시도 버블. | FE-9, AI-1 | `frontend/src/components/ChatBubble.tsx` | S |
| FE-13 | PWA | vite-plugin-pwa, manifest, 설치, 아이콘. | FE-1 | `frontend/vite.config.ts`, `frontend/public/manifest.webmanifest` | S |
| FE-13a | SummaryBubble UI | 색 구분 전폭 요약 띠, 경계 마이크로카피, ~120K 요약 임박 배지, 비용 툴팁. | FE-9, AI-8 | `frontend/src/components/SummaryBubble.tsx` | S |
| FE-14 | 상태 | 빈/에러/오프라인, SSE 재접속 배너. | FE-4, FE-8 | `frontend/src/components/states/*` | S |

### AI / Engine (`frontend/src/`)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| AI-1 | GeminiClient | fetch→`generativelanguage.googleapis.com` generateContent; 401/403→FAILED("키 확인"), 429→재시도 카피 매핑. 키는 호출 시점 메모리에만. | FE-3 | `frontend/src/api/gemini.ts` | M |
| AI-2 | 모델 config | `MODEL="gemini-3.1-flash-lite"`, generationConfig 기본값; 단일 출처. | — | `frontend/src/config/model.ts` | S |
| AI-3 | 토큰 카운팅 | `countTokens` 호출 + `Math.ceil(chars/4)` 폴백; 버블별 tokenCount. | AI-1, AI-2 | `frontend/src/api/gemini.ts` | S |
| AI-4 | buildContents | 조립 chokepoint: 사람→`user`(`「{username}」:` 접두), AI→`model`, 요약→개시 user turn 매핑; 페르소나는 systemInstruction. | AI-2 | `frontend/src/engine/contextEngine.ts` | M |
| AI-5 | 1차 답변 흐름 | 글 생성 후: seg#0 조립 → 페르소나 호출 → AI_REPLY PENDING 게시 → PATCH COMPLETE/FAILED. 작성자 키. | AI-1, AI-4, BE-12, BE-8, FE-7 | `frontend/src/engine/contextEngine.ts` | M |
| AI-6 | 요약 오케스트레이션 | 요약 호출(페르소나+요약 지시) → AI_SUMMARY 게시 → 409 시 현재 세그먼트 재조회 & 재조립 → 진행. | AI-1, AI-4, AI-8, BE-7, BE-12 | `frontend/src/engine/contextEngine.ts` | M |
| AI-7 | @AI 답변 흐름 | `@AI` 감지, 사람 먼저 게시, GET /context, (AI-8 분기), AI_REPLY PENDING 게시(replyToId), 호출, PATCH. 호출자 키. | AI-1, AI-4, BE-12, BE-8, BE-6, XC-4 | `frontend/src/engine/contextEngine.ts` | L |
| AI-8 | 지연 요약 감지 | `@AI` 경로에서 답변 전 `summaryNeeded`/`tokenSum>128K` 게이트. | BE-12 | `frontend/src/engine/contextEngine.ts` | S |
| AI-9 | 요약 후 재조립 | 활성 세그먼트 N≥1에 대해 (세그먼트 개시 요약 + 요약 이후 버블만)으로 contents 구성. | AI-4, AI-6 | `frontend/src/engine/contextEngine.ts` | M |

### Cross-cutting (`server/` + `frontend/`)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| XC-1 | Key-blind 리뷰 체크리스트 | 코드화된 체크리스트 + lint 규칙: 서버 바디/헤더/로그에 apiKey 금지; CI grep 게이트. | BE-1 | `docs/checklists/key-blind.md`, CI config | S |
| XC-2 | 로그 redaction 테스트 | 서버 로그/응답에 키 형태 payload가 절대 없음을 단언. | XC-1, BE-3..BE-13 | `server/test/security/redaction.test.ts` | S |
| XC-3 | CSP + sanitize | CSP 헤더(`connect-src` Google만, `script-src 'self'` 등) + 사용자 콘텐츠/마크다운에 DOMPurify. | FE-1, BE-1 | `server/src/plugins/security.ts`, `frontend/src/lib/sanitize.ts` | M |
| XC-4 | 프롬프트 인젝션 가드 | AI-4 chokepoint에서: 페르소나는 systemInstruction 유지, 사용자 입력은 데이터 유지; 덮어쓰기 시도 테스트. | AI-4 | `frontend/src/engine/contextEngine.ts` | S |
| XC-8 | hot decay 다듬기 | 시간 경과에 따른 hotScore 리프레시/decay 처리. | BE-9a, BE-5 | `server/src/domain/hotScore.ts` | S |
| XC-9 | 레이트 리미팅 | username별 글 레이트 리밋; 커뮤니티 생성 쿨다운. | BE-3, BE-4, BE-6 | `server/src/plugins/rateLimit.ts` | S |
| XC-10 | 지표 계측 | 클라이언트가 §8 KPI에 공급할 이벤트 발행; BE-13(작성자 D1 포함)과 연결. | BE-13, FE-3 | `frontend/src/lib/metrics.ts` | S |
| XC-11 | 라이선스 | MIT LICENSE + 소스 헤더. | — | `LICENSE`, headers | XS |
| XC-T | 통합 테스트 | 단일 스위트: contextEngine 토큰/128K/세그먼트 전환 + hotScore(unit); clientId 멱등 + `/context` #5-vs-#7 조립(contract); 다중 클라 SSE fan-out + 동시 @AI/요약(integration); J1/J2/J3(E2E, Gemini 모킹+실키). 겹치는 BE/AI/RT/XC 테스트 범위 대체. | 모든 구현 WP | `server/test/**`, `frontend/src/**/*.test.ts`, `e2e/**` | L |

---

## 6. 의존성 / 순서 노트 (Dependency / Sequencing Notes)

**임계 경로(Critical path)**: BE-1→BE-2→BE-3→(BE-5,BE-6)→RT-1→RT-3→BE-6→RT-4→BE-12→AI-4→AI-7→BE-7→AI-6→XC-T.

**해소된 순서 이슈(본 개정)**:
- **BE-6 ↔ SSE 결합 수정**: BE-6는 이제 **publish seam(RT-1/RT-2/RT-3)** 에만 의존하며, 전체 stream 엔드포인트에 의존하지 *않는다*. stream 엔드포인트 **BE-10/RT-4가 BE-6에 의존**한다(BE-6 이벤트를 릴레이). M2 쓰기 경로를 실시간 허브에 묶을 위험이 있던 과결합을 제거.
- **BE-5 ⇄ BE-9 사이클을 분리로 제거**: BE-9를 **BE-9a(순수 hotScore 함수, M1#4, dep BE-2)**(BE-5가 소비)와 **BE-9b(인증 upvote 라우트, M1#7, dep BE-3+BE-9a+BE-5)** 로 분리. BE-5의 dep은 이제 `BE-2, BE-9a`(사이클 없음). 라우트 절반은 BE-3 식별자 이후로 올바르게 배치.
- **XC-4 순서 수정**: XC-4가 이제 **dep AI-4** 를 선언하고(AI-4가 만드는 `buildContents` chokepoint를 가드) M3에서 AI-4 이후, AI-7이 chokepoint를 소비하기 전에 배치. "아직 없는 파일을 편집" 모호성 제거.

**해소된 불일치(본 개정)**:
- **`Comment.clientId` 추가(L12)**: BE-2가 "TRD §3 그대로"에서 벗어나 `clientId`(및 unique 인덱스)를 추가, TRD §4.1 멱등성과 조화. BE-6 멱등성과 BE-8 AI 버블 인가가 이제 실현 가능.
- **BE-8 AI 버블 인가**: AI 버블은 `authorId=null`; 인가는 영속화된 발신 `clientId`를 사용(사람 버블은 `authorId===userId`). 데이터 모델과 일관.
- **FR-7.3 409 경로**(BE-7 ↔ AI-6) 올바름 확인, 그대로 유지.

**영역 간 의존성**:
- FE↔AI 인터페이스: AI-5/AI-7 전에 `api/types.ts`(`SessionResponse.id`, 댓글 게시의 `clientId` 포함) 동결(early-freeze).
- AI↔BE: AI-5/AI-6/AI-7 전에 `/context`(BE-12)와 댓글 엔드포인트(BE-6/BE-8) 동결.
- RT==BE-10은 `server/src/realtime/*` 아래 단일 서브시스템으로 통합.

**병렬 레인**: M1 FE(FE-1..FE-7)는 FE-2 계약 동결 후 BE(BE-1..BE-9b)와 병렬. M3 AI 레인은 AI-1 도착 후 FE-12와 병렬.

**Early-freeze 항목**: `api/types.ts` 계약; 이벤트 스키마(RT-5); 모델 config(AI-2); CSP 정책(XC-3).

---

## 7. 요구사항 추적 매트릭스 (Requirement Traceability Matrix)

모든 요구사항이 ≥1개의 커버 WP에 매핑. 미커버 요구사항 없음.

| 요구사항 | 커버 WP |
|----------|---------|
| FR-1.1 인기 홈 피드 | BE-5, BE-9a, FE-4, XC-8 |
| FR-1.2 커뮤니티 검색 | BE-4, FE-5 |
| FR-1.3 비로그인 열람 | BE-4/BE-5(no-auth GET), FE-3/FE-4(게스트), FE-9 |
| FR-2.1 username+키 로컬 저장 | FE-3 |
| FR-2.2 키 서버 미전송 | L1, XC-1, XC-2, AI-1 |
| FR-2.3 username 표시 + 본인 버블 | BE-3(`id`), FE-3(`userId`), FE-9 |
| FR-2.4 로그아웃 삭제 | FE-3 |
| FR-3.1 커뮤니티+페르소나+아이콘 생성 | BE-4, FE-6(personaIcon 포함) |
| FR-3.2 페르소나=systemInstruction | AI-4, L6 |
| FR-3.3 생성자 페르소나 편집 | BE-4(PATCH), FE-6 |
| FR-4.1 글 작성 | BE-5, FE-7 |
| FR-4.2 먼저 등록 후 스레드 | BE-5, FE-7 |
| FR-4.3 1차 AI 답변(작성자 키, 로딩) | AI-5, FE-7, FE-12 |
| FR-5.1 원본 고정 + 채팅 리스트 | FE-8, FE-9 |
| FR-5.2 타인/AI 좌, 본인 우 | FE-9(`authorId===userId`), BE-3, FE-3 |
| FR-5.3 작성자/시간/타입, AI/요약 구분 | FE-9, FE-13a |
| FR-5.4 실시간 새 버블 | RT-1..RT-7, BE-6, FE-10 |
| FR-6.1 `@AI` (원본+AI+사람) 기반 | AI-4, AI-7, BE-12 |
| FR-6.2 사람 먼저 → 로딩 → AI; 호출자 키 | AI-7, BE-6, BE-8, FE-11, FE-12 |
| FR-6.3 일반 댓글 즉시 | BE-6, FE-11 |
| FR-7.1 128K → 요약 버블 | AI-8, AI-6, BE-7, FE-13a |
| FR-7.2 요약 후 요약+이후만 사용 | AI-9, BE-12 |
| FR-7.3 다음 호출자 키로 지연 요약 | AI-8, AI-6, BE-7, L3 |
| FR-7.4 요약 색 구분 경계 | FE-13a, RT-8 |
| BYOK(수용기준) | L1, AI-1, XC-1, XC-2 |
| NFR-1 모바일 우선/PWA/터치 | FE-1, FE-13, WIREFRAME §11 |
| NFR-2 보안/XSS/키 | XC-1, XC-2, XC-3, XC-4 |
| NFR-3 성능/페이지네이션 | BE-11, FE-4(cursor) |
| NFR-4 무상태/확장/pubsub | BE-1, RT-2(인터페이스), L10 |
| NFR-5 신뢰성(AI 실패 시 사람 보존) | BE-8, FE-12, AI-1 |
| NFR-6 비용(서버 LLM=0) | L1, AI-1 |
| TRD §6.5 동시성(동시 @AI/요약, segmentExpected) | BE-6, BE-7, AI-6, XC-T |
| TRD §7 SSE(재생/Last-Event-ID/segment.opened) | RT-4, RT-5, RT-6, RT-8 |
| TRD §8 보안(CSP/sanitize/프롬프트인젝션/레이트/인가) | XC-3, XC-4, XC-9, BE-4/BE-8 인가 |
| TRD §9 hot 정렬 | BE-9a, XC-8 |
| 지표: 글당 평균 @AI ≥2 | BE-13, XC-10 |
| 지표: 스레드당 고유 댓글자 ≥3 | BE-13, XC-10 |
| 지표: 요약 성공률 ≥95% | BE-13, AI-6 |
| 지표: Gemini 성공률 ≥97% | XC-10, AI-1 |
| 지표: P95 전파 <1.5s | RT-4, XC-T |
| **지표: 작성자 D1 재방문 ≥25%** | **BE-13(VisitEvent), XC-10** |
| 라이선스 MIT | XC-11 |

**이전에 지적된 갭, 이제 해소됨**: 작성자-D1 메커니즘(BE-13 `VisitEvent`), 페르소나 아이콘 데이터 소스(BE-2 `personaIcon` → FE-5/FE-6/FE-9), 본인 버블 식별자(BE-3 `id` + FE-3 `userId`), clientId 저장(BE-2). 남은 의도적 비-WP 항목: **선택적 스트리밍**(TRD §5에서 선택으로 표기; PoC는 비스트리밍 + 로딩 인디케이터 — 명시적 범위 외, WP 없음). **마크다운 vs 평문** 렌더링: DOMPurify로 sanitize된 파이프라인을 통한 마크다운 렌더로 해결(XC-3).

---

## 8. 통합 리스크 & 미해결 질문 (Consolidated Risks & Open Questions)

### 리스크 (중복 제거, 완화책 포함)
1. **localStorage 키 XSS** → CSP `connect-src` Google만으로 exfiltration 차단(XC-3); 호출 시점 메모리만 사용; 경고 카피.
2. **BYOK 무효/쿼터** → 사람 보존, AI 버블 FAILED/재시도(FE-12, AI-1).
3. **128K 요약 비용이 호출자에게** → 요약 임박 배지 + 비용 툴팁(FE-13a).
4. **동시성 하의 공유 컨텍스트 일관성** → 서버 `seq`/세그먼트 SoT; 스냅샷 시점 시맨틱(BE-6, BE-7).
5. **프롬프트 인젝션** → 페르소나를 systemInstruction으로 격리(XC-4).
6. **동시 요약 이중 개시** → BE-7 세그먼트당 1개 + 409(AI-6 재조립).
7. **재접속 시 SSE 이벤트 누락** → `Last-Event-ID` 재생(RT-6).
8. **토큰 추정치 드리프트**(chars/4 vs countTokens) → countTokens 우선, 폴백 문서화(AI-3).
9. **clientId 충돌/악용** → unique `[postId, clientId]`(BE-2), 서버 신뢰 seq.
10. **본인 버블 오귀속** → 영속화된 `userId`로 해결(BE-3/FE-3/FE-9).
11. **단일 인스턴스 pub/sub 한계** → Redis용 인터페이스 seam(RT-2, L10).
12. **마크다운 XSS** → DOMPurify sanitize(XC-3).
13. **레이트/스팸** → XC-9.
14. **흐름 중 요약 호출 실패** → FIFO 폴백 컨텍스트 또는 보류(TRD §11; AI-6 처리).
15. **AI 버블 PATCH 인가** → clientId 기반(BE-8) 이제 실현 가능.
16. **지표 데이터 희박(PoC 규모)** → VisitEvent + 클라이언트 이벤트 best-effort(BE-13/XC-10).

### 미해결 질문 (중복 제거, 비차단; 필요 시 기본값 선택)
1. clientId 저장 형태 — **해결됨**: Comment의 컬럼(L12).
2. AI 버블 인가 기준 — **해결됨**: 발신 clientId(BE-8).
3. username 고유성 강도 — PoC `@unique` upsert; 사칭 방지 연기(TRD §13).
4. 본인 `id` 반환 — **해결됨**: 반환 & 영속화(L11).
5. countTokens 비용/지연 vs 정확도 — 기본 countTokens, 폴백 chars/4.
6. 요약 품질 평가 루프 — 연기(TRD §13).
7. 페르소나 아이콘 소스 — **해결됨**: `Community.personaIcon` + 기본 이모지 컨벤션(BE-2/FE-5).
8. 스트리밍 토큰 — PoC 범위 외(비스트리밍).
9. 마크다운 vs 평문 — **해결됨**: DOMPurify 통한 마크다운(XC-3).
10. Redis 활성화 임계 — 다중 인스턴스 전까지 연기.
11. segmentExpected 불일치 UX — 서버 정정 응답(TRD §6.5; BE-6).
12. 토큰 사용량 보정(추정→실제) — PoC 선택(TRD §6.4).
13. hot decay 배치 vs 쓰기 시점 — PoC 쓰기 시점, 추후 배치(XC-8).
14. PWA 오프라인 범위 — PoC 셸 한정(FE-13).
15. 레이트 리밋 임계 — 보수적 기본값(XC-9).
16. 게스트 열람 범위 경계 — 읽기 GET은 비인증(BE-4/BE-5).
17. AI 실패 카피 현지화 — KO/EN 혼용 카피(PRD 범위).
18. 동시 1차 답변 dedupe — clientId 멱등(BE-6).
19. segment.opened vs comment.created 순서 — seq 정렬 발행(RT-5/RT-8).
20. 최대 버블 페이지 크기 — 50(BE-11).
21. 페르소나 프롬프트 길이 상한 — 소프트 캡, 연기.
22. 요약 입력용 countTokens — AI-3 재사용.
23. 작성자 D1 추적 메커니즘 — **해결됨**: VisitEvent(BE-13).
24. 지표 저장/보존 — PoC 인-DB, 보존 정책 없음.
25. CSP report-uri — 선택, 연기.
26. CI에서 Gemini 모킹 vs 실키 — 양쪽 레인(XC-T).

---

## 9. 완료 정의 (Definition of Done)

> 범례: `[x]` 구현 + 자동검증(vitest contract/integration/unit) 또는 부팅 스모크로 확인 · `[~]` 구현·코드검증 완료, 단 명시한 항목은 PoC에서 미측정/미실행(브라우저 E2E·성능 P95·Postgres 교체). 상세: [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md) §6.

### PRD §13 수용기준 (각각 검증 WP/여정에 연결)
- [x] **#1** 홈 인기 피드 + 커뮤니티 검색 — BE-5/BE-9a/FE-4 + BE-4/FE-5. (구현; hotScore unit, 피드/검색 라우트 스모크. E2E 스캐폴드)
- [x] **#2** 특정 커뮤니티에 글 작성 — BE-5/FE-7. (POST /posts + seg#0 스모크. E2E J1 스캐폴드)
- [x] **#3** 작성자 키로 페르소나 적용 1차 AI 답변, 로딩 — AI-5/FE-7/FE-12. (runPrimaryReply + PENDING/PATCH unit)
- [x] **#4** 원본 고정 + 채팅; 타인/AI 좌, 본인 우 — FE-9(`authorId===userId`)/BE-3/FE-3. (코드 + 프론트 unit)
- [x] **#5** `@AI` (원본+AI+사람) 기반 신규 버블 — AI-7/AI-4/BE-12. (`/context` seg0 조립 contract 테스트)
- [x] **#6** >128K → 색 구분 요약 버블 — AI-8/AI-6/BE-7/FE-13a. (요약 전환 + 409 contract 테스트)
- [x] **#7** 요약 후 `@AI`는 (요약+이후)만 기반 — AI-9/BE-12. (seg≥1 이전 히스토리 제외 contract 테스트)
- [x] **BYOK** 모든 AI 호출 브라우저→Google, 서버 key-blind — L1/AI-1/XC-3. (서버 src apiKey 0건 + key-blind contract 테스트; gemini 직접 호출 unit)
- [x] **순서** 사람 먼저 → 로딩 → AI 버블 — AI-7/FE-11/FE-12. (runAtAiReply 순서 unit)

### 엔지니어링 게이트
- [~] **실시간**: 재접속 재생 정확 + comment.created/updated/segment.opened seq 순서 — SSE integration 테스트 green. **P95 < 1.5s 성능은 PoC에서 미측정.**
- [x] **신뢰성**: AI 실패 시 사람 버블 보존, FAILED+재시도 표시(NFR-5; FE-12). (engine unit + retryAiBubble)
- [x] **보안**: CSP 강제(`connect-src` Google만 — 헤더+메타), DOMPurify sanitize chokepoint, 로그/소스에 키 없음(XC-3); 프롬프트 인젝션 가드 XC-4. (CSP 헤더 스모크 + sanitize/XC-4 unit; §4 캡슐화 버그 수정 후 헤더 적용 확인)
- [~] **PWA**: vite-plugin-pwa로 SW+manifest 산출, 모바일 우선/터치 ≥44px(FE-13/NFR-1). **실기기 설치는 수동 확인 권장.**
- [~] **배포**: 정적 프론트 + Node 서버 구조 확립. **SQLite→Postgres datasource 교체는 미검증**(추상화만, L10).
- [x] **지표**: §8 KPI 계측 + 작성자 D1(VisitEvent) — BE-13(/metrics, /metrics/visit) + XC-10 클라 계측. (DB 산출 KPI 동작; geminiSuccessRate/p95는 best-effort `null`)
- [x] **라이선스**: MIT LICENSE + 엔트리 파일 헤더(XC-11).
- [~] **테스트**: 통합 스위트 — **unit/contract/integration green(백엔드 22, 프론트 28)**. **E2E(J1/J2/J3)는 Gemini 모킹 스캐폴드 제공, 브라우저 실행은 미수행**(XC-T).
