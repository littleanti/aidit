# Aidit — 구현 계획서 (PLAN.md)

> 관련 문서: [PRD.md](./PRD.md), [TRD.md](./TRD.md), [WIREFRAME.md](./WIREFRAME.md), [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md)
> 상태: PoC · 버전: 0.2 · 날짜: 2026-06-16
> **구현 상태(2026-06-17): M1–M5 전부 구현·검증·커밋 완료.** 스펙 대비 확정/추가/변경 사항과 수정한 버그는 [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md)에 정리(§9 완료 정의의 실제 충족 현황 포함).
> 본 계획서는 5개 영역 계획(Backend / Realtime / Frontend / AI-Engine / Cross-cutting)을 종합한 것으로, 세 개의 원본 문서에 엄격히 근거한다. 원본 문서 내부에서 충돌이 있는 경우(특히 TRD §3 스키마 vs. TRD §4.1 멱등성), 본 계획서가 그 충돌을 명시적으로 해소하며 그 결정은 **구속력(binding)** 을 가진다.

---

## 1. 개요 (Introduction)

Aidit은 모바일 우선 Reddit형 커뮤니티 PWA로, 각 게시글이 채팅방형 댓글 스레드를 열고 여러 사용자가 스레드마다 **하나의 공유 AI 컨텍스트**를 함께 쌓아간다. 모든 LLM 호출은 **BYOK(Bring Your Own Key)** 방식이다: 브라우저가 사용자 본인 키로 LLM 제공자(기본: Google Gemini)를 직접 호출하며, Aidit 서버는 키를 보거나 저장하거나 중계하지 않는다. 활성 컨텍스트 세그먼트가 **128K 토큰**을 초과하면, 다음 `@AI` 호출자의 키로 **지연(lazy)** AI 요약 버블이 생성되고 새 컨텍스트 세그먼트가 열린다.

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

PRD §12에 매핑. 각 마일스톤은 순서 있는 작업 패키지, 목표, 종료 기준을 나열한다. 디렉터리 정규화(구속력): 백엔드는 `backend/` 아래, 프론트엔드/AI/엔진은 `frontend/src/` 아래. RT 영역의 `backend/src/realtime/*`와 BE-10 `backend/src/sse/*`는 **하나의 서브시스템**이다(§6 참조). 중복되는 테스트 WP는 **통합**되며(§6 참조) 중복 생성하지 않는다.

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

### M3 — AI 코어 (BYOK LLM 1차 답변 + `@AI` 답변)
PRD §12.3 · 수용기준 #3, #5, BYOK 매핑.

| 순서 | WP | 제목 | 종료 관련 |
|------|----|------|-----------|
| 1 | AI-1 | LlmClient 전송 (fetch→LLM 제공자, 401/403/429 에러 매핑) | BYOK 호출 |
| 2 | AI-2 | 모델/config 상수(`LLM_MODEL="gemini-3.1-flash-lite"`) | L7 |
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

