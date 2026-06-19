# Aidit

> 여러 사람이 **하나의 AI 컨텍스트를 공유**하며 협업하는 Reddit형 커뮤니티 모바일 웹 (PWA).

각 게시글이 채팅방형 댓글 스레드를 열고, 여러 사용자가 스레드마다 하나의 공유 AI 컨텍스트를 함께 쌓아갑니다. 모든 LLM 호출은 **BYOK(Bring Your Own Key)** — 브라우저가 사용자 본인 키로 Google Gemini를 직접 호출하며, Aidit 서버는 키를 보거나 저장하거나 중계하지 않습니다 (key-blind).

## 핵심 차별점

1. **공유 AI 컨텍스트** — 하나의 글 스레드 = 하나의 누적 대화. 모두의 댓글이 같은 컨텍스트를 형성하고, `@AI`는 그 누적 위에서 답합니다.
2. **커뮤니티별 AI 페르소나** — 커뮤니티 생성자가 정의한 페르소나가 모든 AI 호출의 system instruction이 됩니다.
3. **BYOK** — 서버는 LLM 키를 보유/대납하지 않습니다 (서버 LLM 비용 0).
4. **무한 대화의 자동 요약** — 활성 컨텍스트가 128K 토큰을 넘으면 다음 `@AI` 호출자의 키로 지연 요약 버블이 생성됩니다.

## 주요 기능

- **커뮤니티** — 생성/검색, 커뮤니티별 AI 페르소나 + 아이콘, 생성자 편집(`✎ 편집`).
- **글** — 작성(이미지 첨부 가능) · **작성자 본인 편집**(제목/본문/이미지) · 추천(▲) · hot/new 피드(커서 페이지네이션).
- **채팅방형 스레드** — 원본 글 + 실시간 댓글 버블(SSE). `@AI` 멘션 시 본인 키로 답변 버블 생성, 실패 시 재시도.
- **1차 AI 답변** — 글 작성 직후 작성자 키로 첫 AI 답변 자동 생성(옵션).
- **128K 자동 요약** — 임박 시 헤더 배지로 경고, 다음 `@AI` 호출자 키로 지연 요약.
- **북마크** — 🔖 토글(서버 영속) + 프로필 "북마크한 글" 모아보기.
- **이미지 첨부** — 글/댓글에 단일 이미지(멀티모달 — 1차 AI 답변에 inline 전달).
- **프로필(나)** — API 키(마스킹) 변경 · 로그아웃 · 내 커뮤니티/내 글/북마크.
- **Gemini 연결 표식** — 상단바 LED 배지가 가장 최근 LLM 쿼리의 성공/실패를 반영(연결/끊김/미확인).
- **로그인** — username + Google AI Studio 키, 모달 오버레이. 키는 localStorage에만 저장.

## 아키텍처

```
Browser (React PWA)  ──REST(텍스트만)──▶  Aidit Server (Node + Fastify + Prisma)
   │  GeminiClient (BYOK)                    CRUD · post별 SSE 릴레이 · 컨텍스트 경계 SoT
   └──────fetch 직접──────▶  Google Generative Language API
```

- **Backend** (`server/`): Node 20 + Fastify + TypeScript + Prisma (SQLite PoC → Postgres). 서버는 key-blind.
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite + Zustand + TailwindCSS, PWA. 모바일 우선, 레트로 그린 인광 CRT 테마.
- **Realtime**: per-post SSE, `seq` 기반 재생 / `Last-Event-ID` 복구.
- **Context Engine**: 클라이언트 TS, 128K 지연 요약 + 세그먼트 경계.

## 빠른 시작

**사전 요구**: Node 20+, npm. 로그인 시 사용할 [Google AI Studio API 키](https://aistudio.google.com/apikey)(브라우저에만 저장, 서버 미전송).

```bash
# 1) Backend (포트 3001)
cd server
cp .env.example .env          # DATABASE_URL="file:./dev.db", PORT=3001
npm install
npm run prisma:migrate        # dev.db 생성 + Prisma 클라이언트 생성
npm run dev

# 2) Frontend (포트 5173, /api → 3001 프록시)
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 → 우상단 `[ Login ]`으로 username + Gemini 키 입력 후 사용.

## 스크립트

| 위치 | 명령 | 설명 |
|------|------|------|
| `server/` | `npm run dev` | tsx watch 개발 서버(3001) |
| `server/` | `npm run typecheck` | `tsc --noEmit` |
| `server/` | `npm test` | vitest(계약/SSE/hotScore 테스트) |
| `server/` | `npm run prisma:migrate` | 마이그레이션 적용 + 클라이언트 생성 |
| `server/` | `npm run build` / `npm start` | 빌드 / `dist` 실행 |
| `frontend/` | `npm run dev` | Vite 개발 서버(5173) |
| `frontend/` | `npm run typecheck` | `tsc --noEmit` |
| `frontend/` | `npm test` | vitest(engine/store/sanitize 테스트) |
| `frontend/` | `npm run build` | 타입체크 + 프로덕션 빌드 |
| `frontend/` | `npm run e2e` | Playwright E2E |

## 보안 메모 (key-blind / L1)

Google AI Studio API 키는 **브라우저 localStorage에만** 저장되고, 호출 직전 메모리에서만 사용되어 Google로 직접 전송됩니다. 어떤 요청 바디/헤더/로그에도 키가 포함되지 않으며 Aidit 서버 DB에 저장되지 않습니다. `server/.env`는 git 추적 대상이 아닙니다(`.env.example`만 커밋).

## 개발 문서

자세한 사양은 [`docs/`](./docs)를 참조하세요: [PRD](./docs/PRD.md) · [TRD](./docs/TRD.md)(REST API·스키마) · [PLAN](./docs/PLAN.md)(마일스톤 M1–M12) · [WIREFRAME](./docs/WIREFRAME.md) · [디자인 시스템](./docs/DESIGN-SYSTEM.md)(컬러·타이포·로고 자산 SoT) · [구현 노트](./docs/IMPLEMENTATION_NOTES.md)(실제 구현 차이·추가·버그 수정·실행 방법).

## License

[MIT](./LICENSE)
