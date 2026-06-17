# Aidit — Technical Requirements Document (TRD)

> Companion to [PRD.md](./PRD.md). Status: PoC · Version: 0.1 · Date: 2026-06-16
> 핵심 설계 원칙: **서버는 키를 모른다.** 모든 LLM 호출은 브라우저 → Google 직접. 서버는 CRUD + 스레드별 SSE 릴레이 + 컨텍스트 경계(SoT)만 담당.

---

## 1. 아키텍처 개요

```
┌─────────────────────────── Browser (PWA, React) ───────────────────────────┐
│  UI (Home / Community / Thread-Chat)                                        │
│  ├─ AuthStore        localStorage: { username, googleApiKey }               │
│  ├─ GeminiClient     fetch → generativelanguage.googleapis.com  (BYOK)      │
│  ├─ ContextEngine    토큰 카운팅 + 128K 세그먼트 + 요약 트리거 (manager.py 포팅) │
│  └─ ThreadStream     EventSource(SSE)  ← 서버 실시간 버블                      │
└───────────┬───────────────────────────────────────────────┬───────────────┘
            │ REST (글/댓글/요약 텍스트 게시, 키 절대 미포함)        │ SSE (구독)
            ▼                                                   ▼
┌────────────────────────── Aidit Server (Node + Fastify) ────────────────────┐
│  REST API  /communities /posts /posts/:id/comments ...                      │
│  SSE Hub   /posts/:id/stream  (post 단위 pub/sub fan-out)                    │
│  Domain    Community · Post · Comment(=Bubble) · ContextSegment             │
│  AInvocationLock / Idempotency  (동시 @AI·요약 경쟁 단순 처리)                  │
└───────────┬─────────────────────────────────────────────────────────────────┘
            ▼
        Postgres (PoC는 SQLite 가능)  +  Redis(선택, 다중 인스턴스 SSE pub/sub)
```

**브라우저 → Google 직접 호출**이 핵심: API 키는 서버를 절대 통과하지 않는다.
서버가 받는 것은 이미 생성된 **텍스트 결과(사람 댓글, AI 답변, 요약문)** 뿐이다.

### 1.1 agent-cli에서 가져오는 것 / 새로 만드는 것

| agent-cli 자산 | Aidit에서 |
|----------------|-----------|
| `context/manager.py` 토큰 budget + 압축/요약 (90% 임계) | **클라이언트 TS로 포팅**, 임계를 128K 정책으로 |
| `render/web.py` `_event_buffer` fan-out + 재생(replay) | **post 단위 SSE Hub**로 재구성 |
| `providers/openai|anthropic.py` (서버 키) | 폐기. **클라이언트 GeminiClient(BYOK)** 신규 |
| 단일 세션/JSONL 저장, 닉네임-only auth | 폐기. **멀티테넌트 DB + username 식별** |

---

## 2. 기술 스택 (PoC 권장)

| 레이어 | 선택 | 비고 |
|--------|------|------|
| Frontend | **React 18 + TypeScript + Vite**, React Router, Zustand(상태), TailwindCSS | 모바일 우선, PWA(vite-plugin-pwa) |
| 실시간 | **SSE (EventSource)** | 단방향 서버→클라 충분, WS 대비 단순. 쓰기는 REST |
| Backend | **Node 20 + Fastify + TypeScript** | 가볍고 SSE 친화적. (대안: NestJS) |
| ORM/DB | **Prisma + SQLite(PoC) → Postgres(확장)** | 무상태 서버, 단일 SoT |
| Pub/Sub | **인메모리(단일 인스턴스)** → **Redis pub/sub**(다중) | NFR-4 수평확장 |
| LLM | **Google Gemini Flash Lite (BYOK, 클라이언트)** | §5 |
| 배포 | 정적 프론트(CDN) + Node 서버(컨테이너) | |

---

## 3. 데이터 모델