### Backend (`backend/`)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| BE-1 | 스캐폴드 | Fastify+TS, Prisma 초기화, datasource 추상화(SQLite PoC→Postgres), config, health | — | `backend/src/app.ts`, `backend/src/config.ts`, `backend/prisma/schema.prisma`(init) | S |
| BE-2 | 스키마+마이그레이션(개정) | TRD §3 스키마 **+ L12 변경** 구현: `Comment.clientId String?` + `@@unique([postId, clientId])`; `Community.personaIcon String?`(기본 컨벤션은 FE에서 적용); `VisitEvent{id,userId,date,@@unique([userId,date])}`. **어떤 모델에도 `apiKey` 필드 없음.** 마이그레이션 생성. | BE-1 | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` | M |
| BE-3 | Auth 세션 | `POST /auth/session`: username으로 User upsert, **`{ id, username }` 반환**. 키 절대 미수령. 계약상 `id`를 `me` 식별자로 문서화. | BE-2 | `backend/src/routes/auth.ts` | S |
| BE-4 | 커뮤니티 | `GET /communities?q=`(부분 일치), `POST /communities`(name/slug/personaPrompt/personaIcon), `PATCH /communities/:id`(userId 통한 생성자 전용). | BE-2, BE-3 | `backend/src/routes/communities.ts` | M |
| BE-5 | 게시글 + seg#0 | `POST /posts`(먼저 등록, `ContextSegment` index 0 활성 자동 생성), `GET /posts/:id`, `GET /communities/:slug/posts`, `GET /posts?sort=hot&cursor=`. | BE-2, BE-9a | `backend/src/routes/posts.ts`, `backend/src/domain/segment.ts` | M |
| BE-5s | 세그먼트 개시 전환 | AI_SUMMARY 댓글 수락 시 현재 세그먼트 비활성화, 세그먼트 N+1 개시(활성), `summaryCommentId` 연결. | BE-5, BE-6, BE-7 | `backend/src/domain/segment.ts` | M |
| BE-6 | 댓글 게시(HUMAN) | `POST /posts/:id/comments`: `seq` 부여, 활성 `segmentId` 해석, `tokenCount` 영속화, **`clientId` 멱등 강제(재요청 시 기존 반환)**, `tokenSum` 갱신, RT-3 seam 통한 publish. | BE-2, BE-3, RT-1, RT-3 | `backend/src/routes/comments.ts` | M |
| BE-7 | 요약 가드 | 활성 세그먼트에 요약이 없을 때만 AI_SUMMARY 수락; 동시 패자 → **409 + 현재/신규 활성 세그먼트 payload**. 승자에서 BE-5s 트리거. | BE-5, BE-6 | `backend/src/routes/comments.ts`, `backend/src/domain/segment.ts` | M |
| BE-8 | 댓글 PATCH | `PATCH /comments/:id` PENDING→COMPLETE/FAILED, 본문 갱신. **인가: 사람 버블은 `authorId===userId`; AI 버블(authorId null)은 발신 `clientId` 매칭**(L12로 영속화). | BE-2, BE-6 | `backend/src/routes/comments.ts` | S |
| BE-9a | hotScore 함수 | TRD §9 기준 순수 재계산 `hotScore(score, commentCount, createdAt)`. | BE-2 | `backend/src/domain/hotScore.ts` | S |
| BE-9b | Upvote 라우트 | `POST /posts/:id/upvote`(userId 통한 인증), BE-9a로 재계산, 영속화. | BE-3, BE-9a, BE-5 | `backend/src/routes/posts.ts` | S |
| BE-11 | 댓글 페이지네이션 | `GET /posts/:id/comments?afterSeq=` `seq` 기준 keyset, 페이지 크기 50. | BE-2, BE-6 | `backend/src/routes/comments.ts` | S |
| BE-12 | 컨텍스트 조립 엔드포인트 | `GET /posts/:id/context` → 활성 세그먼트 기준 `{ segmentIndex, contents[], tokenSum, summaryNeeded }`(TRD §6.2). | BE-2, BE-5, BE-6 | `backend/src/routes/context.ts`, `backend/src/domain/contextAssembler.ts` | M |
| BE-13 | 지표 + VisitEvent | 인증 앱 오픈 시 `VisitEvent(userId, date)` 기록(일별 멱등); §8 KPI용 읽기 엔드포인트(글당 평균 @AI, 스레드당 고유 댓글자, 요약 성공률, 작성자 **D1 재방문율** = 첫 글 이후 익일 VisitEvent). | BE-2, BE-3 | `backend/src/routes/metrics.ts` | M |

### Realtime (`backend/src/realtime/*`, BE-10 SSE와 통합)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| RT-1 | SSE 전송 스캐폴드 | EventSource 호환 `text/event-stream` 배관, 연결 레지스트리, heartbeat. | BE-1 | `backend/src/realtime/transport.ts` | M |
| RT-2 | Pub/sub 구현 | `PubSub` 인터페이스 뒤의 인메모리 pub/sub(Redis 교체 가능). | RT-1 | `backend/src/realtime/pubsub.ts` | S |
| RT-3 | Publish seam | BE 쓰기에서 사용하는 `publish(postId, event)` API(BE-6를 stream 엔드포인트에서 디커플). | RT-2 | `backend/src/realtime/publish.ts` | S |
| BE-10/RT-4 | Stream 엔드포인트 | `GET /posts/:id/stream`: `afterSeq`로 스냅샷 재생 후 라이브 구독. **BE-6에 의존**(BE-6 이벤트를 소비), 역방향 아님. | RT-1, RT-2, RT-3, BE-6 | `backend/src/realtime/stream.ts` (== `backend/src/sse/*`) | M |
| RT-5 | 이벤트 스키마 | 타입 지정된 `comment.created` / `comment.updated` / `segment.opened`. | RT-2 | `backend/src/realtime/events.ts` | S |
| RT-6 | 재접속 재생 | `Last-Event-ID`(=seq) 갭 재생. | RT-4, RT-5, BE-11 | `backend/src/realtime/stream.ts` | S |
| RT-7/FE-10 | 클라이언트 stream 훅 | `useThreadStream` EventSource 구독 + 재생 + seq 기반 dedupe. | RT-4, RT-5, FE-8 | `frontend/src/stream/useThreadStream.ts` | M |
| RT-8 | segment.opened 연결 | BE-5s에서 pub/sub를 거쳐 클라이언트까지 `segment.opened` 종단 간 전파. | BE-5s, RT-5, RT-4 | `backend/src/realtime/publish.ts`, `frontend/src/stream/useThreadStream.ts` | S |

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
| AI-1 | LlmClient | fetch→`generativelanguage.googleapis.com` generateContent; 401/403→FAILED("키 확인"), 429→재시도 카피 매핑. 키는 호출 시점 메모리에만. | FE-3 | `frontend/src/api/llm.ts` | M |
| AI-2 | 모델 config | `LLM_MODEL="gemini-3.1-flash-lite"`, generationConfig 기본값; 단일 출처. | — | `frontend/src/config/model.ts` | S |
| AI-3 | 토큰 카운팅 | `countTokens` 호출 + `Math.ceil(chars/4)` 폴백; 버블별 tokenCount. | AI-1, AI-2 | `frontend/src/api/llm.ts` | S |
| AI-4 | buildContents | 조립 chokepoint: 사람→`user`(`「{username}」:` 접두), AI→`model`, 요약→개시 user turn 매핑; 페르소나는 systemInstruction. | AI-2 | `frontend/src/engine/contextEngine.ts` | M |
| AI-5 | 1차 답변 흐름 | 글 생성 후: seg#0 조립 → 페르소나 호출 → AI_REPLY PENDING 게시 → PATCH COMPLETE/FAILED. 작성자 키. | AI-1, AI-4, BE-12, BE-8, FE-7 | `frontend/src/engine/contextEngine.ts` | M |
| AI-6 | 요약 오케스트레이션 | 요약 호출(페르소나+요약 지시) → AI_SUMMARY 게시 → 409 시 현재 세그먼트 재조회 & 재조립 → 진행. | AI-1, AI-4, AI-8, BE-7, BE-12 | `frontend/src/engine/contextEngine.ts` | M |
| AI-7 | @AI 답변 흐름 | `@AI` 감지, 사람 먼저 게시, GET /context, (AI-8 분기), AI_REPLY PENDING 게시(replyToId), 호출, PATCH. 호출자 키. | AI-1, AI-4, BE-12, BE-8, BE-6, XC-4 | `frontend/src/engine/contextEngine.ts` | L |
| AI-8 | 지연 요약 감지 | `@AI` 경로에서 답변 전 `summaryNeeded`/`tokenSum>128K` 게이트. | BE-12 | `frontend/src/engine/contextEngine.ts` | S |
| AI-9 | 요약 후 재조립 | 활성 세그먼트 N≥1에 대해 (세그먼트 개시 요약 + 요약 이후 버블만)으로 contents 구성. | AI-4, AI-6 | `frontend/src/engine/contextEngine.ts` | M |

### Cross-cutting (`backend/` + `frontend/`)

| id | 제목 | 설명 | deps | files | est |
|----|------|------|------|-------|-----|
| XC-1 | Key-blind 리뷰 체크리스트 | 코드화된 체크리스트 + lint 규칙: 서버 바디/헤더/로그에 apiKey 금지; grep 게이트. **게이트는 자체 서버 배포 파이프라인에서 실행한다**(GitHub Actions 미사용, 2026-07-27). | BE-1 | `docs/checklists/key-blind.md`, 배포 파이프라인 설정 | S |
| XC-2 | 로그 redaction 테스트 | 서버 로그/응답에 키 형태 payload가 절대 없음을 단언. | XC-1, BE-3..BE-13 | `backend/test/security/redaction.test.ts` | S |
| XC-3 | CSP + sanitize | CSP 헤더(`connect-src` Google만, `script-src 'self'` 등) + 사용자 콘텐츠/마크다운에 DOMPurify. | FE-1, BE-1 | `backend/src/plugins/security.ts`, `frontend/src/lib/sanitize.ts` | M |
| XC-4 | 프롬프트 인젝션 가드 | AI-4 chokepoint에서: 페르소나는 systemInstruction 유지, 사용자 입력은 데이터 유지; 덮어쓰기 시도 테스트. | AI-4 | `frontend/src/engine/contextEngine.ts` | S |
| XC-8 | hot decay 다듬기 | 시간 경과에 따른 hotScore 리프레시/decay 처리. | BE-9a, BE-5 | `backend/src/domain/hotScore.ts` | S |
| XC-9 | 레이트 리미팅 | username별 글 레이트 리밋; 커뮤니티 생성 쿨다운. | BE-3, BE-4, BE-6 | `backend/src/plugins/rateLimit.ts` | S |
| XC-10 | 지표 계측 | 클라이언트가 §8 KPI에 공급할 이벤트 발행; BE-13(작성자 D1 포함)과 연결. | BE-13, FE-3 | `frontend/src/lib/metrics.ts` | S |
| XC-11 | 라이선스 | MIT LICENSE + 소스 헤더. | — | `LICENSE`, headers | XS |
| XC-T | 통합 테스트 | 단일 스위트: contextEngine 토큰/128K/세그먼트 전환 + hotScore(unit); clientId 멱등 + `/context` #5-vs-#7 조립(contract); 다중 클라 SSE fan-out + 동시 @AI/요약(integration); J1/J2/J3(E2E, LLM 모킹+실키). 겹치는 BE/AI/RT/XC 테스트 범위 대체. | 모든 구현 WP | `backend/test/**`, `frontend/src/**/*.test.ts`, `e2e/**` | L |

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
- RT==BE-10은 `backend/src/realtime/*` 아래 단일 서브시스템으로 통합.

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
| 지표: LLM 성공률 ≥97% | XC-10, AI-1 |
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
26. CI에서 LLM 모킹 vs 실키 — 양쪽 레인(XC-T).

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
- [x] **BYOK** 모든 AI 호출 브라우저→Google, 서버 key-blind — L1/AI-1/XC-3. (서버 src apiKey 0건 + key-blind contract 테스트; llm 직접 호출 unit)
- [x] **순서** 사람 먼저 → 로딩 → AI 버블 — AI-7/FE-11/FE-12. (runAtAiReply 순서 unit)

### 엔지니어링 게이트
- [~] **실시간**: 재접속 재생 정확 + comment.created/updated/segment.opened seq 순서 — SSE integration 테스트 green. **P95 < 1.5s 성능은 PoC에서 미측정.**
- [x] **신뢰성**: AI 실패 시 사람 버블 보존, FAILED+재시도 표시(NFR-5; FE-12). (engine unit + retryAiBubble)
- [x] **보안**: CSP 강제(`connect-src` Google만 — 헤더+메타), DOMPurify sanitize chokepoint, 로그/소스에 키 없음(XC-3); 프롬프트 인젝션 가드 XC-4. (CSP 헤더 스모크 + sanitize/XC-4 unit; §4 캡슐화 버그 수정 후 헤더 적용 확인)
- [~] **PWA**: vite-plugin-pwa로 SW+manifest 산출, 모바일 우선/터치 ≥44px(FE-13/NFR-1). **실기기 설치는 수동 확인 권장.**
- [~] **배포**: 정적 프론트 + Node 서버 구조 확립. **SQLite→Postgres datasource 교체는 미검증**(추상화만, L10).
- [x] **지표**: §8 KPI 계측 + 작성자 D1(VisitEvent) — BE-13(/metrics, /metrics/visit) + XC-10 클라 계측. (DB 산출 KPI 동작; llmSuccessRate/p95는 best-effort `null`)
- [x] **라이선스**: MIT LICENSE + 엔트리 파일 헤더(XC-11).
- [~] **테스트**: 통합 스위트 — **unit/contract/integration green(백엔드 22, 프론트 28)**. **E2E(J1/J2/J3)는 LLM 모킹 스캐폴드 제공, 브라우저 실행은 미수행**(XC-T).

---

## 10. M6 — 게시글(Thread) 비주얼 리디자인 (v0.3, 2026-06-18)

> 출처: 레퍼런스 모바일 채팅 UI 2종. 상세 사양: [WIREFRAME.md §6.3](./WIREFRAME.md). **표현 계층 한정** —
> 라우팅/스토어/엔진/SSE/BYOK 로직 불변(L1/L4/L5 그대로). 완료 게이트: `npm run typecheck` ·
> `npm run test` · `npm run build` 전부 green + 브라우저 시각 검증.

### 작업 패키지 (WP)
- [x] **VR-1 · 디자인 토큰**: `tailwind.config.js` `colors.brand` 블루→바이올렛(`#7c3aed`/`#6d28d9`),
  `index.html` `theme-color`→`#7c3aed`. blue-600 하드코딩 잔재 grep 확인. (§6.3 A)
- [x] **VR-2 · Avatar 컴포넌트**: 신규 `frontend/src/components/Avatar.tsx`. user/me/ai 종류, 정적
  팔레트(purge 안전), 시드 해시 색상, AI 그라데이션 로봇. (§6.3 B)
- [x] **VR-3 · Thread 헤더**: PersonaBadge 헤더 → 글 상세 헤더(‹뒤로 `navigate(-1)`·제목 중앙·북마크
  로컬토글·⋯). (§6.3 C)
- [x] **VR-4 · 원본 게시글 카드**: 📌 라벨 + 카드(rounded-2xl shadow) + 아바타·작성자·시간 +
  우측 점수/댓글 카운트. (§6.3 D)
- [x] **VR-5 · ChatBubble**: 행 레이아웃 아바타화(타인/AI 좌·본인 우 `flex-row-reverse`), 버블
  꼬리/색, 본인 읽음 `✓`, AI 로딩 `✨ … •••`. (§6.3 E)
- [x] **VR-6 · Composer**: ＋첨부(placeholder) + 알약형 입력 + 바이올렛 원형 전송, 토글 액센트
  바이올렛. (§6.3 F)
- [x] **VR-7 · 주변 정합**: PostCard/PersonaBadge/AppLayout/BottomTabBar 브랜드색 자동반영 확인,
  SummaryBubble 토큰 정합. (§6.3 G)
- [x] **VR-8 · 검증**: typecheck + vitest + build green, 브라우저(dev)에서 Thread 시각 확인
  (아바타·색·헤더·Composer·읽음표시·AI 로딩).
- [x] **VR-9 · 문서 재동기화**: 구현 차이를 [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md)에 기록,
  WIREFRAME 사양과 실제 구현 일치 확인.

---

## 11. M7 — 전 화면 디자인 시스템 전파 (v0.3, 2026-06-18)

> Thread 채팅 UI(M6)에서 확립한 비주얼 언어를 나머지 모든 화면에 일관 적용. 상세 사양:
> [WIREFRAME.md §12](./WIREFRAME.md). **표현 계층 한정** — 라우팅/스토어/검증/BYOK/SSE 불변.
> 완료 게이트: `npm run typecheck` · `npm run test` · `npm run build` green + 브라우저 시각 검증(실 키 로그인).

### 작업 패키지 (WP) — 파일 소유권 분리(병렬 충돌 방지)
- [x] **DS-1 · Login**: 폼 카드화 + 바이올렛 로고 락업 + 입력/버튼 토큰. (§12.2)
- [x] **DS-2 · Home + 상태 컴포넌트**: EmptyState 버튼 토큰, 상태 컴포넌트(Empty/Error/Loading/Offline)
  radius 통일. (Home.tsx + components/states/*)
- [x] **DS-3 · Community(검색+상세) + Search**: 검색 입력·결과 카드 리스트, 상세 헤더/페르소나 박스/글
  리스트 카드화, 작성자 Avatar. (Community.tsx, Search.tsx는 재노출만)
- [x] **DS-4 · CreatePost + CreateCommunity + PersonaEditor**: 입력/select/textarea/버튼 토큰 통일,
  토글 액센트 바이올렛.
- [x] **DS-5 · Profile**: 헤더 Avatar, 섹션 카드화, 리스트 카드형. 키 마스킹/로컬 로직 불변.
- [x] **DS-6 · AppLayout + BottomTabBar**: 로고/사이드바/탭 활성색 정합(대부분 자동), 구조 불변.
- [x] **DS-7 · 검증**: typecheck + vitest + build green, 브라우저에서 전 화면 시각 확인
  (실 키로 로그인 → Home/Search/Community/Create*/Profile/Thread 순회).
