# Aidit

> 여러 사람이 **하나의 AI 컨텍스트를 공유**하며 협업하는 Reddit형 커뮤니티 모바일 웹 (PWA).

각 게시글이 채팅방형 댓글 스레드를 열고, 여러 사용자가 스레드마다 하나의 공유 AI 컨텍스트를 함께 쌓아갑니다. 모든 LLM 호출은 **BYOK(Bring Your Own Key)** — 브라우저가 사용자 본인 키로 Google Gemini를 직접 호출하며, Aidit 서버는 키를 보거나 저장하거나 중계하지 않습니다 (key-blind).

## 핵심 차별점

1. **공유 AI 컨텍스트** — 하나의 글 스레드 = 하나의 누적 대화. 모두의 댓글이 같은 컨텍스트를 형성하고, `@AI`는 그 누적 위에서 답합니다.
2. **커뮤니티별 AI 페르소나** — 커뮤니티 생성자가 정의한 페르소나가 모든 AI 호출의 system instruction이 됩니다.
3. **BYOK** — 서버는 LLM 키를 보유/대납하지 않습니다 (서버 LLM 비용 0).
4. **무한 대화의 자동 요약** — 활성 컨텍스트가 128K 토큰을 넘으면 다음 `@AI` 호출자의 키로 지연 요약 버블이 생성됩니다.

## 아키텍처

```
Browser (React PWA)  ──REST(텍스트만)──▶  Aidit Server (Node + Fastify + Prisma)
   │  GeminiClient (BYOK)                    CRUD · post별 SSE 릴레이 · 컨텍스트 경계 SoT
   └──────fetch 직접──────▶  Google Generative Language API
```

- **Backend** (`server/`): Node 20 + Fastify + TypeScript + Prisma (SQLite PoC → Postgres). 서버는 key-blind.
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite + Zustand + TailwindCSS. 모바일 우선.
- **Realtime**: per-post SSE, `seq` 기반 재생 / `Last-Event-ID` 복구.
- **Context Engine**: 클라이언트 TS, 128K 지연 요약 + 세그먼트 경계.

## 개발

자세한 사양은 [`docs/`](./docs)를 참조하세요: [PRD](./docs/PRD.md) · [TRD](./docs/TRD.md) · [PLAN](./docs/PLAN.md) · [WIREFRAME](./docs/WIREFRAME.md).

```bash
# Backend
cd server && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## License

[MIT](./LICENSE)
