# Aidit

> 여러 사람이 **하나의 AI 컨텍스트를 공유**하며 협업하는 Reddit형 커뮤니티 모바일 웹 (PWA).

각 게시글이 채팅방형 댓글 스레드를 열고, 여러 사용자가 스레드마다 하나의 공유 AI 컨텍스트를 함께 쌓아갑니다. 트리형 댓글이 아니라 **글 하나 = 누적 대화 하나**이며, 커뮤니티가 정의한 페르소나를 가진 AI가 그 누적 위에서 함께 토론에 참여합니다. 모든 LLM 호출은 **BYOK(Bring Your Own Key)** — 브라우저가 사용자 본인 키로 Google Gemini를 직접 호출하며, Aidit 서버는 키를 보거나 저장하거나 중계하지 않습니다 (key-blind).

**설계 목표**
- **서버 LLM 비용 0** — 추론 비용·키는 전적으로 사용자 본인이 부담(BYOK). 서버는 텍스트 CRUD와 실시간 중계만 담당한다.
- **키 노출 면적 최소화** — 키는 브라우저 localStorage에만 머물고 Google로만 직접 전송된다. 어떤 요청 바디·헤더·로그·DB에도 남지 않는다.
- **무한히 이어지는 스레드** — 컨텍스트가 한도(128K 토큰)에 차면 자동 요약으로 압축되어 대화가 영원히 계속될 수 있다.
- **마찰 없는 진입** — 기본은 회원가입 없는 게스트 모드(닉네임만)로, 누구나 곧바로 읽고 쓸 수 있다.

## 핵심 차별점

1. **공유 AI 컨텍스트** — 하나의 글 스레드 = 하나의 누적 대화. 모두의 댓글이 같은 컨텍스트를 형성하고, `@AI`는 그 누적 위에서 답합니다.
2. **커뮤니티별 AI 페르소나** — 커뮤니티 생성자가 정의한 페르소나가 모든 AI 호출의 system instruction이 됩니다.
3. **BYOK** — 서버는 LLM 키를 보유/대납하지 않습니다 (서버 LLM 비용 0).
4. **무한 대화의 자동 요약** — 활성 컨텍스트가 128K 토큰을 넘으면 다음 `@AI` 호출자의 키로 지연 요약 버블이 생성됩니다.

## 주요 기능

- **커뮤니티** — 생성/검색, 커뮤니티별 AI 페르소나 + 아이콘, 생성자 편집(`✎ 편집`).
- **글** — 작성(이미지 첨부 가능) · **작성자 본인 편집**(제목/본문/이미지) · 추천(▲) · hot/new 피드(커서 페이지네이션).
- **채팅방형 스레드** — 원본 글 + 실시간 댓글 버블(SSE). 입력창의 **AI 토글**을 켜면 본인 키로 답변 버블 생성, 실패 시 재시도. AI/사람 버블은 **GFM 마크다운 렌더링**(표·코드·굵게, 넓은 표/코드는 버블 안에서만 가로 스크롤).
- **1차 AI 답변** — 글 작성 직후 작성자 키로 첫 AI 답변 자동 생성(옵션).
- **128K 자동 요약** — 임박 시 헤더 배지로 경고, 다음 `@AI` 호출자 키로 지연 요약.
- **북마크** — 🔖 토글(서버 영속) + 프로필 "북마크한 글" 모아보기.
- **이미지 첨부** — 글/댓글에 단일 이미지(멀티모달 — 1차 AI 답변에 inline 전달).
- **프로필(나)** — API 키(마스킹) 변경/삭제 · 로그아웃 · 내 커뮤니티/내 글/북마크(탭형 무한 스크롤).
- **Gemini 연결 표식** — 상단바 LED 배지가 가장 최근 LLM 쿼리의 성공/실패를 반영(연결/끊김/미확인).
- **진입 — 게스트 / 회원 (런타임 듀얼모드)** — 로그인 화면은 **[게스트] / [로그인]** 2탭. **닉네임(최대 16자)만** 입력하면 게스트로 즉시 입장하고 서버가 `#a3f9` 같은 식별자를 자동 부여한다. 비밀번호까지 입력하면 회원(신규 아이디=가입, 기존=로그인)으로 동작한다 — 모드 전환 설정 없이 입력만으로 갈린다. AI를 쓸 때만 본인 Gemini 키가 필요(키는 localStorage에만 저장). 세션은 JWT이며 앱을 열 때마다 슬라이딩 갱신(만료 = 마지막 활동 + 7일).

## 아키텍처

```
Browser (React PWA)  ──REST(텍스트만)──▶  Aidit Server (Node + Fastify + Prisma)
   │  GeminiClient (BYOK)                    CRUD · post별 SSE 릴레이 · 컨텍스트 경계 SoT
   └──────fetch 직접──────▶  Google Generative Language API
```

- **Backend** (`backend/`): Node 20 + Fastify + TypeScript + Prisma (SQLite PoC → Postgres). 서버는 key-blind.
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite + Zustand + TailwindCSS, PWA. 모바일 우선, 레트로 그린 인광 CRT 테마.
- **Realtime**: per-post SSE, `seq` 기반 재생 / `Last-Event-ID` 복구.
- **Context Engine**: 클라이언트 TS, 128K 지연 요약 + 세그먼트 경계.

## 빠른 시작