- [x] **DS-8 · 문서 재동기화 + 푸시**: IMPLEMENTATION_NOTES 기록, WIREFRAME 정합 확인, 커밋·푸시.

---

## 12. M15 — 실인증(JWT) 보안 게이트 (v0.4, 2026-06-19)

> 기존 x-user-id 헤더(username 기반, 위조 가능)를 **실인증(bcrypt+JWT)**로 교체. 공개 배포 시 필수. 완료 게이트:
> `npm run typecheck` · `npm run test` · `npm run build` green + E2E(로그인/회원가입/쓰기 인증 흐름).

### 작업 패키지 (WP) — 보안 게이트 (비기능 → 기능 등급 상향)

| id | 제목 | 설명 | 종료 관련 |
|---|------|------|----------|
| **AUTH-1** | **User.passwordHash 추가 + 마이그레이션** | Prisma 스키마: `User.passwordHash String`(bcrypt 저장), 마이그레이션 생성. 기존 사용자는 데이터 마이그레이션 없음(새 가입만 가능). | DB 준비 |
| **AUTH-2** | **`POST /auth/register`** | username+password 입력 → User 생성(username 중복 409), bcrypt 해시 저장, **JWT 서명 후 토큰 반환**. 응답: `{ id, token, username }`. | 회원가입 |
| **AUTH-3** | **`POST /auth/session` 교체** | username+password 입력 → 기존 User 조회, bcrypt 검증(실패 시 401), **JWT 서명 후 토큰 반환**. 응답: `{ id, token, username }`. `x-user-id` 방식 완전 폐기. | 로그인 |
| **AUTH-4** | **JWT 미들웨어 + requireAuth/optionalAuth** | Fastify 플러그인: `Authorization: Bearer <token>` 헤더 파싱 → JWT_SECRET으로 검증 → `request.user = { id, username }` 주입. 라우트 가드: `requireAuth`(실패 시 401), `optionalAuth`(선택, 없으면 `request.user = null`). | 모든 쓰기 경로 보호 |
| **AUTH-5** | **환경 변수** | `JWT_SECRET`(토큰 서명용, 강 요구), `JWT_EXPIRES`(기본 `'7d'`, 선택). `.env.example` 문서화. | 프로덕션 설정 |
| **AUTH-6** | **x-user-id 참조 제거** | 서버 전체 grep: `x-user-id` 헤더 제거, 모든 인가를 `request.user.id`로 전환. BE-3/4/5/6/8/9b/11/12/13 경로 갱신. | 완전 교체 |
| **AUTH-7** | **프론트 authStore + 로그인폼** | 신규 `POST /auth/register`·`POST /auth/session` 호출 함수 + 응답 토큰 저장. `LoginForm`: password 필드 추가. 로그아웃: localStorage 토큰 삭제. 모든 쓰기 요청에 **`Authorization: Bearer <token>` 자동 헤더** 추가(fetch 인터셉터). | 인증 흐름 |
| **AUTH-8** | **E2E 회원가입/로그인/쓰기 검증** | J1 개정: 새 사용자로 가입 → 로그인 → 글 작성 흐름. 로그인 실패(잘못된 비밀번호) 401 가드. 미인증 쓰기(토큰 없음/만료) 401 가드. | 인증 보안 |
| **AUTH-9** | **문서 갱신** | TRD §4 API 표: `POST /auth/register` + `POST /auth/session` 추가, `x-user-id` → `Authorization: Bearer <jwt>` 변경, `JWT_SECRET`/`JWT_EXPIRES` 환경 변수 기록. PRD FR-2 갱신(비밀번호 도입). PLAN §0(L11 `x-user-id` 삭제). README 보안 섹션 갱신(공개 배포 게이트 **CLOSED**). | 문서 정합 |

**M15 종료 기준**: 회원가입/로그인/비밀번호 검증 동작; 모든 쓰기가 JWT 토큰으로 인증됨; E2E 로그인 흐름 green; 서버 코드 x-user-id 0건; TRD/PRD/README 갱신; 기존 사용자는 재가입 필요(PoC 데이터 마이그레이션 미포함).

**보안 게이트 해제 의미**: 공개 배포(GitHub Pages + 외부 호스트) 전에 **username/password 기반 실인증**으로 x-user-id 위조 불가능 상태로 전환 완료. 이제 배포 차단 게이트 제거 가능.

---

## 12. M8 — 그린 인광 CRT 레트로 터미널 리디자인 (v0.5, 2026-06-19)

