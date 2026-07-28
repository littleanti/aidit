# Aidit — Technical Requirements Document (TRD)

> Companion to [PRD.md](./PRD.md). Status: PoC · Version: 0.1 · Date: 2026-06-16
> 핵심 설계 원칙: **서버는 키를 모른다.** 모든 LLM 호출은 브라우저 → Google 직접. 서버는 CRUD + 스레드별 SSE 릴레이 + 컨텍스트 경계(SoT)만 담당.

---

## 1. 아키텍처 개요

```
┌─────────────────────────── Browser (PWA, React) ───────────────────────────┐
│  UI (Home / Community / Thread-Chat)                                        │
│  ├─ AuthStore        localStorage: { username, googleApiKey }               │
│  ├─ LlmClient        fetch → generativelanguage.googleapis.com  (BYOK)      │
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
| `providers/openai|anthropic.py` (서버 키) | 폐기. **클라이언트 LlmClient(BYOK)** 신규 |
| 단일 세션/JSONL 저장, 닉네임-only auth | 폐기. **멀티테넌트 DB + username 식별** |

---

## 2. 기술 스택 (PoC 권장)

| 레이어 | 선택 | 비고 |
|--------|------|------|
| Frontend | **React 18 + TypeScript + Vite**, React Router, Zustand(상태), TailwindCSS | 모바일 우선, PWA(vite-plugin-pwa) |
| 실시간 | **SSE (EventSource)** | 단방향 서버→클라 충분, WS 대비 단순. 쓰기는 REST |
| Backend | **Node 20 + Fastify + TypeScript** | 가볍고 SSE 친화적. (대안: NestJS) |
| ORM/DB | **Prisma + SQLite(개발·테스트) / Postgres(운영)** | 단일 스키마에서 provider만 전환 — §15.1 |
| 인증 | **bcrypt(비밀번호) + @fastify/jwt(서명)** | 비밀번호 해시 저장, Bearer JWT 토큰 |
| Pub/Sub | **어댑터 인터페이스**: `InMemoryPubSub`(단일) / `RedisPubSub`(다중, `REDIS_URL`) | NFR-4 수평확장 — §15.2 |
| LLM | **LLM 제공자 BYOK, 클라이언트 직접 호출 (기본: Google Gemini Flash Lite)** | §5 |
| 배포 | 정적 프론트(CDN) + Node 서버(컨테이너) | |

---

## 3. 데이터 모델

```prisma
// Prisma schema (PoC)