**사전 요구**: Node 20+, npm. 로그인 시 사용할 [Google AI Studio API 키](https://aistudio.google.com/apikey)(브라우저에만 저장, 서버 미전송).

```bash
# 1) Backend (포트 3001)
cd backend
cp .env.example .env          # DATABASE_URL="file:./dev.db", PORT=3001
npm install
npm run prisma:migrate        # dev.db 생성 + Prisma 클라이언트 생성
npm run dev

# 2) Frontend (포트 5173, /api → 3001 프록시)
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 → 로그인 화면 **[게스트]** 탭에서 닉네임만 입력하면 바로 사용. 회원으로 쓰려면 **[로그인]** 탭에서 아이디+비밀번호로 가입/로그인한다. AI 답변을 쓰려면 프로필(나) → 설정에서 Gemini 키를 등록한다.

## 스크립트

| 위치 | 명령 | 설명 |
|------|------|------|
| `backend/` | `npm run dev` | tsx watch 개발 서버(3001) |
| `backend/` | `npm run typecheck` | `tsc --noEmit` |
| `backend/` | `npm test` | vitest(계약/SSE/hotScore 테스트) |
| `backend/` | `npm run prisma:migrate` | 마이그레이션 적용 + 클라이언트 생성 |
| `backend/` | `npm run build` / `npm start` | 빌드 / `dist` 실행 |
| `frontend/` | `npm run dev` | Vite 개발 서버(5173) |
| `frontend/` | `npm run typecheck` | `tsc --noEmit` |
| `frontend/` | `npm test` | vitest(engine/store/sanitize 테스트) |
| `frontend/` | `npm run build` | 타입체크 + 프로덕션 빌드 |
| `frontend/` | `npm run e2e` | Playwright E2E |

## 보안 메모

**API 키 (key-blind / L1)**: Google AI Studio API 키는 **브라우저 localStorage에만** 저장되고, 호출 직전 메모리에서만 사용되어 Google로 직접 전송됩니다. 어떤 요청 바디/헤더/로그에도 키가 포함되지 않으며 Aidit 서버 DB에 저장되지 않습니다. `backend/.env`는 git 추적 대상이 아닙니다(`.env.example`만 커밋).

**인증 (JWT 기반)**: 인증 소스는 **오직 `Authorization: Bearer <token>` JWT 한 가지**이며, 서버는 **JWT_SECRET으로 토큰을 검증**해 사용자를 식별합니다. 위조 가능했던 이전의 `x-user-id` 헤더는 완전히 제거되었습니다. 게스트·회원 두 모드가 **런타임에 공존**하며, 진입 요청의 **비밀번호 유무**로 분기됩니다(모드 전환 설정 없음).

- **게스트(비밀번호 없음)**: `POST /auth/guest`가 닉네임만으로 비밀번호 없는 사용자(`passwordHash=null`)를 만들고 JWT를 발급합니다. `requireAuth`는 토큰의 `sub`만 검증하므로 게스트 토큰도 모든 쓰기 게이트를 동일하게 통과합니다. 비밀번호가 없는 게스트 신원은 토큰을 잃으면 복구할 수 없습니다.
- **회원(비밀번호 있음)**: 신규 아이디는 `POST /auth/register`, 기존 아이디는 `POST /auth/session`이 **bcrypt 비밀번호 검증 후 JWT**를 발급합니다.
- **공통**: `POST /auth/refresh`가 슬라이딩 갱신(만료 = 마지막 활동 + 7일). **프로덕션 배포 시 JWT_SECRET 환경 변수는 필수이며 강력한 난수값으로 설정**해야 합니다.

## GitHub Pages 배포(옵션 A)

프론트엔드는 **GitHub Pages 정적 호스팅**, 백엔드는 **외부 호스트(Render 등)** 에서 운영하는 분리 구조.

- **프론트엔드 빌드**: `VITE_API_ORIGIN=https://your-api.onrender.com npm run build` (또는 `.env`에 설정)
- **환경 변수**: `VITE_API_ORIGIN` (백엔드 origin, 끝 슬래시/`/api` suffix 제외) 설정 시 절대 URL로 API 호출; unset이면 dev 상대 경로 + Vite 프록시 사용
- **public/.nojekyll**: GitHub Pages Jekyll 처리 비활성화
- **404.html SPA 트릭**: 딥 링크 지원(rafryer.github.io/repo-name/posts/123 등)
- **CSP 자동화**: `vite.config.ts`가 빌드 시 `VITE_API_ORIGIN`을 CSP `connect-src` + `img-src`에 주입
- **CORS 허용**: 백엔드 `WEB_ORIGIN` env에 `https://username.github.io` 또는 `https://username.github.io/repo-name` 추가
- **서버 바인드**: 프로덕션에선 `HOST=127.0.0.1`로 로컬 인터페이스만 (LB/프록시 뒤)
- **인증**: `JWT_SECRET` env(토큰 서명, 강필수·난수값), `JWT_EXPIRES` env(선택, 기본 '7d'). 게스트·회원 모드는 런타임에 공존하므로 별도 모드 플래그가 없다.

**보안 게이트**: ✅ **CLOSED** — 모든 쓰기가 JWT(`Authorization: Bearer`)로만 인증되고 `x-user-id`는 폐기됨. 공개 배포 가능. (게스트는 비밀번호 없는 익명 진입이며, 회원 가입/로그인은 같은 화면의 [로그인] 탭에서 비밀번호 입력으로 이뤄진다.)

## 개발 문서

자세한 사양은 [`docs/`](./docs)를 참조하세요: [PRD](./docs/PRD.md) · [TRD](./docs/TRD.md)(REST API·스키마) · [PLAN](./docs/PLAN.md)(마일스톤 M1–M14) · [WIREFRAME](./docs/WIREFRAME.md) · [디자인 시스템](./docs/DESIGN-SYSTEM.md)(컬러·타이포·로고 자산 SoT) · [구현 노트](./docs/IMPLEMENTATION_NOTES.md)(실제 구현 차이·추가·버그 수정·실행 방법).

## License

[MIT](./LICENSE)