> 로고 기반 인디고-바이올렛(v1)을 **그린 인광 CRT 터미널** 미감으로 **대체**. 출처: `레트로 스타일 UI
> 리디자인/AiditScreen.dc.html`. SoT: [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)(v2). **표현 계층 한정** —
> 라우팅/스토어/엔진/SSE/BYOK 로직 불변. 완료 게이트: `typecheck` · `test` · `build` green + 브라우저 시각 검증.
> PR [#4](https://github.com/littleanti/aidit/pull/4)로 main 머지.

### 작업 패키지 (WP)
- [x] **RT-1 · 토큰**: `tailwind.config.js` `brand/ink/canvas` 제거 → `term-*` 팔레트(인광 그린·앰버·레드·
  표면·보더), `bg-term-screen`/`bg-term-cta` 그라디언트, `font-mono`, `shadow-glow-*`. `index.html`
  theme-color + PWA manifest `theme_color`/`background_color` → `#04130b`.
- [x] **RT-2 · 전역 CSS**: `index.css` body 그라디언트 배경 + CRT 스캔라인(`::before`)·비네트(`::after`)
  오버레이, 인광 placeholder/스크롤바, `.glow`/`.glow-lg`/`.term-cursor`(blink + `prefers-reduced-motion`).
- [x] **RT-3 · 헤더·내비**: AppLayout 헤더(A-마크 + AIDIT, `[ user ]`/`[ Login ]`), 하단탭·데스크톱
  사이드바 이모지 → 스트로크 SVG 아이콘, 활성색 앰버.
- [x] **RT-4 · 홈/피드**: 인기·최신 세그먼트 탭(앰버 활성), `aidit@yoon:~$ feed --sort=` 프롬프트 + 커서,
  `— EOF · 마지막 글이에요 —` 푸터, PostCard `POST` 코너태그 + 글로우 제목.
- [x] **RT-5 · 화면 전환**: Login/Search/Community/CreatePost/CreateCommunity/Profile/Thread +
  Composer/ChatBubble/SummaryBubble/Avatar/PersonaBadge/PersonaEditor/상태 컴포넌트 `term-*` 전환.
  레거시 slate/brand/purple/white 잔재 grep 0건.
- [x] **RT-6 · 폰트**: 웹폰트 CDN 미사용(CSP/PWA 오프라인) — 시스템 모노스페이스 스택. dc.html의
  JetBrains Mono CDN과 **의도적 분기**(문서화).
- [x] **RT-7 · 회귀 수정**: `@apply bg-term-screen` → 순수 CSS `background-image`(구버전 config를
  require-cache에 든 dev 서버의 PostCSS "class does not exist" 에러 회피, 프로덕션/신규 서버는 영향 없음).
- [x] **RT-8 · 검증**: tsc + vitest(28) + build green, 브라우저(dev) 로그인·홈 피드 시각 확인.
- [x] **RT-9 · 문서**: DESIGN-SYSTEM v2 교체, WIREFRAME v0.5 비주얼 식별자 갱신.

---

## 12. M14 — GitHub Pages 배포 준비(옵션 A) (2026-06-19)

> ⚠️ **2026-07-27 — 이 마일스톤의 배포 방식은 대체됨(SUPERSEDED).** 운영은 **자체 서버(self-hosted)** 로 결정되어 **GitHub Pages·GitHub Actions를 사용하지 않는다.** 아래 기록은 당시 완료된 작업의 이력으로 남기며, 산출물 중 `public/404.html`·`public/.nojekyll`·백엔드 CORS 기본 허용 오리진(`littleanti.github.io`)은 자체 서버 운영에 불필요한 잔여 자산이라 정리 대상이다. `VITE_API_ORIGIN` 주입과 CSP 자동화(DEP-1/DEP-2), `WEB_ORIGIN` CORS allowlist(DEP-5)는 **자체 서버 배포에도 그대로 유효**하다. 현행 배포·CI 방침은 README "배포 · CI" 절을 따른다.

> 프론트엔드 정적 호스팅(GitHub Pages) + 백엔드 외부 호스트(Render 등) 분리 구조.
> **기능 추가 없음 — 배포 준비만(PREP).** 공개 배포는 `x-user-id` 실인증 교체 후(현재 scope 외).
> 완료 게이트: 중앙 config 설정 · 404.html 추가 · vite.config CSP 주입 · .nojekyll · CORS allowlist · env 문서화.

### 작업 패키지 (WP)
- [x] **DEP-1 · 중앙 API 설정**: `frontend/src/config/api.ts` — `VITE_API_ORIGIN` 환경변수(unset=dev 상대경로, set=절대 backend origin) → `API_BASE`/`apiUrl`/`assetUrl` 단일 출처. 기존 `rest.ts` import 일원화. dev는 Vite 프록시 `/api` 불변.
- [x] **DEP-2 · vite.config CSP 자동화**: `buildCsp(apiOrigin)` 함수 — build 시 `VITE_API_ORIGIN`을 읽어 CSP `connect-src`/`img-src` 에 자동 주입. `cspInjectionPlugin` 적용, dev HMR 영향 없음(apply='build'). manifest scope `start_url` 기본 `/` 또는 `VITE_BASE` 지원.
- [x] **DEP-3 · SPA 404.html 트릭**: `public/404.html` — 딥 링크(`/posts/123`) → 302 `/index.html?path=/posts/123` → JS 복원(`history.replaceState`). GitHub Pages 자동 폴백 활용.
- [x] **DEP-4 · .nojekyll**: `public/.nojekyll` — Jekyll 처리 비활성화(빌드 속도·캐시 간섭 회피).
- [x] **DEP-5 · CORS 백엔드 allowlist**: `backend/.env.example` 문서화 — `WEB_ORIGIN` env(comma-sep, e.g. `https://littleanti.github.io,https://staging.example.com`) + 기본 `https://littleanti.github.io` 자동 허용. `@fastify/cors` plugin 수정.
- [x] **DEP-6 · 환경 변수 문서화**: `frontend/.env.example` — `VITE_API_ORIGIN` 예시·설명 추가. `backend/.env.example` — `WEB_ORIGIN` + `HOST=127.0.0.1`(프로덕션 프라이빗 바인드) 예시.
- [x] **DEP-7 · 보안 게이트 명시**: README "GitHub Pages 배포(옵션 A)" 섹션 — **`x-user-id` 실인증 교체 필수**(현재 username 입력만 기반 → JWT/OAuth 권고) 단일 행 경고.
- [x] **DEP-8 · 검증**: 빌드 clean(`npm run build`), 정적 output 확인(`.nojekyll`·404.html·manifest), 로컬 dev 여전히 `/api` 프록시 동작.

---

## 13. M9 — Option A 동선 + 글 이미지(멀티모달) + 로그인 모달 + 커뮤니티 편집 (v0.6, 2026-06-19)

> 레트로 적용(v0.5) 후, 재설계 갤러리에 합의됐으나 코드에 미반영됐던 **기능/동작**을 Option A 합의대로
> 정렬. 표현이 아니라 **IA · 작성 흐름 · 인증 표면 · 데이터 모델 · AI 컨텍스트**. 상세:
> [IMPLEMENTATION_NOTES §4.6–4.8](./IMPLEMENTATION_NOTES.md) · [TRD §5.1](./TRD.md). 완료 게이트:
> 서버/프론트 `build`·`test` green + 브라우저. PR [#4](https://github.com/littleanti/aidit/pull/4)로 머지.

### 작업 패키지 (WP)
- [x] **OA-1 · IA 재배선**: `작성` 탭·사이드바 → `/create-post`(글 작성) 직결(기존 `/create-community`).
  커뮤니티 만들기는 검색 화면 진입 유지(상시 `[+]` + 무결과 인라인 CTA — 기존).
- [x] **OA-2 · 글 작성 커뮤니티 피커**: `<select>` → `▾ 변경` 펼침 피커(검색 필터 + `[*]`/`[ ]` 마크).
  가입 커뮤니티 0개일 때만 "검색에서 만들기 →" 보조 링크(사각지대 보완).
- [x] **OA-3 · 글 이미지 첨부(풀스택)**: `Post.imageUrl String?` + 마이그레이션 `add_post_image_url`
  (nullable·비파괴), `POST/GET /posts`·`toFeedCard` 응답 포함, types/`CreatePostBody.imageUrl`,
  작성 점선 드롭존(`uploadImage`) + 썸네일 칩, Thread 원본 카드·PostCard 표시.
- [x] **OA-4 · 글 이미지 → 1차 AI 답변(멀티모달)**: `runPrimaryReply`에 `image` 추가 → 작성자 user 턴
  `inlineData`로 첨부, 신규 `lib/imageInline.urlToInlineData`(`/uploads` fetch→base64, 실패 시 텍스트
  only). 컨텍스트 텍스트 매핑·XC-4·BYOK 불변. 단위 테스트 2(image 유 inlineData / 무 텍스트).
- [x] **OA-5 · 로그인 모달**: `stores/uiStore`(loginOpen/openLogin/closeLogin), `LoginForm` 추출 +
  `LoginModal` 오버레이, 헤더 `[ Login ]` → 모달, `/login` 라우트 호환 유지, CreatePost 비로그인 게이트=모달.
- [x] **OA-6 · 커뮤니티 편집 모드**: 상세 ✎ 편집 state `{editSlug}`, CreateCommunity가 `getCommunity`로
  기존 값 프리필(이름/주소(readOnly)/설명/페르소나/아이콘) + 제출 `patchCommunity` 분기 + "수정" 제목/CTA.
  검색 `state.name`(이름) 프리필도 함께 반영.
- [x] **OA-7 · 검증**: 서버 build + 22테스트, 프론트 build + 30테스트 green. 브라우저 — 작성 직결 ·
  피커 펼침 · 이미지 드롭존 · 로그인 모달(열기→제출) · 편집 프리필 실동작 확인.
- [x] **OA-8 · 문서 + 머지**: IMPLEMENTATION_NOTES §4.6–4.8 · TRD §5.1 · DESIGN-SYSTEM/WIREFRAME 갱신,
  PR #4 main 머지.

---

## 14. M10 — 글(게시글) 편집 (v0.7, 2026-06-19)

> OA-6의 **커뮤니티 편집 패턴**을 글에 적용. 작성자는 자신의 글을 조회 후 수정(제목/본문/이미지)할 수 있다.
> 표현/라우팅·컨트랙트·BYOK·SSE 불변. 완료 게이트: 서버/프론트 `build`·`test` green + 브라우저.

### 작업 패키지 (WP)
- [x] **BE-14 · `PATCH /posts/:id` 엔드포인트**: 요청 본문에 `title?`, `body?`, `imageUrl?` 지원.
  인증: `x-user-id`로 현재 사용자와 `post.authorId` 검증 → 비작성자는 **403 Forbidden**.
  응답: 수정된 `Post` DTO(`title`, `body`, `imageUrl` 반영).
- [x] **FE-15 · CreatePost 편집 모드 (링크 state)**: 라우트 `/create-post?editPostId=<id>` 또는 Link state `{editPostId}`.
  컴포넌트가 `getPost(editPostId)`로 기존 글 로드 → 폼 프리필(제목/본문/이미지) + 제목/버튼 "수정"으로 변경.
  제출 분기: `editPostId` 있으면 `patchPost(id, {...})` 호출 → 수정 후 Thread로 이동.
- [x] **FE-16 · Thread 헤더 [편집] 버튼**: Thread의 ⋯ 메뉴 슬롯에 작성자만 보이는 **`✎ 편집`** 버튼 추가.
  비작성자에게는 버튼 미표시(⋯ 슬롯 비움). 클릭 시 `/create-post` + state `{editPostId: post.id}`로 링크.
  북마크 🔖는 유지. **스타일은 커뮤니티 편집 버튼(`Community.tsx`)과 완전 동일**(2026-06-19 통일).
- [x] **FE-17 · 검증**: 서버 build + 테스트 green. 브라우저 — 작성자 편집 진입 · 폼 프리필 · 저장 · 비작성자 [편집] 미표시 확인.

---

## 15. M11 — 북마크 (v0.8, 2026-06-19)

> 사용자가 글을 북마크하고, 북마크한 글 목록을 프로필 화면에서 모아본다.
> DB: `Bookmark` 모델 신규(userId+postId unique, userId+createdAt 인덱스).
> 백엔드: 3개 엔드포인트(`POST /posts/:id/bookmark`, `DELETE /posts/:id/bookmark`, `GET /users/:id/bookmarks`) +
> `GET /posts/:id` 시 bookmarked 불린 반환. 프론트: Thread 헤더 🔖 버튼(낙관적 토글, 로그인 필요) +
> Profile 페이지 "북마크한 글" 섹션(최신 북마크순). 완료 게이트: 서버/프론트 `build`·`test` green + 브라우저.

### 작업 패키지 (WP)
- [x] **DB-11 · `Bookmark` 모델**: `userId`+`postId` unique, `userId`+`createdAt` 인덱스(최신순 조회).
  마이그레이션 `add_bookmark_model` 추가.
- [x] **BE-15 · 북마크 엔드포인트**:
  - `POST /posts/:id/bookmark` (인증: `x-user-id`) — idempotent upsert, 201 응답 `{bookmarked:true}`
  - `DELETE /posts/:id/bookmark` (인증: `x-user-id`) — idempotent delete, 200 응답 `{bookmarked:false}`
  - `GET /users/:id/bookmarks` (인증 불필요) — bookmarked posts 피드 카드로, 최신 북마크순
- [x] **BE-16 · `GET /posts/:id` bookmarked 필드**: 선택 `x-user-id` 헤더 있으면 반환 유저의 북마크 여부
  불린(없으면 `false`).
- [x] **FE-18 · Thread 헤더 🔖 버튼**: 북마크 초기값은 `post.bookmarked`(서버 계산),
  로컬 state로 낙관적 토글. 로그인 필요 → `openLogin()`. 클릭 시 `POST/DELETE /posts/:id/bookmark`.
  실패 시 상태 롤백 + 토스트 "북마크 처리에 실패했습니다."
- [x] **FE-19 · Profile 북마크한 글 섹션**: 프로필 조회 시 `getUserBookmarks(userId)`로 로드.
  "북마크한 글" 섹션(홈 피드와 동일한 PostCard 리스트, 최신 북마크순).
  빈상태: "북마크한 글이 없어요"
- [x] **FE-20 · resetDb() 정리**: `backend/src/test/helpers.ts` `resetDb()` 함수에서 `bookmark` 테이블도
  정리하도록 추가.
- [x] **FE-21 · 검증**: 서버 build + 테스트 green. 브라우저 — Thread에서 북마크 토글 · Profile에서
  북마크한 글 목록 · 빈상태 확인.

---

## 16. M12 — LLM 연결 표식 + 헤더 UX (v0.9, 2026-06-19)

> 상단바에 BYOK LLM 연결 상태를 레트로 LED 배지로 노출. **프론트 전용**(신규 API 없음) — 가장 최근 실제 LLM 쿼리 결과를 신뢰.

### 작업 패키지 (WP)
- [x] **FE-22 · `llmStatusStore`**: 세션-한정·비영속 zustand store. `status: 'unknown'|'connected'|'disconnected'`,
  `markSuccess()` / `markFailure(kind?)`. 하드 리로드 시 `unknown` 초기화(`aiModeStore`와 동일 철학).
- [x] **FE-23 · 추적 래퍼 `engine/llmStatus.ts`**: `llm.generateContent`를 감싸 성공→`markSuccess`,
  `LlmError`→`markFailure(kind)` 기록 후 re-throw. `contextEngine.ts`·`retryAiBubble.ts`의 `generateContent`
  import만 래퍼로 교체(1차/@AI/재시도/요약 전 경로를 단일 chokepoint로 커버). `llm.ts`는 키-blind 유지.
  `countTokens`는 폴백 보조 호출이라 신호에서 제외.
- [x] **FE-24 · `LlmStatusBadge` 컴포넌트**: LED 점 + `LLM` 라벨. 연결=`●` 초록 인광(`glow`),
  끊김=`●` `text-term-danger`+`animate-pulse`, 미확인=`○` `text-term-faint`. hover 한국어 툴팁(`role="status"`).
- [x] **FE-25 · AppLayout 배선**: 로그인 상태에서 `[ {username} ]` 바로 좌측에 배지 표시. (겸: 상단바 아이디
  → `/me` 링크화, Thread `✎ 편집` 버튼을 커뮤니티 편집 버튼과 동일 스타일로 통일.)
- [x] **FE-26 · 검증**: tsc 클린 + 프론트 테스트 30 green(엔진 import 교체 무영향).
- [x] **FE-27 · 로그인 시 1회 연결 테스트**: `pingLlm(apiKey)`(= `countTokens`, 생성 비용 0)를
  키가 생기거나 바뀔 때(신규 로그인 · 키 변경 · 지속 세션 로드) **키당 한 번** 실행해 배지를 즉시 갱신.
  `AppLayout` effect가 `googleApiKey` 변화를 감지, `useRef`로 동일 키 중복 핑 방지. tsc 클린 + 테스트 30 green.

---

## 17. M13 — 추천(업보트) 토글 (v1.0, 2026-06-19)

> 북마크를 거울한 투표 시스템. 사용자당 글당 유일한 Vote 레코드, Post.score는 실시간 vote count로 재계산.
> 백엔드: POST/DELETE `/posts/:id/upvote` 멱등 토글(점수 갱신). 프론트: PostCard·Thread의 ▲ 버튼 interactive
> (낙관적, 로그인 필수, voted 강조 색). 완료 게이트: 서버/프론트 `build`·`test` green + 브라우저.

### 작업 패키지 (WP)
- [ ] **DB-12 · `Vote` 모델**: `userId`+`postId` unique index. 마이그레이션 `add_vote_model` 추가.
- [ ] **BE-17 · POST /posts/:id/upvote (toggle-add)**: 인증(`x-user-id`), idempotent upsert(`findUnique`/`create`/`ignore` 분기). 응답 `{voted:true}`. hotScore 재계산.
- [ ] **BE-18 · DELETE /posts/:id/upvote (toggle-remove)**: 인증(`x-user-id`), idempotent delete. 응답 `{voted:false}`. hotScore 재계산.
- [ ] **BE-19 · `GET /posts/:id` voted 필드**: 선택 `x-user-id` 헤더 있으면 반환 유저의 vote 여부 불린(없으면 `false`).
- [ ] **BE-20 · 피드 voted 필드**: GET `/posts`, `/communities/:slug/posts`, `/users/:id/posts`, `/users/:id/bookmarks`의 `toFeedCard`에 `voted` 추가(x-user-id 있을 때만).
- [ ] **FE-28 · PostCard ▲ 버튼 (toggle)**: 초기값 `post.voted`(서버 계산), 낙관적 UI. 로그인 필수(`openLogin()`). 클릭 시 POST/DELETE `/posts/:id/upvote`. voted=true일 때 `text-term-amber` 강조색. 실패 시 롤백 + 토스트.
- [ ] **FE-29 · Thread 원본 카드 ▲ 버튼**: PostCard와 동일 패턴, 피드 카드에서 상세로 진입 시에도 voted 상태 유지.
- [ ] **FE-30 · Feed fetcher x-user-id forward**: 홈/커뮤니티/프로필/북마크 피드의 `getPosts`/`getCommunityPosts`/`getUserPosts`/`getUserBookmarks`가 모두 `x-user-id` 헤더로 voted 상태를 요청.
- [ ] **XC-13 · resetDb() 정리**: `backend/src/test/helpers.ts`에서 `vote` 테이블 삭제 추가.
- [ ] **XC-14 · 검증**: 서버 build + 테스트 green. 프론트 build + 테스트 green. 브라우저 — PostCard/Thread에서 ▲ 토글 · voted 강조색 · 재로드 후 상태 유지(x-user-id forward) 확인.

**M13 종료 기준**: POST/DELETE `/posts/:id/upvote`가 멱등 토글; GET `/posts/:id` + 모든 피드가 `voted` boolean 반환(x-user-id 있을 때); PostCard/Thread의 ▲ 버튼이 로그인 필요하며 낙관적 토글, voted=true일 때 강조색; Post.score는 실시간 vote count를 반영.

---

## 18. (보류/예정) M16 — Fly.io 배포 + Postgres 전환 (deferred, 2026-06-20)

> **2026-07-28 갱신**: 이 마일스톤의 **Postgres 전환 부분은 준비 완료**다 — 파생 스키마(`prisma/schema.postgres.prisma`)·DDL 산출물(`prisma/postgres/init.sql`)·드리프트 게이트(`db:pg:check`)가 있고, 함께 필요한 pub/sub·레이트리밋 공유도 어댑터로 구현됐다(TRD §15). **남은 것은 실제 인스턴스에 대한 런타임 검증**이며, 호스팅은 Fly.io가 아니라 **자체 서버**로 방향이 바뀌었다(README "배포 · CI"). 아래 원 기록은 당시 계획으로 보존한다.

> **현재 결정**: **로컬 PC에서 SQLite로 데모 유지**(필요 시 `vite --host`로 LAN 공유). 아래 배포 작업은 **나중에** 진행하기 위한 보류 기록이다. 실인증(JWT, M15)은 이미 완료되어 로컬/공개 모두 적용됨 — 로컬은 `JWT_SECRET` 미설정 시 dev 폴백+경고로 동작(추가 설정 불필요), **공개 배포 시에만 실 `JWT_SECRET` 필수**.

**확정 설계 결정 (재논의 불필요)**
- 호스트: **Fly.io 단일 머신**(`min_machines_running=1`, 슬립 금지). SSE가 in-memory pub/sub라 **인스턴스 1개 고정**(스케일아웃하려면 Redis pub/sub 선행).
- 프론트: **단일 Fly 앱** — Fastify가 빌드된 `dist`까지 서빙(`/`=프론트, `/api`·`/uploads`·SSE=동일 오리진). → CORS/`VITE_API_ORIGIN`/mixed-content 불필요. (대안: 이미 준비된 GitHub Pages 분리 구성(M14)도 가능)
- DB: **Neon Postgres**(무료, 리전 AWS Tokyo `ap-northeast-1`). Prisma `provider="postgresql"`, 런타임=pooled URL, 마이그레이션=direct URL(`DIRECT_URL`).
- 업로드: **휘발 감수**(서버 FS, 재배포 시 소실). 영구화 필요 시 Fly Volume(단일 머신) 또는 Cloudflare R2/S3.
- 리전: Fly `nrt`(Tokyo) + Neon Tokyo로 맞춤.
- BYOK라 서버 LLM 비용 0 → 최소 머신(`shared-cpu-1x`, 256–512MB) 충분.

**사전 준비 (사용자 직접)**
- [ ] **PRE-1** Fly 가입(https://fly.io/app/sign-up) + 카드 등록 + `flyctl` 설치 + `fly auth login`.
- [ ] **PRE-2** Neon 가입(https://neon.tech) → 프로젝트 생성(Tokyo) → **pooled `DATABASE_URL`** + **direct `DIRECT_URL`** 확보.
- [ ] **PRE-3** `JWT_SECRET` 랜덤 생성(`openssl rand -base64 48`).

**작업 패키지 (자산 준비)**
- [ ] **DEP-1 · Prisma → Postgres**: `provider="postgresql"`, `DATABASE_URL`/`DIRECT_URL`(directUrl) 설정, **PG용 마이그레이션 재생성**(기존 SQLite 마이그레이션은 PG 적용 불가 → 새 baseline). ⚠️ **로컬 dev도 SQLite 사용 불가**가 되므로 로컬용은 **Neon `dev` 브랜치**를 별도 DATABASE_URL로 권장.
- [ ] **DEP-2 · Fastify 정적 서빙**: `@fastify/static`으로 `dist` 서빙 + SPA fallback(딥링크). `/api`·`/uploads`·SSE 라우트와 공존.
- [ ] **DEP-3 · Dockerfile**(멀티스테이지: 프론트 빌드 → 서버 빌드 → `prisma generate` → 실행). **Prisma 엔진 바이너리 타깃 주의**(Alpine면 `linux-musl` 필요 → debian-slim 베이스 권장).
- [ ] **DEP-4 · fly.toml**: `internal_port=3001`, `[http_service] force_https`, `min_machines_running=1`, 단일 인스턴스.
- [ ] **DEP-5 · release_command**: `npx prisma migrate deploy`(배포 시 마이그레이션 자동 적용, DIRECT_URL 사용).
- [ ] **DEP-6 · 시크릿/배포 절차**: `fly secrets set JWT_SECRET / DATABASE_URL / DIRECT_URL` (HOST는 0.0.0.0 유지 — 127.0.0.1 금지). `.dockerignore`, `docs/DEPLOY-FLY.md` 절차서.
- [ ] **DEP-7 · 검증**: `fly deploy` 후 register/login·글/댓글·SSE 실시간·추천/북마크·이미지(휘발) 동작 확인. 단일 오리진이므로 CORS 불필요 확인.

**재개 방법**: PRE-1~3 완료를 알려주면 DEP-1~7을 workflow로 진행(자산 생성→푸시→`fly launch`/`secrets`/`deploy` 명령 안내).

---

## 19. M17 — 다국어(i18n) KO/EN + AI 언어 연동 (v1.1, 2026-06-20)

> 출처: 설계 사양(i18n 상세 설계, 2026-06-20). SoT 문서: [PRD.md §FR-10](./PRD.md), [TRD.md §10](./TRD.md), [WIREFRAME.md §9](./WIREFRAME.md).
> **UI 상태 기반(state-based) 방식 — URL/라우트 변경 없음.** AI는 활성 UI 언어로 답변·요약.
> UGC(게시글·댓글·커뮤니티명·username)는 번역 대상이 아님 — UI 크롬 + AI 지시어만.
> 완료 게이트: `npm run typecheck` · `npm run test` · `npm run build` 전부 green + 브라우저 시각 검증(KO↔EN 전환 + AI 답변 언어 확인).

### 작업 패키지 (WP)

- [x] **I18N-1 · langStore**: 신규 `frontend/src/stores/langStore.ts`. zustand + persist(`localStorage` 키 `'aidit-lang'`). shape: `{ lang: 'ko'|'en', setLang(l), toggle() }`. 초기값: `navigator.language` 가 `'ko'`로 시작하면 `'ko'`, 아니면 `'en'`; 명시적 선택은 브라우저 기본값을 영구 우선. `onRehydrateStorage` / persist 패턴은 `src/stores/authStore.ts`의 기존 패턴 그대로 따름. 마운트 시 및 `setLang` 호출 시 `document.documentElement.lang = lang` 설정.
- [x] **I18N-2 · 딕셔너리 인프라**: 신규 디렉터리 `frontend/src/i18n/`. `dicts/<namespace>.ts` 파일 각각: `export const <ns> = { ko: {...}, en: {...} } as const;`. 플레이스홀더 보간 형식 `{name}`, `{count}`. 네임스페이스는 화면/기능 단위(예: `common`, `auth`, `home`, `thread`, `community`, `post`, `profile`, `errors`). `src/i18n/index.ts`: 모든 네임스페이스를 임포트하고 `export const DICTS = { ...all } as const;`, `export type Lang = 'ko'|'en';` 내보내기.
- [x] **I18N-3 · useT 훅**: 신규 `frontend/src/i18n/useT.ts`. `export function useT()` — langStore를 구독하고 `t(key, vars?)` 함수를 반환. `key` 형식은 `'ns.subkey'`(첫 `.` 기준 분리). 해석 우선순위: `DICTS[ns][lang][sub]` → `DICTS[ns].ko[sub]` fallback → raw key fallback. `{x}` 토큰을 `vars`로 치환. `import.meta.env.DEV` 환경에서 키 누락 시 `console.warn`. 반환값은 항상 `string`.
- [x] **I18N-4 · tn 유틸(비-React)**: 신규 `frontend/src/i18n/tn.ts`. `export function tn(key, vars?)` — I18N-3와 동일한 해석 로직이되 `useLangStore.getState().lang`으로 React 훅 없이 호출. `stores/`, `engine/`, `lib/` 내부 비-React 모듈에서 사용.
- [x] **I18N-5 · LangToggle 컴포넌트**: 신규 `frontend/src/components/LangToggle.tsx`. `[ KO | EN ]` 세그먼트 컨트롤. 활성 언어: `text-term-amber`; 비활성: `text-term-dim hover:text-term-bright`. 기존 AppLayout 버튼 스타일링과 일치. 선택적 prop `variant: 'header' | 'setting'`(기본 `'header'`).
- [x] **I18N-6 · 헤더 LangToggle 배선**: `AppLayout` 상단바에 LangToggle(`variant='header'`) 마운트. 기존 `LlmStatusBadge`·`[ username ]` 레이아웃과 정합.
- [x] **I18N-7 · 프로필/설정 화면 LangToggle 배선**: `Profile.tsx`(설정 화면) "언어 / Language" 행 추가. LangToggle(`variant='setting'`). WIREFRAME §9 설정 화면 행 패턴과 정합.
- [x] **I18N-8 · 문자열 마이그레이션 — UI 크롬 (~29개 파일)**: 각 화면/컴포넌트의 정적 한국어 문자열을 딕셔너리로 이전하고 `t(...)` 호출로 교체. 대상: `AppLayout`, `Login/LoginModal`, `Home`, `Search`, `Community`, `CreatePost`, `CreateCommunity`, `Thread`, `Composer`, `ChatBubble/SummaryBubble`, `Profile`, `상태 컴포넌트(Empty/Error/Loading/Offline)`, `PostCard`, `PersonaEditor`, `Avatar`. UGC(게시글 제목·본문·댓글·커뮤니티명·username)는 번역하지 않음.
- [x] **I18N-9 · AI 언어 지시어 — contextEngine.ts**: `buildLlmRequest`(또는 systemInstruction 조립 지점)에서 `useLangStore.getState().lang`을 읽어 언어 지시어를 `systemInstruction`에 추가. `lang==='en'`이면 `'Respond in English.'`, `lang==='ko'`이면 한국어 동등 문장. systemInstruction 조립: `[persona.trim(), directive].filter(Boolean).join('\n\n')`, persona가 없으면 directive만. **XC-4(프롬프트 인젝션 가드) 불변** — 페르소나 + 앱 통제 지시어만 systemInstruction에 들어가고 사용자·댓글 내용은 data turn 유지.
- [x] **I18N-10 · SUMMARY_DIRECTIVE 언어화**: `contextEngine.ts`의 `SUMMARY_DIRECTIVE` 상수를 `{ ko: '<기존 한국어 요약 지시>', en: '<동등 영문 요약 지시>' }` 객체로 교체. `ensureSummary`에서 `SUMMARY_DIRECTIVE[lang]` 선택.
- [x] **I18N-11 · 오류 문자열 언어화**: `llm.ts`의 `USER_MESSAGES`(오류 코드 → 사용자 표시 문자열 레코드)를 `{ ko: {...}, en: {...} }` 구조로 교체하고, 현재 lang을 읽는 헬퍼로 선택. `contextEngine.ts` 내 하드코딩된 AI 실패 문자열도 동일하게 `tn()`으로 교체.
- [x] **I18N-12 · Intl 날짜/숫자 포맷**: 날짜·숫자가 렌더되는 모든 위치에서 `new Intl.DateTimeFormat(lang, ...)` / `new Intl.NumberFormat(lang, ...)` 적용.
- [x] **I18N-13 · 검증**: `typecheck` + `test` + `build` green. 브라우저 — KO↔EN 토글 시 전체 UI 크롬 언어 전환 확인; AI 답변·요약 언어가 UI 언어를 따르는지 실 키로 확인; 새로고침 후 선택 언어 유지 확인.

**M17 종료 기준**: `langStore`가 `localStorage`에 영속되고 `document.documentElement.lang`을 갱신함; `LangToggle`이 헤더·프로필 설정 양쪽에 존재하고 KO/EN을 즉시 전환함; 모든 UI 크롬 문자열이 딕셔너리로 이전되어 선택 언어로 표시됨(UGC는 원문 유지); AI가 `systemInstruction` 언어 지시어를 통해 UI 언어로 답변·요약함; `SUMMARY_DIRECTIVE`·`USER_MESSAGES`·AI 실패 문자열이 lang-aware임; typecheck · test · build 전부 green.

---

## 20. M18 — 프로필(/me) 리디자인: 탭 + 커서 페이지네이션 + 설정 분리 (v1.2, 예정)

> 출처: Profile Redesign 승인 사양(2026-06-21). 레퍼런스: GitHub 프로필 탭, Reddit(Posts/Saved), X(Posts/Likes).
> 앱은 그린 인광 CRT 터미널 미감 — 기존 Home 피드 패턴(탭 + IntersectionObserver 센티널 + opaque nextCursor + loading/EOF)을 **그대로 재사용**하여 일관성 유지.
> **기능 추가 / IA 변경** — 라우팅 신규(`/me/settings`), 백엔드 3개 엔드포인트 keyset 페이지네이션 추가, 프론트 탭·무한스크롤·설정 페이지 분리.
> 완료 게이트: `npm run typecheck` · `npm run test` · `npm run build` 전부 green + 브라우저 시각 검증(탭 전환·무한스크롤·설정 페이지 이동·KO/EN 전환).

### 배경 — 현재 상태 (ground truth)

- 피드 `GET /posts`는 `backend/src/routes/posts.ts`에 keyset 커서 페이지네이션 완비(`encodeCursor`/`decodeCursor` = createdAt(ms)+id base64url, PAGE+1 take, `items`+`nextCursor` 응답 envelope). 프론트 `getPosts`는 `PostsPage` shape 반환.
- 프로필 3개 엔드포인트는 페이지네이션 **없음**(전체 목록 반환): `GET /users/:id/posts`, `GET /users/:id/bookmarks`(둘 다 `posts.ts`), `GET /users/:id/communities`(`communities.ts`).
- `rest.ts`의 `getUserPosts`/`getUserBookmarks`/`getUserCommunities`는 커서를 버리고 bare 배열로 unwrap(`toItems`).
- `Profile.tsx`는 `Promise.all`로 셋을 동시 로드·나열; API Key·Language·Logout 설정이 `/me` 상단에 위치.

### 작업 패키지 (WP)

#### 백엔드 — keyset 커서 페이지네이션 추가

- [ ] **PR-BE-1 · 공유 커서 유틸 추출**: `backend/src/domain/cursor.ts` 신규. 기존 `posts.ts`의 `encodeCursor`/`decodeCursor`(createdAtMs + id base64url)를 이 모듈로 이전·재익스포트. `posts.ts`는 동일 함수를 `cursor.ts`에서 import — 피드·`/communities/:slug/posts` 동작 **불변**. `communities.ts`가 재사용.
- [ ] **PR-BE-2 · `GET /users/:id/posts` 페이지네이션**: `createdAt desc, id desc` 정렬; 커서 앵커 = `post.createdAt(ms) + post.id`(피드 "new" 커서와 동일). `cursor` 쿼리 파라미터 수락; 잘못된 커서 → 400. `{ items, nextCursor }` 반환(끝이면 `null`). `PAGE_SIZE` 상수(~20) 사용.
- [ ] **PR-BE-3 · `GET /users/:id/communities` 페이지네이션**: `createdAt desc, id desc` 정렬; 커서 앵커 = `community.createdAt(ms) + community.id`. PR-BE-1 `cursor.ts` 재사용. 동일 envelope 반환.
- [ ] **PR-BE-4 · `GET /users/:id/bookmarks` 페이지네이션 (트리키)**: 정렬 기준은 **Bookmark 조인 행의 `createdAt desc`(북마크된 시각), 타이브레이크 `bookmark.id desc`**. 커서 앵커·keyset 조건자 모두 bookmark 행 기준(`bookmark.createdAt(ms) + bookmark.id`). `post.createdAt` 사용 금지. 동일 envelope 반환.
- [ ] **PR-BE-5 · 백엔드 테스트 추가/확장**: 3개 엔드포인트 각각: 첫 페이지 크기 = PAGE_SIZE, `nextCursor` 존재(더 있을 때), 두 번째 페이지 이어지기, 목록 끝 `nextCursor null`, 잘못된 커서 400. 기존 피드 테스트 **무변경**.

#### 클라이언트 — types + rest.ts 갱신

- [ ] **PR-FE-1 · `api/types.ts` 타입 추가**: `CommunitiesPage { items: Community[]; nextCursor: string | null }` 신규. 기존 `PostsPage { items: Post[]; nextCursor: string | null }` 참조.
- [ ] **PR-FE-2 · `rest.ts` 페이지 클라이언트 교체**: `getUserPosts(userId, cursor?)` → `PostsPage` 반환. `getUserBookmarks(userId, cursor?)` → `PostsPage` 반환. `getUserCommunities(userId, cursor?)` → `CommunitiesPage` 반환. Authorization 헤더(acting userId) 전달 방식 기존과 동일하게 유지.

#### 프론트엔드 — 훅 + UI

- [ ] **PR-FE-3 · `usePagedList` 훅**: 신규 `frontend/src/hooks/usePagedList.ts`. 캡슐화 항목: `items` 상태, `cursor`, `loading`, `done`(EOF), `error`, sentinel `ref`(IntersectionObserver), `loadMore`(items append). Home 피드의 IntersectionObserver + nextCursor 패턴을 재사용하여 3개 탭이 공유. 제네릭(`T`) 설계.
- [ ] **PR-FE-4 · Profile 탭 UI 리디자인**: `Profile.tsx` 개편. 3개 탭 `[ communities | posts | bookmarks ]` — Home 피드 탭과 동일한 세그먼트 컨트롤 스타일(활성 = `text-term-amber`). 활성 탭만 lazy 로드·페이지네이션(`usePagedList` 사용). 탭별 ShellPrompt 커맨드: `ls ~/communities`, `ls ~/posts`, `ls ~/bookmarks`. 빈 상태·로딩·EOF 상태는 기존 Home 피드의 states 컴포넌트·idiom 재사용. 설정 섹션(API Key·Language·Logout)은 이 화면에서 **제거**하고 `/me/settings` 링크로 대체. 헤더에 gear 아이콘 또는 `[ settings ]` 링크 추가(→ `/me/settings`).
- [ ] **PR-FE-5 · Settings 페이지 신규**: `frontend/src/pages/Settings.tsx` 신규. 내용: API Key 섹션(마스킹·로컬 전용 — 동작 **완전 동일**), Language 설정(`LangToggle variant='setting'`), Logout(→ `/login` 네비게이션). ShellPrompt 커맨드: `cat ~/.config`. `/me`로 돌아가는 back 링크. 터미널 미감 전체 유지.
- [ ] **PR-FE-6 · 라우팅 등록**: `src/App.tsx`의 AppLayout 그룹 내 `/me/settings` 경로에 `Settings` 컴포넌트 등록.
- [ ] **PR-FE-7 · i18n 키 추가**: `src/i18n/dicts/profile.ts`(ko + en)에 신규 키 추가 — 탭 레이블(`communities`, `posts`, `bookmarks`), 설정 링크 레이블, 설정 페이지 제목, 각 탭 EOF/빈 상태 문자열(Home 피드 기존 키와 중복 시 재사용 우선). 커맨드 문자열은 번역 대상 아님.
- [ ] **PR-FE-8 · 검증**: `typecheck` + `test` + `build` green. 브라우저 — 탭 전환 · 무한스크롤 · `/me/settings` 이동·back · KO/EN 전환 · 비로그인 EmptyState 유지 · API Key 마스킹 동작·Logout 동작 확인.

**M18 종료 기준**: 3개 프로필 엔드포인트가 keyset `{ items, nextCursor }` envelope 반환(잘못된 커서 400, EOF `null`); bookmarks 커서가 post.createdAt 아닌 bookmark 행 기준임; `getUserPosts`/`getUserBookmarks`/`getUserCommunities`가 paged shape 반환; Profile(`/me`)이 탭 3개(communities/posts/bookmarks) + 활성 탭 무한스크롤; 설정(API Key·Language·Logout)이 `/me/settings`로 이동됨; AppLayout 그룹에 `/me/settings` 라우트 등록; i18n 키 추가; BYOK 키 마스킹·로컬 전용 동작 불변; 비로그인 EmptyState 유지; 모바일 우선·터치 ≥44px·가로 스크롤 없음; `typecheck`·`test`·`build` green.

---

## 21. M19 — 지식 루프 + 수평 확장 + 검증 게이트 (v1.3, 2026-07-27~28)

> 심사 기준(기술성/창의성/완성도/비즈니스/전달력) 관점의 약점을 좁히는 묶음. 전부 구현·검증·커밋 완료.

| WP | 내용 | 산출물 | 검증 |
|----|------|--------|------|
| **KL-1** | **논의 문서 응결(FR-13)** — 스레드 `⋯` → `[ 문서로 정리 ]` → 본인 키로 마크다운 응결 → `/d/:id`, 커뮤니티 [게시글\|문서] 탭 | `Document` 모델·마이그레이션, `routes/documents.ts`, `engine/documentEngine.ts`, `pages/Document.tsx` | 백엔드 계약 18건, 엔진 21건, e2e J4 4건 |
| **KL-2** | **문서 재투입(FR-14)** — Composer AI 메뉴에서 문서 최대 3개 첨부, 활성 컨텍스트 **앞**에 참고 턴으로 삽입(XC-4 유지) | `stores/docContextStore.ts`, `buildLlmRequest.attachedDocuments` | 엔진 7건, 스토어 8건, e2e J5 2건 |
| **SC-1** | **Postgres 전환 경로** — 단일 SoT 스키마에서 파생 + DDL 생성 + 드리프트 게이트 | `scripts/sync-postgres-schema.mjs`, `prisma/postgres/init.sql` | `db:pg:check`(파이프라인 게이트) |
| **SC-2** | **pub/sub 어댑터** — `InMemory`/`Redis`(`REDIS_URL`), 의존성 추가 없이 RESP 자체 구현 | `redis/resp.ts`, `realtime/pubsub.ts` | fan-out 14건(2 인스턴스 전달 + 인메모리 비전달 대비) |
| **SC-3** | **레이트리밋 공유** — 정책/저장소 분리, 원자적 고정 윈도우(`INCR`) | `store/rateLimitStore.ts`, `redis/client.ts` | 16건(2 인스턴스 예산 공유 + 동시 초과 허용 없음) |
| **VF-1** | **부하 시뮬레이션** — SSE fan-out 지연 + 요약 경쟁 수렴 | `test/load/simulate.mjs` | 실측(README 성능 실측 A·B) |
| **VF-2** | **실키 실측** — 실제 키 3명으로 전 구간, 토큰·비용·키 유출 계측 | `e2e/measure-real-keys.mjs` | 실측(README 성능 실측 C) |
| **VF-3** | **검증 게이트 코드화** — 5게이트 + 실패 시 `exit 1`, e2e 서버 자체 기동, 커버리지 | `deploy/pipeline.sh` | 드리프트 주입으로 실패 경로까지 실측 |
| **DL-1** | **전달력** — 응결 흐름 GIF + 화면 3장(재현 생성), README 재구성, 배포·CI 방침 명시 | `e2e/capture-media.spec.ts`, `docs/assets/*` | `npm run media` 재현 |

**완료 게이트**: 백엔드 125 / 프론트 79 유닛 통과, 양쪽 typecheck 클린, e2e J4·J5 6건 통과, `./deploy/pipeline.sh --with-build` 전 게이트 PASS.

**남은 것**(의도적 미완):
- 실 Redis 서버 / 실 Postgres 인스턴스 **런타임** 검증 — 배포 시 1회.
- e2e 서버 **자체 기동 경로**의 실행 검증 — 개발 포트 점유 때문에 설정 로드까지만.
- **유기적 사용 데이터**(파일럿) — 현재 실측은 각본화된 1회 세션.