model User {
  id           String   @id @default(cuid())
  username     String   @unique          // 표시 + 본인 판별. 키는 저장 안 함. 게스트는 `닉네임#hex4`(예: 철수#a3f9) 결합 문자열.
  passwordHash String?                  // bcrypt 해시(평문 비밀번호 미저장). 게스트(닉네임만, 비밀번호 없는 진입)는 null.
  createdAt    DateTime @default(now())
  communities  Community[] @relation("CreatedCommunities")
  posts        Post[]
  comments     Comment[]
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
  imageUrl    String?                   // 선택 첨부 이미지 URL(업로드 파일 서빙 경로). null=이미지 없음
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

// 북마크: 사용자가 글을 북마크. userId+postId unique, userId+createdAt 인덱스(최신순 조회).
model Bookmark {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  postId    String
  post      Post     @relation(fields: [postId], references: [id])
  createdAt DateTime @default(now())

  @@unique([userId, postId])
  @@index([userId, createdAt])
}

// 추천(업보트): 사용자가 글을 추천. userId+postId unique. Post.score = 이 행의 count.
model Vote {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  postId    String
  post      Post     @relation(fields: [postId], references: [id])
  createdAt DateTime @default(now())

  @@unique([userId, postId])
  @@index([postId])
}

// FR-13: 논의 문서 응결. 스레드 논의를 호출자 키(BYOK)로 마크다운 문서로 정리한 결과물.
// 서버는 key-blind — 완성된 텍스트만 받는다. provenance(segmentIndex/sourceSeq)로
// "스레드의 어디까지를 응결한 문서인지"가 데이터로 남는다.
model Document {
  id           String   @id @default(cuid())
  communityId  String
  community    Community @relation(fields: [communityId], references: [id])
  postId       String
  post         Post     @relation(fields: [postId], references: [id])
  authorId     String?  // 응결을 실행한 사용자(삭제 대비 nullable)
  author       User?    @relation(fields: [authorId], references: [id])
  title        String   // 생성 마크다운의 첫 '# 제목' 또는 게시글 제목
  body         String   // 마크다운 본문
  segmentIndex Int      // 응결 시점의 활성 세그먼트 index (provenance)
  sourceSeq    Int      // 응결에 포함된 마지막 버블의 seq (provenance)
  clientId     String?  // 멱등키(재시도 중복 방지)
  createdAt    DateTime @default(now())

  @@unique([postId, clientId])
  @@index([communityId, createdAt])
  @@index([postId, createdAt])
}
```

**설계 포인트**
- **버블 = `Comment`**, 종류는 `type`(HUMAN/AI_REPLY/AI_SUMMARY). 좌/우는 클라가 `authorId === me ? 우 : 좌`로 판정(AI는 항상 좌).
- **세그먼트(`ContextSegment`)** 가 요약 경계의 단일 출처. 활성 세그먼트의 `tokenSum`으로 128K를 판정(요청 #6/#7).
- **`seq`** 는 post 내 전역 단조 증가 — SSE 재생/정렬/멱등의 기준.
- **북마크(`Bookmark`)**: 사용자 프라이빗 상태. `GET /posts/:id`는 선택 `x-user-id` 헤더로 요청 사용자의 북마크 여부를 `bookmarked` 불린으로 응답(없으면 false).
- **문서(`Document`)**: 스레드 논의의 응결물(FR-13). 버블(`Comment`)과 달리 SSE fan-out 대상이 아니고 `seq`를 소비하지 않는다 — 스레드의 실시간 순서 계약(L4)을 건드리지 않기 위해 **별도 테이블**로 둔다. 같은 스레드에서 여러 번 응결하면 새 행이 누적되며(버전 히스토리), `@@unique([postId, clientId])`로 재시도만 멱등화한다.
- **추천(`Vote`)**: `@@unique([userId, postId])`로 사용자당 글당 1표. **`Post.score`는 더 이상 단순 증가 카운터가 아니라 `Vote` 행 수(count)** 이며 추천 추가/취소마다 재계산된다(기존 "score+1 무중복방지" 폐기). `GET /posts/:id`와 모든 피드 카드는 선택 `x-user-id`로 요청 사용자의 추천 여부를 `voted` 불린으로 응답(북마크와 동일 패턴).

---

## 4. REST API (요약)

> **인증 정책(확정)**: 모든 쓰기 요청은 **`Authorization: Bearer <jwt>` 헤더로 서명된 JWT 토큰**을 보낸다. 서버는 토큰을 **JWT_SECRET(환경변수)** 로 검증해 `userId`를 파생한다(x-user-id 신뢰 폐기). 토큰은 **JWT_EXPIRES(기본 7일)** 후 만료하되, **슬라이딩 갱신**(유효 토큰 제시 시 `POST /auth/refresh`로 재발급)으로 **마지막 활동 기준**으로 연장된다. **비밀번호는 bcrypt 해시로 저장**(평문 비전송). **게스트·회원 듀얼모드**: 두 모드는 **런타임에 공존**하며 서버 플래그로 고정하지 않는다(`AUTH_SIGNUP_REQUIRED` 제거). 분기는 **요청 본문의 `password` 유무**로 한다 — 없으면 `POST /auth/guest`(닉네임만, `passwordHash=null`), 있으면 `POST /auth/register`(신규)|`POST /auth/session`(기존). 게스트 닉네임은 **최대 16자·`#` 입력 금지**이며 서버가 `#`hex4 식별자를 부여한다(선점 검사 없이 항상 유일). 전체 구현 차이·추가 엔드포인트·KPI 형상은 [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md) 참조.

| Method · Path | 설명 | 인증 | 비고 |
|---------------|------|------|------|
| `POST /auth/register` | 회원가입(username+password) → User 생성, **`{ id, token, username }` 반환** | - | username 중복 409. 키는 미전송. **JWT 서명·반환(Bearer 토큰).** |
| `POST /auth/session` | 로그인(username+password) → **`{ id, token, username }` 반환, 토큰 검증** | - | 실패 시 401. 키 미전송. **JWT 서명·반환(Bearer 토큰).** |
| `POST /auth/guest` | **게스트 진입**(닉네임만, 항상 활성; password 없는 경로) → User 생성(`passwordHash=null`) → **`{ id, token, username }` 반환** | - | 닉네임 ≤16자·`#` 입력 금지. 서버가 `#`hex4 식별자 부여(예 `철수#a3f9`, 충돌 시 재생성). JWT 서명·반환. |
| `POST /auth/refresh` | **토큰 슬라이딩 갱신**(유효 Bearer → 새 토큰) → **`{ token }` 반환** | **`Authorization: Bearer <jwt>`** | 만료를 마지막 활동+JWT_EXPIRES로 연장. 무효/만료 토큰 401. 게스트·회원 공통. |
| `GET /communities?q=` | 커뮤니티 검색(부분일치) | - | FR-1.2 |
| `GET /communities/:slug` | 단일 커뮤니티 조회(slug 정확 일치, 없으면 404) | - | 상세 뷰 |
| `POST /communities` | 커뮤니티 생성(name, slug, personaPrompt, personaIcon) | **`Authorization: Bearer <jwt>`** | FR-3.1 · 토큰 검증(서명/만료) |
| `PATCH /communities/:id` | 페르소나/설명 수정(생성자만) | **`Authorization: Bearer <jwt>`** | FR-3.3 · 토큰 검증 |
| `GET /posts?sort=hot&cursor=` | 홈 인기 피드 | - | FR-1.1, 커서 페이지네이션 |
| `GET /communities/:slug/posts` | 커뮤니티별 글 | - | |
| `POST /posts` | 글 작성(먼저 등록, seg#0 자동) | **`Authorization: Bearer <jwt>`** | FR-4.2 · 레이트리밋(XC-9) · 본문에 선택 `imageUrl?` · 토큰 검증 |
| `POST /uploads` | 단일 이미지 업로드(multipart) → `{ imageUrl }`(서버 상대 `/uploads/<name>`) | **`Authorization: Bearer <jwt>`** | 글/댓글 이미지 첨부. 형식 PNG/JPEG/WebP/GIF · 최대 5MB · 정적 서빙 `GET /uploads/*` · 토큰 검증 |
| `GET /posts/:id` | 글 + 메타 | 선택 **`Authorization: Bearer <jwt>`** | 응답에 `imageUrl`, `bookmarked`, `voted`, `community.personaPrompt`(L6: 클라 AI systemInstruction 소스) 포함 |
| `PATCH /posts/:id` | **글 수정**(제목/본문/이미지, 작성자만) | **`Authorization: Bearer <jwt>`** | 토큰에서 파생된 `userId`로 작성자 검증 → 비작성자 403 |
| `DELETE /posts/:id` | **글 삭제**(작성자만) | **`Authorization: Bearer <jwt>`** | 토큰 파생 `userId`로 작성자 검증 → 비작성자 403 · 미존재 404 · 단일 트랜잭션 cascade(vote→bookmark→comment.replyToId 해제→comment→contextSegment→post) · 200 `{deleted:true}` |
| `GET /posts/:id/comments?afterSeq=` | 버블 페이지네이션 | - | FR-5 |
| `POST /posts/:id/comments` | **버블 게시**(사람/AI/요약 텍스트) | **`Authorization: Bearer <jwt>`**(사람) | §4.1 · clientId 멱등 · 토큰 검증 |
| `PATCH /comments/:id` | AI 버블 상태/본문 갱신(PENDING→COMPLETE/FAILED) | **`Authorization: Bearer <jwt>`**(사람)·clientId(AI) | FR-6.2 · 토큰 검증 |
| `GET /posts/:id/context` | **AI 호출용 컨텍스트 조립 결과** 반환 | - | §6.2 핵심 |
| `GET /posts/:id/stream` | **SSE 구독**(새 버블/상태변경 push) | - | §7 |
| `POST /posts/:id/upvote` | **추천(토글-추가, 멱등 upsert)** | **`Authorization: Bearer <jwt>`** | `score=vote count` + hotScore 재계산, `{id,score,hotScore,voted:true}` · 토큰 검증 |
| `DELETE /posts/:id/upvote` | **추천 취소(멱등)** | **`Authorization: Bearer <jwt>`** | `score=vote count` + hotScore 재계산, `{id,score,hotScore,voted:false}` · 토큰 검증 |
| **`POST /posts/:id/bookmark`** | **북마크 추가**(idempotent upsert) | **`Authorization: Bearer <jwt>`** | 201 `{bookmarked:true}` · 토큰 검증 |
| **`DELETE /posts/:id/bookmark`** | **북마크 제거**(idempotent delete) | **`Authorization: Bearer <jwt>`** | 200 `{bookmarked:false}` · 토큰 검증 |
| **`GET /users/:id/bookmarks`** | **북마크한 글 목록**(피드 카드, 북마크 최신순) — 커서 페이지네이션 | - | `?cursor=` 수락. `{ items, nextCursor }` 응답. 커서는 **Bookmark 행** 기준(§4.2) |
| `GET /users/:id/posts` | 사용자가 작성한 글 목록(피드 카드, 최신순) — 커서 페이지네이션 | - | `?cursor=` 수락. `{ items, nextCursor }` 응답. 커서 앵커 = `post.createdAt(ms) + post.id`(§4.2) |
| `GET /users/:id/communities` | 사용자가 생성한 커뮤니티 목록 — 커서 페이지네이션 | - | `?cursor=` 수락. `{ items, nextCursor }` 응답. 커서 앵커 = `community.createdAt(ms) + community.id`(§4.2) |
| **`POST /posts/:id/documents`** | **논의 문서 응결 저장**(FR-13) — 클라가 본인 키로 생성한 마크다운을 게시 | **`Authorization: Bearer <jwt>`** | §4.3 · `clientId` 멱등 · 서버는 key-blind(완성 텍스트만 수신) · 201 `{ document }` |
| **`GET /posts/:id/documents`** | **스레드에 응결된 문서 목록**(최신순) | - | 요약 필드만(본문 미포함) 반환 |
| **`GET /communities/:slug/documents?cursor=`** | **커뮤니티 문서 목록**(최신순) — 커서 페이지네이션 | - | `{ items, nextCursor }`. 커서 앵커 = `document.createdAt(ms) + document.id`(§4.2) |
| **`GET /documents/:id`** | **문서 단건 조회**(마크다운 본문 포함) | - | 미존재 404 |
| `POST /metrics/visit` | 인증 앱 오픈 시 `VisitEvent` 일별 멱등 기록 | **`Authorization: Bearer <jwt>`** | BE-13 · 작성자 D1 · 토큰 검증 |
| `GET /metrics` | §8 KPI 집계 반환 | - | BE-13 (형상: IMPLEMENTATION_NOTES §2.2) |

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

### 4.2 프로필 엔드포인트 커서 페이지네이션

세 프로필 엔드포인트는 홈 피드(`GET /posts`)와 **동일한 keyset 커서 패턴**을 따른다: `encodeCursor` / `decodeCursor`(base64url of `createdAtMs + id`)를 공유 유틸(`backend/src/domain/cursor.ts`)로 추출해 재사용한다.

**공통 규칙**

| 항목 | 값 |
|------|----|
| 쿼리 파라미터 | `cursor` (선택, 없으면 첫 페이지) |
| 응답 봉투 | `{ items: T[], nextCursor: string \| null }` |
| 페이지 크기 | `PAGE_SIZE`(프로필 전용 상수, 권장 20) |
| 끝 표시 | `nextCursor: null` |
| 잘못된 커서 | **400** |
| 정렬 | 각 엔드포인트별 아래 명세 |

**`GET /users/:id/posts`**

- 정렬: `post.createdAt DESC, post.id DESC`
- 커서 앵커: `post.createdAt(ms)` + `post.id` (홈 피드 `"new"` 정렬과 동일 인코딩)
- keyset 조건(cursor 있을 때): `(createdAt, id) < (cursorCreatedAt, cursorId)`

**`GET /users/:id/communities`**

- 정렬: `community.createdAt DESC, community.id DESC`
- 커서 앵커: `community.createdAt(ms)` + `community.id`
- keyset 조건(cursor 있을 때): `(createdAt, id) < (cursorCreatedAt, cursorId)`

**`GET /users/:id/bookmarks`** _(커서 기준이 다름 — 주의)_

- items는 Post 피드 카드이지만 **정렬·커서 앵커는 Bookmark 행** 기준.
- 정렬: `bookmark.createdAt DESC, bookmark.id DESC` (북마크한 시각 최신순)
- 커서 앵커: `bookmark.createdAt(ms)` + `bookmark.id` ← **post.createdAt 아님**
- keyset 조건(cursor 있을 때): `(bookmark.createdAt, bookmark.id) < (cursorCreatedAt, cursorId)`
- `nextCursor`도 마지막 Bookmark 행의 `(createdAt, id)`로 인코딩한다.

**클라이언트 타입 (`frontend/src/api/`)**

```ts
// types.ts — 추가
export interface PostsPage   { items: Post[];      nextCursor: string | null; }
export interface CommunitiesPage { items: Community[]; nextCursor: string | null; }

// rest.ts — 변경 요약
// getUserPosts(userId, cursor?)     → Promise<PostsPage>
// getUserBookmarks(userId, cursor?) → Promise<PostsPage>
// getUserCommunities(userId, cursor?) → Promise<CommunitiesPage>
```

**프론트엔드 무한 스크롤**

홈 피드와 동일한 `IntersectionObserver` 센티널 + `usePagedList` 훅 패턴 사용. 프로필 탭 전환 시 해당 탭이 처음 활성화될 때만 첫 페이지를 lazy 로드한다. 탭별 독립 커서 상태 유지.

---

### 4.3 `POST /posts/:id/documents` — 논의 문서 응결 계약 (FR-13)

요청 본문(키 없음 — 서버는 key-blind):
```jsonc
{
  "title": "Code Agent 사용 가이드",  // 선택. 생략/공백이면 서버가 게시글 제목 사용
  "body": "# Code Agent 사용 가이드\n\n## 1. ...",  // 필수. 마크다운 본문
  "segmentIndex": 0,                  // 필수. 응결 시점의 활성 세그먼트 index
  "sourceSeq": 17,                    // 필수. 응결에 포함된 마지막 버블 seq
  "clientId": "uuid"                  // 선택. 멱등키
}
```

- **생성 위치**: 마크다운은 **브라우저**가 호출자 본인 키로 만든다(`frontend/src/engine/documentEngine.ts`). 서버는 완성된 텍스트만 저장하며 어떤 LLM 호출도 하지 않는다(L1 key-blind 불변).
- **검증**: `body` 비어 있으면 400. `body` 길이 상한 **200,000자**(초과 400). `segmentIndex`/`sourceSeq`는 음이 아닌 정수 필수. 게시글 미존재 404. 미인증 401.
- **`communityId`** 는 클라가 보내지 않고 **서버가 게시글에서 파생**한다(위조 방지).
- **멱등**: 동일 `clientId` 재요청은 새 행을 만들지 않고 **기존 문서를 200으로 반환**한다. `clientId`가 없으면 매 호출이 새 버전을 만든다(FR-13.5).
- **SSE 미발행**: 문서 생성은 스레드 `seq` 계약과 무관하므로 `comment.created` 등 어떤 실시간 이벤트도 발행하지 않는다. 응결을 실행한 클라이언트만 즉시 결과를 받고 이동한다.
- **레이트리밋(XC-9)**: 문서 응결은 사용자 키로 LLM을 태우는 무거운 동작이므로 **identity당 5분에 3건**으로 제한(초과 429 + `Retry-After`).

---

## 5. LLM (BYOK) 클라이언트

> **모든 호출은 브라우저에서.** 서버·서버 로그를 절대 경유하지 않는다.

- 엔드포인트(REST): `https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={USER_KEY}`
- 토큰 카운팅: `.../models/{MODEL}:countTokens?key={USER_KEY}` (정확) 또는 로컬 휴리스틱(`chars/4`) 폴백.
- 모델(A-1): `LLM_MODEL = "gemini-3.1-flash-lite"` (PoC 고정값, 설정 한 곳에서 관리).
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

### 5.1 컨텍스트 → LLM `contents` 매핑
- 글 원본/타인 댓글/AI 버블 → 역할 매핑: 사람 발화는 `role:"user"`, AI 버블은 `role:"model"`.
- 다자 대화이므로 각 user turn 앞에 `「{username}」: ` 접두로 화자 구분(LLM API는 멀티 user 화자 개념이 약해 텍스트로 표기).
- 요약 버블은 새 세그먼트의 첫 `user` turn으로 "지금까지 요약: ..." 형태 주입(§6.3).
- **첨부 문서(FR-14)**: 선택된 커뮤니티 문서는 **활성 컨텍스트 턴들보다 앞에** `role:'user'` 턴으로 놓인다. 각 턴은 앱이 통제하는 라벨(`ai.document_context_prefix`, ko/en)로 시작해 "이건 참고 문서, 아래가 진행 중인 대화"를 구분한다. **문서 본문은 UGC이므로 systemInstruction에 절대 넣지 않는다**(XC-4). 본문은 발화 시점에 `GET /documents/:id`로 가져오며(목록 응답에는 본문이 없다), 일부 조회가 실패하면 그 문서만 빼고 답변을 계속한다(FR-14.7). 상한 3개(FR-14.3), `@AI` 경로 전용(FR-14.8).
- **멀티모달 이미지**: 컨텍스트 턴은 텍스트(`parts:[{text}]`)로만 매핑한다. 이미지는 **"그 호출에서 신규로 실리는" 한 장**만 user turn에 `inlineData`(base64) 파트로 덧붙는다 — ① `@AI` 댓글에 방금 업로드한 이미지(Composer), ② **글 작성 시 첨부한 이미지의 1차 AI 답변**(`runPrimaryReply`: 글 본문 텍스트 턴 뒤에 작성자 user turn으로 `Post.imageUrl`을 `inlineData`로 첨부). 과거 글/댓글의 이미지는 후속 호출에서 재전송하지 않는다(컨텍스트는 텍스트). 인코딩 실패 시 텍스트 only로 진행(답변을 막지 않음).

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
        a) 사용자 키로 LLM 요약 호출 (요약 프롬프트 + 현재 contents)
        b) [REST] AI_SUMMARY 버블 게시 → 서버가 새 세그먼트(N+1) 개시, 활성 전환
        c) 컨텍스트를 (요약문 + 방금 @AI 사람댓글)로 재조립
 4) [REST] AI_REPLY 버블 PENDING 게시 (replyToId=사람댓글) → 즉시 좌측에 "…로딩"
 5) 사용자 키로 LLM generateContent (systemInstruction=persona, contents=조립결과)
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
- 각 버블 게시 시 `tokenCount` 산정: 1순위 LLM `countTokens`(정확, 키 필요), 폴백 `Math.ceil(chars/4)`.
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
- 재연결: `Last-Event-ID`(=마지막 seq)로 누락분 재생.
- **다중 인스턴스(구현됨, 2026-07-27)**: pub/sub이 `PubSub` 인터페이스(`subscribe`/`publish`)로 분리되어 두 구현이 존재한다 — `InMemoryPubSub`(기본, 프로세스 로컬)과 `RedisPubSub`(채널 `aidit:post:<postId>`). `REDIS_URL` 환경변수가 있으면 후자가 선택되며 **쓰기 경로(`publish.ts`)와 SSE 엔드포인트(`stream.ts`)는 무변경**이다. 상세는 §15.2.

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
 │                 langStore.ts  ← NEW (§14)
 ├─ api/           rest.ts(서버), llm.ts(BYOK 호출·countTokens·요약)
 ├─ engine/        contextEngine.ts (manager.py 포팅: 조립·128K 판정·요약 오케스트레이션)
 ├─ stream/        useThreadStream.ts (EventSource 구독·재생)
 ├─ i18n/          dicts/<namespace>.ts, index.ts, useT.ts, tn.ts  ← NEW (§14)
 ├─ pages/         Home, Community, Thread, CreatePost, CreateCommunity, Login
 └─ components/    PostCard, ChatBubble(left/right/ai/summary), Composer, PersonaBadge
                   LangToggle.tsx  ← NEW (§14)