```prisma
// Prisma schema (PoC)

model User {
  id        String   @id @default(cuid())
  username  String   @unique          // 표시 + 본인 판별. 키는 저장 안 함.
  createdAt DateTime @default(now())
  communities Community[] @relation("CreatedCommunities")
  posts     Post[]
  comments  Comment[]
}

model Community {
  id            String   @id @default(cuid())
  slug          String   @unique       // 검색/URL
  name          String
  description   String?
  personaPrompt String                 // ← 커뮤니티 AI 페르소나 (system instruction)
  creatorId     String
  creator       User     @relation("CreatedCommunities", fields: [creatorId], references: [id])
  createdAt     DateTime @default(now())
  posts         Post[]
}

model Post {
  id          String   @id @default(cuid())
  communityId String
  community   Community @relation(fields: [communityId], references: [id])
  authorId    String
  author      User     @relation(fields: [authorId], references: [id])
  title       String
  body        String
  score       Int      @default(0)      // 추천(인기 정렬용)
  commentCount Int     @default(0)
  hotScore    Float    @default(0)      // 비정규화 인기점수(§9)
  createdAt   DateTime @default(now())
  comments    Comment[]
  segments    ContextSegment[]
}

enum CommentType { HUMAN  AI_REPLY  AI_SUMMARY }   // 버블 종류
enum CommentStatus { PENDING  COMPLETE  FAILED }   // AI 버블 로딩/실패 상태

model Comment {                          // = "버블"
  id          String   @id @default(cuid())
  postId      String
  post        Post     @relation(fields: [postId], references: [id])
  authorId    String?                    // AI 버블이면 null
  author      User?    @relation(fields: [authorId], references: [id])
  type        CommentType
  status      CommentStatus @default(COMPLETE)
  body        String
  tokenCount  Int       @default(0)      // 컨텍스트 합산용(추정치)
  segmentId   String                     // 소속 컨텍스트 세그먼트(§6)
  segment     ContextSegment @relation(fields: [segmentId], references: [id])
  // @AI 답변이 어떤 사람 댓글에 대한 응답인지(요청 #5 "해당 @AI 댓글에 대해")
  replyToId   String?
  replyTo     Comment?  @relation("ReplyChain", fields: [replyToId], references: [id])
  replies     Comment[] @relation("ReplyChain")
  seq         Int                        // post 내 단조 증가 순서(SoT 정렬키)
  createdAt   DateTime  @default(now())
  @@index([postId, seq])
}

// 컨텍스트 세그먼트: 요약 경계 단위. post 생성 시 seg#0 자동 생성.
// 요약 버블이 만들어지면 새 세그먼트가 열리고, 그 첫 버블이 요약문(AI_SUMMARY).
model ContextSegment {
  id            String   @id @default(cuid())
  postId        String
  post          Post     @relation(fields: [postId], references: [id])
  index         Int                      // 0,1,2... post 내 순번
  // 이 세그먼트의 컨텍스트 = 직전 세그먼트 요약문(있으면) + 이 세그먼트의 버블들
  summaryCommentId String?               // 이 세그먼트를 여는 요약 버블(index>0일 때)
  tokenSum      Int      @default(0)      // 캐시된 누적 토큰(128K 판정용)
  isActive      Boolean  @default(true)   // 최신(활성) 세그먼트 1개만 true
  createdAt     DateTime @default(now())
  comments      Comment[]
  @@unique([postId, index])
}
```