```
- `contextEngine.ts`가 §6 시퀀스를 오케스트레이션(서버 context 조회 → 임계 판정 → 요약 → 답변 → PATCH).
- 낙관적 UI: 사람 댓글 즉시 우측 표시, AI 버블 PENDING placeholder → 도착 시 교체.
- i18n 상세 설계(스토어·사전·훅·AI 언어 연동)는 **§14** 참조.

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
- **E2E(요청 매핑)**: J1(게시→1차 AI), J2(@AI), J3(128K→요약→요약기반 답변). LLM 제공자는 모킹/실키 양면.
- **수동 검증**: 두 브라우저로 같은 스레드, 좌/우 버블·실시간·요약색 확인.

---

## 13. 미해결/후속 결정

- username 고유성 강도(선점 vs 표시명) — PoC는 `@unique` upsert, 도용 방지는 후속.
- 토큰 카운팅 정확도 vs `countTokens` 호출 비용/지연 트레이드오프.
- 요약 품질 평가 루프(요약이 사실 보존하는지) — 후속 자동평가.
- ~~모델 ID 확정~~ → **`gemini-3.1-flash-lite` 로 확정(PoC).**
- ~~라이선스 불일치~~ → **MIT 기준으로 확정.**
- ~~localStorage 키 XSS~~ → **CSP `connect-src` Google 도메인 제한으로 exfiltration 차단, PoC 수용 리스크로 확정(§8).**
- **로케일 기본값**: 첫 방문 시 `navigator.language`가 `'ko'`로 시작하면 한국어, 아니면 영어. 명시적 선택은 `localStorage('aidit-lang')`에 영구 저장, 브라우저 기본값을 덮어쓴다(§14).

---

## 14. 다국어 (i18n)

> SoT: 이 섹션. 연관 PLAN 마일스톤: M17. 지원 로케일: **`ko`(한국어) · `en`(영어)**. 외부 i18n 라이브러리 없음 — 경량 커스텀 구현.
> URL/라우트 변경 없음(state-based, option a). UGC(글·댓글·커뮤니티명·사용자명)는 번역 대상 아님 — UI 크롬과 AI 지시문만.

### 14.1 언어 스토어 (`src/stores/langStore.ts`)

`authStore.ts`의 `persist + onRehydrateStorage` 패턴을 그대로 따른다.

```ts
// src/stores/langStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'ko' | 'en';

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set, get) => ({
      lang: navigator.language.startsWith('ko') ? 'ko' : 'en',
      setLang: (l) => {
        set({ lang: l });
        document.documentElement.lang = l;
      },
      toggle: () => get().setLang(get().lang === 'ko' ? 'en' : 'ko'),
    }),
    {
      name: 'aidit-lang',
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.lang = state.lang;
      },
    }
  )
);
```

- **`name: 'aidit-lang'`** — localStorage 키. 리하이드레이션 즉시 `document.documentElement.lang` 동기화.
- 명시적 선택(`setLang`)은 브라우저 기본값(`navigator.language`)을 영구 덮어쓴다.
- 비 React 코드에서 현재 언어를 읽을 때는 `useLangStore.getState().lang` 사용(훅 호출 불가 환경).

### 14.2 사전 구조 (`src/i18n/`)

```
src/i18n/
 ├─ dicts/
 │   ├─ common.ts      // 범용: 버튼, 레이블, 날짜 포맷 등
 │   ├─ auth.ts        // 로그인/회원가입 화면
 │   ├─ post.ts        // 글 작성·목록·상세
 │   ├─ community.ts   // 커뮤니티 생성·검색
 │   ├─ thread.ts      // 스레드 채팅 버블·컴포저
 │   ├─ profile.ts     // 프로필·설정 화면
 │   └─ errors.ts      // LLM/네트워크 오류 메시지
 ├─ index.ts           // DICTS 집계·재수출
 ├─ useT.ts            // React 컴포넌트용 훅
 └─ tn.ts              // 비 React 모듈용 함수
```

**네임스페이스 파일 형태** (예: `thread.ts`):

```ts
// src/i18n/dicts/thread.ts
export const thread = {
  ko: {
    composerPlaceholder: '@AI 또는 댓글을 입력하세요…',
    aiPending: 'AI가 답변 중…',
    summaryLabel: '대화 요약',
  },
  en: {
    composerPlaceholder: 'Type @AI or a comment…',
    aiPending: 'AI is thinking…',
    summaryLabel: 'Conversation summary',
  },
} as const;
```

- 플레이스홀더 보간은 `{name}` `{count}` 스타일. 예: `'게시물 {count}개'`.
- 모든 네임스페이스 객체는 `as const`로 타입 추론 보장.

**`src/i18n/index.ts`**:

```ts
import { common } from './dicts/common';
import { auth } from './dicts/auth';
import { post } from './dicts/post';
import { community } from './dicts/community';
import { thread } from './dicts/thread';
import { profile } from './dicts/profile';
import { errors } from './dicts/errors';

export const DICTS = { common, auth, post, community, thread, profile, errors } as const;
export type { Lang } from '../stores/langStore';
```

### 14.3 해석 함수

#### `src/i18n/useT.ts` — React 컴포넌트용

```ts
// src/i18n/useT.ts
import { useLangStore } from '../stores/langStore';
import { DICTS, type Lang } from './index';