**설계 포인트**
- **버블 = `Comment`**, 종류는 `type`(HUMAN/AI_REPLY/AI_SUMMARY). 좌/우는 클라가 `authorId === me ? 우 : 좌`로 판정(AI는 항상 좌).
- **세그먼트(`ContextSegment`)** 가 요약 경계의 단일 출처. 활성 세그먼트의 `tokenSum`으로 128K를 판정(요청 #6/#7).
- **`seq`** 는 post 내 전역 단조 증가 — SSE 재생/정렬/멱등의 기준.

---

## 4. REST API (요약)

| Method · Path | 설명 | 인증 | 비고 |
|---------------|------|------|------|
| `POST /auth/session` | username 등록/확인(없으면 생성) | - | 키 미전송. 사실상 username upsert |
| `GET /communities?q=` | 커뮤니티 검색(부분일치) | - | FR-1.2 |
| `POST /communities` | 커뮤니티 생성(name, slug, personaPrompt) | username | FR-3.1 |
| `PATCH /communities/:id` | 페르소나/설명 수정(생성자만) | username | FR-3.3 |
| `GET /posts?sort=hot&cursor=` | 홈 인기 피드 | - | FR-1.1, 커서 페이지네이션 |
| `GET /communities/:slug/posts` | 커뮤니티별 글 | - | |
| `POST /posts` | 글 작성(먼저 등록) | username | FR-4.2 |
| `GET /posts/:id` | 글 + 메타 | - | |
| `GET /posts/:id/comments?afterSeq=` | 버블 페이지네이션 | - | FR-5 |
| `POST /posts/:id/comments` | **버블 게시**(사람/AI/요약 텍스트) | username | §4.1 |
| `PATCH /comments/:id` | AI 버블 상태/본문 갱신(PENDING→COMPLETE/FAILED) | username | FR-6.2 |
| `GET /posts/:id/context` | **AI 호출용 컨텍스트 조립 결과** 반환 | - | §6.2 핵심 |
| `GET /posts/:id/stream` | **SSE 구독**(새 버블/상태변경 push) | - | §7 |
| `POST /posts/:id/upvote` | 추천 | username | hotScore 갱신 |

### 4.1 `POST /posts/:id/comments` — 버블 게시 계약

요청 본문(키 없음):
```jsonc
{
  "type": "HUMAN | AI_REPLY | AI_SUMMARY",
  "body": "텍스트",
  "status": "COMPLETE | PENDING",   // 사람=COMPLETE, AI=처음 PENDING
  "replyToId": "cmt_...",            // AI_REPLY가 응답하는 @AI 사람댓글
  "clientId": "uuid",                // 멱등키(중복 게시 방지)
  "segmentExpected": 2               // 클라가 가정한 활성 세그먼트 index (낙관적 동시성)
}
```
- 서버는 `seq` 부여, 활성 `segmentId` 결정, `tokenCount`(서버 재추정 or 클라 제출) 반영, 활성 세그먼트 `tokenSum` 갱신, **SSE로 fan-out**.
- `clientId` 멱등: 동일 clientId 재요청은 기존 버블 반환(네트워크 재시도 안전).

---

## 5. Gemini (BYOK) 클라이언트

> **모든 호출은 브라우저에서.** 서버·서버 로그를 절대 경유하지 않는다.

- 엔드포인트(REST): `https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={USER_KEY}`
- 토큰 카운팅: `.../models/{MODEL}:countTokens?key={USER_KEY}` (정확) 또는 로컬 휴리스틱(`chars/4`) 폴백.
- 모델(A-1): `MODEL = "gemini-3.1-flash-lite"` (PoC 고정값, 설정 한 곳에서 관리).
- 요청 형태:
```jsonc
{
  "systemInstruction": { "parts": [{ "text": "<community.personaPrompt>" }] },
  "contents": [ /* §6에서 조립한 역할별 turn 배열 */ ],
  "generationConfig": { "temperature": 0.7, "maxOutputTokens": 2048 }
}
```
- 오류 처리: 401/403(키 무효) → AI 버블 `FAILED` + "키를 확인하세요". 429(쿼터) → 재시도 안내. 사람 댓글은 영향 없음(NFR-5).
- **스트리밍(선택)**: `:streamGenerateContent`로 부분 토큰 표시(버블 타이핑 효과). PoC는 비스트리밍 + 로딩 인디케이터로 충분.

### 5.1 컨텍스트 → Gemini `contents` 매핑
- 글 원본/타인 댓글/AI 버블 → 역할 매핑: 사람 발화는 `role:"user"`, AI 버블은 `role:"model"`.
- 다자 대화이므로 각 user turn 앞에 `「{username}」: ` 접두로 화자 구분(Gemini는 멀티 user 화자 개념이 약해 텍스트로 표기).
- 요약 버블은 새 세그먼트의 첫 `user` turn으로 "지금까지 요약: ..." 형태 주입(§6.3).

---

## 6. 컨텍스트 & 요약 엔진 (제품의 심장)

### 6.1 활성 컨텍스트의 정의
- **세그먼트 0**: 요약 이전. 컨텍스트 = `글 원본 + 세그먼트0의 모든 버블`. (요청 #5)
- **세그먼트 N(≥1)**: 컨텍스트 = `세그먼트 N을 여는 요약 버블 + 세그먼트 N의 버블들`. (요청 #7 — 원본/이전 히스토리 제외)
- "활성 세그먼트"는 항상 1개(`isActive=true`).

### 6.2 `@AI` 처리 시퀀스 (클라이언트 + 서버)

```
사용자가 "@AI ..." 댓글 전송
 1) [REST] 사람 댓글 우선 등록 (type=HUMAN, COMPLETE)         ← 먼저 보임(FR-6.2)
 2) [REST] GET /posts/:id/context  → { segmentIndex, contents[], tokenSum, summaryNeeded }
 3) IF tokenSum > 128_000  (= summaryNeeded)  →  [요약 분기, 6.3]
        a) 사용자 키로 Gemini 요약 호출 (요약 프롬프트 + 현재 contents)
        b) [REST] AI_SUMMARY 버블 게시 → 서버가 새 세그먼트(N+1) 개시, 활성 전환
        c) 컨텍스트를 (요약문 + 방금 @AI 사람댓글)로 재조립
 4) [REST] AI_REPLY 버블 PENDING 게시 (replyToId=사람댓글) → 즉시 좌측에 "…로딩"
 5) 사용자 키로 Gemini generateContent (systemInstruction=persona, contents=조립결과)
 6) [REST] PATCH /comments/:aiId  body=응답, status=COMPLETE   (실패 시 FAILED)
 7) 서버는 매 단계 SSE fan-out → 모든 시청자 실시간 갱신
```

- **토큰 판정의 단일 출처는 서버**(`segment.tokenSum`). 클라는 게시 시 자기 버블의 `tokenCount`를 함께 보내 서버가 누적.
- **128K는 활성 세그먼트의 `tokenSum`** 기준(A-2: 제품 정책치, 모델 한도와 분리).
- **지연(lazy) 요약(FR-7.3)**: 평범한 사람 댓글로 128K를 넘겨도 즉시 요약하지 않는다(서버에 키 없음). 다음 `@AI` 호출자의 키로 3)단계에서 처리. → 요청 #6의 "버블 후 초과 시 요약"을 BYOK 제약과 화해시킨 결정.

### 6.3 요약 프롬프트 (manager.py 포팅 개념)
- agent-cli `manager.py`의 압축: "오래된 절반을 단일 LLM 호출로 요약, 이전 요약을 재귀적으로 앞에 붙임".
- Aidit 적용:
  - 입력: 현재 활성 세그먼트의 contents(글원본/이전요약 포함).
  - system: `personaPrompt` + 요약 지시("이 토론의 사실/결정/미해결 질문을 충실히 보존해 요약. 새 질문에 답하기 위한 컨텍스트로 쓰일 것").
  - 출력: 요약 텍스트 → `AI_SUMMARY` 버블(보라/앰버 색, FR-7.4).
  - 새 세그먼트는 이 요약을 첫 컨텍스트 요소로 가짐(이전 원본 제외 = 요청 #7).

### 6.4 토큰 카운팅
- 각 버블 게시 시 `tokenCount` 산정: 1순위 Gemini `countTokens`(정확, 키 필요), 폴백 `Math.ceil(chars/4)`.
- 서버는 `segment.tokenSum += tokenCount`. `GET /context`는 `tokenSum`을 그대로 임계 판정에 사용.
- agent-cli처럼 추정→실제(usage) 보정도 가능(PoC 선택).

### 6.5 동시성 / 경쟁 상태 (PoC 단순화)
- **동시 `@AI`**: 둘 다 사람 댓글은 정상 등록, 각자 AI 답변 생성(서버 `seq`로 순서 확정). 컨텍스트는 "조회 시점 스냅샷" 기준 → 약간의 비결정성 허용(PoC).
- **동시 요약 트리거**: 서버가 post별 **요약 멱등 가드** — 활성 세그먼트당 `AI_SUMMARY`는 1개만 허용. 두 클라가 동시에 요약 게시하면 첫 게시만 새 세그먼트 개시, 둘째는 409 + 최신 세그먼트 반환 → 둘째 클라는 새 세그먼트 기준으로 답변 진행.
- `segmentExpected` 불일치 시 서버가 정정 응답(낙관적 동시성).

---

## 7. 실시간 (SSE)

- `GET /posts/:id/stream`: `text/event-stream`. 연결 시 **현재 버블 스냅샷(afterSeq 기준) 재생 후 라이브** (agent-cli `_event_buffer` 재생 패턴 차용).
- 이벤트:
  - `comment.created` `{ comment }` — 새 버블(사람/AI PENDING/요약).
  - `comment.updated` `{ id, body, status }` — AI 버블 로딩→완료/실패.
  - `segment.opened` `{ segmentIndex, summaryCommentId }` — 요약으로 새 세그먼트 시작.
- 다중 인스턴스: Redis pub/sub로 post 채널 fan-out, 또는 SSE sticky 라우팅.
- 재연결: `Last-Event-ID`(=마지막 seq)로 누락분 재생.

---

## 8. 보안 & 프라이버시

- **키 격리(최우선)**: API 키는 localStorage + 호출 직전 메모리에서만. 서버 요청 바디/헤더/로그에 절대 미포함. 코드리뷰 체크리스트로 강제.
- **XSS / 키 유출 대응 (PoC 채택 방식)**: 키는 localStorage에 두되, **유출 채널을 CSP로 차단**한다. 엄격 **CSP**:
  - `connect-src 'self' https://generativelanguage.googleapis.com` — **Google 도메인 외부로의 네트워크 전송 자체를 금지**. XSS 스크립트가 키를 읽어도 공격자 서버로 exfiltrate할 통로가 없다(핵심 완화).
  - `script-src 'self'` (인라인/외부 스크립트 차단), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.
  - 사용자 콘텐츠(글/댓글/페르소나)는 렌더 시 escape, 마크다운은 DOMPurify sanitize.
- **localStorage 한계 고지**: CSP가 exfiltration은 막지만 동일 출처 내 오용 가능성은 남으므로, 로그인 화면에 "키는 이 기기에만 저장" 경고 카피 유지. (문서화된 PoC 수용 리스크)
- **프롬프트 인젝션**: `personaPrompt`는 systemInstruction으로 격리, 사용자 댓글은 데이터(user turn). 페르소나가 사용자 입력으로 덮이지 않도록 분리.
- **레이트/남용**: username 기반 게시 레이트리밋(서버), 커뮤니티 생성 스팸 방지(쿨다운).
- **권한**: 페르소나 편집은 `creatorId`만. AI 버블 PATCH는 해당 버블 생성 트랜잭션 소유자/멱등키 기준.

---

## 9. 인기(Hot) 정렬

PoC 공식(Reddit hot 변형):
```
hotScore = log10(max(score, 1)) + (commentCount * 0.5) / 1.0
           + ageDecay(createdAt)
ageDecay = -(epochHours(now - createdAt)) / 12     // 12h 반감 느낌
```
- 게시/추천/댓글 시 비정규화 `hotScore` 갱신, `ORDER BY hotScore DESC` + 커서 페이지네이션.
- PoC는 단순 재계산(쓰기 시) → 추후 배치/윈도우.

---

## 10. 프론트엔드 구조

```
src/
 ├─ stores/        authStore(username,key), threadStore(bubbles,segment)
 ├─ api/           rest.ts(서버), gemini.ts(BYOK 호출·countTokens·요약)
 ├─ engine/        contextEngine.ts (manager.py 포팅: 조립·128K 판정·요약 오케스트레이션)
 ├─ stream/        useThreadStream.ts (EventSource 구독·재생)
 ├─ pages/         Home, Community, Thread, CreatePost, CreateCommunity, Login
 └─ components/    PostCard, ChatBubble(left/right/ai/summary), Composer, PersonaBadge
```
- `contextEngine.ts`가 §6 시퀀스를 오케스트레이션(서버 context 조회 → 임계 판정 → 요약 → 답변 → PATCH).
- 낙관적 UI: 사람 댓글 즉시 우측 표시, AI 버블 PENDING placeholder → 도착 시 교체.

---

## 11. 에러 & 상태 매트릭스

| 상황 | 사람 댓글 | AI 버블 | UX |
|------|-----------|---------|-----|
| 키 무효(401/403) | 보존 | FAILED | "키 확인" + 재시도 |
| 쿼터(429) | 보존 | FAILED | "잠시 후 재시도" |
| 네트워크 실패(게시) | 멱등 재시도 | - | 토스트 |
| 요약 호출 실패 | 보존 | 요약 버블 미생성 | 답변은 (가능 시) FIFO 폴백 컨텍스트로 진행 or 보류 |
| 동시 요약 충돌 | - | 둘째 409 | 새 세그먼트로 재조립 후 진행 |

---

## 12. 테스트 전략 (PoC)

- **단위**: contextEngine 토큰 합산/128K 경계/세그먼트 전환, hotScore.
- **계약**: REST 멱등(clientId), `/context` 조립 정확성(요청 #5 vs #7 분기).
- **통합**: 다중 클라 SSE fan-out, 동시 `@AI`/동시 요약 경쟁.
- **E2E(요청 매핑)**: J1(게시→1차 AI), J2(@AI), J3(128K→요약→요약기반 답변). Gemini는 모킹/실키 양면.
- **수동 검증**: 두 브라우저로 같은 스레드, 좌/우 버블·실시간·요약색 확인.

---

## 13. 미해결/후속 결정

- username 고유성 강도(선점 vs 표시명) — PoC는 `@unique` upsert, 도용 방지는 후속.
- 토큰 카운팅 정확도 vs `countTokens` 호출 비용/지연 트레이드오프.
- 요약 품질 평가 루프(요약이 사실 보존하는지) — 후속 자동평가.
- ~~모델 ID 확정~~ → **`gemini-3.1-flash-lite` 로 확정(PoC).**
- ~~라이선스 불일치~~ → **MIT 기준으로 확정.**
- ~~localStorage 키 XSS~~ → **CSP `connect-src` Google 도메인 제한으로 exfiltration 차단, PoC 수용 리스크로 확정(§8).**