export function useT() {
  const lang = useLangStore((s) => s.lang);

  return function t(key: string, vars?: Record<string, string | number>): string {
    const [ns, sub] = key.split(/\.(.+)/);          // 첫 점에서만 분리
    const dict = (DICTS as Record<string, Record<Lang, Record<string, string>>>)[ns];
    const value = dict?.[lang]?.[sub] ?? dict?.['ko']?.[sub] ?? key;

    if (import.meta.env.DEV && value === key) {
      console.warn(`[i18n] missing key: "${key}" (lang=${lang})`);
    }

    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  };
}
```

- 키 해석 순서: `DICTS[ns][lang][sub]` → `DICTS[ns].ko[sub]`(한국어 폴백) → 원시 키.
- `t`는 항상 `string`을 반환한다(undefined 없음).
- DEV 환경에서 누락 키 `console.warn`.

#### `src/i18n/tn.ts` — 비 React 모듈용

```ts
// src/i18n/tn.ts
import { useLangStore } from '../stores/langStore';
import { DICTS, type Lang } from './index';

export function tn(key: string, vars?: Record<string, string | number>): string {
  const lang = useLangStore.getState().lang;   // 훅 없이 스토어 직접 읽기
  const [ns, sub] = key.split(/\.(.+)/);
  const dict = (DICTS as Record<string, Record<Lang, Record<string, string>>>)[ns];
  const value = dict?.[lang]?.[sub] ?? dict?.['ko']?.[sub] ?? key;

  if (import.meta.env.DEV && value === key) {
    console.warn(`[i18n] missing key: "${key}" (lang=${lang})`);
  }

  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
```

- `stores/`, `engine/`, `lib/` 등 React 훅을 호출할 수 없는 모듈에서 사용.
- 해석 로직은 `useT` 내부 `t`와 동일하다.

### 14.4 `LangToggle` 컴포넌트 (`src/components/LangToggle.tsx`)

헤더와 프로필/설정 화면 양쪽에 배치 가능한 `[ KO | EN ]` 세그먼트 컨트롤.

```ts
// src/components/LangToggle.tsx
import { useLangStore, type Lang } from '../stores/langStore';

interface Props { variant?: 'header' | 'setting'; }

export function LangToggle({ variant = 'header' }: Props) {
  const { lang, setLang } = useLangStore();
  const options: Lang[] = ['ko', 'en'];

  return (
    <span className={variant === 'header' ? 'flex items-center gap-0' : 'flex items-center gap-1'}>
      {options.map((l, i) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={[
            'px-1.5 py-0.5 text-xs font-mono uppercase tracking-widest transition-colors',
            lang === l
              ? 'text-term-amber'
              : 'text-term-dim hover:text-term-bright',
          ].join(' ')}
          aria-pressed={lang === l}
        >
          {i === 0 && <span className="text-term-dim mr-0.5">[</span>}
          {l.toUpperCase()}
          {i === options.length - 1 && <span className="text-term-dim ml-0.5">]</span>}
          {i < options.length - 1 && <span className="text-term-dim mx-0.5">|</span>}
        </button>
      ))}
    </span>
  );
}
```

- **활성 언어**: `text-term-amber`. **비활성**: `text-term-dim hover:text-term-bright`. 기존 AppLayout 버튼 스타일 준수.
- `variant='header'`: 상단바 오른쪽 끝 배치. `variant='setting'`: 프로필 설정 행 안에 배치.
- `aria-pressed`로 접근성 상태 표현.

### 14.5 AI 언어 연동 (`src/engine/contextEngine.ts`)

> **XC-4 불변 조건 유지**: `systemInstruction`에는 `personaPrompt`(커뮤니티 설정) + 아래 앱 제어 지시문만 들어간다. 사용자 댓글·UGC는 절대 `systemInstruction`으로 올라가지 않는다.

#### 14.5.1 언어 지시문 삽입

`buildLlmRequest` 함수 안에서 최종 `systemInstruction`을 조립할 때:

```ts
const lang = useLangStore.getState().lang;
const langDirective = lang === 'en'
  ? 'Respond in English.'
  : '반드시 한국어로 답변하세요.';

// personaPrompt가 있을 때만 systemInstruction 구성
const parts = [persona?.trim(), langDirective].filter(Boolean);
systemInstruction = parts.length > 0
  ? { parts: [{ text: parts.join('\n\n') }] }
  : undefined;
```

- `persona` 빈 문자열이면 지시문 단독으로 `systemInstruction` 구성.
- `persona`와 지시문 사이는 빈 줄 두 개(`\n\n`)로 구분.

#### 14.5.2 `SUMMARY_DIRECTIVE` 언어 분기

`contextEngine.ts` 상단의 `SUMMARY_DIRECTIVE` 상수를 언어별 맵으로 변환:

```ts
// 기존 단일 상수 → 언어별 맵
const SUMMARY_DIRECTIVE: Record<Lang, string> = {
  ko: '이 토론의 사실·결정·미해결 질문을 충실히 보존해 요약하세요. 새 질문에 답하기 위한 컨텍스트로 쓰일 것입니다.',
  en: 'Summarise this discussion, faithfully preserving all facts, decisions, and open questions. The result will be used as context for answering new questions.',
};
```

`ensureSummary` 호출 시:

```ts
const lang = useLangStore.getState().lang;
const summaryPrompt = SUMMARY_DIRECTIVE[lang];
```

#### 14.5.3 오류 메시지 언어 분기 (`src/api/llm.ts`)

기존 `USER_MESSAGES` 레코드(고정 한국어 문자열)를 언어별 맵으로 전환:

```ts
// src/i18n/dicts/errors.ts 에 정의하고 tn()으로 참조
export const errors = {
  ko: {
    invalidKey:   '키를 확인하세요. (401/403)',
    quota:        '쿼터 초과 — 잠시 후 재시도하세요. (429)',
    networkError: '네트워크 오류 — 재시도 중…',
    aiFailed:     'AI 답변 생성에 실패했습니다.',
  },
  en: {
    invalidKey:   'Check your API key. (401/403)',
    quota:        'Quota exceeded — please retry in a moment. (429)',
    networkError: 'Network error — retrying…',
    aiFailed:     'Failed to generate AI response.',
  },
} as const;
```

`llm.ts`와 `contextEngine.ts`의 하드코딩 한국어 오류 문자열을 `tn('errors.<key>')` 호출로 교체.

### 14.6 날짜·숫자 로케일

날짜와 숫자를 렌더링하는 모든 컴포넌트에서 `Intl` API를 사용한다:

```ts
// 날짜 예시
new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
  year: 'numeric', month: 'short', day: 'numeric'
}).format(new Date(createdAt))
```

- `lang` 값은 `useLangStore`에서 구독.
- 숫자(추천 수, 댓글 수)는 `Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US').format(n)`.

### 14.7 설계 제약 및 비결정 사항

| 항목 | 결정 |
|------|------|
| URL/라우트 변경 | **없음** — state-based(option a). `/en/` 라우트, `?lang=` 쿼리 파라미터 모두 미도입. |
| 지원 로케일 | **`ko`, `en` 2개**로 고정(PoC). 3번째 로케일은 `DICTS` 타입 확장으로 대응 가능. |
| UGC 번역 | **없음** — 글·댓글·커뮤니티명·사용자명은 입력 언어 그대로 표시. |
| DB 모델 변경 | **없음** — 로케일 선택은 클라이언트 localStorage에만 저장. 서버·DB 스키마 무변경. |
| 외부 i18n 라이브러리 | **미사용** — `react-i18next`, `lingui` 등 없음. 커스텀 경량 구현(§14.2–14.3). |
| SSR/SEO | PoC는 CSR 전용 — `<html lang>` 동기화로 최소 접근성만 충족. |
| XC-4 불변 조건 | `systemInstruction`에 UGC 미포함 원칙 유지. 언어 지시문은 앱 제어 텍스트이므로 허용. |

---

## 15. 수평 확장 (Postgres · Redis pub/sub)

> 목적: "단일 인스턴스 PoC"라는 구조적 한계를 **코드 경로로** 제거한다. 애플리케이션 로직(라우트·SSE 엔드포인트·쓰기 경로)은 한 줄도 분기하지 않고, DB provider와 pub/sub 백엔드만 환경변수로 교체된다.

### 15.1 DB — SQLite(개발/테스트) ↔ Postgres(운영)

Prisma는 `datasource.provider`에 `env()`를 허용하지 않으므로 **파일 2개 + 파생 스크립트** 구조를 쓴다.

| 파일/스크립트 | 역할 |
|---|---|
| `backend/prisma/schema.prisma` | **단일 편집 지점(SoT)**. provider = `sqlite`. 개발·테스트가 이걸 쓴다. |
| `backend/prisma/schema.postgres.prisma` | **파생물(생성됨, 손으로 고치지 않는다)**. datasource 블록만 `postgresql`로 치환된 사본. |
| `backend/scripts/sync-postgres-schema.mjs` | SoT → 파생 스키마 재생성. 헤더에 "생성됨" 배너를 박아 수동 편집을 막는다. |
| `npm run db:pg:sync` | 위 스크립트 실행. |
| `npm run db:pg:ddl` | `prisma migrate diff`로 **Postgres DDL을 서버 없이** 생성 → `prisma/postgres/init.sql`(213줄, enum·TIMESTAMP(3)·FK 포함). 리뷰 가능한 산출물. |
| `npm run db:pg:push` | 실제 Postgres에 스키마 적용(`prisma db push`). |
| `npm run db:pg:generate` | Postgres 스키마로 Prisma 클라이언트 생성. |
| `npm run db:pg:check` | 파생 스키마가 최신인지 검사 — 드리프트면 비영점 종료(**자체 서버 배포 파이프라인의 게이트용**; GitHub Actions는 사용하지 않는다). |

> **왜 `migrate deploy`가 아니라 `db push`인가**: `prisma/migrations/`의 마이그레이션 SQL은 SQLite 문법으로 생성돼 있어 Postgres에 그대로 적용할 수 없다. Postgres 초기 구축은 생성된 `init.sql`(리뷰용) 또는 `db push`(실행용)로 하고, 이후 증분 변경은 `migrate diff`로 DDL을 뽑아 적용한다. Postgres 전용 마이그레이션 히스토리를 갖추는 것은 실제 운영 DB가 생기는 시점의 후속 작업이다.

- **드리프트 방지**: 모델을 SoT에만 추가하고 `db:pg:check`가 파생 스키마의 최신성을 강제한다. 두 파일의 모델 정의가 갈라지는 사고가 구조적으로 불가능하다.
- **운영 전환 절차**: `DATABASE_URL=postgresql://…` 설정 → `npm run db:pg:push` (스키마 적용) → `npm run db:pg:generate` (Postgres용 클라이언트 생성) → 앱 기동.
- **검증 상태(정직하게)**: DDL 생성(`init.sql`)은 실제로 수행·커밋되어 Postgres 문법 산출물이 존재한다. **살아있는 Postgres 인스턴스에 대한 런타임 검증은 아직 없다** — 배포 시 `db:pg:deploy` + 계약 테스트를 Postgres URL로 1회 실행하는 것이 남은 숙제다.

### 15.2 Pub/Sub — 인메모리 ↔ Redis

```
publish.ts (쓰기 경로)          stream.ts (SSE 엔드포인트)
        │                                │
        └────────► PubSub 인터페이스 ◄────┘
                    │            │
        InMemoryPubSub        RedisPubSub  (채널 aidit:post:<postId>)
        (기본)                (REDIS_URL 설정 시)
```

- **인터페이스**: `subscribe(postId, handler) => unsubscribe`, `publish(postId, event)`. **동기 시그니처를 유지**해 기존 호출자(2곳)를 수정하지 않는다.
- **`RedisPubSub`**: 의존성 추가 없이 `node:net` 위에 최소 RESP 인코더/디코더를 구현했다(구독용·발행용 소켓 2개 분리 — 구독 모드 소켓에서는 PUBLISH가 불가하므로). 지수 백오프 재연결, 재연결 시 활성 채널 **자동 재구독**을 포함한다.
- **직렬화**: `ThreadEvent`를 JSON으로 실어 보내고 수신 측에서 파싱해 로컬 핸들러에 디스패치한다. 즉 **SSE 프레임 직렬화(`serializeEvent`)는 각 인스턴스에서 수행**되며 와이어 계약(§7)은 불변이다.
- **장애 모드**: Redis 연결이 끊긴 동안의 이벤트는 **유실된다**(pub/sub은 큐가 아니다). 이는 설계상 허용 — 클라이언트가 `Last-Event-ID`로 재연결하면 DB 스냅샷 재생이 누락분을 복구한다(§7). 즉 **DB가 SoT, pub/sub은 가속기**다.
- **검증 상태**: `backend/test/pubsub.fanout.test.ts`가 테스트 프로세스 안에 **최소 RESP 브로커를 띄우고 `RedisPubSub` 인스턴스 2개(= 앱 인스턴스 2개)를 붙여**, A에서 publish한 이벤트를 B의 구독자가 수신하는 것을 검증한다. 같은 파일에서 `InMemoryPubSub`은 인스턴스 간 전달이 **안 되는 것**도 함께 검증해(어댑터가 왜 필요한지의 회귀 방어) 대비를 못박는다. 브로커 구현은 `backend/test/fakeRedis.ts`로 공유한다(§15.3 테스트와 동일 페이크). 실제 Redis 서버 대상 검증은 배포 환경에서 1회 수행이 남아 있다.

### 15.3 인스턴스 로컬 상태 제거 — 레이트리밋 · 업로드

pub/sub만 공유해도 **인스턴스 로컬 상태가 남아 있으면 "수평 확장 가능"은 거짓**이 된다. 남아 있던 두 곳을 정리한다.

**레이트리밋** — 기존 구현은 모듈 스코프 `Map`에 타임스탬프를 쌓는 프로세스 로컬 슬라이딩 윈도우였다. 2대로 띄우면 요청이 두 인스턴스로 분산되므로 identity당 실효 한도가 2배가 된다. 정책과 저장소를 분리한다: 정책(라우트→윈도우·최대치)은 `plugins/rateLimit.ts`, 카운터 위치는 `store/rateLimitStore.ts`.

| 구현 | 선택 조건 | 저장 형태 |
|---|---|---|
| `InMemoryRateLimitStore` | 기본(`REDIS_URL` 미설정) | `Map<key, {count, resetAt}>` |
| `RedisRateLimitStore` | `REDIS_URL` 설정 시 | 키당 카운터 — `INCR` + 첫 히트에만 `PEXPIRE` |

- **왜 슬라이딩이 아니라 고정 윈도우인가**: 처음엔 정확도를 위해 ZSET 슬라이딩 윈도우로 구현했다. 그런데 Redis에서 그 방식은 **read-then-act**(트림→카운트→판정→추가)라서 동시 요청들이 모두 "추가 전" 개수를 읽고 **전부 통과**한다 — 한도 2에 동시 3건이 모두 통과하는 것을 테스트로 재현했다. **막으려는 바로 그 버스트에서 조용히 한도를 넘는 리미터**는 거친 리미터보다 나쁘다. 그래서 두 백엔드를 고정 윈도우로 바꿨고, Redis 쪽은 `INCR`이 원자적이므로 **초과 허용이 구조적으로 불가능**하다.
- **대가(인지된 트레이드오프)**: 고정 윈도우는 경계에서 최대 2배 버스트를 허용한다(윈도우 끝에 max, 다음 윈도우 시작에 다시 max). 현 정책값에서는 수용 가능하며, "동시성에서 한도를 넘는 것"보다 낫다고 판단했다.
- **TTL은 첫 히트에만** 설정한다. 매 히트마다 `PEXPIRE`를 걸면 리셋 시점이 계속 밀려 계속 요청하는 클라이언트는 새 윈도우를 영원히 못 받는다. TTL이 유실된 키(`PTTL` = -1)는 영구 차단 대신 윈도우를 다시 걸어 복구한다.
- 두 구현의 의미를 **일부러 같게** 뒀다. 환경에 따라 경계 허용량이 달라지면 "왜 로컬에선 안 걸리는데 운영에선 걸리나"를 설명할 수 없다.
- **판정 실패 시 개방(fail-open)**: Redis가 죽으면 429를 남발하는 대신 통과시키고 경고를 남긴다. 레이트리밋은 인증·검증 뒤에 있는 보조 방어선이다.
- 정책값은 불변: 글 10/분, 업로드 20/분, 문서 응결 3/5분, 커뮤니티 생성 1/3분. 키잉도 불변(JWT `sub` 우선, 없으면 IP).
- **RESP 재사용**: 코덱은 `redis/resp.ts`(`encodeCommand`/`RespParser`/`RedisConnection`/`parseRedisUrl`), 응답 상관관계가 필요한 명령은 `redis/client.ts`(`RedisCommandClient`). RESP2는 요청 id가 없고 응답이 전송 순서대로 오므로 **FIFO 리졸버 큐**로 상관시키며, 타임아웃된 명령은 큐에서 제거하지 않고 `dead` 플래그만 세운다 — 제거하면 늦게 도착한 응답이 **다음 명령의 응답으로 오인**된다.
- **검증**: `backend/test/rateLimitStore.test.ts` 16건 — 두 백엔드 동일 동작, **Redis 2 인스턴스가 한 예산 공유**, 동시 요청 초과 허용 없음(위 결함 회귀 방어), 인메모리는 인스턴스 간 공유되지 않음(어댑터 필요성), 윈도우 만료 복구, 명령 수(첫 히트 `INCR`+`PEXPIRE`, 이후 `INCR`만), TTL 유실 복구, Redis 불가 시 fail-open.

**업로드** — `STORAGE_BACKEND=local`은 이미지를 그 인스턴스의 디스크에 쓰므로 다른 인스턴스가 서빙할 수 없다. **다중 인스턴스에서는 `STORAGE_BACKEND=s3`가 필수**이며(코드는 이미 지원), `REDIS_URL`이 설정된 채 `local`이면 기동 시 경고를 출력한다(`config.ts`).

> 정리하면 다중 인스턴스 구성의 요구사항은 **`DATABASE_URL`=Postgres · `REDIS_URL` 설정 · `STORAGE_BACKEND=s3`** 세 가지다. 하나라도 빠지면 그 축의 상태가 인스턴스에 묶인다.
