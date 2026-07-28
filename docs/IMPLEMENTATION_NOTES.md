# Aidit — 구현 노트 (IMPLEMENTATION_NOTES.md)

> 관련 문서: [PRD.md](./PRD.md), [TRD.md](./TRD.md), [PLAN.md](./PLAN.md), [WIREFRAME.md](./WIREFRAME.md)
> 상태: M1–M19 구현 완료 · 최초 작성 2026-06-17 · 최종 수정 2026-07-28 (E2E 실행 경로 복구 — 5스펙 10케이스 전부 통과)
> 이 문서는 **실제 구현 결과**가 스펙(PRD/TRD/PLAN) 대비 어떻게 확정·추가·변경되었는지, 그리고 개발 중 발견·수정한 버그를 기록한다. 스펙 문서가 "권장/미확정"으로 남긴 항목의 **확정값**과, 통합 과정에서 추가한 소소한 보조 자산을 포함한다.

---

## 변경 이력 (Changelog)

> 최신 항목이 맨 위. 태그: **[feat]** 기능 추가 · **[fix]** 버그 수정 · **[test]** 테스트 · **[docs]** 문서 · **[chore]** 설정. 각 항목은 상세 절(§)을 가리킨다.

### 2026-07-28 (10)
- **[fix]** **E2E 실행 경로 복구 — J1~J3·실키 스펙이 "미실행"이 아니라 **깨져 있었다** (5스펙 10케이스 전부 통과)**: 지금까지 hermetic한 J4/J5 6건만 통과 확인했고 나머지는 "라이브 스택이 필요해 미실행"으로 적어 왔다. 실제로 라이브 스택을 띄워 돌려보니 **미실행이 아니라 실패**였다. 원인 6개를 전부 잡았다.
  - **① 자체 기동이 포트를 하드코딩**: `webServer`가 `localhost:3001/health`를 기다리는데 이 환경의 `backend/.env`는 `PORT=3002`다 → 두 서버가 모두 정상인데 `Timed out waiting 60000ms from config.webServer`로 죽었다. **`backend/.env`의 `PORT`를 읽어 파생**하고(`AIDIT_E2E_API_PORT`로 덮어쓰기 가능), Vite의 `/api` 프록시 타깃도 같은 값으로 주입하도록 고쳤다.
  - **② IPv6 함정**: 백엔드는 `HOST=127.0.0.1`(IPv4 전용)로 바인딩하는데 `localhost`는 `::1`로 먼저 해석돼 헬스 프로브가 60초 내내 `ECONNREFUSED ::1:3002`를 받았다(curl은 IPv4로 폴백해서 사람 눈에는 정상으로 보인다). 프로브·프록시 타깃을 **`127.0.0.1` 명시**로 바꿨다.
  - **③ `tsx watch`가 Playwright 아래에서 포트를 열지 않음**: npm 배너만 찍고 60초간 리슨하지 않았다(직접 띄우면 3초). 워처는 테스트 하니스에 필요도 없으므로 **`backend: npm run dev:once`(`tsx src/app.ts`) 신설**해 사용한다.
  - **④ 로그인 헬퍼가 게스트 모드를 몰랐다**: `#username`을 무조건 채웠는데 기본 설정(`AUTH_SIGNUP_REQUIRED=false`)의 게스트 탭은 `#nickname`이다 → J1~J3가 30초 타임아웃(`waiting for locator('#username')`). **두 모드를 모두 처리**하도록 고쳤다. 덧붙여 Playwright 브라우저 로케일이 en-US여서 한국어 셀렉터가 전부 빗나갔다 → `login()`이 **`aidit-lang`을 ko로 고정**(j4가 쓰던 방식과 동일).
  - **⑤ 시드 경로가 인증 변경을 못 따라갔다**: `seedOverThreshold`가 `x-user-id`만 보내 **401**. 쓰기 라우트는 `Authorization: Bearer <token>`을 요구하므로 스토어의 JWT를 읽어 함께 보낸다(`getAuthToken` 신설).
  - **⑥ 스타일 결합 + strict mode 2건**: J3가 요약 밴드를 `.bg-gradient-to-r` 클래스로 단정했는데 터미널 리스타일에서 앰버 틴트로 바뀌어 실패 — **FR-7.4 경계 마이크로카피로 단정**하도록 교체(제품은 정상, 테스트가 스타일에 묶여 있었다). J2·실키 스펙은 `getByText`가 **버블과 Composer 텍스트에어리어 둘 다** 잡아 strict mode 위반 — Composer는 POST 성공 후에야 비워지므로(6.1.6) 잠깐 양쪽에 같은 텍스트가 존재한다 → 버블 `<p>`로 스코프를 좁혔다.
  - **실키 스펙도 갱신**: 자체 로그인 인라인 코드를 공용 헬퍼로 교체(모드·언어 대응), 커뮤니티 이름을 유니크화(서버가 이름 중복에 409), AI 렌더 단정을 `AI` 배지 → **모델 답변 본문 스니펫**으로 교체 — 그 배지는 `aria-hidden` + `hidden sm:inline`이라 이 스펙이 도는 Pixel 7 폭에서는 **설계상 안 보인다**(태블릿 폭에서만 통과할 수 있는 단정이었다).
  - **검증(실측)**: 콜드 스타트에서 `npm run e2e`가 스택을 스스로 띄워 **10/10 통과**(실키 스펙 포함), `./deploy/pipeline.sh --all` → **8게이트 전부 통과**. 실키 전 구간 재측정도 통과: 8회 호출 · 7,733 토큰 · 사용자 합계 $0.004333 · 서버 $0 · **키 유출 0건(API 요청 327건 전수 검사)** · 응결 문서 1건 · 공유 컨텍스트 `417→671→935→1,193` · FR-14 첨부 순증 `+646` prompt.

### 2026-07-28 (9)
- **[docs]** **`countTokens`가 "무료"라는 서술의 근거 범위를 정정 (TRD §5·§6.4)**: 보정 근거를 적으면서 코드 주석·스크립트·문서에 `countTokens is FREE`라고 단정해 뒀는데, 1차 문서를 다시 확인한 결과 **그 범위가 과했다.**
  - **확인된 것**: "There's no charge for calling `countTokens` (the Count Tokens API)" + "maximum quota … 3000 requests per minute (RPM)" — 출처는 **Vertex AI / Firebase AI Logic** 문서([링크](https://firebase.google.com/docs/vertex-ai/count-tokens)).
  - **확인되지 않은 것**: 우리가 실제로 호출하는 **Gemini Developer API**(`generativelanguage.googleapis.com`)의 [토큰 문서](https://ai.google.dev/gemini-api/docs/tokens)·[가격 문서](https://ai.google.dev/gemini-api/docs/pricing)에는 `countTokens` 과금 여부 서술이 **없다**. 즉 "토큰 요금이 붙지 않는다"는 근거는 있으나 해당 엔드포인트에 대한 1차 근거는 아니다.
  - **무료여도 공짜가 아니다**: `countTokens`는 **RPM 쿼터를 소비**한다. 이는 발화마다 호출하지 않기로 한 결정을 오히려 강화한다 — 댓글 한 건마다 부르면 사용자 키의 분당 한도를 생성 호출과 나눠 쓰게 되고, 서버는 key-blind라 대신 부를 수도 없다.
  - **서술 정정 범위**: `backend/src/domain/tokenEstimate.ts`, `frontend/src/api/llm.ts`, `backend/scripts/calibrate-token-estimate.mjs`, TRD §6.4, README "성능 실측 D" — "무료" → **"과금 없음(Vertex 문서 기준) · RPM 쿼터 소비 · Developer API 문서에는 미명시"** 로 좁히고 출처를 달았다. 동작 변경 없음.
  - **덧붙여 정정한 과잉 서술 2건**: ① 주석의 "런타임에 `countTokens`를 호출하지 않는다"는 **발화별 호출**에 대한 얘기였는데 전면 부정처럼 읽혔다 — 실제로는 **키당 1회 연결 프로브**(FR-8 `pingLlm`)로 호출한다. "발화마다 호출하지 않는다"로 정정. ② 프론트 `llm.ts` 주석에 1차 오류 시절 문구(`this repo's own corpus`)가 남아 바로 아래 정정 문단과 모순돼 있었다 → 제거. ③ TRD §5의 토큰 카운팅 항목이 여전히 폴백을 `chars/4`로 적고 있었다 → 현행 추정식으로 갱신.

### 2026-07-28 (8)
- **[fix]** **토큰 추정 계수 실측 보정 — `chars/4`가 한국어를 −58%까지 과소평가하던 결함 수정 (TRD §6.4)**: 128K 요약 트리거(FR-7)의 판정 기준이 잘못돼 있었다. **런타임 `countTokens` 호출은 채택하지 않고**(발화마다 API 왕복 추가, 서버는 key-blind), **무료인 `countTokens`를 오프라인 보정에만** 사용했다.
  - **실측(모델 `gemini-3.1-flash-lite`)**: 한국어 **1토큰 ≈ 1.7~1.9자**, 영어 **1토큰 ≈ 4.5~5.2자**. 기존 `ceil(chars/4)`는 앱 콘텐츠 **누적 합을 −39.4%**(최악 단일 **−58%**) 과소평가 → 임계가 한참 늦게 걸려 정책이 무력화. **정확도 문제가 아니라 결함**이다.
  - **보정 과정에서 한 번 틀렸다(기록 보존)**: 1차 적합은 **이 리포의 문서**(PRD·TRD·README·코드)를 코퍼스로 써서 `dense/0.9`가 나왔다. 그런데 추정기가 보는 텍스트는 문서가 아니라 **댓글·AI 답변·응결 문서**다. 측정해 보니 **대화체 한국어(~0.65 tok/dense자)와 기술 한국어+마크업(~1.0)의 밀도가 1.5배 다르고**, 문서 기준 계수를 앱 콘텐츠에 적용하면 **+34% 과대평가**가 났다. 보정 하니스를 만들어 돌린 뒤에야 드러났다 — **"무엇으로 보정하는가"가 계수 자체보다 중요하다**는 교훈.
  - **채택식**: `tokens ≈ ceil(dense/1.3 + rest/4.5)` (dense = 한글·CJK·가나). 앱 형태 10샘플 기준 **누적 −39.4% → +7.9%**, 최악 과소 −58% → **−3%**, 평균 절대 오차 44% → **9%**. 더 정확한 후보(`dense/1.4`, 누적 +1.0%)는 최악 과소가 −13%로 커져 탈락 — **과소평가는 정책을 조용히 넘기고, 과대평가는 요약을 조금 일찍 태울 뿐**이라 편향을 과대 방향으로 뒀다.
  - **구현**: 서버 `comments.ts`의 인라인 함수를 신규 `backend/src/domain/tokenEstimate.ts`로 추출(테스트 가능하게), 프론트 `api/llm.ts`의 `estimateTokens`도 동일 상수로 교체. 두 구현이 갈리면 서버 `tokenSum`과 클라 판단이 어긋난다는 경고를 양쪽 주석에 명시하고 TRD §6.4를 SoT로 지정.
  - **재보정 도구 상시화**: `backend/scripts/calibrate-token-estimate.mjs` + `npm run calibrate:tokens` — 앱 형태 샘플에 `countTokens`를 1회씩 호출해 **현재 추정기의 누적 오차**와 최소제곱 적합값을 출력하고, 오차가 음수(위험 방향)로 넘어가면 손보라고 안내한다. 모델 교체 시 필수 실행. 최종 확인: 누적 **+5.0%**.
  - **테스트**: 신규 `backend/test/tokenEstimate.test.ts` **7건** — `countTokens` 실측값을 **인라인 리터럴 픽스처**로 고정(초안에서 리포 문서를 슬라이스했는데, 문서가 바뀌면 실측값이 조용히 무효가 되므로 인라인으로 바꿨다), 한국어 과소평가 소멸·과대 방향 유지(상한)·**모든 개별 픽스처에서 `chars/4`보다 절대오차가 작음**을 단정. 프론트 `llm.test.ts`(7건)는 `chars/4` 단정을 걷어내고 한글 밀도 케이스 + **백엔드 공식과의 동기 검증**을 추가.
  - **문서**: TRD §6.4를 계수 SoT로 재작성(밀도 표·1차 오류 기록·후보 비교·재보정 절차), §13 미해결 항목 종결, PRD **FR-7.5 신설**, README **"성능 실측 D"** 신설.

### 2026-07-28 (7)
- **[docs]** **특허·논문에 FR-13/FR-14 반영**: 두 문서가 문서 응결·재투입을 다루지 않아 최신 구현과 어긋나 있었다. 선행기술을 실제로 조사해 근거를 붙였다(기존 문서의 강점이 인용 검증이므로 추측으로 채우지 않았다).
  - **선행기술 확인**: 응결 방향의 최근접은 **Slack AI**(채널·대화 요약 + 워크플로 `Summarize public channel` 산출물을 **Canvas 문서**로 기록), 재투입 방향의 최근접은 **Google NotebookLM**(업로드 출처를 RAG로 근거화, 인라인 인용). 두 요소기술 모두 **공지**임을 명시했다.
  - **PATENT.html**: 배경기술 **(6) 신설** — 위 두 서비스를 인용하고 상이점 3가지를 못박음(① 요약·문서화 추론이 운영자 자격증명으로 서버측 수행되어 비용이 운영자에 귀속(key-custody), ② 대상이 임계 세그먼트로 구획된 활성 컨텍스트가 아니고 출처(provenance) 보유가 없음, ③ 재투입 시 문서 본문을 데이터 역할 턴에만 배치하는 격리가 없음). **진보성 주장 지점을 요소기술이 아니라 "key-blind 다중 사용자 공유 컨텍스트 안에서 두 방향을 순환으로 닫으면서 비용 귀속·출처 보존·역할 격리를 동시 만족시키는 결합 구성"으로 정직하게 한정**했다. 해결하려는 과제 1항 추가, 발명의 효과 2행 추가, 실시예 **9(응결)·10(재투입)** 추가, **청구항 19~22**(응결·출처/버전·재투입 격리·순환/비용귀속) 추가.
  - **PAPER.html**: Related Work **II.E 신설**(위 선행기술 + 부재한 것), **IV.E/IV.F 신설**(응결·재투입의 설계와 non-interference), **VI.E 신설 — 실키 3개 실측 평가**(호출 종류별 표, 사용자별 귀속, 컨텍스트 성장 곡선 399→1,116, 첨부 순증 +794, 서버 요청 327건 키 유출 0). 그리고 **VI.D의 "The cost result is analytical, not measured"가 이제 사실이 아니므로 정정**했다(측정된 단일 세션이 추가됐고, 각본 세션이라 사용량 분포는 아님을 명시). References 3건 추가(Slack AI·NotebookLM·Gemini 단가).
  - **검증**: 브라우저 대신 구조 검증 스크립트로 두 파일의 태그 균형·문단 종료·삽입 내용·삭제 문장을 전수 확인(ALL STRUCTURAL CHECKS PASSED).
- **[fix]** **GitHub Pages 잔여물 제거**: 자체 서버 배포로 방향이 정해진 뒤 남아 있던 Pages 전용 자산을 정리했다.
  - **제거**: `frontend/public/404.html`, `frontend/public/.nojekyll`, `frontend/index.html`의 **딥링크 복원 스니펫**, `backend/src/app.ts`의 CORS 기본 허용 오리진 `https://littleanti.github.io`.
  - **함께 제거해야 하는 이유(발견)**: `index.html`의 스니펫은 404.html이 쓴 `/?/<path>` 리다이렉트를 되돌리는 코드다. 404.html만 지우고 스니펫을 남기면 **쿼리가 `/`로 시작하는 모든 URL을 조용히 재작성하는 죽은 코드**가 되므로 반드시 쌍으로 제거해야 한다. 제거 이력을 주석으로 남겼다.
  - **대체 요구사항 명시(중요)**: Pages 트릭이 사라졌으므로 **자체 서버에서 딥링크(`/p/:id`·`/d/:id` 직접 접속)가 동작하려면 정적 서버의 SPA fallback 설정이 필요**하다. README에 nginx `try_files $uri $uri/ /index.html` 예시와 함께 명시했다.
  - **CORS 동작 변화**: 프로덕션 프론트엔드 오리진은 이제 **`WEB_ORIGIN`에 반드시 명시**해야 한다(기본 허용은 localhost·사설 LAN http뿐). `.env.example` 주석을 사실과 일치하도록 정정하고, `vite.config.ts`의 Pages 전제 주석(USER/PROJECT page, VITE_BASE)도 리버스 프록시 서브패스 기준으로 갱신했다.
  - **회귀 테스트 신설**: `backend/test/cors.test.ts` **7건** — localhost/사설 LAN 허용, 임의 외부 오리진 거부(그러나 500이 아님 = graceful deny), `WEB_ORIGIN` 목록 허용(공백 허용), 목록 외 거부, **제거된 github.io 오리진이 더 이상 허용되지 않음(오늘 변경의 회귀 잠금)**, 사설 LAN이라도 https는 불허(http 전용 정규식 검증). CORS 테스트가 전무했는데 CORS를 변경했기 때문에 추가했다.

### 2026-07-28 (6)
- **[docs]** **최종 문서 최신화 + 전체 재검증**: 기능 작업이 끝난 뒤 문서가 실제 구현과 어긋난 지점을 훑어 정정했다(동작 변경 없음).
  - **PRD**: §5.1 In Scope에 **FR-14**·이미지 첨부 추가. §5.2에서 **"이미지/파일 첨부"가 Out of Scope로 남아 있던 모순 정정** — 이미지는 구현되어 In Scope로 이동했고(글·댓글 단일 이미지 + 1차 답변 멀티모달), Out of Scope는 "파일(비이미지) 첨부"로 한정했다.
  - **PLAN**: §18 M16(Fly.io 배포 + Postgres 전환, 보류)에 **SUPERSEDED 성격의 갱신 주석** — Postgres 전환은 준비 완료(파생 스키마·DDL·드리프트 게이트), 호스팅 방향은 자체 서버로 변경, 남은 것은 런타임 검증. **§21 M19 신설**로 이번 묶음(FR-13/14·수평 확장·부하/실키 실측·게이트 코드화·전달력)을 WP 표 + 완료 게이트 + "의도적 미완" 목록으로 기록.
  - **e2e/README.md 전면 개정**: 존재하지 않는 `server/` 디렉터리 기준의 수동 서버 기동 안내, "J1~J3 3개뿐", "green gate가 아니다"라는 서술이 모두 낡아 있었다 → 5스펙(J4/J5 hermetic 포함) + 비테스트 도구 3종(미디어·실키 계측·데모), `webServer` 자동 기동, `AIDIT_PIPELINE`/`AIDIT_E2E_BASE_URL` 스위치, 라우트 등록 순서·EventSource·`authorId: null` 함정까지 현재 사실로 갱신.
  - **`backend/.env.example`**: **`REDIS_URL` 신설 문서화** + 다중 인스턴스 3요건(Postgres·REDIS_URL·s3) 명시. CORS 기본 허용 오리진 `littleanti.github.io`가 GitHub Pages 계획의 잔여물이며 제거 예정임을 주석으로 남김.
  - **DEMO_SCENARIO**: 16턴이 프롬프트로 문서를 부탁하던 흐름이 `[ 문서로 정리 ]`(FR-13)로 승격됐음을 명시하고, 촬영 시 FR-13 실행 + FR-14 첨부 컷으로 대체할 것을 권고(기존 대본도 계속 유효).
  - **TRD §13**: 토큰 카운팅 항목에 실측으로 제공자 실제 `promptTokenCount`를 확보했다는 사실을 추가(추정치 보정/`countTokens` 교체가 측정 가능한 후속으로 바뀜). 요약 품질 항목에 FR-13 산출물 육안 확인 사실 추가(자동평가는 여전히 미구현).
  - **README**: E2E 행을 실측과 일치시켰다 — **5스펙 10케이스** 중 hermetic 6건만 이 환경에서 통과 확인, J1~J3·실키는 라이브 스택 필요로 미실행. 문서 인덱스의 PATENT/PAPER에 **FR-13/14 미반영** 경고 표기.
- **[test]** **재검증 결과**: `./deploy/pipeline.sh --with-build` 7게이트 PASS(백엔드 typecheck·test 125, Postgres 드리프트, 프론트 typecheck·test 79, 양쪽 build), 문서 상대 링크 전수 검사 0건 깨짐, 리포 전체 실키 문자열 스캔 0건.
  - **계측 함정 1건 발견·기록**: 백엔드 vitest를 **동시에 두 개** 실행하면 고정 경로 `prisma/test.db`를 공유해 **유령 실패 15건**이 난다(단독 실행 시 125/125 통과). `backend/vitest.config.ts`에 FOOTGUN 주석으로 못박았다 — 파이프라인은 게이트를 직렬 실행하므로 영향 없음.

### 2026-07-28 (5)
- **[test]** **실제 사용자 키 3개로 전 구간 실측 — BYOK 원가·key-blind를 측정값으로 전환**: 유일하게 검증 데이터가 0이던 항목(비즈니스 가치)을 실측으로 채운다. 신규 하니스 `frontend/e2e/measure-real-keys.mjs`(`npm run measure:keys`).
  - **무엇을 하는가**: 브라우저 3개 컨텍스트에 **서로 다른 실제 키**를 넣고 게스트 3명으로 전 구간을 구동한다 — 커뮤니티 생성 → 게시글+1차 AI 답변 → **9턴 다자 토론(4턴 `@AI`)** → `[ 문서로 정리 ]`(FR-13) → 대조군/첨부 스레드에서 **같은 질문**을 문서 없이/있이 각 1회(FR-14 순증 측정). 제공자가 반환하는 `usageMetadata`(prompt/candidates/total)를 호출별로 기록하고, 동작 종류별(1차/`@AI`/응결/첨부)로 집계한다.
  - **왜 가로채지 않고 관찰만 하는가**: `page.route` 패스스루로 계측하면 per-post **SSE 스트림까지 프록시**해야 하고, 무한 응답을 버퍼링하면 스레드 화면이 멈춘다. `request`/`response` 이벤트 관찰만 쓰면 측정 대상 실행이 평소와 **완전히 동일**해진다.
  - **핵심 실측(2026-07-28)**: 8회 호출 · 총 7,713 토큰 · **사용자 3명 합계 $0.004412** · **운영자 LLM 비용 $0** · **키 유출 0건(서버 요청 327건 바디·쿼리·헤더 전수 검사)** · 응결 문서 1건(1,267자, 출처 `seq 15`) · 공유 컨텍스트 성장 `399→650→898→1,116` prompt 토큰 · FR-14 첨부 순증 `+794` prompt(+$0.0002). 단가는 공식 문서 확인(입력 $0.25 / 출력 $1.50 per 1M, 무료 티어 존재).
  - **하니스 자체 결함 2건 수정(측정 신뢰성)**: ① DOM의 `[AI]` 텍스트로 AI 답변 완료를 기다렸는데 **Composer의 활성 AI 칩이 같은 토큰을 렌더**해 대기가 즉시 통과했고, 진행 중이던 호출이 다음 `reload`에 취소되어 **호출 2건이 측정에서 유실**됐다(찬의 `@AI`, 대조군). → **관측된 generateContent 응답 수**로 대기하도록 교체(네트워크 완료가 보장되므로 취소 불가). ② 1차 답변이 `unknown` 종류로 집계되고 스레드 수가 하드코딩(2)이라 실제(3)와 달랐다 → 라벨링·실측 카운트로 수정. **공개 수치는 이 수정 이후의 깨끗한 런에서만 뽑았다.**
  - **제품 결함은 발견되지 않았다** — 실키 전 구간이 첫 시도부터 통과했고(문서 품질도 섹션 구조 + 논의에서 실제로 갈렸던 쟁점을 "미해결 질문"으로 도출), 유실은 전부 계측 코드 문제였다.
  - **문서 반영**: README "성능 실측 C" 신설 + 검증 상태 표에 실키 행, BUSINESS_VALUE §5.1 신설(가정 표 → 실측 표 + 선형 외삽 + 남은 검증 명시), §5.2로 수익 모델 분리.
  - **키 취급**: 키는 env(`DEMO_KEY_A/B/C`)로만 받고 산출 JSON·로그·리포에 **절대 기록하지 않는다**(집계는 닉네임 기준). 산출물은 스크래치패드에만 남기고 커밋하지 않았다.

### 2026-07-28 (4)
- **[chore]** **검증 게이트를 리포에 코드화 — `deploy/pipeline.sh` + e2e 자체 기동 + 커버리지**: GitHub Actions를 쓰지 않기로 한 뒤 "자동 검증이 존재한다"는 것을 리포에서 볼 방법이 없었다. 게이트를 스크립트로 못박는다.
  - **`deploy/pipeline.sh`**: 5개 필수 게이트(백엔드 typecheck·test, **Postgres 스키마 드리프트(`db:pg:check`)**, 프론트 typecheck·test) + 옵션(`--with-e2e`, `--with-build`, `--all`). 실패해도 나머지를 계속 돌려 **한 번의 실행으로 모든 문제를 보고**하고, 요약에 실패 게이트를 나열한 뒤 `exit 1`로 배포를 막는다. 실측 검증: 정상 시 5게이트 PASS·exit 0, 파생 스키마를 일부러 드리프트시키면 해당 게이트만 FAIL·exit 1.
  - **버그 2건 수정(작성 중 발견)**: ① bash 내장 `printf`는 포맷 문자열이 `--`로 시작하면 **옵션으로 파싱**해 `invalid option` 에러를 내고 PASS/FAIL 줄이 아예 출력되지 않았다 → `printf '%s
' "--- PASS: ..."` 형태로 교체. ② e2e 게이트가 개발자가 띄워둔 기존 dev 서버를 재사용해 **이 커밋이 아닌 다른 빌드를 테스트**할 수 있었다 → `AIDIT_PIPELINE=1`일 때 `reuseExistingServer: false`.
  - **e2e 자체 기동**: `playwright.config.ts`에 `webServer`(Vite 5173 + 백엔드 3001 `/health`)를 추가해 `npm run e2e` 한 명령으로 돌아간다(기존에는 사람이 서버 두 개를 먼저 띄워야 했다). `AIDIT_E2E_BASE_URL`이 있으면 이미 뜬 앱을 대상으로 삼고 기동을 건너뛴다. **검증 한계**: 이 환경의 5173/3001은 사용자의 개발 서버가 점유 중이고, J1~J3는 실제 백엔드에 쓰기를 하므로(사용자 dev DB 오염) **자체 기동 경로는 설정 로드까지만 확인**했다. 헤르메틱 스펙(J4/J5 6건)은 `AIDIT_E2E_BASE_URL`로 실행해 통과 확인.
  - **커버리지**: `npm run test:cov`(프론트) 추가. 실측 전체 **20.4%**, `src/engine` **76.4%**. 낮은 전체 수치는 화면을 유닛으로 덮지 않는 의도된 분포이며, README에 그 전략과 함께 **수치를 그대로 공개**했다(엔진 수치만 골라 쓰지 않음).

### 2026-07-28 (3)
- **[feat]** **지식 복리 루프 완성 — 커뮤니티 문서를 컨텍스트로 재투입 (FR-14)**: FR-13이 논의를 문서로 **내보내는** 방향이었다면 FR-14는 그 문서를 다시 **끌어와** 다음 논의의 참고 자료로 쓴다. 두 방향이 닫히면서 BUSINESS_VALUE가 서술로만 주장했던 "사용자가 늘수록 문서 자산이 쌓인다"가 실제 동작이 된다.
  - **서버 무변경**: 컨텍스트 조립을 건드리지 않고 **클라이언트에서 앞에 덧붙이는** 방식을 택했다. 첨부는 "이번 발화에 대한 참고 자료"이지 스레드의 저장 상태가 아니므로, 서버의 `tokenSum`·세그먼트·`seq`(L4)에 개입하지 않는 것이 의미상 정확하다. 즉 첨부가 128K 요약 트리거를 앞당기지 않는다.
  - **엔진**: `buildLlmRequest`에 `attachedDocuments?`를 추가해 **활성 컨텍스트 턴들보다 앞에** `role:'user'` 참고 턴으로 배치한다. 각 턴은 앱 통제 라벨(`ai.document_context_prefix`, ko/en)로 시작해 "참고 자료 vs 진행 중 대화"를 구분한다. **XC-4 유지**: 문서 본문은 UGC이므로 systemInstruction에 절대 들어가지 않는다. `runAtAiReply`는 `attachedDocumentIds`를 받아 발화 시점에 `getDocument`로 본문을 병렬 조회하며, 실패한 문서는 **건너뛰고 답변을 계속**한다(FR-14.7 — 요약 실패 정책과 동일 철학).
  - **스토어**: 신규 `stores/docContextStore.ts` — postId 스코프 선택, **세션 한정·미영속**(aiMode/aiLength/persona와 동일), 상한 3개(초과 시 조용히 교체하지 않고 **거절**), 본문은 저장하지 않고 id만 보관(긴 가이드를 클라 상태에 복제하지 않고 항상 최신 본문을 사용).
  - **UI**: 새 화면을 만들지 않고 이미 발화별 AI 설정이 모여 있는 **Composer AI 팝오버**에 "참고 문서 n/3" 행을 추가(첫 오픈 시 지연 로드, 체크박스, 상한 도달 시 미선택 항목 disabled, 문서 없으면 만드는 방법 안내). 팝오버를 닫아도 보이도록 입력창 위에 **`📎 문서 n개 참고` 칩**(× 로 전체 해제). 전송 후 첨부는 자동 해제 — 발화 단위 결정이므로.
  - **테스트**: 엔진 7건 추가(앞에 배치·라벨·**XC-4로 프롬프트 인젝션 본문이 system에 못 들어감**·미첨부 시 요청 동일·본문 조회·조회 실패 시 건너뛰기·미첨부 시 조회 안 함), 스토어 8건, e2e J5 2건(실제 브라우저에서 첨부 → 전송 → **첫 턴이 참고 문서** + system에 본문 없음 + 전송 후 칩 사라짐, 문서 없을 때 안내). 프론트 **79 통과**.
  - (PRD FR-14·J5 신설, TRD §5.1 매핑 추가, WIREFRAME §14 신설)

### 2026-07-28 (2)
- **[fix]** **인스턴스 로컬 상태 제거 — 레이트리밋 공유 + 업로드 경고 (NFR-4 / TRD §15.3)**: pub/sub만 어댑터로 분리해 놓고 **레이트리밋 카운터가 모듈 스코프 `Map`(프로세스 로컬)** 로 남아 있었다. 2대로 띄우면 identity당 실효 한도가 2배가 되어 "수평 확장 가능"이라는 문서 서술과 **모순**이었다.
  - **정책/저장소 분리**: `plugins/rateLimit.ts`는 정책 테이블(라우트→윈도우·최대치·메시지)만 갖고, 카운터 위치는 신규 `store/rateLimitStore.ts`가 결정 — `InMemoryRateLimitStore`(기본) / `RedisRateLimitStore`(`REDIS_URL`). 4개 정책의 값·키잉(JWT sub 우선, 없으면 IP)은 불변.
  - **RESP 재사용**: `realtime/pubsub.ts` 안에 있던 RESP 코덱을 `redis/resp.ts`로 추출(`encodeCommand`/`RespParser`/`RedisConnection`/`parseRedisUrl`)하고, 응답 상관관계가 필요한 명령용으로 `redis/client.ts`(`RedisCommandClient`)를 신설했다. RESP2는 요청 id가 없고 응답이 전송 순서대로 오므로 **FIFO 리졸버 큐**로 상관시키며, 타임아웃된 명령은 큐에서 빼지 않고 `dead` 플래그만 세운다 — 빼면 늦게 도착한 응답이 **다음 명령의 응답으로 오인**된다. `pubsub.ts`는 기존 import 경로 유지를 위해 re-export만 남겼다.
  - **구현 중 발견한 결함(중요)**: 처음엔 정확도를 위해 ZSET 슬라이딩 윈도우로 만들었는데, Redis에서 그 방식은 read-then-act(트림→카운트→판정→추가)라 **동시 요청이 모두 "추가 전" 개수를 읽고 전부 통과**한다. 한도 2에 동시 3건이 모두 통과하는 것을 테스트로 재현했다. 막으려는 바로 그 버스트에서 한도를 넘는 리미터는 의미가 없으므로, **두 백엔드를 원자적 고정 윈도우로 전환**(Redis는 `INCR` + 첫 히트에만 `PEXPIRE`). 대가로 경계에서 최대 2배 버스트를 허용하는 것은 인지된 트레이드오프로 문서화했다. TTL 유실(`PTTL`=-1) 시 영구 차단 대신 윈도우를 재설정하고, Redis 장애 시 **fail-open**(429 남발 방지).
  - **업로드**: `STORAGE_BACKEND=local`은 이미지를 그 인스턴스 디스크에 쓰므로 다중 인스턴스에서 다른 인스턴스가 404를 낸다. 코드는 이미 s3를 지원하므로, `REDIS_URL`이 설정된 채 `local`이면 **기동 시 경고**를 출력한다(`config.ts`).
  - **테스트**: 신규 `test/rateLimitStore.test.ts` 16건 — 두 백엔드 동일 동작, **Redis 2 인스턴스가 한 예산 공유**, 동시 초과 허용 없음(위 결함 회귀 방어), 인메모리는 인스턴스 간 공유 안 됨(어댑터 필요성), 윈도우 만료 복구, 명령 수 검증, TTL 유실 복구, fail-open. 테스트용 RESP 브로커를 `test/fakeRedis.ts`로 공유화(pub/sub 테스트의 중복 브로커 제거, INCR/PEXPIRE/PTTL/DEL 추가). 백엔드 **125 통과**.

### 2026-07-28
- **[docs]** **README 미디어 — 응결 흐름 GIF + 화면 스크린샷 3장(재현 가능 생성)**: 데모 영상이 Google Drive 링크라 **익명 접근 시 로그인 페이지로 유도**되는 것을 확인했다(WebFetch 검증). 링크 하나에 전달력을 의존하지 않도록 리포 안에 미디어를 넣는다.
  - **생성 도구**: `frontend/e2e/capture-media.spec.ts` — Aidit REST와 LLM 호스트를 스텁한 상태로 실제 UI를 촬영(백엔드·DB·실키 불필요, 매 실행 동일 산출물). 산출물: `docs/assets/thread.png`·`document.png`·`community.png` + `docs/assets/condense/*.png`(GIF 프레임 23장). 전용 설정 `e2e/playwright.media.config.ts`(Pixel 7 · `deviceScaleFactor: 2`)를 두고, 메인 e2e 설정에는 `testIgnore`를 추가해 **미디어 갱신이 테스트 게이트를 막지 않게** 했다.
  - **GIF**: `frontend/e2e/make-gif.mjs`(`npm run media:gif`) — ffmpeg 2-pass 팔레트(64색, bayer 디더)로 `docs/assets/condense.gif` 생성(380px, 194KB). 필터 그래프의 인용부호가 OS 셸마다 다르게 해석되는 문제를 피해 argv 배열로 spawn한다. 프레임은 `.gitignore`(재생성 가능), GIF만 커밋.
  - **캡처 정확성 이슈 2건 수정**: ① `page.route`로 채운 SSE 응답은 **완결된 바디**라 EventSource가 즉시 EOF→에러로 가면서 "연결이 끊겼습니다" 배너가 모든 스크린샷에 남았다 → `EventSource`를 페이지에서 열린 상태로 스텁해 정상 정상상태를 촬영. ② 스텁 헬퍼의 `authorId: null ?? 기본값`이 널을 덮어써 **AI 답변이 사람 버블로 렌더**됐다(제품 오해) → 명시적 null이 살아남게 수정, `Code Agent [AI]` 라벨로 정상 촬영.
  - **README**: 히어로에 GIF + 한 줄 캡션, 신설 "🖼 화면" 절에 스크린샷 3장 + 설명, 데모 영상은 보조 링크로 이동, 스크립트 표에 `media`/`media:gif` 추가.
  - **후속(사용자 조치 필요)**: Drive 영상 공유 설정을 "링크가 있는 모든 사용자"로 바꿔야 외부에서 열린다.

### 2026-07-27 (2)
- **[docs]** **배포·CI 방침을 자체 서버(self-hosted)로 명시 — GitHub Pages·Actions 미사용**: 운영을 직접 관리하는 서버에서 하기로 결정되어, 문서가 GitHub 호스팅을 전제하던 서술을 정정한다. 동작 변경 없음(문서 전용).
  - **README**: "GitHub Pages 배포" 절 → **"배포 · CI"** 절로 교체 — 자체 서버 운영 명시, `WEB_ORIGIN` 예시를 `app.example.com`으로, 파이프라인에서 그대로 쓸 게이트 명령(양쪽 typecheck·test·build + `db:pg:check`) 추가. "검증 상태" 표에 **CI 행 신설** — 리포에 워크플로 정의가 없는 것은 누락이 아니라 의도된 선택임을 못박음.
  - **TRD §15.1**: `db:pg:check`의 "CI 게이트용" → "자체 서버 배포 파이프라인의 게이트용(GitHub Actions 미사용)".
  - **PLAN**: §12 M14(GitHub Pages 배포 준비)에 **SUPERSEDED 배너** 추가 — 이력은 보존하되 현행 방침은 README를 따르도록 하고, 여전히 유효한 산출물(`VITE_API_ORIGIN`·CSP 주입·`WEB_ORIGIN` allowlist)과 정리 대상 잔여 자산을 구분해 명시. XC-1의 "CI grep 게이트"도 자체 파이프라인 기준으로 정정.
  - ~~남은 정리 대상(코드, 미변경)~~ → **2026-07-28 (7)에서 전부 제거 완료**(404.html·.nojekyll·index.html 디코더·CORS 기본 오리진).

### 2026-07-27
- **[feat]** **논의 문서 응결 — 스레드 → 마크다운 문서 (FR-13)**: 데모 대본의 프롬프트 한 줄에만 존재했던 "논의를 문서로 정리" 흐름을 정식 기능으로 승격. 스레드 `⋯` 메뉴의 `[ 문서로 정리 ]` → **호출자 본인 키(BYOK)** 로 활성 컨텍스트를 문서화해 저장하고 `/d/:id`로 이동, 커뮤니티 상세의 **[게시글|문서] 탭**에 누적된다.
  - **DB**: 신규 `Document` 모델(`communityId`/`postId`/`authorId?`/`title`/`body`/`segmentIndex`/`sourceSeq`/`clientId?`) + 마이그레이션 `20260727_add_document`. `@@unique([postId, clientId])`로 재시도 멱등, `@@index([communityId, createdAt])`·`@@index([postId, createdAt])`. 버블(`Comment`)과 분리된 테이블이라 `seq`·SSE 계약(L4/§7)을 건드리지 않는다. (`backend/prisma/schema.prisma`)
  - **백엔드**: 신규 `POST /posts/:id/documents`(JWT 필수, `body` 필수·200K자 상한, `segmentIndex`/`sourceSeq` 음이 아닌 정수 필수, `communityId`는 **서버가 게시글에서 파생**해 위조 차단, `clientId` 재요청은 기존 문서 200 반환), `GET /posts/:id/documents`, `GET /communities/:slug/documents?cursor=`(커서 페이지네이션, 앵커 `createdAt(ms)+id`), `GET /documents/:id`. 문서 응결은 사용자 키로 LLM을 태우는 무거운 동작이라 **identity당 5분 3건** 레이트리밋 추가. 게시글 삭제 트랜잭션에 문서 삭제를 포함. (`backend/src/routes/documents.ts`, `backend/src/plugins/rateLimit.ts`, `backend/src/routes/posts.ts`, `backend/src/app.ts`)
  - **프론트 엔진**: 신규 `frontend/src/engine/documentEngine.ts` — `condenseToDocument()`가 `getContext` → 문서화 지시문(`ai.document_directive`, ko/en)으로 `buildLlmRequest` 재사용 → `generateContent`(호출자 키) → 첫 `# 제목` 추출(없으면 게시글 제목) → `postDocument`. **XC-4 격리 유지**: 지시문은 앱 제어 텍스트로 systemInstruction에만, 스레드 내용은 전부 데이터 턴. LLM 실패 시 문서를 만들지 않고 실패를 반환(스레드 무변경, FR-13.7).
  - **프론트 UI**: 스레드 `⋯` 메뉴를 **작성자 전용 → 로그인 사용자 전원**으로 열고 `[ 문서로 정리 ]`를 최상단에 추가(편집/삭제는 구분선 아래 작성자만, 폭 `w-28`→`w-36`, 실행 중 `[ 정리 중… ]` disabled). 신규 화면 `Document.tsx`(`/d/:documentId`) — `SafeMarkdown` + 기존 `prose-chat` 재사용 + provenance(세그먼트/턴 수) 표기 + 원본 스레드 링크. 저장 마크다운은 첫 줄 `# 제목`을 보존하되 화면에서는 카드 제목과 중복되므로 `stripLeadingTitle()`로 **선행 제목 줄만** 제거해 렌더한다(본문 중간 `#`는 불변). 커뮤니티 상세에 `[게시글|문서]` 세그먼트 탭. (`frontend/src/pages/Thread.tsx`, `frontend/src/pages/Document.tsx`, `frontend/src/pages/Community.tsx`, `frontend/src/App.tsx`, `frontend/src/api/rest.ts`, `frontend/src/api/types.ts`)
  - **i18n**: 신규 namespace `document`(ko/en) + `ai.document_directive` + `thread.condense*` 키. (`frontend/src/i18n/dicts/document.ts`, `dicts/ai.ts`, `dicts/thread.ts`, `i18n/index.ts`)
  - **테스트**: 백엔드 계약 테스트(생성·검증 400·401·404·멱등·커뮤니티/스레드 목록·커서·레이트리밋), 프론트 엔진 테스트(제목 추출·게시글 제목 폴백·XC-4 격리·LLM 실패). (PRD FR-13·§5.1·J4·§8 신설, TRD §3·§4·§4.3, WIREFRAME §0·§3·§13)
- **[feat]** **수평 확장 경로 구현 — Postgres 전환 + pub/sub 어댑터 (NFR-4)**: "단일 인스턴스 PoC"라는 구조적 한계를 코드 경로에서 제거. 애플리케이션 로직은 무분기.
  - **DB provider 전환**: `prisma/schema.prisma`(SQLite, 단일 편집 지점) → `scripts/sync-postgres-schema.mjs`가 datasource만 치환한 **파생** `prisma/schema.postgres.prisma`를 생성. npm 스크립트 `db:pg:sync`/`db:pg:ddl`(서버 없이 `prisma migrate diff`로 `prisma/postgres/init.sql` 213줄 생성 — enum·`TIMESTAMP(3)`·FK 포함)/`db:pg:push`/`db:pg:generate`/`db:pg:check`(드리프트 검사, CI 게이트용). 두 스키마가 갈라지는 사고가 구조적으로 불가능하다. **한계 명시**: 살아있는 Postgres 런타임 검증은 미수행(배포 시 1회 필요).
  - **pub/sub 어댑터**: `pubsub.ts`를 `PubSub` 인터페이스 + `InMemoryPubSub`(기본) + `RedisPubSub`(채널 `aidit:post:<postId>`)로 분리하고 `REDIS_URL`로 선택. **의존성 추가 없이** `node:net` 위에 최소 RESP 인코더/디코더 구현(구독용·발행용 소켓 분리, 지수 백오프 재연결 + 활성 채널 자동 재구독). 동기 시그니처를 유지해 호출자(`publish.ts`, `stream.ts`)는 무변경.
  - **검증**: 신규 `backend/test/pubsub.fanout.test.ts` — 테스트 프로세스 내부에 최소 RESP 브로커를 띄우고 `RedisPubSub` **2개 인스턴스(=앱 2대)** 를 붙여 A→B 이벤트 전달을 확인하고, 같은 파일에서 `InMemoryPubSub`은 인스턴스 간 전달이 **되지 않음**도 검증해 어댑터의 필요성을 회귀로 못박는다. (`backend/src/realtime/pubsub.ts`, `backend/src/config.ts`, TRD §2·§7·§15 신설, PRD NFR-4 갱신)
- **[test]** **부하 시뮬레이션 하니스 + 실측 기록**: `backend/test/load/simulate.mjs` — 앱을 인프로세스로 띄우고 임시 SQLite에 대해 ① 동시 SSE 구독자 N명에 대한 버블 fan-out 지연(P50/P95/P99), ② 동시 요약 경쟁 K건의 수렴률(정확히 1승·나머지 409·무재시도)을 실측한다. 결과는 실행 환경을 명시해 README "성능 실측"에 기록. 시뮬레이션(로컬 단일 머신·인프로세스)이며 실서비스 부하 테스트가 아님을 명시.
- **[docs]** **README 전면 재구성**: 텍스트 벽 → 히어로(한 줄 정의 + **데모 영상 링크** + 라이브/문서 배지) → mermaid 시퀀스로 key-blind BYOK 증명 → 차별점 3줄 → 빠른 시작 → 성능 실측 → 상세는 `docs/`로 위임. 아키텍처 ASCII 3줄을 mermaid 다이어그램 2개(시퀀스: 브라우저↔Gemini 직행 / 컴포넌트: 확장 구성)로 대체.

### 2026-07-25
- **[docs]** **비즈니스 가치 근거 문서 추가(`docs/BUSINESS_VALUE.md`)**: 심사 기준 "비즈니스 가치"를 서사→근거로 보강. 한 줄 가치제안, 문제·시장, ICP·쐐기 유스케이스, 차별화 해자(key-blind BYOK 비용귀속·멀티유저 공유 컨텍스트·컨텍스트 연속성 엔진), Unit Economics(운영자 LLM 원가≈0), 경쟁 2×2, GTM, KPI, 자매 제품(Aidit-Code)과의 포트폴리오 논리(정반대 원가모델→획득/수익화 사다리), 리스크. (`docs/BUSINESS_VALUE.md`)

### 2026-07-24
- **[chore]** **데모 오케스트레이션 스크립트 추가**: `docs/DEMO_SCENARIO.md`의 시나리오(3440×1440 3분할 창 A/B/C, 게스트 BYOK 로그인, 커뮤니티 생성 → 게시글 → 16턴 댓글 대화 → AI 문서 생성)를 Playwright로 자동 실행한다. ffmpeg(ddagrab+NVENC, `draw_mouse=0`) 전체 화면 녹화 시작/종료 포함, 산출물 `demo-aidit.mp4`(리포 루트, 미추적). 앱 코드 무변경 — 데모 전용 도구. (`frontend/e2e/demo-scenario.mjs`)

### 2026-07-17
- **[refactor]** **홈 상단을 다른 페이지와 동일한 "제목 바 + 쉘 + 본문 탭" 리듬으로 통일**: 홈의 고정 상단바(`PageHeaderBar`)는 2026-06-26부터 인기/최신 탭 두 버튼이 바를 가득 채우는 형태였다(다른 페이지는 제목). 검색 화면에 본문 탭([커뮤니티|게시글], FR-1.4)이 생기면서 "상단바 = 페이지 정체성, 본문 탭 = 콘텐츠 전환" 규칙으로 앱 전체를 통일한다 — 홈 상단바를 **제목 "홈"**으로 바꾸고, 인기/최신 탭을 ShellPrompt 아래 **본문 세그먼트 탭**(검색 페이지 tablist와 동일 스타일: `min-h-[44px] flex-1`, 활성 amber 언더라인+배경)으로 이동. 트레이드오프(인지된 결정): 탭이 sticky에서 내려와 **스크롤 중 정렬 전환은 불가**해짐 — 전환 시 목록이 리셋되어 최상단으로 돌아가므로 실사용 영향 낮다고 판단. 정렬 상태·무한 스크롤·데이터 로직 무변경. 신규 i18n 키 `home.title`·`home.sortTabsAria`(ko/en 대칭). (`frontend/src/pages/Home.tsx`, `frontend/src/i18n/dicts/home.ts`; WIREFRAME §2 갱신)
- **[feat]** **검색 화면에 게시글 검색 추가 — [커뮤니티|게시글] 탭 (FR-1.4)**: 기존 `/search`는 커뮤니티 검색만 제공했다. 게시글(제목·본문 부분일치) 검색을 추가한다.
  - **백엔드**: `GET /posts`에 선택 쿼리 `q` 추가 — `title OR body contains(q)` 필터를 기존 keyset 커서 where와 `AND`로 결합(정렬·커서·voted 계산 등 기존 피드 동작 불변, `q` 미지정 시 완전 동일). SQLite `contains`는 ASCII 대소문자 무시. (`backend/src/routes/posts.ts`)
  - **프론트 API**: `getPosts` 파라미터에 `q?` 추가. (`frontend/src/api/rest.ts`)
  - **검색 UI**: `CommunitySearch`(→ 화면 제목 "검색")에 [커뮤니티|게시글] 세그먼트 탭 추가. 게시글 탭은 디바운스(250ms) `getPosts({sort:'new', q})` — 결과는 제목+커뮤니티+메타(작성자·점수·댓글) 카드로 `/p/:id` 링크, `nextCursor` 있으면 `[ 더 보기 ]`로 추가 로드. 커뮤니티 만들기 CTA·커뮤니티 결과는 커뮤니티 탭에서만 노출. (`frontend/src/pages/Community.tsx`)
  - **i18n**: `community.*`에 탭·게시글 검색 문구 ko/en 대칭 추가, `searchTitle`을 "커뮤니티 검색"→"검색"으로 일반화.
  - **테스트**: 백엔드 계약 테스트에 `GET /posts?q=` 필터·페이지네이션 케이스 추가. (`backend/test/contract.test.ts`)
  - (PRD FR-1.4 신설·§5.2 정정, WIREFRAME §3 갱신)
- **[feat]** **내 AI 페르소나 — 사용자 개인 페르소나 3슬롯(로컬 저장) + Composer 발화별 선택 적용**: 커뮤니티 페르소나(systemInstruction) 외에, 사용자가 자신의 BYOK AI에 부여할 **개인 페르소나를 최대 3개** 저장하고 `@AI` 답변마다 골라 적용할 수 있게 한다(예: 토론 커뮤니티에서 "게시글에 반대 입장을 내는 토론자" 페르소나).
  - **저장(로컬 전용)**: 신규 스토어 `frontend/src/stores/userPersonaStore.ts` — zustand persist, localStorage 키 `aidit-user-personas`, 슬롯 3개 `{ name, prompt }`. BYOK 키·AI 모드·길이 설정과 동일한 "AI 관련 설정은 내 기기에" 철학으로 **서버에 전송하지 않는다**(서버·API 계약·DB 무변경). 발화별 선택 상태 `selectedByPost`(postId → 슬롯 인덱스 | null)는 **세션 한정·미영속**(aiModeStore와 동일 철학, persist `partialize`로 `personas`만 저장).
  - **관리 UI**: 설정 페이지 `/me/settings`(`Settings.tsx`)의 API Key 섹션 아래에 "MY AI PERSONA" 섹션 추가 — 슬롯 3개 각각 이름 입력 + 프롬프트 textarea + `[ 저장 ]`/`[ 비우기 ]`, 로컬 저장 안내 문구.
  - **선택 UX**: Composer AI 메뉴(`AiModeMenu`)에 페르소나 선택 행 추가 — `[없음]` + 저장된 슬롯 이름 버튼(빈 슬롯은 미노출). **기본값은 없음**이며 사용자가 스레드에서 발화별로 선택한다. 저장된 페르소나가 하나도 없으면 설정으로 안내하는 힌트 노출.
  - **주입(XC-4 유지)**: `contextEngine.buildLlmRequest`의 systemInstruction 조립을 `[커뮤니티 페르소나, 내 페르소나, 언어 지시, 길이 지시]` 순으로 확장(`BuildLlmRequestArgs.userPersonaPrompt?` 신설). `RunAtAiReplyArgs.userPersonaPrompt?`로 Composer→엔진 전달. **`runPrimaryReply`(1차 답변)·`ensureSummary`(128K 요약)는 무변경** — 개인 페르소나는 Composer가 구동하는 `@AI` 답변에만 적용. 개인 페르소나도 systemInstruction에만 들어가고 user 데이터 턴과는 절대 결합되지 않는다(XC-4 격리 불변).
  - **i18n**: `profile.myPersona*`(설정 섹션)·`thread.persona*`(Composer 행) 키를 ko/en 대칭 추가.
  - **변경 파일**: `frontend/src/stores/userPersonaStore.ts`(신규), `frontend/src/pages/Settings.tsx`, `frontend/src/components/Composer.tsx`, `frontend/src/engine/contextEngine.ts`, `frontend/src/i18n/dicts/profile.ts`, `frontend/src/i18n/dicts/thread.ts`. (PRD FR-12 신설, WIREFRAME §9.1 갱신)

### 2026-07-08
- **[docs]** **PATENT.html — 멀티유저 AI 챗 오픈소스 추가 조사(STMP) 반영**: 사용자 문의로 CopilotKit/open-multiplayer-chat 확인 결과 미존재(404; CopilotKit 산하 유사물은 open-multi-agent-canvas — 다중 에이전트/단일 사용자라 비관련). 대신 실재하는 최근접 오픈소스 SillyTavern MultiPlayer(STMP, AGPL-3.0 — 복수 사용자가 하나의 채팅 히스토리를 공유하며 AI와 대화)를 배경기술 (1)에 추가. 신규성 위협 아님 — 호스트 서버가 호스트 자격증명(secrets.json)으로 LLM 호출(key-custody), 컨텍스트는 요약이 아닌 길이 절단(truncation), 동시성은 발화 쿨다운뿐. AnythingLLM(사용자별 분리 히스토리)·llm-party-chat(다중 LLM 간 대화)은 비관련으로 인용 제외. (`docs/PATENT.html`)
- **[docs]** **PATENT.html — CopilotKit OpenTag 선행기술 대비 반영**: 다중 사용자 Slack 스레드에 참여하는 셀프호스트 AI 에이전트 OpenTag(MIT)를 배경기술 (1)에 추가. 분석 결과 신규성 위협 아님 — "bring your own model"형이지만 자격증명은 운영 조직의 서버측(.env)에 보관되어 추론·과금이 서버측(key-custody)이고, 컨텍스트 요약·압축, 토큰 임계 세그먼트, 동시 압축 조정(멱등 가드·무재시도 수렴)은 문서화된 범위에서 전부 미개시. 셀프호스트형도 key-custody 한계에 포섭됨을 한계 문단에 명시. (`docs/PATENT.html`)
- **[docs]** **PATENT.html — US12406668B2 청구항·명세서 정밀 대비 반영**: 조사에서 "본 발명과 가장 가까운 특허문헌"으로 지목된 Microsoft US12406668B2("Network-based communication session copilot", 2025-09-02 등록)의 원문을 대조하여 배경기술 (1)에 상세 대비를 추가. 동 문헌이 개시하는 것(LLM 입력 한계 명시, 최대 입력 크기 기준 세그먼트 분할, summary-of-summaries·rolling summary, 참가자 단말 로컬 처리 언급, 사설/협업 코파일럿)과 개시하지 않는 것((a) 사용자 자격증명·비용 귀속 전무, (b) 분할이 일회적 전사 분할일 뿐 서버 단일출처의 지속적 세그먼트 상태 전이가 아님, (c) 참가자별 인스턴스 격리로 동시 압축 경쟁·조정 부재)을 명시. (`docs/PATENT.html`)
- **[docs]** **특허 명세서 초안(PATENT.html) 종래기술 재조사 반영 — 배경기술·발명의 내용·청구범위 전면 개정**: 6개 레인(클라이언트 오프로드 특허 / BYOK·key-blind 특허 / 컨텍스트 압축 논문 / BYOK 서비스·OSS / 보안 CSP·SSRF / 동시성 멱등·낙관적 동시성) 병렬 웹 조사 + 인용 실재성 독립 검증(74건) 결과를 반영. 주요 변경: ① 배경기술을 (1)~(5) 소절로 재편 — 다중 사용자 공유 AI 대화의 key-custody 한계(신규 인용: US12475887B2·US12406668B2·US12462095B2, ChatGPT Group Chats, Open WebUI Channels 등), 임계치 트리거 재귀 요약의 공지성 자인(신규: arXiv:2308.15022, MemGPT 2310.08560, Collaborative Memory 2505.18279, Claude Code auto-compact), 클라이언트 오프로드·BYOK의 단일 사용자 한계(최근접 US9569428B2 정밀 대비, TypingMind, GitHub Copilot BYOK), 서버 프록시 CVE 실증(신규: Dify CVE-2024-11822 등), 분산 조정 공지 기법(RFC 7232, EventStoreDB expectedVersion, Stripe Idempotency-Key, DynamoDB 조건부 쓰기)과 잔존 과제 정식화. ② WO2025042780A1 양수인 정정(Modulus AI) + US12380287B2 병기, Samsung Transcript Assist 서술 정밀화, GitHub Models→Copilot BYOK 특정, BYOK 용어 정의 신설. ③ 청구항 재편 — 시스템 독립항(1)에 key-blind·단일출처·lazy BYOK 트리거·도메인 특정 멱등 가드(409+최신 세그먼트 동봉·무재시도 수렴)·SSE 팬아웃·비용 귀속을 전부 반영, 서버 단일 주체 방법 독립항 신설(분할침해 대응), 클라이언트 관점 기록매체항 신설, CSP·페르소나 격리 종속항을 구조 결합형으로 보강, 방어 계층 종속항(신뢰 분리·abort·세그먼트 체인 등) 추가. (`docs/PATENT.html`)

### 2026-06-29
- **[fix]** **데스크탑에서 긴 AI 답글이 고정 그리드 폭(`max-w-5xl`)을 깨던 문제 — `<main>`에 `min-w-0` 추가**: 데스크탑 레이아웃은 `desktop:grid-cols-[220px_1fr]` 그리드이고 `<main>`이 `1fr` 트랙 아이템이다. 그리드/플렉스 아이템의 기본 `min-width`는 `auto`라, 내부에 줄바꿈 불가한 긴 콘텐츠(긴 코드 블록·URL·넓은 이미지/표 등)가 있으면 `1fr` 트랙이 제 몫(≈780px)을 넘어 확장되며 전체 그리드가 `max-w-5xl`(1024px)을 초과해 사이드바·본문 정렬이 깨지거나 가로 스크롤이 생긴다. `<main>`에 `min-w-0`(= `min-width:0`, 트랙을 `minmax(0,1fr)`로 만드는 것과 동치)을 주면 트랙이 제 몫을 넘지 않고 내부 콘텐츠가 줄바꿈/스크롤되어 폭이 고정된다. 모바일 단일 컬럼(`grid-cols-1`) 그리드 아이템에도 동일하게 이로워 분기 없이 항상 적용. ChatBubble은 이미 `min-w-0`·`break-words`를 갖췄으나 트랙 상한은 그리드 아이템(`<main>`)에서 잡아야 한다. (`frontend/src/layout/AppLayout.tsx`)
- **[refactor]** **코드·문서 전반의 `gemini` 특정 네이밍을 범용 `llm`으로 통일 + LLM 프로바이더 추상화**: 특정 모델명 비노출 방침에 맞춰 사용자 노출 문자열·컴포넌트/스토어/타입/상수/파일명·i18n 키·주석·문서의 `Gemini`/`GEMINI`/`gemini`를 전부 `Llm`/`LLM`/`llm`으로 리네임. 파일: `api/gemini.ts`→`api/llm.ts`, `stores/geminiStatusStore.ts`→`llmStatusStore.ts`, `engine/geminiStatus.ts`→`llmStatus.ts`, `components/GeminiStatusBadge.tsx`→`LlmStatusBadge.tsx`(+ 각 테스트). 심볼: `GeminiError`→`LlmError`, `GeminiContent/Part/Request`→`Llm*`, `geminiStatusStore`→`llmStatusStore` 등. i18n 키 `gemini_*`→`llm_*`, 텔레메트리 이벤트 `gemini_success/failure`→`llm_*`, 백엔드 KPI 필드 `geminiSuccessRate`→`llmSuccessRate`. **프로바이더 추상화**: 모델 ID·엔드포인트를 env로 분리 — FE `LLM_MODEL`(`VITE_LLM_MODEL` ?? `gemini-3.1-flash-lite`)·`LLM_BASE`(`VITE_LLM_BASE` ?? Google v1beta), BE `LLM_MODEL`(`process.env.LLM_MODEL` ?? 동일 기본값). **기능 보존**: 실제 호출 기본값(Gemini 모델 ID·`generativelanguage.googleapis.com` 엔드포인트)과 Google REST 와이어 필드명(`inlineData`/`systemInstruction`/`candidates`/`totalTokens` 등)은 그대로 유지 — 기본 동작 불변, 기본 프로바이더는 여전히 Gemini. 과거 변경 이력 항목은 당시 실제 파일명을 보존하기 위해 미수정. (코드·문서 45파일 전반)

### 2026-06-28
- **[feat]** **게시글(Thread) 화면을 형제 앱 Aidit-Code식 window-scroll로 통일 + 상단 제목 바 자동 숨김(스크롤↓ 숨김 / 스크롤↑ 표시)**: 글로벌 앱바 밑 제목 바가 항상 세로 공간을 점유해 댓글이 적게 보이던 문제 해결. **(1) 스크롤 영역 통일**: 기존 Thread는 *풀하이트 flex(`h-[calc(100dvh-3rem)]`) + 내부 `overflow-y-auto` 컨테이너* 모델이라 제목 헤더가 스크롤 밖 고정 flex 아이템이었다. 이를 Aidit-Code처럼 **window-scroll**로 전환 — 내부 스크롤 컨테이너(`flex-1 overflow-y-auto`) 래퍼 제거, 외곽 `h-[calc(100dvh-3rem)]`→`min-h-[calc(100dvh-3rem)]` 흐름. 본문(ShellPrompt·원글 카드·구분선·채팅 목록)의 좌우 패딩·풀블리드(`-mx-4`) 구조는 그대로 유지해 시각 변화 없음(Option B). **(2) 제목 헤더**: 고정 flex 행 → `sticky top-12 z-0` + 신규 훅 `useHideOnScroll`로 스크롤↓ 시 글로벌 앱바 뒤로 슬라이드업(`-translate-y-[calc(100%+1px)]`; 헤더 `z-0` < 글로벌 앱바 `z-10`이라 뒤로 숨음), 최상단 64px·위로 스크롤 시 표시. **(3) Composer**: flex 하단 고정 자식 → `sticky bottom-[calc(3.5rem+var(--safe-bottom,0px))] tablet:bottom-0`(모바일 고정 탭바 위/태블릿+ 뷰포트 하단). 점프 칩·AI 토스트·요약 배지를 Composer sticky 래퍼 안으로 이동(상시 노출 유지). **(4) 스크롤 핸들러**: 점프 칩 방향감지·jumpTo·신규 댓글 자동 맨아래 스크롤을 내부 `scrollRef`→**window**(`window.scrollY`/`window.scrollTo`)로 전환, `scrollRef`·`bottomRef` 제거. (`frontend/src/hooks/useHideOnScroll.ts` 신규, `frontend/src/pages/Thread.tsx`)
- **[feat]** **게시글 상단 sticky bar를 형제 앱 Aidit-Code와 동일 구성으로 변경 — 제목 좌측 정렬 + ⋯ 메뉴 헤더 복귀**: 기존엔 `‹ 뒤로 · 제목(가운데) · 🔖`였고 작성자 ⋯ 편집/삭제 메뉴는 2026-06-26에 원글 카드 메타행으로 분리돼 있었다. Aidit-Code Thread 상단바(`‹ · 제목(좌측, flex-1) · [상태점] · 북마크 · ⋯`)와 통일하기 위해 다음을 변경: (1) 제목을 가운데→**좌측 정렬**(양옆 `flex-1` spacer div 제거, `<h1>`에 `flex-1` 부여) + 크기/굵기를 Aidit-Code와 동일하게 `text-base font-semibold`→**`text-sm font-bold`**, 명시적 `font-mono` 추가(색 `text-term-title`#7dffa0·`.glow`는 이미 동일). (2) 헤더 패딩 `px-2`→**`px-4`**, 뒤로가기 버튼에 `-ml-2`(셰브론 좌표를 Aidit-Code와 일치). (3) 북마크를 🔖 이모지+opacity → **Aidit-Code SVG 북마크 아이콘**(17×17, `M6 3h12v18l-6-4-6 4z`), 활성 시 `text-term-amber`, 버튼 `h-10 w-10`→`h-9 w-9`. (4) 작성자 ⋯ 편집/삭제 팝오버를 **원글 카드 메타행 → 상단바**(북마크 뒤)로 복귀, 트리거 `h-7 w-7`→`h-9 w-9`(팝오버 `w-28`·키·핸들러 불변). **세션 상태점(StatusBadge)은 Aidit에 세션 개념이 없어 제외.** 폰트 종류/색/글로우 토큰은 양 앱이 이미 글자단위 동일(폰트 스택 `mono`, `text-term-title`=`text-term-glow`=#7dffa0, `.glow`=text-shadow 0 0 4px rgba(125,255,160,.45))이라 변경 없음. **`PageHeaderBar` 컴포넌트로 교체하지 않음**: Aidit Thread는 풀하이트 flex + 내부 스크롤 컨테이너 구조라 헤더는 스크롤 영역 밖 첫 flex 아이템으로 고정되며, window-scroll용 `sticky` PageHeaderBar로 바꾸면 레이아웃이 깨진다. (`frontend/src/pages/Thread.tsx`)

### 2026-06-27
- **[feat]** **헤더 LLM 연결 배지에 `AI` 텍스트 라벨 추가(좁은 화면 숨김) + 툴팁 문구 `LLM`→`AI`**: 형제 앱 Aidit-Code 헤더 배지(`● LLM` — 점 + `hidden sm:inline` 라벨)와 디자인을 통일하기 위해, 2026-06-26에 LED 점만 남겼던 `GeminiStatusBadge`에 가시 텍스트 라벨을 다시 추가한다. 단 **특정 모델명을 노출하지 않는다**는 기존 방침(GEMINI 라벨 제거)을 유지하므로 라벨 문구는 일반어 `AI`로 한다. 라벨 클래스는 Aidit-Code와 동일하게 `hidden text-[10px] uppercase tracking-wider text-term-faint sm:inline` — 좁은 화면(<640px)에선 점만, 넓은 화면(≥640px, Tailwind 기본 `sm`)에선 `● AI` 노출. 함께 툴팁(`misc.gemini_*`, ko·en)의 `LLM`→`AI`로 통일(예: `LLM 연결됨 — 최근 응답 성공`→`AI 연결됨 — 최근 응답 성공`). 상태 스토어 로직·LED 색상 불변. (`frontend/src/components/GeminiStatusBadge.tsx`, `frontend/src/i18n/dicts/misc.ts`)

### 2026-06-26
- **[fix]** **게시글 ⋯ 팝오버 메뉴 폭 조정 — `w-36`→고정 `w-28`(영어 라벨 기준)**: 작성자 전용 ⋯ 팝오버의 `[ 편집 ]`/`[ 삭제 ]` 메뉴는 컨테이너가 고정폭 `w-36`(144px)이라 우측 공백이 과했다(브라우저 canvas 실측 text-xs mono+px-3: `[ Delete ]`=90px, `[ Edit ]`=77px, 한글 `[ 삭제 ]`=72px → 144px 기준 ~54px 빈 공간). `w-fit`은 절대배치+래핑 가능 콘텐츠에서 min-content로 수축해 라벨 공백이 줄바꿈 기회가 되며 `[ Delete ]`가 3줄로 깨지는 문제가 있어, **영어 최장 라벨(90px) 기준 고정폭 `w-28`(112px)으로 확정**(한·영 동일 가로, 90px+22px 여백으로 한 줄 유지, 144px 대비 32px 축소). 삭제확인 긴 문구는 112px 안에서 자연 줄바꿈. 형제 앱 Aidit-Code도 동일 1줄 수정(`bg-term-panel`만 다르고 폭 클래스 동일). (`frontend/src/pages/Thread.tsx`)
- **[fix]** **게시글 작성 AI 토글 카피에 "(답변 길이)" 명시 — `post.ai_first_reply`**: 토글 바로 아래 짧게/보통/길게 길이 선택과의 관계를 분명히 하기 위해 라벨 끝에 길이 힌트를 덧붙임. ko `게시 후 AI 1차 답변 받기` → `게시 후 AI 1차 답변 받기 (답변 길이)`, en `Get first AI reply after posting` → `Get first AI reply after posting (response length)`. 키·동작 불변, 표시 문자열만 변경. (`frontend/src/i18n/dicts/post.ts`)
- **[fix]** **홈 스크롤 시 글로벌 앱바 아래 실선(`border-b`)이 사라지던 문제 — `<header>`에 명시적 `h-12` 부여**: 홈에서 스크롤하면 인기/최신 바(`PageHeaderBar`) 위의 실선(글로벌 앱바 하단 테두리)이 사라졌다. 원인: 글로벌 앱바(`AppLayout`의 `<header>`)에는 **높이 지정이 없어** 실제 높이가 *안쪽 `h-12` div(48px) + `<header>` 자신의 `border-b`(≈0.8px) = 48.8px*가 됐다(height가 `auto`면 `box-border`여도 테두리가 높이에 가산됨). 그런데 그 아래 고정되는 `PageHeaderBar`는 `sticky top-12`(48px)에 핀 → 불투명 배경(`bg-term-screen`)이 앱바 테두리 구간(48.0–48.8px)을 정확히 **0.8px 덮어** 선을 가렸다(스크롤 0에서는 바가 흐름상 48.8px = 테두리 아래라 보였음). `<header>`에 `h-12`를 부여하면 기본 `border-box`로 테두리가 48px 안에 포함돼 앱바 하단(48.0px) = `PageHeaderBar` 핀 위치(48.0px)로 정확히 일치, 겹침 0 → 선이 항상 보인다(브라우저 측정으로 겹침 0.8px→0px 확인). 안쪽 div·배지·네비 등 시각 변화 없음. (`frontend/src/layout/AppLayout.tsx`)
- **[fix]** **UI 카피 용어 통일 — 게시물을 뜻하는 "글" → "게시글"**: 나(프로필) 탭 등에서 게시물을 "글"로 표기해 형제 앱 Aidit-Code("게시글")와 불일치했다. i18n 사전(KO)에서 post 의미의 `글`을 `게시글`로 통일(조사 유지). `인기글`→`인기 게시글`, `글쓰기`→`게시글 쓰기` 포함. **"댓글"(comment)·주석의 "글리프" 등 post와 무관한 "글"은 미변경**, EN(`post(s)`)도 불변. (`frontend/src/i18n/dicts/post.ts`, `thread.ts`, `home.ts`, `profile.ts`, `community.ts`)
- **[fix]** **한글까지 고정폭으로 통일 — `font-mono` 스택에 `D2Coding`·`NanumGothicCoding` 추가 + 끝 `monospace` generic 제거**: 기존 스택(`ui-monospace … Consolas … monospace`)은 한글 글리프가 없어 `monospace` generic의 한글 폴백(Malgun Gothic, **비례폭**)으로 렌더돼 라틴(고정폭)과 어긋났다. 형제 앱 Aidit-Code와 동일 폰트로 맞추면서 한글도 고정폭으로 통일한다. **Chrome 특이동작 주의**: 스택이 `monospace` generic으로 끝나면 앞에 명시한 D2Coding을 건너뛰고 Malgun(288px)으로 폴백하므로, **끝의 `monospace` generic을 제거**하고 명시 한글 고정폭 폰트로 끝낸다 → 한글 = D2Coding(264.96px), 라틴은 그대로 Consolas(228.73px, 글리프 단위 매칭). 최종 스택: `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'D2Coding', 'NanumGothicCoding'`. preflight가 `code/pre`에도 적용하므로 마크다운/터미널 한글도 동일 고정폭. (`frontend/tailwind.config.js`, `docs/DESIGN-SYSTEM.md`)
- **[fix]** **게시글(Thread) 제목 헤더 높이를 글로벌 앱바와 동일하게(`h-12`, 48px)**: Thread 상단 제목 헤더는 `py-2` + 뒤로 버튼(`h-10`)에 의해 높이가 ~56px로 잡혀 글로벌 앱바(`h-12`, 48px)·`PageHeaderBar`(`h-12`)보다 컸다. `<header>`에서 `py-2`를 제거하고 고정 `h-12`를 부여해 글로벌 바와 정확히 같은 높이로 맞춘다(`items-center`라 `h-10` 뒤로/북마크 버튼은 48px 안에서 수직 중앙 정렬, 시각 변화 없음). (`frontend/src/pages/Thread.tsx`)
- **[refactor]** **헤더 LLM 연결 배지에서 `GEMINI` 라벨 제거 + 툴팁 문구를 LLM 일반화**: 글로벌 앱바의 연결 배지(`GeminiStatusBadge`)는 LED 점 + `GEMINI` 텍스트를 함께 표시했으나, 향후 임의의 LLM 엔드포인트를 사용할 수 있도록 개선 예정이라 특정 모델명을 노출하지 않는다. 가시 라벨 `GEMINI` span을 제거하고 LED 점(`●`/`○`)만 남긴다. 툴팁(`misc.gemini_*`, ko/en)도 "Gemini …"→"LLM …"으로 일반화. 상태 스토어 로직·표시 색상은 불변. (`frontend/src/components/GeminiStatusBadge.tsx`, `frontend/src/i18n/dicts/misc.ts`)
- **[feat]** **홈 인기/최신 토글을 `PageHeaderBar`로 승격 + 고정 상단바↔ShellPrompt 간격 5개 페이지 통일(16px)**: 두 가지 일관성 정리.
  - **홈 탭 = 고정 상단바**: 기존 홈의 `인기/최신` 탭은 `sticky top-0`의 독자적 바(글로벌 앱바와 겹치는 위치, 자체 `border-b`/`bg`)였다. 이를 검색·작성과 **동일한 `PageHeaderBar`**(`sticky top-12`, `h-12`, Thread 헤더 스타일)로 승격한다. 차이는 제목 대신 **두 개의 탭 버튼**(`인기`/`최신`)이 바를 가득 채운다는 점뿐 — 버튼은 `h-full flex-1`로 바 높이에 맞고, 활성 탭은 기존 amber 언더라인(`border-b-2 border-term-amber` + `bg-[rgba(255,207,74,0.06)]`) 유지. 이제 홈 바도 다른 페이지와 동일하게 글로벌 앱바 바로 아래(`top-12`)에 핀. **탭 라벨 폰트도 다른 페이지 상단바 제목과 동일하게 `text-sm`→`text-base`(16px)로 키움**(`font-semibold` 동일, `h-full` + `items-center` 수직 정렬로 위치도 일치).
  - **상단바↔ShellPrompt 간격 통일**: 고정 상단바와 그 아래 꾸미기 쉘(`ShellPrompt`) 사이 간격이 페이지마다 달랐다 — 검색·작성 16px(`space-y-4`/`gap-4`), 홈·나 12px, 설정 32px(`space-y-8`). 검색·작성을 기준(16px)으로 **5개 페이지(홈·검색·작성·나·설정) 모두 16px로 통일**. 나(`Profile`)·홈은 ShellPrompt `mt-4`, 설정(`Settings`)은 루트의 `space-y-8`을 제거하고 섹션들을 별도 `space-y-8` 래퍼로 묶어 섹션 리듬은 유지하면서 바↔쉘 간격만 16px로 맞춤. 검색·작성은 이미 16px라 불변.
  - **변경 파일**: `frontend/src/pages/Home.tsx`, `frontend/src/pages/Profile.tsx`, `frontend/src/pages/Settings.tsx`.
- **[feat]** **설정 페이지(`/me/settings`)에도 고정 상단바 적용**: 검색·작성·커뮤니티·나와 동일하게 `Settings.tsx`의 헤더(제목 `settingsTitle` + `[ ← 프로필 ]` 뒤로 링크)를 `PageHeaderBar`로 승격하고 ShellPrompt(`cat ~/.config`)를 바 바로 아래로 이동. 제목은 다른 바와 동일한 `text-base font-semibold text-term-title glow` 스타일로 통일, 뒤로 링크는 바 높이에 맞춰 `h-8`. 섹션 간 `space-y-8` 리듬은 유지(외곽 `py-6`→`pb-6`로 바 플러시). (`frontend/src/pages/Settings.tsx`)
- **[fix]** **`PageHeaderBar` 배경을 Thread 헤더와 동일하게 — 반투명+블러 제거**: 고정 상단바가 `bg-term-screen/95 + backdrop-blur`(글로벌 앱바 스타일)라 Thread 헤더의 **불투명 솔리드 `bg-term-screen`** 과 색감이 달라 보였다. `PageHeaderBar`의 배경을 `bg-term-screen`(블러 제거)로 바꿔 Thread `<header>`와 정확히 동일하게 맞춘다. (`frontend/src/components/PageHeaderBar.tsx`)
- **[feat]** **검색·작성·커뮤니티·나 페이지에 고정 상단바 추가 + ShellPrompt를 상단바 바로 아래로 이동**: 게시글(Thread) 페이지처럼 페이지 제목을 담은 **고정 상단바**를 글로벌 앱바(`AppLayout`의 `sticky top-0` h-12) 바로 아래에 둔다. 재사용 컴포넌트 `PageHeaderBar`(신규)를 도입 — `sticky top-12 z-10`로 글로벌 앱바 밑에 핀, Thread 헤더와 동일 스타일(`border-b border-term-border bg-term-screen`), 모바일에서 좌우 패딩 위로 풀블리드(`-mx-4 … desktop:mx-0`). 각 페이지는 제목을 이 바에 넣고 **ShellPrompt(꾸미기 쉘)를 바 바로 아래**(스크롤 본문 첫 항목)로 옮겨 Thread와 동일한 순서로 통일한다.
  - **검색(`CommunitySearch`)**: 바 = `community.searchTitle`, 아래 ShellPrompt(`grep -ri`).
  - **작성(`CreatePost`)**: 바 = `post.heading_create`/`heading_edit`, 아래 ShellPrompt.
  - **커뮤니티(`Community`)**: 바 = 커뮤니티 이름(`RobotTile` 아이콘 + 이름), 아래 ShellPrompt(`feed r/...`). 아바타·설명·페르소나·정렬 등 풍부한 헤더는 스크롤 본문에 그대로 유지(이름 중복 표시는 Thread의 제목 중복과 동일 패턴).
  - **나(`Profile`)**: 기존 헤더(아바타+사용자명+`[ 설정 ]`)를 바로 승격, 아래 ShellPrompt(탭별 커맨드).
  - **창 스크롤·무한스크롤 유지**: sticky 방식이라 각 페이지의 window 스크롤과 커뮤니티/나 탭의 IntersectionObserver 무한스크롤이 그대로 동작(내부 스크롤 컨테이너로 재배선하지 않음).
  - **Thread 미변경**: Thread는 이미 *고정 헤더 + 하단 고정 Composer + 가운데 메시지 내부 스크롤* 모델이라 헤더가 고정 상태이며, 자동 맨아래 스크롤·점프 칩(내부 `scrollRef` 의존)·Composer 하단 핀을 깨지 않기 위해 내부 구조를 바꾸지 않는다(4개 페이지의 바를 Thread 헤더 스타일에 맞춰 시각적 일관성 확보).
  - **변경 파일**: `frontend/src/components/PageHeaderBar.tsx`(신규), `frontend/src/pages/Community.tsx`(`CommunitySearch`+`Community`), `frontend/src/pages/CreatePost.tsx`, `frontend/src/pages/Profile.tsx`.
- **[refactor]** **Me 페이지 설정 링크 — 톱니바퀴 아이콘 제거, 라벨만 표시**: `Profile.tsx` 헤더 `/me/settings` 링크에서 톱니바퀴 SVG 아이콘을 제거하고 `[ 설정 ]`(`profile.settingsLabel`) 라벨만 남긴다. 아이콘-라벨 간격용 `gap-1.5`도 제거. `aria-label`(`profile.settingsLink`)·라우팅·나머지 스타일 불변. (`frontend/src/pages/Profile.tsx`)
- **[refactor]** **Thread 편집/삭제 버튼을 헤더 → 원본 게시글 카드 오버플로 메뉴로 이동(UI/UX 정리)**: 직전 [feat]에서 sticky 네비 헤더에 넣었던 `[ 편집 ]`/`[ 삭제 ]` 알약 버튼(테두리 + `min-h-[44px]`)이 좁은 헤더를 가득 채워 글 제목을 `…`으로 잘리게 만들고, 빨간 테두리 삭제가 화면에서 가장 시끄러운 요소가 되는 문제가 있었다(사용자 스크린샷). 헤더의 일은 *길찾기(뒤로)+정체성(제목)*이므로 소유자 액션을 **네비 헤더에서 제거**하고, 글 스코프 액션의 올바른 자리인 **원본 게시글 카드 메타행**(`▲점수 💬댓글수` 옆)으로 옮겨 작성자 전용 `[⋯]` 오버플로 트리거 + 팝오버 메뉴로 접었다.
  - **헤더 슬림화**: `<header>` 우측 그룹에서 편집/삭제(및 인라인 확인 UI)를 제거 → 헤더는 `뒤로 + 제목(+ 북마크)`만 남는다. 제목이 더 이상 버튼에 밀려 잘리지 않는다.
  - **카드 메타행 오버플로 메뉴**: 메타행 우측(`upvote`/`comment` 그룹) 끝에 작성자에게만 보이는 `[⋯]` 아이콘 버튼(`thread.moreActionsAria`). 클릭 시 Composer AI 메뉴와 동일한 팝오버 패턴(`relative` 컨테이너 + `absolute` 팝오버 + 바깥 클릭/Esc 닫힘 + `aria-expanded`)으로 `[ 편집 ]` / `[ 삭제 ]` 메뉴를 연다(아이콘 없이 라벨만, 메뉴 행은 ≥44px 터치 타깃). 삭제는 danger색이며 **메뉴 안에서 2단계 확인**(`삭제할까요? [ 확인 ] [ 취소 ]`) 후 `DELETE /posts/:id` → 성공 시 커뮤니티(`/c/{slug}`)·미해결 시 `/`로 이동, 실패 시 `thread.deleteFailed` 토스트.
  - **동작·계약 불변**: 백엔드 라우트·인증·삭제 트랜잭션, 편집 진입(`/create-post` + `editPostId`), 기존 i18n 라벨 값(`editLabel`/`deleteLabel`/`deleteConfirm`/`deleteConfirmYes`/`deleteCancel`/`deleteFailed`/`deleteAria`/`editAria`)은 그대로 재사용. 트리거·메뉴 컨테이너 aria용 신규 키 `moreActionsAria`(ko `글 관리` / en `Post actions`)·`ownerMenuAria`(ko `글 관리 메뉴` / en `Post actions menu`)만 ko/en 대칭 추가. 44px 터치 타깃은 헤더 인라인 → 메뉴 행으로 이전(미감·접근성 양립).
  - **변경 파일**: `frontend/src/pages/Thread.tsx`, `frontend/src/i18n/dicts/thread.ts`. (WIREFRAME §6.3-C·D 갱신)
- **[chore]** **Vite 개발 프록시 타깃을 환경변수로 설정 가능하게 변경**: `frontend/vite.config.ts`의 dev 프록시(`/api`·`/uploads`)가 백엔드 주소를 `http://localhost:3001`로 **하드코딩**하고 있어, 백엔드를 다른 포트(예: 3002)로 띄우면 프론트의 API 호출이 닿지 않았다. `loadEnv`로 읽은 `VITE_DEV_PROXY_TARGET`(미설정 시 기본 `http://localhost:3001` — **기존 동작 불변**)을 두 프록시의 `target`으로 사용하도록 변경. 로컬에서 `VITE_DEV_PROXY_TARGET=http://localhost:3002 npm run dev`처럼 백엔드 포트에 맞춰 프록시를 재지정할 수 있다. 프로덕션 빌드(CSP·`VITE_API_ORIGIN`) 경로는 무관·불변. (`frontend/vite.config.ts`)
- **[refactor]** **Me 페이지 설정 링크 — 가시 레이블을 브래킷 스타일로 변경**: `Profile.tsx` 헤더의 `/me/settings` 링크 `<span>` 텍스트를 `t('profile.settingsLink')`(기존 클린 텍스트)에서 신규 키 `t('profile.settingsLabel')`(ko `[ 설정 ]` / en `[ Settings ]`)로 교체. `aria-label`은 기존 `t('profile.settingsLink')`(ko `설정` / en `Settings`)를 그대로 유지 — `editLabel`/`editAria` 분리 패턴과 동일한 브래킷-visible/clean-aria 구조. 변경 파일: `frontend/src/pages/Profile.tsx`, `frontend/src/i18n/dicts/profile.ts`.
- **[feat]** **게시글 삭제(작성자 전용) — `DELETE /posts/:id` + Thread 편집/삭제 버튼**: 기존엔 글 작성자가 글을 **수정**(`PATCH /posts/:id`)만 할 수 있고 **삭제**할 방법이 없었다. 작성자 전용 삭제 경로를 백엔드·프론트 양쪽에 추가한다.
  - **백엔드 `DELETE /posts/:id`**: `PATCH /posts/:id`와 **동일한 인증·소유권 게이트**를 그대로 미러링한다 — `requireAuth`(토큰 없으면 401), 글 조회 후 없으면 404 `{error:"Post not found"}`, 토큰 파생 `userId`가 작성자가 아니면 403 `{error:"Only the author may delete"}`. Prisma 스키마의 `Post` 자식 관계에 `onDelete: Cascade`가 **없으므로**, 단일 `prisma.$transaction` 안에서 FK 제약을 만족하는 **고정 순서**로 직접 삭제한다: ① `vote.deleteMany({postId})` → ② `bookmark.deleteMany({postId})` → ③ `comment.updateMany({postId}, {replyToId:null})`(자기참조 `ReplyChain` FK를 먼저 끊음) → ④ `comment.deleteMany({postId})`(`Comment.segmentId` FK 때문에 세그먼트보다 **댓글을 먼저** 삭제) → ⑤ `contextSegment.deleteMany({postId})` → ⑥ `post.delete({id})`. (`ContextSegment.summaryCommentId`는 FK 관계가 없는 느슨한 `String?`이므로 별도 처리 불필요.) 응답은 파일 내 다른 DELETE 라우트(upvote/bookmark)와 동일하게 200 + 작은 JSON ack `{ deleted: true }`를 반환(프론트 `request` 헬퍼가 빈/JSON 본문 모두 처리하므로 호환).
  - **프론트 클라이언트 `deletePost(id, userId?)`**: `removeBookmark`/`removeUpvote`와 동일한 시그니처로 `request('/posts/:id', { method:'DELETE', userId })`를 호출(식별자는 헤더 JWT로 전달, `userId`는 호출처 호환용).
  - **Thread 편집/삭제 버튼(작성자 전용 + 인라인 2단계 확인)**: 글 상세 헤더의 기존 `[ 편집 ]` 링크 **바로 옆**에 `[ 삭제 ]` 버튼을 추가(동일 가드 `myUserId && post.authorId === myUserId`). 삭제 버튼은 편집 버튼과 같은 버튼 스타일 패밀리에 위험색(`term-danger`, Settings 키 삭제 버튼과 동일 팔레트)을 입힌다. 1차 클릭 시 인라인 확인 어피던스(`thread.deleteConfirm` 문구 + `thread.deleteConfirmYes` 확인 버튼 + `thread.deleteCancel` 취소 버튼)로 전환, 취소 시 상태 리셋. 확인 시 `deletePost(post.id, myUserId)` 호출 → 성공하면 커뮤니티 slug를 알면 `/c/{slug}`로, 모르면 `/`로 이동. 실패 시 기존 토스트(`showAiToast`)로 `thread.deleteFailed` 노출. 요청 진행 중에는 버튼 비활성화. 삭제 버튼 `aria-label`=`thread.deleteAria`, 터치 타깃 min-h 44px(편집 버튼과 동일 접근성).
  - **i18n 키 변경(ko/en 대칭)**: `editLabel` 라벨을 브래킷 스타일로 변경(ko `[ 편집 ]`/en `[ Edit ]`). 신규 키 6종 추가 — `deleteLabel`(ko `[ 삭제 ]`/en `[ Delete ]`), `deleteAria`(ko `게시글 삭제`/en `Delete post`), `deleteConfirm`(ko `삭제할까요?`/en `Delete?`), `deleteConfirmYes`(ko `[ 확인 ]`/en `[ Confirm ]`), `deleteCancel`(ko `[ 취소 ]`/en `[ Cancel ]`), `deleteFailed`(ko `삭제에 실패했습니다.`/en `Failed to delete the post.`).
  - **테스트**: `contract.test.ts`에 `DELETE /posts/:id` describe 블록 추가 — (a) 작성자 삭제 성공 + 이후 `GET`→404, (b) 다른 인증 사용자→403, (c) 미존재 id→404, (d) 댓글 1개 + 추천/북마크가 있는 글도 FK 에러 없이(cascade) 삭제 성공.
  - **변경 파일**: `backend/src/routes/posts.ts`, `backend/test/contract.test.ts`, `frontend/src/api/rest.ts`, `frontend/src/pages/Thread.tsx`, `frontend/src/i18n/dicts/thread.ts`. (TRD §3 엔드포인트 표·WIREFRAME §6.3-C 갱신)

### 2026-06-23
- **[fix]** **프로필 설정 버튼 — 라벨("설정")을 가로·세로(좁은 화면) 모두 항상 노출**: `Profile.tsx` 헤더의 `/me/settings` 링크가 톱니바퀴 아이콘 + 라벨 구성인데, 라벨 `<span>`에 `hidden sm:inline`이 걸려 있어 **`sm`(640px) 미만(세로/좁은 화면)에서는 톱니바퀴 아이콘만** 보였다. 사용자 요청에 따라 `hidden sm:inline`을 제거해 화면 폭과 무관하게 "톱니바퀴 + 설정"을 일관되게 표시한다. 링크 컨테이너는 이미 `inline-flex items-center gap-1.5`라 아이콘-라벨 간격은 그대로 유지. (`frontend/src/pages/Profile.tsx`)
- **[fix]** **로그아웃 시 BYOK Gemini 키 보존 — `logout()`이 키를 지우던 동작 제거**: 명시적 로그아웃(`logout()`)이 `set({ ..., googleApiKey: null })`로 로컬 Gemini 키까지 비웠다. persist `partialize`가 `googleApiKey`를 localStorage에 저장하므로, 이 시점에 **저장된 키가 localStorage에서도 `null`로 덮어써졌고**, 이후 재로그인 시 키를 다시 입력해야 했다. 사용자 요청(로그아웃해도 키 보존)에 따라 `logout()`에서 `googleApiKey: null`을 제거해 `clearSession()`과 동일하게 **식별자·토큰만 비우고 키는 유지**하도록 변경. 토큰 만료(401→`clearSession`)·명시적 로그아웃(`logout`) 두 경로 모두 이제 BYOK 키를 보존한다. 키를 의도적으로 지우는 경로는 설정 화면의 키 삭제 버튼(`updateKey('')`, `Settings.tsx`)으로 단일화. `AuthState.logout`의 JSDoc도 "키 유지"로 정정. ⚠️ 게스트 정체성은 비밀번호가 없어 로그아웃 후 복구 불가라는 점(`auth.guestEphemeralWarning`)은 불변 — 이번 변경은 **로컬 키 보존**일 뿐 게스트 계정 복구와는 무관. (`frontend/src/stores/authStore.ts`)
- **[feat]** **로그인 폼 — 저장된 Gemini 키가 있으면 입력창에 "저장됨" 표시**: localStorage에 키가 이미 있으면(`useAuthStore.googleApiKey`) 키 입력 필드 라벨 옆에 녹색 배지(`auth.apiKeyStoredBadge`)를 띄우고, placeholder를 "저장된 키 유지 (변경하려면 입력)"(`auth.apiKeyStoredPlaceholder`)로 바꾸며, 안내문을 "비워두면 기존 키를 그대로 사용 / 새 키 입력 시 교체"(`auth.apiKeyStoredHint`)로 교체한다. 키를 평문 prefill하지 않고(비밀번호 타입 필드) **표시만** 한다 — 비워두고 로그인하면 `LoginForm`의 `if (apiKey.trim()) updateKey(...)` 가드에 의해 기존 키가 그대로 유지되고, 새 키를 입력하면 교체된다. 신규 i18n 키 3종(`apiKeyStoredBadge`·`apiKeyStoredPlaceholder`·`apiKeyStoredHint`)을 ko/en 대칭으로 추가. (`frontend/src/components/LoginForm.tsx`, `frontend/src/i18n/dicts/auth.ts`)
- **[docs]** **PATENT.html 심사관 거절이유·외부 사실검증 반영 보정**: 의견제출통지 상당의 지적(진보성·과장기재·기재불비)과 외부 사실검증에 따라 특허 명세서 초안을 정정. ① 독립항 1·13·17을 아키텍처 일반(클라이언트 위임 요약)에서 진보적 핵심(멱등 가드 winner 201/loser 409 + segmentExpected 낙관적 동시성에 의한 상호 불신 복수 클라이언트 동시 압축 조정)으로 한정 보정. ② 배경기술에 가장 근접 선행기술 US9569428B2 명시 인용·차별화 및 Otter US20240395254A1·IBM US8914452B2·Wu et al. arXiv:2109.10862·HAT arXiv:2406.06124·Context-Aware Hierarchical Merging arXiv:2502.00977 등 구체 선행문헌 인용, BYOK 프록시 SSRF 서술을 CVE 인용(LobeChat CVE-2024-32964, NextChat CVE-2026-7177/CVE-2023-49785) 및 "검증되지 않은 프록싱의 경향적 위험"으로 정정. ③ 효과의 절대표현 정정: "추론비용 영(零)"→"LLM 추론 호출 비용 비귀속(인프라 비용 별도)", "키 유출 차단"→"스크립트 연결 채널(fetch/XHR/WS/SSE) 유출 차단 + 잔여 채널 caveat", "SSRF 표면 부재"→"서버측 표면 제거·위험 재배치", "무한 지속"→"지속적 압축·유지". ④ 청구항 3·16 CSP 한정, 청구항 11 결과적→구조적 재기재, 청구항 12 태그 (k) 부여, 청구항 17에 409 재조립 동작 추가. ⑤ "무상태"를 "LLM 추론 비보유"로 한정, 임계치 부등호를 전 문서 "초과(>)"로 통일, gemini-3.1-flash-lite/엔드포인트 caveat·SSE 단방향 caveat·100a/100b 부호 도입 추가. HTML 무결성(SVG 6개 well-formed, 외부 의존 0) 유지. (`PATENT.html`)
- **[fix]** **i18n 커버리지 감사 — 하드코딩 사용자 노출 문자열 3건을 t()/tn()으로 라우팅**: KO/EN 전수 검사(사전 키 대칭·미번역·dangling 참조·하드코딩) 결과, 사전 11개 네임스페이스의 ko↔en 키는 **완전 일치**(미번역·dangling 0건)였고 `t()`를 거치지 않은 사용자 노출 문자열 3곳만 발견되어 정정한다.
  - `pages/CreatePost.tsx` 이미지 드롭존 하단 헬퍼 `PNG · JPG` → `t('post.image_attach_hint')`. dict `post`에 `image_attach_hint`(ko/en 동일 `'PNG · JPG'`) 신설.
  - `pages/CreateCommunity.tsx` slug 입력 placeholder `home-cooking` → `t('community.fieldSlugPlaceholder')`. dict `community`에 `fieldSlugPlaceholder`(ko/en 동일 `'home-cooking'` — slug는 ASCII) 신설.
  - `api/rest.ts` 비-2xx 폴백 메시지 `Request failed: {status} {statusText}`(`request`·`uploadImage` 2곳) → 비-React 모듈이므로 `tn('misc.request_failed', { status, statusText })`로 통합. dict `misc`에 `request_failed`(ko `'요청 실패: {status} {statusText}'` / en `'Request failed: {status} {statusText}'`) 신설. 서버가 사람이 읽을 메시지를 줄 때는 그대로 노출하고, 메시지가 없을 때만 이 폴백에 도달.
  - 신규 키 3종은 ko/en 양쪽 동시 추가로 대칭 유지. 브랜드명(`Aidit`)·기술 배지(`API KEY`/`PERSONA`)·API 키 포맷 예시(`AIza…`)·장식용 터미널 토큰(`[x]`/`[AI] >`) 등은 의도된 비-번역 문자열로 판단해 제외. (`frontend/src/pages/CreatePost.tsx`, `frontend/src/pages/CreateCommunity.tsx`, `frontend/src/api/rest.ts`, `frontend/src/i18n/dicts/post.ts`, `frontend/src/i18n/dicts/community.ts`, `frontend/src/i18n/dicts/misc.ts`)
- **[docs]** **README를 소개 글로 전면 갱신**: 소개 단락에 "글 하나=누적 대화 하나" 컨셉 + **설계 목표 4개**(서버 LLM 비용 0·키 노출 면적 최소화·무한 스레드·마찰 없는 진입)를 추가하고, 인증 서술을 위 `[refactor]`의 **런타임 듀얼모드**(비밀번호 유무로 게스트/회원 분기)·**2탭 로그인**·JWT 슬라이딩 갱신에 맞춰 정정(폐기된 `AUTH_SIGNUP_REQUIRED` 플래그 서술을 주요 기능·보안 메모·Pages 배포 절에서 제거). 스레드는 `@AI` 멘션→**입력창 AI 토글** + AI/사람 버블 **GFM 마크다운 렌더링** 명시, 프로필 키 변경/삭제·탭형 무한 스크롤 반영, 빠른 시작 접속 안내를 게스트 진입 기준으로 교체. (`README.md`; commit `4c1136d`)
- **[refactor]** **회원가입 토글 플래그 제거 → 런타임 듀얼모드 + 2탭 로그인 UI**: 서버 기동 시 모드를 고정하던 `AUTH_SIGNUP_REQUIRED` 플래그를 **완전히 제거**하고, 게스트·회원 두 모드를 **런타임에 공존**시킨다. 핵심 결정:
  - **3엔드포인트 항상 활성**: `POST /auth/register`·`POST /auth/session`·`POST /auth/guest`를 모드 게이팅 없이 **항상 활성**으로 둔다(기존 `describe.skipIf`/403 분기 폐기). `POST /auth/refresh`는 그대로(게스트·회원 공통 슬라이딩 갱신).
  - **입력 → 모드 규칙**: 요청 본문의 `password` 유무로 분기한다. 비밀번호 **비어있음 → 게스트**(`POST /auth/guest`, 닉네임만), 비밀번호 **차있음 → 회원**(신규 아이디=`POST /auth/register`, 기존=`POST /auth/session`). Google API 키는 모드와 **직교**(서버 미전송·localStorage 전용)이라 어느 모드든 동일하게 동작한다.
  - **게스트 닉네임 — 선점 검사 없음**: 최대 16자·`#` 입력 금지, 서버가 `base#hex4`(예 `철수#a3f9`)를 부여한다. **선점(중복) 검사를 하지 않는다** — 항상 `#hex4` suffix로 유일해지며, 회원 username의 `plain` 네임스페이스와 **절대 충돌하지 않는다**. 회원 username의 `#` 입력 금지는 유지(두 네임스페이스 분리).
  - **2탭 로그인 UI**: 로그인 화면을 **[게스트] / [로그인]** 2탭으로 구성. 기본 탭은 localStorage(persist key `aidit-auth`)에 직전 식별(username)이 있으면 **[로그인]**, 없으면 **[게스트]**. [로그인] 탭은 상단 서브토글 없이 **하단 링크 하나**로 로그인↔회원가입을 전환(회원가입 시 비밀번호 확인 필드 노출).
  - **제거 대상**: 백엔드 `config.signupRequired` + `AUTH_SIGNUP_REQUIRED` env, 프론트 `frontend/src/config/auth.ts`(`VITE_AUTH_SIGNUP_REQUIRED`), 백엔드 `vitest.guest.config.ts` + `package.json`의 `test:guest` 스크립트, `contract.test.ts`의 `describe.skipIf` 게이팅, `vitest.config.ts` env의 `AUTH_SIGNUP_REQUIRED` 핀.
  - **보안·승격**: 보안 트레이드오프는 이번 범위에서 무시(사용자 명시). 게스트→회원 승격은 future feature(PRD §5.2에 이미 문서화)로 이번 범위 아님.
  - **변경 파일**(예정): `backend/src/config.ts`, `backend/src/routes/auth.ts`, `backend/.env.example`, `backend/vitest.config.ts`, `backend/vitest.guest.config.ts`(삭제), `backend/package.json`, `backend/test/contract.test.ts`, `backend/test/helpers.ts`, `frontend/src/config/auth.ts`(삭제), `frontend/.env.example`, `frontend/src/stores/authStore.ts`, `frontend/src/components/LoginForm.tsx`, `frontend/src/i18n/dicts/auth.ts`. (PRD FR-2.7·TRD §4 갱신) — 아래 기존 2026-06-23 `[chore]`/`[feat]` 항목은 이 리팩터가 대체한 직전 구현의 **이력**으로 보존한다.
- **[chore]** **`AUTH_SIGNUP_REQUIRED` 기본값 OFF(게스트 모드) 전환**: 백엔드(`config.ts`)·프론트(`config/auth.ts`)·양쪽 `.env.example` 기본값을 모두 `false`로 바꿔 **게스트 모드를 기본**으로 한다 — 회원가입 모드는 `AUTH_SIGNUP_REQUIRED=true`/`VITE_AUTH_SIGNUP_REQUIRED=true`로 **명시**해야 켜진다. 테스트는 `backend/vitest.config.ts` env에 `AUTH_SIGNUP_REQUIRED:"true"`를 고정해 `npm test`=ON·`npm run test:guest`=OFF 두 모드 커버리지를 프로덕션 기본값과 무관하게 유지. (`backend/src/config.ts`, `backend/.env.example`, `backend/vitest.config.ts`, `frontend/src/config/auth.ts`, `frontend/.env.example`; PRD FR-2.7·TRD §4 갱신)
- **[feat]** **회원가입 토글(게스트 모드) + JWT 슬라이딩 갱신 구현 — `AUTH_SIGNUP_REQUIRED`**: 환경 플래그 하나로 서버 기동 모드를 분기한다. 플래그 **OFF**면 회원가입/비밀번호 없이 **닉네임(+로컬 API 키)만으로 게스트 진입**, **ON**이면 기존 username+password 회원가입(현행 유지). 기존 JWT 흐름과 호환 — 스키마 `passwordHash`가 nullable이고 `requireAuth`가 토큰의 `sub`만 검증하므로, 게스트에게 발급한 JWT가 모든 쓰기 게이트(`posts`/`communities`/`comments`)를 코드 변경 없이 통과한다. **구현된 라우트 모델**(설계 검토 시 "password 검증 분기"보다 깔끔한 라우트 가용성 분기로 확정): `signupRequired=true`(ON)이면 `POST /auth/register`·`POST /auth/session` 활성·`POST /auth/guest` 403; `signupRequired=false`(OFF)이면 register·session 403(`Signup is disabled`)·guest 활성. `POST /auth/refresh`는 양 모드 공통. **검증**: 백엔드 `tsc` 클린 + `npm test`(ON) 65 pass/4 skip + `npm run test:guest`(OFF) 59 pass/10 skip, 프론트 `tsc` 클린 + 43 pass. **확정·구현된 설계**:
  - **플래그 이름·배치**: 공통 베이스 이름 `AUTH_SIGNUP_REQUIRED`(**기본 `false`=게스트 모드**; `true`로 명시 시 기존 회원가입 모드). **프론트·백엔드가 각자 `.env`를 보유** — 백엔드는 `AUTH_SIGNUP_REQUIRED`, 프론트는 Vite 관례대로 `VITE_` 접두사를 붙여 `VITE_AUTH_SIGNUP_REQUIRED`로 둔다(`import.meta.env.VITE_AUTH_SIGNUP_REQUIRED`). `VITE_` 접두사는 "브라우저 번들에 노출되는 공개값" 경계를 뜻하며 회원가입 모드는 공개 정보라 적합 — `vite.config.ts` 변경 불필요. 베이스 이름이 같아 수동 동기화가 단순하다(앞에 `VITE_`만 붙임). 두 값의 동기화는 **운영자가 수동**으로 맞춘다. 프론트는 빌드타임 `import.meta.env`로 모드를 읽으므로 서버 모드 조회용 런타임 엔드포인트(예전에 검토한 `GET /health` 확장)는 **불필요·폐기**.
  - **게스트 식별자**: 사용자가 입력한 **베이스 닉네임(최대 16자, `#` 문자 입력 금지)** 뒤에 서버가 **`#` + hex 4자리**(예: `철수#a3f9`, 공간 16⁴=65536)를 자동 부여. 저장 `username` = 결합 문자열 → 스키마 `@unique` 그대로 유지(마이그레이션 불필요), 희박한 충돌 시 서버가 식별자만 재생성. **외부·내부 표시 모두** 결합 문자열을 사용. `#` 입력 금지는 회원가입(ON) username에도 적용해 두 네임스페이스가 섞이지 않게 한다.
  - **게스트 토큰**: `POST /auth/guest`(베이스 닉네임 검증 1~16자·`#` 금지 → `base + '#' + randomBytes(2).toString('hex')` 결합 → `prisma.user.create` `passwordHash=null` → `app.jwt.sign({ sub })`, 201 `{ token, id, username }`). Prisma P2002(unique) 충돌 시 식별자만 최대 8회 재시도, 소진 시 409(이론상 거의 불가, 무한 루프·미정의 토큰 방지용 안전장치). 만료 기준은 기존 `JWT_EXPIRES`(7일)와 동일.
  - **JWT 슬라이딩 갱신**: `POST /auth/refresh`(Bearer 필수 → `requireAuth`로 userId 확인 → 실제 user 존재 확인 → 새 토큰 서명, 200 `{ token }`). 프론트는 **앱 오픈 시 1회**(`AppLayout` 마운트 useEffect) 호출 → 만료가 **마지막 활동 + 7일**로 밀린다(게스트·회원 공통). 단 완전 만료/로그아웃 후엔 비밀번호가 없는 게스트 정체성은 복구 불가.
  - **API 키**: 게스트도 키 없이 글/댓글 작성 가능(AI 호출 시에만 키 필요) — 현행 BYOK·로컬 전용(`authStore.googleApiKey`) 불변, 백엔드 무변경.
  - **테스트 — 플래그에 따라 다르게 동작(문서화 확정)**: 테스트는 `app.inject`로 실제 앱을 두드리며, 워커 포크는 **`vitest.config.ts`의 `env:` 블록**에서만 env를 받는다(`setup-global.ts`의 `process.env` 변경은 포크에 전파되지 않음). 따라서 모드 분기의 기준값도 여기서 제어한다.
    - **모드 선택 메커니즘**: `config.signupRequired`(= `process.env.AUTH_SIGNUP_REQUIRED`)를 단일 기준으로 삼는다. 기본 실행(`npm test`)은 **ON**(`vitest.config.ts` `env`에 `AUTH_SIGNUP_REQUIRED:"true"` 고정). OFF 모드 실행(`npm run test:guest`)은 `vitest.guest.config.ts`(env에 `AUTH_SIGNUP_REQUIRED:"false"`)로 구동. **두 모드를 모두 검증**하기 위해 `backend/package.json`에 스크립트 2개를 둔다 — `test`(ON, 기본) + `test:guest`(`AUTH_SIGNUP_REQUIRED=false`로 동일 스위트 재실행), CI는 둘 다 실행. (`.env`가 이 플래그를 고정하면 테스트 기준값을 가리므로 `backend/.env`엔 넣지 않거나, 테스트 env가 우선하도록 둔다.)
    - **`helpers.ts::createUser` 모드 인지형**: ON이면 기존대로 `POST /auth/register`(password `"password123"`). OFF이면 `POST /auth/guest`(닉네임만)로 사용자/토큰 확보. 두 경로 모두 `{ id, username, token }`을 반환해 **하위 테스트는 동일 인터페이스로 동작**한다. ⚠️ OFF 모드에선 반환 `username`이 입력값이 아니라 **`닉네임#hex4`**(서버 부여)이므로, username 일치 단언은 입력값이 아니라 **반환된 username**을 기준으로 한다.
    - **`contract.test.ts` 케이스 게이팅**: ① register/session/비밀번호 검증·중복 409 케이스 → **`describe.skipIf(!config.signupRequired)`**(ON 전용). ② 게스트 진입(`/auth/guest`: 닉네임만 201+token, `#hex4` 부여, `#` 입력 거부, 16자 초과 거부)·슬라이딩 갱신(`/auth/refresh`: 유효 토큰→새 토큰, 무효/만료 401) 케이스 → **`describe.skipIf(config.signupRequired)`**(OFF 전용, 신규). ③ 공통 쓰기 계약(posts/communities/comments/upvote/bookmark)은 `createUser`로 토큰을 얻어 **두 모드 모두에서 실행** — register 토큰이든 guest 토큰이든 `requireAuth`를 동일하게 통과함을 검증.
  - **변경 예정 파일**(커밋 순서 docs→config→backend→frontend→test): `backend/src/config.ts`(`signupRequired` 플래그), `backend/.env.example`(`AUTH_SIGNUP_REQUIRED`), `backend/src/routes/auth.ts`(password 검증 분기 + `POST /auth/guest` + `POST /auth/refresh`), `frontend/.env.example`(`VITE_AUTH_SIGNUP_REQUIRED`), `frontend/src/config/*`(플래그 읽기), `frontend/src/api/rest.ts`(`guestLogin`·`refreshToken`), `frontend/src/stores/authStore.ts`(게스트 진입·토큰 갱신 액션), `frontend/src/components/LoginForm.tsx`(모드별 UI), `frontend/src/i18n/dicts/auth.ts`(`guestStartBtn`·`guestNameNote`·`guestEphemeralWarning` ko/en). (PRD FR-2.7·TRD §3·§4 갱신)
- **[feat]** **채팅 버블 마크다운 표시 스타일(`prose-chat`) 정의 + 표·이미지 허용**: AI/사람 댓글·요약은 이미 `SafeMarkdown`(marked `gfm:true,breaks:true` → DOMPurify)로 마크다운을 렌더하고 있었으나, 버블이 붙이던 `prose-chat` 클래스의 **CSS 정의가 없어** Tailwind preflight가 목록 불릿·제목 크기·코드 배경·인용·링크 스타일을 모두 리셋 → 밋밋하게 표시됐다. 수정:
  - `index.css` `@layer components`에 **`.prose-chat` 타이포그래피 정의**(그린 CRT 팔레트): 문단 간격, `ul/ol` 불릿·들여쓰기, `h1~h3` 크기·굵기(`#aaffc0`), 링크 밑줄+색, 인라인/블록 `code` 배경·테두리, `blockquote` 좌측 바, `hr`, **GFM 표**(자체 가로 스크롤 — 페이지 가로 스크롤 금지 준수), **이미지**(`max-width:100%`).
  - `sanitize.ts` XC-3 allowlist 확장: `table/thead/tbody/tr/th/td`·`img` 태그와 `src/alt/align` 속성 추가. `ALLOWED_URI_REGEXP`는 http(s)/mailto 유지(이미지 `src`도 동일 제약 — `data:`/`javascript:` 차단).
  - 버블 3곳(`ChatBubble`, `SummaryBubble`×2)에서 `whitespace-pre-wrap` 제거(`break-words` 유지) — `breaks:true`가 줄바꿈을 `<br>`로 이미 처리하므로 블록 간 빈 줄 중복을 없앰.
  - **넓은 표/코드 스크롤 격리(버블 안 가로 스크롤)**: 넓은 표/코드가 들어오면 버블 자체가 커지며 버블 전체가 좌우 스크롤되던 문제 수정. 원인은 flexbox `min-width:auto`(버블 클러스터가 표의 min-content 아래로 못 줄어 `max-w-[78%]`를 무시). `ChatBubble` 버블 클러스터에 **`min-w-0`** 추가 → 클러스터가 78%로 묶이고 내부 표/코드만 `overflow-x:auto`로 스크롤(페이지·버블 가로 스크롤 없음).
  - **느슨한 굵게 정규화**: AI가 `** 텍스트 **`처럼 별표 안쪽에 공백을 넣어 출력하면 CommonMark 규칙상 굵게 처리되지 않던 문제. `sanitize.ts`에 `normalizeLooseBold`를 추가 — **코드(펜스/인라인)를 PUA 센티넬로 마스킹**한 뒤 `**…**` 안쪽 공백만 정규화하고 복원(코드 내 `**kwargs` 등 불변, 본문 숫자 불변). 단일 `*`는 불릿·곱셈 충돌로 제외. **추가**: 단어에 공백 없이 붙으면서 안쪽이 따옴표 등 구두점으로 시작/끝나는 굵게(예: `앞**'내용'**뒤`, `김치는**'적당량'**넣어요`)는 CommonMark flanking 규칙상 literal로 남는데, 그 런(run)만 `<strong>`으로 강제 변환(공백 분리/단독/일반 intraword 굵게·`***굵은기울임***`·코드/숫자는 불변). 실제 `renderMarkdownSafe`로 16+개 패턴 회귀 검증.
  - **CSP 주의(미변경)**: 프론트/백 CSP `img-src 'self' blob: data: [api-origin]`라 **마크다운의 외부 https 이미지는 CSP에 막혀 렌더되지 않는다**. 외부 이미지를 실제 표시하려면 `img-src` 확장이 필요(보안 트레이드오프) — 이번 변경엔 미포함. (`frontend/src/index.css`, `frontend/src/lib/sanitize.ts`, `frontend/src/lib/sanitize.test.ts`, `frontend/src/components/ChatBubble.tsx`, `frontend/src/components/SummaryBubble.tsx`)
- **[feat]** **Thread 원본 게시글 카드에 카테고리(커뮤니티) 링크 추가**: `★ 원본 게시글` 카드의 코너 라벨 아래·제목 위에 글의 커뮤니티를 한 줄로 표시한다 — `{personaIcon} {community.name} · r/{slug}`. 문자를 누르면 `/c/{slug}` 커뮤니티 페이지로 이동(react-router `<Link>`, PostCard의 커뮤니티 라인과 동일 패턴/클래스 `text-xs text-term-dim hover:text-term-bright`). 출처는 Thread가 이미 보유한 `community` 상태(slug·name·personaIcon)이며, 미해결 시 라인 생략. 서버·라우트·데이터 계약 무변경(표현 계층만). (`frontend/src/pages/Thread.tsx`; WIREFRAME §6.3-D 갱신)
- **[feat]** **Composer AI 모드를 입력창에 통합(트레일링 팝오버) + 키 기반 기본값 + 수동 @AI 단축 제거**: 입력 위에 쌓이던 "컨트롤 행([X] AI 모드 토글 + 길이 세그먼트)"과 입력 내부 `@AI` 칩 적층을 폐기하고, AI 컨트롤을 **입력 바 우측의 트레일링 `[🤖 AI ⌄]` 칩 하나**로 접었다. 칩 탭 → 입력 바 위로 **한 줄 팝오버**(`[🤖 AI]` 사용/끄기 토글 + 구분선 + `[ 짧게 ][ 보통 ][ 길게 ]` 길이)가 열린다. 세부:
  - **키 기반 기본값**: 스레드 진입 시 BYOK Gemini 키가 있으면 AI **ON**, 없으면 **OFF**로 시작. `aiModeStore`는 명시적 override만 보관(미설정=키 유무로 결정)하도록 의미를 바꾸고, 기본값 계산은 호출처(`Composer`)가 `useAuthStore().googleApiKey`를 반응형으로 읽어 수행. 토글은 `set(postId, next)`로 명시값 기록(기존 `toggle`의 `?? true` 기본값 의존 제거).
  - **키 없음 가드 — AI 켜기 차단**: BYOK Gemini 키가 없으면 **AI를 켤 수 없다**. 팝오버에서 AI 토글을 눌러도 켜지지 않고(`aiMode` OFF 유지), **팝오버 안에 앰버 경고**(`thread.aiNoKeyHint` "Gemini 키가 없어 AI를 켤 수 없어요." + `키 등록하기 →` → `/me/settings`)만 뜬다. 파생식 `aiMode = hasApiKey ? (override ?? true) : false`로 stale override가 있어도 키 없이는 ON 불가. 기존 "전송 시 `aiNoKey` 토스트"는 제거. (키 없는 사용자의 댓글은 항상 일반 댓글로 등록 — human-first 불변)
  - **수동 `@AI` 단축 제거**: 본문 `@AI` 타이핑 라우팅(`AI_MENTION`/`hasMention`)과 멘션 안내 행(`mentionIndicator`)을 삭제. AI 여부는 **오직 토글**로 결정(`wantsAI = aiMode`). Thread 셸 프롬프트 스왑(`onWantsAIChange`)도 그대로 토글값만 반영.
  - **상태 신호 동기화**: AI ON이면 트레일링 칩·입력 보더 `term-amber` + placeholder `@AI 메시지 보내기…`, OFF면 `term-border` 녹색 + `메시지 보내기…`. 길이 세그먼트는 AI OFF 시 비활성(disabled). 팝오버 버튼 터치 타깃 ≥44px, 길이 선택 시 팝오버 자동 닫힘, 바깥 클릭/Esc로 닫힘.
  - **i18n**: `placeholderAi`(ko `@AI 메시지 보내기…`/en `Message @AI…`)·`placeholderHuman`(ko `메시지 보내기…`/en `Send a message…`) 카피 교체, 신규 `aiMenuAria`·`aiNoKeyHint`·`aiNoKeyCta` 추가, 미사용 `mentionIndicator`·`atAiChipAria`·`aiNoKey` 제거. `aiModeLabel`은 팝오버 토글 `aria-label`로 재활용.
  - (`frontend/src/components/Composer.tsx`, `frontend/src/stores/aiModeStore.ts`, `frontend/src/i18n/dicts/thread.ts`; WIREFRAME §6.3-F·PRD FR-6 갱신)

### 2026-06-22
- **[feat]** **긴 스레드 스크롤 점프 — 우측 하단 방향식 단일 점프 칩(Option A)**: 긴 대화에서 위/아래 끝까지 빠르게 이동하도록 스크롤 영역 우측 하단에 **사각 칩 하나**를 띄우되 **스크롤 방향**을 따른다 — 내리면 `↓`(맨 아래로), 올리면 `↑`(맨 위로). 슬롯에는 항상 한 개만 뜨고(거리·속도 무관, 방향만으로 결정), 멈추면 ~1초 후 페이드아웃해 읽는 동안 버블을 가리지 않는다. 세부:
  - **상태·방향 판정**: 단일 `activeChip`(`'none' | 'top' | 'bottom'`). 매 스크롤의 `scrollTop` 변화량 `dY` **부호로 방향 판정** — `dY < -2`(위로)면 `top`, `dY > 2`(아래로)면 `bottom`, 절댓값이 deadzone(`SCROLL_DIR_DEADZONE = 2px`) 미만인 미세 떨림은 현재 칩 유지. 스크롤마다 idle 타이머(1초) 재무장 후 만료 시 `'none'`.
  - **자기 트리거 차단**: `jumpTo(edge)`는 `isProgrammatic` ref를 세워 **스무스 스크롤이 만든 스크롤 이벤트가 칩을 재무장하지 못하게 차단**하고 탭 즉시 칩을 숨긴 뒤, `scrollRef` 컨테이너를 양 끝으로 `scrollTo`(top→`{top:0}`, bottom→`{top:scrollHeight}`)한다. `prefers-reduced-motion`이면 smooth→auto(CRT 커서 정책)로 내리고, ~700ms(reduce 시 0ms) 후 플래그를 해제하며 `lastScrollTop`을 동기화.
  - **레이아웃·시각**: 래퍼는 `sticky bottom-3 h-0`라 트레일링 스크롤 공간을 만들지 않고, 내부 박스는 하단 모서리에 앵커(`absolute bottom-0 right-3`). 칩은 `h-10 w-10 rounded-[2px]` 사각, `bg-term-card/85 backdrop-blur`(반투명+블러)로 버블 위에 떠도 분리되며 hover 시 `shadow-glow-soft`.
  - **a11y·비활성화**: 숨김 상태(`activeChip==='none'`)에선 `opacity-0` + `pointer-events-none` + `tabIndex -1` + `aria-hidden`으로 완전히 비활성화. 라벨·아이콘·`onClick`은 `activeChip`에 따라 스왑(`↑`=`M6 15l6-6 6 6`, `↓`=`M6 9l6 6 6-6`), aria-label은 `thread.jumpTopAria`("맨 위로 이동"/"Scroll to top")·`thread.jumpBottomAria`("맨 아래로 이동"/"Scroll to bottom") ko/en. `─ 대화 ─` 구분선은 점프 컨트롤 없는 평범한 인플로우 구분선으로 둔다. (`frontend/src/pages/Thread.tsx`, `frontend/src/i18n/dicts/thread.ts`; WIREFRAME §6 갱신 항목과 동일 사양)
- **[chore]** **Composer 컨트롤 행의 BYOK 비용 힌트 문구 제거**: AI 컴포저 컨트롤 행에 매 진입마다 상시 노출되던 안내글 `thread.costHint`(ko `메시지마다 내 키로 호출됩니다` / en `Uses your key for every message`)와 그 툴팁 `thread.costHintTooltip`을 제거했다. 같은 정보(키 미설정 시 동작·비용)는 이미 `thread.aiNoKey` 토스트와 `@AI` 칩/AI 모드 토글의 시각 신호로 전달되므로 중복이라 판단. **변경**: ① `Composer.tsx`에서 비용 힌트 `<span>`(title 툴팁 포함) 삭제 — 컨트롤 행은 이제 `[X] AI 모드` 토글 + (wantsAI 시) 길이 셀렉터만 남음. ② 미사용이 된 i18n 키 `costHint`·`costHintTooltip`을 ko/en 사전에서 제거. (`frontend/src/components/Composer.tsx`, `frontend/src/i18n/dicts/thread.ts`)
- **[fix]** **설정의 키 삭제 버튼이 한글 화면에서도 `Remove`로 노출되던 i18n 누락**: `Settings.tsx`의 키 삭제 버튼 라벨이 `[ Remove ]` 하드코딩이라 한국어 UI에서도 영어로 보였다. 신규 i18n 키 `profile.keyRemoveBtn`(ko `[ 삭제 ]` / en `[ Remove ]`)을 추가하고 버튼을 `t('profile.keyRemoveBtn')`로 교체. (`frontend/src/i18n/dicts/profile.ts`, `frontend/src/pages/Settings.tsx`)
- **[fix]** **키 삭제 후에도 헤더 Gemini 배지가 초록(연결됨)으로 남던 버그**: `/me/settings`에서 키를 지워도(`updateKey('')`) 상단 `GeminiStatusBadge`가 직전 `connected`(초록 `●`) 상태 그대로 유지됐다. 원인은 `AppLayout`의 핑 effect가 **키가 *생기거나 바뀔* 때만** 다뤘기 때문 — `if (googleApiKey && googleApiKey !== lastPingedKey.current)` 가드는 빈 문자열(falsy)을 통과하지 못해, 키 제거 시 `geminiStatusStore`를 초기화하는 분기가 아예 없었다(배지는 마지막 쿼리 결과를 그대로 표시). **수정**: ① `geminiStatusStore`에 `reset()`(→ `{ status: 'unknown', lastKind: null }`) 액션 추가. ② `AppLayout` effect를 `googleApiKey`가 있으면 (변경 시) 핑, **없으면 `lastPingedKey` ref를 비우고 `reset()` 호출**하도록 분기 추가 → 키 삭제 즉시 배지가 `○ 미확인`으로 복귀하고, 같은 키 재입력 시 다시 핑이 한 번 돈다. (`frontend/src/stores/geminiStatusStore.ts`, `frontend/src/layout/AppLayout.tsx`)
- **[feat]** **BYOK 키 미설정 시 AI 게이트 완화 — 사람 댓글 우선, AI만 건너뜀**: 기존엔 AI 토글 ON(또는 수동 `@AI`)인데 Gemini 키가 없으면 Composer가 전송 자체를 **차단**하고 `navigate('/login')`로 **하드 리다이렉트**했다(`showToast(thread.aiNoKey)` → `return`). 키가 없는 사용자는 일반 댓글조차 남길 수 없었다. **변경**(`frontend/src/components/Composer.tsx`): `willInvokeAi = wantsAI && hasApiKey`로 분리하고, `wantsAI && !hasApiKey`이면 **`thread.aiNoKey` 토스트만 띄운 뒤 그대로 진행** — 사람 댓글은 정상 등록되고 **AI 호출만 조용히 생략**된다(리다이렉트·`return` 제거). 즉 **키가 없어도 앱(글/댓글 작성)은 정상 동작**하며, 키 미설정의 비용은 여전히 0(AI 미호출). 키가 있으면 기존 `@AI` 흐름 그대로. (commit `6ab6784`)
- **[feat]** **설정에 API 키 삭제(Remove) 액션 추가**: `/me/settings`의 API Key 섹션에 키가 설정돼 있을 때만 노출되는 **`[ Remove ]`** 버튼(위험색 `term-danger`)을 추가(`frontend/src/pages/Settings.tsx::removeKey` → `updateKey('')`). 기존 `[ 변경 ]` 버튼과 나란히 배치되며, 삭제 후 입력 초안/편집 모드를 초기화. 키 삭제는 **localStorage 로컬 전용**(L1 — 네트워크 미전송) 불변. 키를 지우면 위 AI 게이트 완화에 따라 이후 글/댓글은 AI 없이 계속 작성 가능. (commit `5362faa`)

### 2026-06-21
- **[feat]** **Profile(/me) 재설계 — 탭형 무한 스크롤 + /me/settings 분리**: 프로필 화면을 전면 재구성했다. 상세 내용:
  - **백엔드 keyset cursor 페이지네이션**: `GET /users/:id/posts`·`GET /users/:id/bookmarks`(북마크 행 anchor 기반)·`GET /users/:id/communities`에 keyset cursor 페이지네이션 적용. 세 라우트의 커서 인코딩·디코딩 로직을 공유 유틸(`backend/src/lib/cursorUtil.ts` 또는 동등 위치)로 추출해 중복 제거.
  - **rest.ts 페이지드 클라이언트**: `frontend/src/api/rest.ts`의 해당 세 fetcher가 `{ items, nextCursor }` envelope를 그대로 반환하는 paged client로 교체(기존 배열 반환에서 변경).
  - **Profile(/me) 탭 UI**: `/me` 화면을 **[ communities | posts | bookmarks ]** 세 탭으로 재작성. 각 탭은 독립적인 무한 스크롤을 가지며, 공유 `usePagedList` 훅(또는 동등 커스텀 훅)으로 페이지 상태·로딩·fetchMore 로직을 일원화. 탭 ShellPrompt는 `ls ~/<tab>` 패턴.
  - **설정 분리(/me/settings)**: 기존 /me에 인라인으로 있던 API Key 변경·언어 설정·로그아웃을 신규 `/me/settings` 페이지로 이동. /me 화면 상단에 설정 링크 추가. (2026-06-22 후속: API Key 섹션에 `[ Remove ]` 삭제 액션 추가 — 2026-06-22 항목 참조)
  - **신규 i18n 키**: 탭 레이블·설정 페이지 제목·빈 상태 메시지 등 관련 ko/en 사전 키 추가.
  - **Home 피드 미변경**: 홈 피드(`GET /posts` + Home 컴포넌트)는 이번 작업 범위 밖이며 완전히 untouched.

### 2026-06-20
- **[feat]** **댓글 AI 모드 기본 ON 전환**: `aiModeStore`의 스레드별 AI 모드 기본값을 **OFF → ON**으로 변경(`isOn`/`toggle` + `Composer` 읽기 3곳을 `?? false` → `?? true`). 스레드 진입 시 작성창이 **AI-우선**(체크박스 `[X]` · `@AI` 칩 · AI placeholder · 상단 프롬프트 `ai --ask /p/<id>`)이며, 일반 사람 댓글은 사용자가 토글을 끄면 된다. **트레이드오프**: 기존 "비용 안전 기본 OFF(BYOK 키를 의도적 opt-in으로만 소비)" 정책을 뒤집어 **기본적으로 사용자 키를 소비**한다 — 단, 키가 없으면 AI 호출이 일어나지 않으므로 키 미설정 시 비용 0. 세션 한정·미영속(하드 리로드 시 다시 ON). (§3, §5 — 2026-06-18 `aiModeStore` 도입 항목의 "기본 OFF"를 대체) **[2026-06-22 갱신]** 당시 "Composer의 전송 전 가드(키 없으면 AI 전송 차단 + 로그인 유도)는 불변"이라 적었으나, 2026-06-22 패치로 이 가드는 **차단/리다이렉트 없이 토스트 후 진행(사람 댓글 등록 + AI만 생략)** 으로 완화됐다(위 2026-06-22 항목 참조).
- **[feat]** **라이브 프롬프트 polish — ShellPrompt a11y·공유 util·파생 커맨드 반영**: ShellPrompt a11y 수정(전체 행 `aria-hidden="true"` + `role="presentation"` — 보조 기술이 장식 터미널 텍스트를 읽지 않도록; `aria-live` 미사용), 공유 순수 유틸 `src/lib/shellArg.ts::formatPromptArg` 도입(공백 압축 + ~32자 잘라내기 + 말줄임표 + 미관용 따옴표 이스케이프) + 단위 테스트, `CreateCommunity` 파생 slug 반영(`mkdir /c/<slug>`, 빈 slug → `mkdir /c/new`), `CreatePost` 잘라내기·이스케이프된 title 반영(`post --new r/<slug> "<title>"`, 빈 title → 기본 커맨드), `Thread` 정적 스왑(`tail -f /p/<id>` ↔ `ai --ask /p/<id>`, wantsAI boolean 콜백으로 리프트업; 라이브 댓글 텍스트 미러링은 의도적으로 제외). `Search`는 선례 화면으로 그대로 유지. 커맨드 문자열은 i18n 비적용 유지. (§4.13)
- **[feat]** **ShellPrompt 컴포넌트 추출 + 전 화면 확장**: 기존 Home 화면에만 하드코딩된 `aidit@yoon` 고정 문자열 프롬프트를 재사용 가능한 `src/components/ShellPrompt.tsx`로 추출. `authStore`에서 사용자명을 반응형으로 읽고 미로그인 시 `guest` 폴백 적용. 그린 CRT 터미널 스타일(`text-term-bright`, `glow`) + 블링킹 커서 애니메이션 보존. 8개 주요 화면(Home·Community·Thread·Search·CreatePost·CreateCommunity·Profile·Login)에 화면별 커맨드 매핑으로 일괄 적용. 기존 Home의 `aidit@yoon` 하드코딩 사용자명 버그 수정(로그인 사용자명 미반영 문제 해소). 커맨드 문자열은 번역 대상이 아님(i18n 비적용). (§4.12)
- **[feat]** **회원가입 비밀번호 확인 필드 + 좀비 세션 보강**:
  - **비밀번호 확인(UX)**: `LoginForm`의 회원가입 모드에 **`비밀번호 확인`** 필드 추가. 입력 중 불일치하면 인라인 빨간 힌트(`aria-invalid` + 빨간 테두리), 제출 시 `password !== confirmPassword`면 `'비밀번호가 일치하지 않습니다.'`로 가입 차단(서버 호출 전). 로그인 모드에는 미표시. 모드 토글 시 확인값 초기화.
  - **좀비 세션 보강**: JWT 게이트 이전 세션(또는 시크릿 교체/토큰 만료)으로 `username`은 있는데 유효 토큰이 없어 "로그인된 듯 보이나 모든 쓰기가 401"이던 상태를 제거. ① **로드 시**: `authStore` 모듈-init이 `userId`는 있고 `token`이 없으면 `clearSession()`으로 세션 정리(Gemini 키는 보존). ② **런타임**: `rest.request`가 **토큰을 첨부한 요청이 401**이면 신규 leaf `lib/authEvents.ts`의 `notifyAuthExpired()` 호출 → `AppLayout`이 등록한 핸들러가 `clearSession()` + 로그인 모달 오픈(login/register의 무토큰 401은 `tok` 가드로 제외). 신규 `clearSession` 액션은 신원/토큰만 비우고 `googleApiKey`는 유지(만료로 BYOK 키를 잃지 않게). 순환참조 회피: rest→authEvents(leaf)→AppLayout 등록 구조. tsc 클린 + 프론트 30 테스트 green.
- **[feat]** **KO/EN 양국어 UI (i18n)**: `langStore`(persist `aidit-lang`, 브라우저 기본값 초기화, `<html lang>` 동기화), `src/i18n`(`dicts/ko|en` + `useT` 훅 + `tn` 복수형 헬퍼), `LangToggle` 컴포넌트(헤더 + 프로필 화면). 전 네임스페이스(앱 셸·피드·스레드·작성·검색·프로필·인증·AI 메시지·에러) 문자열 마이그레이션 완료. AI 언어 배선: `systemInstruction` 디렉티브 + 언어-aware `SUMMARY_DIRECTIVE` + 언어-aware Gemini 에러 메시지 맵. UGC(사용자 작성 제목·본문·댓글)는 번역하지 않으며, URL 변경 없음. (§4.11)
- **[chore]** **로컬 `.env` 로드 + 실 `JWT_SECRET` 설정**: 기존엔 Prisma만 `.env`를 자동 로드해 앱 자체 변수(`JWT_SECRET`/`HOST`/`PORT`)는 `.env`에 넣어도 무시되고 dev 폴백을 썼다. `backend/src/config.ts` 최상단에서 Node 내장 `process.loadEnvFile()`로 `.env`를 먼저 로드(파일 없으면 try/catch로 무시 → 프로덕션은 플랫폼 주입 env 사용). 로컬 `backend/.env`(git 미추적)에 무작위 `JWT_SECRET`(48바이트 base64) + `HOST=127.0.0.1`(백엔드 비공개 바인드) 기록. 재기동 후 `[auth] WARNING` 사라짐 + `127.0.0.1:3001` 단독 바인딩으로 확인. (시크릿 회전이므로 이전 dev-폴백 토큰은 무효 → 재로그인 필요)

### 2026-06-19 (M15 — 실인증 JWT)
- **[feat]** **실인증(JWT) 보안 게이트 — x-user-id 위조 불가능화**: 기존 passwordless `x-user-id` 헤더(username 입력만 기반, 위조 가능) → **bcrypt+@fastify/jwt 기반 Bearer JWT 토큰**으로 완전 교체(공개 배포 필수). 
  - **백엔드**: (1) User.passwordHash(bcrypt): Prisma 스키마 추가 + 마이그레이션. (2) `POST /auth/register`(회원가입): username+password 입력 → User 생성(중복 409), bcrypt 해싱 저장, JWT 서명 후 `{id, token, username}` 반환. (3) `POST /auth/session`(로그인): username+password 입력 → 기존 User 조회, bcrypt 검증(실패 401), JWT 서명 후 `{id, token, username}` 반환(TRD §4 API 표 `POST /auth/session` 교체). (4) JWT 미들웨어: `Authorization: Bearer <token>` 파싱 → JWT_SECRET으로 검증 → `request.user = {id, username}` 주입; requireAuth(실패 401)/optionalAuth(선택). (5) 환경: JWT_SECRET(필수, .env), JWT_EXPIRES(기본 '7d'). (6) x-user-id 제거: 모든 쓰기 경로(POST/PATCH/DELETE /communities, /posts, /comments, /upvote, /bookmark, /metrics/visit)에서 x-user-id 헤더 참조를 `request.user.id`로 통일. 모든 쓰기는 이제 `Authorization` 헤더만 인증 소스. 서버 코드 x-user-id 0건 확인(grep).
  - **프론트**: (1) 신규 호출: `rest.ts`에 `POST /auth/register(username, password)`, `POST /auth/session(username, password)` 추가(모두 토큰 반환). (2) LoginForm: password 필드 추가(`type="password"`). (3) authStore: 토큰 저장/로드(`{ googleApiKey, token }` 영속화). (4) 모든 인증된 요청: fetch 인터셉터로 **`Authorization: Bearer <token>` 자동 헤더 주입**(`rest.ts::request<T>`에서 토큰 있으면 헤더 추가). (5) 로그아웃: 토큰 제거.
  - **마이그레이션**: 기존 passwordless 사용자는 DB 마이그레이션 없음(passwordHash 칼럼 추가, 기존 행은 null). 공개 배포 시 사용자에게 재가입 안내 필수(기존 username은 유니크 제약으로 같은 이름 재가입 불가 → 안내 필수).
  - **문서**: TRD §2 스택 행 추가(bcrypt+@fastify/jwt), TRD §3 User 모델에 `passwordHash String` 추가, TRD §4 API 표 교체(`POST /auth/register` 추가, `POST /auth/session` 명령어 갱신, 모든 인증 칼럼 `x-user-id` → `Authorization: Bearer <jwt>` 변경), TRD §4 구현 메모 갱신(JWT 정책·JWT_SECRET/JWT_EXPIRES env 기록, x-user-id 신뢰 폐기). PRD FR-2 갱신(username+password 도입, JWT 토큰 설명). PLAN §0 L11 삭제(x-user-id 완전 폐기). README 보안 게이트 상태 **CLOSED**(공개 배포 가능 — "현재 JWT 기반 실인증 완료"), JWT_SECRET 환경 변수 필수 기록 추가.
  - **검증**: E2E J1 개정(회원가입/로그인 흐름 추가), 로그인 실패(잘못된 비밀번호) 401 가드, 미인증 쓰기(토큰 없음) 401 가드, 토큰 만료 401 재로그인. 모든 테스트 green.

### 2026-06-19 (続き)
- **[chore]** **favicon/앱 아이콘 레트로 전환** — 기존 SVG 파비콘이 **인디고-바이올렛 그라디언트(`#5B6CF5`/`#6848F8`/`#8B5CF6`)** 채움이라 §6.3 A 디자인 시스템의 "하드코딩 잔재 금지(`#6848F8`·`brand-*` 등)"를 위반하고 있었다. 인앱 `Logo` 마크(그린 인광 삼각형 "A" 오픈 스트로크 `#5cff9a` + drop-shadow 글로우)와 정합하도록 **그린 인광 CRT 테마**로 교체: `public/favicon.svg`를 둥근 사각 CRT 스크린 타일(`bg-term-screen` 라디얼 + `term-border` 테두리) 위 글로우 "A" 스트로크로 재작성. 파생 PNG **6종**(`favicon-16/32`, `apple-touch-icon` 180, `icon-192/512`, `maskable-512`)을 Playwright(Chromium) 렌더로 일괄 재생성 — maskable은 플랫폼 마스크 안전영역(≈80%) 보장을 위해 풀블리드 배경 + 중앙 축소 변형 사용. `index.html` `theme-color`/manifest `theme_color`는 이미 `#04130b`라 무변경. 순수 자산 교체(코드/라우팅 무변경). (§6.3 A·DESIGN-SYSTEM.md)
- **[fix]** **모바일 upvote "추천 처리에 실패" — CORS 거부(500)**: `vite --host`로 공개된 프론트를 폰(`http://192.168.x.x:5173`)에서 열면 Vite 프록시가 그 **Origin 헤더를 백엔드로 그대로 전달**한다. Pages-prep에서 새로 둔 CORS 허용목록(`localhost`/`127.0.0.1`/`littleanti.github.io`만)에 **사설 LAN IP origin이 없어 거부** → origin 콜백이 `new Error("Not allowed by CORS")`를 던져 **모든 cross-origin 요청이 500**(데스크톱 localhost는 regex 통과라 정상, 폰만 실패). **수정**(`backend/src/app.ts`): ① 허용목록에 **사설 LAN IPv4(http) regex** 추가(10/8·172.16-31/12·192.168/16 — http·사설 범위만이라 prod https는 불매치), ② 거부 시 `cb(new Error)` → **`cb(null, false)`(graceful deny)** 로 변경(불허 origin은 CORS 헤더만 빠지고 500이 아님). LAN origin 프리플라이트 `204 + access-control-allow-origin` 확인. 서버 43 tests green.
- **[feat]** **GitHub Pages 배포 준비(옵션 A) — 중앙 api.ts 설정 + 404.html 트릭 + 빌드타임 CSP + CORS allowlist**: 프론트엔드 정적 호스팅(Pages)과 백엔드 외부 호스트 분리 구조. **중앙 설정(`frontend/src/config/api.ts`)**: `VITE_API_ORIGIN` 환경변수(unset=상대경로+dev프록시, set=절대 backend origin) → `API_BASE`/`assetUrl`에서 사용. **404.html**: SPA 딥 링크(/posts/123) 리다이렉트 → index.html + 복원 스니펫(history.replaceState). **vite.config**: `base` 설정 가능(기본 `/`), 빌드 시 CSP `connect-src`/`img-src`에 `VITE_API_ORIGIN` 자동 주입. **public/.nojekyll**: Jekyll 처리 비활성화. **backend/.env.example**: `WEB_ORIGIN` env 문서화(Pages origin + 다중 스테이징 가능) + `HOST=127.0.0.1`(프로덕션 프라이빗 바인드) 예시. **CORS 백엔드**: `https://littleanti.github.io`(기본 허용) + `WEB_ORIGIN` 추가 allowlist. **보안 게이트**: `x-user-id` 헤더 실인증 교체 필수(현재는 username 입력 기반, 공개 배포 시 JWT/OAuth 권고). (§2.3 개발 프록시 불변; REST `/api` base, SSE 동일 출처; 단일 config seam으로 dev↔prod 분기 최소화)

### 2026-06-19
- **[feat]** **추천(업보트) 토글 — ▲ 점수 실동작**(북마크 패턴 1:1 미러): 기존 ▲ 점수는 표시용 `<span>`이고 프론트에 호출 함수가 없어 동작하지 않았다(백엔드 `POST /upvote`는 *score+1·무중복방지* PoC만 존재). **DB**: `Vote` 모델(`@@unique([userId,postId])`) + 마이그레이션. **BE**: `POST /posts/:id/upvote`를 멱등 토글-추가(upsert)로 교체, `DELETE /posts/:id/upvote` 추가 — 둘 다 **`score = vote count`** 로 재계산 후 hotScore 갱신(기존 score+1 폐기). `GET /posts/:id`에 `voted` 추가(북마크 `bookmarked`와 동일), **피드 카드(`toFeedCard`)에도 `voted` 추가** — `GET /posts`·`/communities/:slug/posts`·`/users/:id/posts`·`/users/:id/bookmarks`가 선택 `x-user-id`로 페이지 postId들을 **1회 batch findMany**해 per-card voted 설정. **FE**: `upvotePost`/`removeUpvote`, 피드 fetcher에 acting user id forward, **PostCard ▲**(카드가 navigate 대상이라 `stopPropagation`+`preventDefault`)·**Thread ▲** 인터랙티브 토글(낙관적+서버 score 동기화+실패 롤백, 미로그인 `openLogin()`, voted=true 시 `text-term-amber` 강조). resetDb votes 정리 + contract 8종. 서버 43 / 프론트 30 tests green.
- **[fix]** **커뮤니티 페르소나가 LLM에 미적용**: `GET /posts/:id`가 응답 `community`에서 **`personaPrompt`를 select/반환하지 않아**(`{id,slug,name,description,personaIcon}`만), Thread가 `community.personaPrompt`를 `undefined`로 받아 `?? ''` → **빈 systemInstruction**으로 모든 `@AI`·1차 답변·재시도·요약을 호출했다(페르소나 전혀 미적용). 엔진 배선(`personaPrompt → systemInstruction`, XC-4/L6)은 정상이었고 단일 원인은 서버 DTO 누락. **수정**: `GET /posts/:id`(및 동일 shape의 `PATCH /posts/:id`)의 Prisma select + DTO에 `personaPrompt` 추가. 폴백 경로(`getCommunities()`)는 personaPrompt를 포함하지만 `loadedPost.community`가 항상 존재해 실행되지 않았음. 회귀 테스트 추가(`GET /posts/:id` → `community.personaPrompt` 단언). 서버 35 tests green.
- **[docs]** **문서 갭 감사 + README 갱신**: 구현된 23개 엔드포인트를 TRD §4 API 표와 대조해 표에 누락돼 있던 4개를 추가 — `GET /communities/:slug`(단일 조회), `POST /uploads`(이미지 업로드 + 정적 `GET /uploads/*`), `GET /users/:id/posts`·`GET /users/:id/communities`(프로필). README를 현재 기능(글 편집·북마크·이미지 첨부·Gemini 표식·프로필·로그인 모달)과 실행 방법(사전요구·.env·prisma migrate·포트·스크립트 표·보안 메모)으로 전면 갱신. **문서 내 실제 API 키(시크릿) 노출 0건 확인**(모두 BYOK 키 개념 설명문이며 키 값 아님), `backend/.env`는 git 미추적(`.env.example`만 커밋).
- **[feat]** **Gemini 연결 표식(헤더 배지)**: 상단바 `[ {username} ]` 좌측에 LED 점 + `GEMINI` 라벨 배지(`components/GeminiStatusBadge.tsx`)를 로그인 상태에서 표시. **판정 근거 = 가장 최근 실제 LLM 쿼리**(`gemini.generateContent`)의 성공/실패. 신규 세션-한정 store `stores/geminiStatusStore.ts`(`'unknown'|'connected'|'disconnected'`, 비영속 — `aiModeStore`와 동일 철학)에 결과를 기록하고, 엔진이 쓰는 `generateContent`를 **얇은 추적 래퍼 `engine/geminiStatus.ts`** 로 감싸 1차 답변·@AI 답변·재시도·요약 **전 경로를 단일 chokepoint**에서 커버(`contextEngine.ts`·`retryAiBubble.ts`의 import만 교체). `gemini.ts`는 키-blind/스토어-free 유지(래퍼는 app 계층). `countTokens`는 자체 폴백이 있어 신호에서 제외. 상태별 표시: 연결=`●` 초록 인광(`glow`), 끊김=`●` `text-term-danger`+`animate-pulse`, 미확인=`○` `text-term-faint`; hover 한국어 툴팁. 하드 리로드 시 `미확인` 초기화. 검증: tsc 클린 + 프론트 테스트 30 green. (WIREFRAME §0/§9)
  - **로그인 시 1회 연결 테스트(2026-06-19 추가)**: 첫 `@AI` 호출까지 기다리지 않고 즉시 상태를 보여주기 위해, 키가 생기거나 바뀔 때(신규 로그인 · 프로필 키 변경 · 지속 세션 로드) **키당 한 번** `pingGemini(apiKey)`를 실행. 핑은 **`countTokens`** 를 사용 — 키·네트워크를 검증하되 **생성 비용 0**(가장 싼 인증 round-trip). 성공→`markSuccess`, `GeminiError`→`markFailure(kind)`, never-throw. `AppLayout`의 effect가 `googleApiKey` 변화를 감지하고 `useRef`로 마지막 핑한 키를 기억해 동일 키 중복 호출을 막음. (수동 추적 래퍼는 여전히 `countTokens`를 무시하지만, **명시적 핑**은 그 자체가 연결 테스트이므로 유효 신호로 사용.)
- **[feat]** **헤더 UX 소소 개선**: ① Thread 헤더의 **`✎ 편집` 버튼을 커뮤니티 편집 버튼(`Community.tsx`)과 완전히 동일한 모양으로 통일**(`border border-term-border px-2 py-1 text-xs text-term-dim hover:border-term-bright hover:text-term-bright` + 라벨 `✎ 편집` + `title`; 기존 `text-term-amber` 아이콘-only에서 교체) — §4.9. ② **상단바 우측 `[ {username} ]`을 `/me`(나) 이동 링크로** 변경(`AppLayout.tsx`, `Link to="/me"` + `hover:text-term-bright`; 비로그인 시 `[ Login ]` 동작은 그대로). 순수 표현/내비게이션 변경, 동작·라우팅 회귀 없음.
- **[feat]** **Option A 동선 개편 + 글 이미지 첨부 + 로그인 모달**: ① IA — 하단/사이드바 '작성' 탭을 글 작성(`/create-post`)으로 직결하고 커뮤니티 만들기는 검색 화면 진입으로 일원화(라우트는 둘 다 유지), ② 글 작성에 **펼침형 커뮤니티 피커**(`<select>` 대체) + **빈상태 보조 링크**(커뮤니티 0개 → `/search`) + **이미지 첨부**(Composer 패턴 재사용) 추가, ③ `Post.imageUrl`(nullable) 풀스택 반영(스키마/`POST /posts`·`GET /posts/:id`·`toFeedCard` + 프론트 타입/표시), ④ **로그인을 별도 페이지 → 모달 오버레이**로 전환(신규 `uiStore`·`LoginModal`·추출된 `LoginForm`, 헤더 `[ Login ]`이 `openLogin()` 호출, 쓰기 게이트 하드 리다이렉트 제거). (§4.6)
- **[fix]** 홈 피드 "Invalid cursor" 무한 루프: `rest.ts::getPosts`가 페이지네이션 envelope를 풀어 `items` 배열만 반환하고 `nextCursor`를 버리자, Home이 마지막 항목의 **원본 id**를 다음 커서로 넘겨 서버가 이를 불투명 커서로 디코드하지 못해 매 페이지 "Invalid cursor"로 실패→재요청을 반복했다. `getPosts`가 서버 envelope **`{ items, nextCursor }`** 를 그대로 반환하도록 되돌리고, Home은 서버가 준 **불투명 `nextCursor`로 페이지네이션**하며 **`null`이면 정지**하도록 수정(원본 id 도출 제거). (§4.5)

### 2026-06-18
- **[feat]** **디자인 시스템 v0.3 전 화면 전파**(VR-10, 표현 계층 한정 — 라우팅/스토어/엔진/SSE/BYOK/검증 불변): §6.3에서 확립한 채팅 UI 비주얼 언어를 Thread 외 나머지 화면(Login·Home·Search·Community·CreatePost·CreateCommunity·Profile·AppLayout/BottomTabBar·상태 컴포넌트)에 일관 전파(WIREFRAME §12). 공유 토큰: **카드/리스트 항목 `rounded-2xl border border-slate-200 bg-white shadow-sm`**(클릭형은 `active:bg-slate-50 hover:border-brand/40` 가산), **입력/textarea/select `rounded-xl ... focus:border-brand focus:ring-1 focus:ring-brand`**, **1차 버튼 바이올렛 `rounded-xl bg-brand text-white`**(2차=`border` hover:brand, 위험=red), 토글 액센트 `accent-violet-600`. **Avatar 컴포넌트(§6.3 B)를 Profile(헤더 `👤`→`Avatar md` seed=username)·Community(글 리스트 작성자 `Avatar sm`)에 재사용.** 브랜드 컬러는 §6.3 A 바이올렛 토큰(`brand=#7c3aed`)을 그대로 사용해 대부분 `bg-brand`/`text-brand`로 자동 반영. **순수 표현(클래스/마크업)만 변경 — 동작 변화 없음.** (§4.4)
- **[feat]** **Thread v0.3 비주얼 리디자인**(VR-9, 표현 계층 한정 — 동작/라우팅/SSE/BYOK 불변): 브랜드 컬러 블루(`#2563eb`)→**바이올렛(`#7c3aed`)**(`tailwind.config.js` `colors.brand`만 교체, `index.html` `theme-color` 동기화), 신규 **`Avatar` 컴포넌트**(user/me=실루엣·시드 해시 팔레트, ai=바이올렛 그라데이션 로봇), Thread 상단을 **글 상세 헤더**(‹뒤로·제목 중앙·🔖북마크·⋯메뉴)로 교체, 원본 게시글을 **📌 라벨 + 아바타 + ▲점수/💬댓글수 핀 카드**로 재스타일, ChatBubble에 **행 끝 아바타 + 본인 COMPLETE 버블 읽음 `✓`**, AI PENDING 로딩을 **`✨ AI가 답변을 작성하고 있어요…`** 스파클 인디케이터로, Composer를 **＋첨부 + 알약형 입력 + 바이올렛 원형 전송**으로 변경. **🔖북마크·⋯메뉴·＋첨부는 표현용 placeholder(백엔드 미연동, 코드 주석 명시).** (§6.3 사양 그대로 구현, 스펙 이탈 없음) (§4.3)
- **[feat]** 커뮤니티 **이름 중복 차단**: 기존엔 slug만 `@unique`라 동일 이름 커뮤니티가 다수 생성되어 검색에 같은 이름이 난립했다. `POST /communities`가 생성 전 라우트 레벨에서 이름 중복(대소문자 무시·trim)을 검사해 중복 시 **409 `{ error:"이미 있는 커뮤니티 이름이에요", code:"DUPLICATE_NAME" }`** 반환. slug 중복은 별도 메시지 **409 `{ error:"이미 있는 주소(slug)예요", code:"DUPLICATE_SLUG" }`**(P2002 `meta.target` 분기). `CreateCommunity`가 폼 상단 `role="alert"` 배너로 서버 한국어 메시지를 노출(에러 시 미이동)하도록 보강. 스키마/마이그레이션 무변경. (§4.2-10)
- **[fix]** 중복/부분일치 커뮤니티 해소 버그: `CommunityDetail`이 부분검색 `getCommunities(slug)` + `matches[0]` 폴백으로 커뮤니티를 해소해 **같은 이름의 다른 커뮤니티(잘못된 항목)** 가 열릴 수 있었다. 정확 단건 **`GET /communities/:slug`**(unique slug, `postCount` 포함) 엔드포인트를 추가하고 `rest.ts::getCommunity(slug)`로 교체 → `matches[0]` 폴백 제거, 404 시 not-found `EmptyState` 표시. E2E 헬퍼 `createCommunityAndPost`도 고정명 "E2E 커뮤니티"에서 고유 이름으로 변경(이름 유니크 하에서 J1/J2/J3 충돌 방지). (§4.2-10)
- **[fix]** Composer에 "🤖 AI에게 묻기" 토글/칩 행이 추가되며 Composer가 더 높아졌고, 그 `sticky` 오버레이가 Thread의 마지막/PENDING("입력 중…") AI 로딩 버블을 가렸다. `sticky` 오버레이를 제거해 Composer를 일반 flex 흐름 자식으로 되돌리고, 모바일 하단 탭바 여백 확보를 Thread 컬럼 레벨에서 처리 → 최신 버블이 항상 입력창 위에 보이도록 수정. (§4.2-9)
- **[feat]** Composer "🤖 AI에게 묻기" 토글(스레드별, 기본 OFF): ON이면 보내는 모든 메시지가 기존 `@AI` 흐름으로 AI에 전달되며 입력창 앞에 편집 불가 "@AI" 칩이 표시(텍스트 주입이 아닌 UI 요소)되고 전송 버튼이 AI 강조색으로 전환. 전송 판단은 `wantsAI = 토글 ON || 수동 @AI 감지`로 단일화해 중복 호출 없이 `runAtAiReply`를 정확히 1회 발화. 수동 `@AI` 타이핑은 일회성 단축키로 유지. BYOK 비용 힌트("메시지마다 내 키로 호출") 노출. 세션 한정·postId별·미영속(새로고침 시 OFF로 초기화)인 신규 `aiModeStore` 도입. (§3, §5)
- **[feat]** 네비게이션/검색/프로필: 도달 가능한 검색 페이지(`/search`), 프로필 페이지(`/me`: 로그아웃·API 키 변경·내 커뮤니티·내 글), PostCard→커뮤니티 링크, `authStore.updateKey`, `GET /users/:id/posts`·`/users/:id/communities`. (commit `f281c45`, §4.2, §5)
- **[fix]** 피드 응답 형태 불일치: `toFeedCard`가 중첩 `community{}`/`author{}`를 반환했으나 `PostListItem`은 평탄(`communitySlug` 등) → 홈 피드 커뮤니티 라벨 공백. 서버를 평탄 동결 계약에 맞춤. (commit `f281c45`, §4.2-7)
- **[fix]** `POST /posts` 201 응답에 최상위 `authorId` 누락 (Post DTO 계약 드리프트): `GET /posts/:id`는 이미 `authorId`를 포함하도록 고쳤으나 형제 `POST /posts` 직렬화기는 `communityId`만 보내 `authorId` 없는 Post 반환. `rest.ts`가 런타임 검증 없이 캐스팅해 tsc가 못 잡는 재발 드리프트 클래스. 직렬화기를 동결 Post DTO에 맞춤. (§4.2-8, `backend/src/routes/posts.ts`)
- **[docs]** 본 구현 노트에 변경 이력(Changelog) 절 추가 — 날짜·역순 정리.

### 2026-06-17

**라이브 검증 (실제 Gemini 키, claude-in-chrome MCP + Playwright)** — commit `6a19d3a`
- **[fix]** 페이지네이션 envelope 미해제: `getPosts`/`getCommunityPosts`/`getComments`가 `{items}`를 배열로 반환 안 함 → 커뮤니티 페이지 크래시·홈 빈 화면·스레드 로딩 실패. (§4.1-3, `frontend/src/api/rest.ts`)
- **[fix]** PENDING AI 버블 빈 본문 거부 → `@AI`/1차 답변 400으로 미생성. PENDING이면 빈 본문 허용. (§4.1-4, `backend/src/routes/comments.ts`)
- **[fix]** `GET /posts/:id`에 `authorId`/`communityId` 누락 → 1차 AI 답변(FR-4.3/수용 #3) 미발화. 스칼라 FK 포함. (§4.1-5, `backend/src/routes/posts.ts`)
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

**Backend (`backend/`)** — Node 20 ESM
- `fastify` ^5.2, `@fastify/cors` ^10, `fastify-plugin` ^5 (전역 훅 de-encapsulation용 — §4 버그 참조)
- `prisma` / `@prisma/client` ^6.2, datasource = SQLite (PoC, `backend/prisma/dev.db`)
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

- **요약 세그먼트 멱등(BE-7/BE-5s)**: AI_SUMMARY는 **새 세그먼트 N+1의 첫(최저 seq) 버블**로 들어가고, 헬퍼 `openSummarySegment(db, input, segmentExpected)`(`backend/src/domain/segment.ts`)가 한 트랜잭션에서 (a) 활성 N 비활성화, (b) N+1 활성 생성(요약 토큰으로 `tokenSum` 시드), (c) `N+1.summaryCommentId` 연결을 수행. `segmentExpected !== active.index`면 **409 `{ segmentIndex, summaryCommentId }`** 반환(이중 개시 방지). 성공 시 `comment.created` → `segment.opened`를 **seq 순서대로** 발행(RT-8).
- **컨텍스트 조립(BE-12)**: `backend/src/domain/contextAssembler.ts`가 활성 세그먼트만 조립. seg0 = 원본 글 user turn + seg0 버블; seg≥1 = "지금까지 요약: …" user turn + 그 이후 버블(이전 히스토리 제외, FR-7.2). PENDING/FAILED AI 버블은 컨텍스트에서 제외(COMPLETE만).
- **CSP 적용 방식(XC-3, L2)**: 서버는 `onSend` 훅(`backend/src/plugins/security.ts`)으로 **모든 응답**에 CSP 헤더 부여. SPA는 빌드 시 `vite.config.ts`의 주입 플러그인이 `dist/index.html`에 `<meta http-equiv>`로 동일 CSP 주입(`apply: 'build'`이므로 **dev HMR은 영향 없음**). 확정 CSP:
  ```
  default-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com;
  script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  ```
- **레이트 리미팅 기본값(XC-9)**: 인메모리(단일 인스턴스). `POST /posts` 10회/분/identity(슬라이딩 윈도우), `POST /communities` 1회/3분/identity(쿨다운). 초과 시 429 + `Retry-After`. 읽기/댓글 게시는 비제한(실시간 데모 매끄러움 위해).
- **마크다운 sanitize chokepoint(XC-3)**: `frontend/src/lib/sanitize.ts`의 `renderMarkdownSafe(md)`(marked → DOMPurify 엄격 allowlist) + `SafeMarkdown` 컴포넌트가 **유일한** `dangerouslySetInnerHTML` 경로. 모든 사용자 콘텐츠(ChatBubble/SummaryBubble/PostCard/Thread 원본 본문)가 이를 경유. `javascript:`/`data:`/`iframe`/`script`/이벤트 핸들러 제거, 실패 시 평문 폴백.
- **hot decay(XC-8)**: 읽기 시점 재계산 방식 채택(PoC). hot 피드 반환 시 `ageDecay`를 반영해 정렬이 현재 경과시간을 반영하도록 함(커서 페이지네이션 유지).
- **토큰 카운팅(AI-3)**: `countTokens` 우선, 폴백 `Math.ceil(text.length/4)`(`estimateTokens`). 버블 게시 시 `tokenCount`를 함께 보내 서버가 활성 세그먼트 `tokenSum` 누적.
- **AI 모드 토글 = 의도 플래그(텍스트 prefix 조작 아님)**: "🤖 AI에게 묻기"는 입력 텍스트에 `@AI`를 끼워넣지 않고 별도 의도 플래그로 모델링 → 파싱 결합 없이 견고(본문은 사용자가 친 그대로 게시). 상태는 스레드별·세션 메모리·기본 OFF(`aiModeStore`, 미영속)로 BYOK 비용 안전을 보장. 전송 라우팅은 `wantsAI = 토글 ON || 수동 @AI 감지`로 단일화해 `runAtAiReply` 단일 발화를 보장하고, 수동 `@AI`는 일회성 단축키로 그대로 유지. (§5)

---

## 4. 개발 중 수정한 버그

1. **CSP·레이트리밋 플러그인 캡슐화로 전역 훅 미적용 (M5, L2 위반)**
   - 증상: `app.register(security)` / `app.register(rateLimit)`로 등록 시 Fastify가 플러그인 컨텍스트를 **캡슐화**해, `onSend`(CSP)·`onRequest`(레이트리밋) 훅이 **형제 라우트와 `/health`에 적용되지 않았다.** 결과적으로 응답에 CSP 헤더가 없고(키 유출 1차 완화책 무력화), `POST /posts`가 429를 내지 않았다(연속 게시 모두 201).
   - 수정: 두 플러그인 export를 `fastify-plugin`(`fp`)로 감싸 훅을 **de-encapsulate** → 앱 전역 적용. `fastify-plugin` ^5를 `backend` 의존성에 추가. `app.ts` 변경 없음(등록 순서는 이미 올바름).
   - 파일: `backend/src/plugins/security.ts`, `backend/src/plugins/rateLimit.ts`, `backend/package.json`.
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
   - 수정: `status === 'PENDING'`일 때 빈 본문 허용(텍스트는 PATCH로 도착). 파일: `backend/src/routes/comments.ts`.
5. **`GET /posts/:id`에 `authorId` 누락 → 1차 AI 답변 미발화 (FR-4.3 / 수용 #3 위반)**
   - 증상: 글 상세 응답이 `author:{id,username}`만 주고 최상위 `authorId`(및 `communityId`) 스칼라를 누락. Thread의 1차 답변 가드 `post.authorId === me`가 `undefined === me`로 항상 거짓 → **작성자 키 1차 AI 답변이 전혀 발화되지 않음**.
   - 수정: 상세 응답에 `authorId`/`communityId` 포함(Post DTO와 일치). 파일: `backend/src/routes/posts.ts`.
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
   - 수정: `POST /posts`의 `reply.code(201).send({...})`에 `authorId: post.authorId` 추가(`GET /posts/:id`와 동일하게 직렬화기를 동결 Post DTO에 정렬). 라이브 검증: `POST /posts`가 이제 최상위 `authorId` 반환. 양측 typecheck clean. 파일: `backend/src/routes/posts.ts`.
9. **Composer "AI에게 묻기" 토글 행 추가 후 마지막/PENDING AI 로딩 버블이 가려짐**
   - 근본 원인: Thread는 고정 높이 flex 컬럼(`h-[calc(100dvh-3rem)] flex flex-col`)에 전용 `flex-1 overflow-y-auto` 스크롤 영역과 형제 `<Composer/>`로 구성되는데, Composer 래퍼가 `sticky bottom-16 z-30`이라 flex 흐름에서 벗어나 스크롤 영역 하단을 **오버레이**했다(스크롤 영역은 컬럼 전체 높이를 점유, Composer는 그 위를 덮음). 여기에 새로 추가된 토글/칩 행이 Composer를 더 높게 만들면서 `scrollIntoView({block:'end'})`로 스크롤포트 바닥에 정렬된 마지막/PENDING("입력 중…") 버블이 더 넓어진 Composer 뒤에 숨었다. 기존 `bottom-16`은 모바일 고정 `BottomTabBar`(`tablet:hidden`, ~56px+safe-area)를 비키려던 본래 핵.
   - 수정(2파일, 백엔드/계약/테스트 무변경): (1) `frontend/src/components/Composer.tsx` 래퍼를 `sticky bottom-16 z-30 … tablet:bottom-0` → `shrink-0 border-t border-slate-200 bg-white`로 변경 — 오버레이·z-lift·sticky 오프셋 제거, Composer를 자연 높이의 일반 bottom flex 자식으로 환원하니 형제 `flex-1` 스크롤 영역이 그 위로 줄어들어 최신 버블이 입력창 위에 항상 노출. (2) `frontend/src/pages/Thread.tsx` 루트 컬럼에 `pb-[calc(3.5rem+var(--safe-bottom,0px))] tablet:pb-0` 추가 — 모바일 탭바 클리어런스를 컬럼 레벨에서 확보(3.5rem=56px+iOS safe-area). `tablet:pb-0`은 `BottomTabBar`의 `tablet:hidden` 분기와 정확히 일치해 탭바가 없는 tablet+에서는 패딩이 사라지고 Composer가 컬럼 바닥에 flush. 데스크톱 `h-[calc(100dvh-3rem)]`·`-mb-20`은 불변. (양측 typecheck clean, E2E J2가 사람/AI 버블 가시성·순서 가드)
10. **커뮤니티 이름 중복 허용 + 부분일치 상세 해소 버그 (2026-06-18)**
    - **이름 유니크(라우트 레벨)**: Prisma 스키마는 `Community.slug`만 `@unique`이고 `name`은 유니크가 아니라 동일 이름 커뮤니티가 무제한 생성되어 검색에 같은 이름이 난립했다. 마이그레이션 없이(운영자 미실행) **라우트 레벨**에서 막는다. `POST /communities`는 생성 전 `findFirst({ where:{ name:{ contains: trimmedName } } })`로 선필터한 뒤 JS에서 **trim + 소문자 정규화 정확 일치**(`sameName.name.trim().toLowerCase() === trimmedName.toLowerCase()`)로 판정 — 한국어(무대소문자) 정확 일치와 ASCII 대소문자 변형을 모두 차단하되 `"test"`가 기존 `"testing"`에 걸리지 않도록 부분일치는 배제. 중복 시 **409 `{ error:"이미 있는 커뮤니티 이름이에요", code:"DUPLICATE_NAME" }`**.
    - **두 개의 구분된 409**: slug 중복은 P2002 백스톱에서 `err.meta?.target`에 `"name"` 포함 시 `DUPLICATE_NAME`, 아니면 **409 `{ error:"이미 있는 주소(slug)예요", code:"DUPLICATE_SLUG" }`**로 분기(현 스키마에선 항상 slug 메시지; 향후 name 인덱스/레이스 대비). 클라(`rest.ts::request`)는 기존에 `body.message`만 읽어 서버의 `{ error }` 메시지가 표면화되지 않았으므로 `message → error → 폴백` 순으로 읽도록 정정 → `CreateCommunity` 폼 상단 `role="alert"` 배너에 한국어 409가 노출되고 에러 시 미이동.
    - **상세 해소 버그(근본 원인)**: `CommunityDetail`이 정확 단건 조회 대신 부분검색 `getCommunities(slug)`를 호출하고 `found = matches.find(c=>c.slug===slug) ?? matches[0] ?? null`로 폴백해, 동일 이름 커뮤니티가 많을 때 `matches[0]`가 **엉뚱한 같은 이름 커뮤니티**를 열 수 있었다. 정확 단건 **`GET /communities/:slug`**(`findUnique` + `_count.posts`, 목록과 동일한 `postCount` 포함 형상; 부재 시 `404 { error:"커뮤니티를 찾을 수 없어요" }`)를 추가하고 프론트를 `getCommunity(slug)`로 교체해 `matches[0]` 폴백을 제거. 404 시 not-found `EmptyState`(검색으로 이동 링크) 렌더. `CommunitySearch`는 결과를 `c.id` 키·`c.slug` 링크로 다루므로 중복 무관(수정 불필요). E2E 헬퍼 `createCommunityAndPost`는 고정명 → 고유명으로 변경. 파일: `backend/src/routes/communities.ts`, `frontend/src/api/rest.ts`, `frontend/src/pages/Community.tsx`, `frontend/src/pages/CreateCommunity.tsx`, `frontend/e2e/helpers.ts`. (양측 typecheck clean)
    - 생성 유니크 판정 흐름:
      ```mermaid
      flowchart TD
        A["입력 (name, slug)"] --> B{name 중복?}
        B -- yes --> C["409 이미 있는 커뮤니티 이름이에요<br/>code: DUPLICATE_NAME"]
        B -- no --> D{slug 중복?}
        D -- yes --> E["409 이미 있는 주소(slug)예요<br/>code: DUPLICATE_SLUG"]
        D -- no --> F["201 커뮤니티 생성"]
        F --> G["스레드/커뮤니티로 이동"]
      ```
    - 미반영(의도/플래그): `PATCH /communities/:id`(이름 수정)는 이름 유니크를 강제하지 않음 — 과제 범위는 생성(POST) 한정이라 스코프 유지, 추후 동일 가드 적용 여지로 플래그.

### 4.3 Thread v0.3 비주얼 리디자인 (VR-9, 2026-06-18)

WIREFRAME §6.3("비주얼 리팩토링 사양 — 구현 단일 출처")을 그대로 구현한 **순수 표현 계층** 변경. 라우팅·스토어·엔진(contextEngine/retry)·SSE·BYOK 키 흐름·요약 트리거 로직은 **불변**이며, 백엔드/API 계약/테스트는 무변경. 변경 파일: `frontend/tailwind.config.js`, `frontend/index.html`, `frontend/src/components/Avatar.tsx`(신규), `frontend/src/components/ChatBubble.tsx`, `frontend/src/components/Composer.tsx`, `frontend/src/components/PostCard.tsx`, `frontend/src/pages/Thread.tsx`.

- **브랜드 컬러 블루→바이올렛(§6.3 A)**: `tailwind.config.js`의 `colors.brand`만 `#2563eb/#1d4ed8` → **`#7c3aed`(violet-600) / `#6d28d9`(violet-700)**로 교체 → `bg-brand`/`text-brand`/`border-brand`를 쓰는 모든 자리(본인 버블, 전송 버튼, 로고, 활성 탭, 링크 등)가 자동 반영. `index.html`의 PWA `theme-color`도 `#0f172a → #7c3aed`로 동기화. (AI 액센트 `purple-*`는 유지.)
- **Avatar 컴포넌트(신규, §6.3 B)**: `frontend/src/components/Avatar.tsx`. props `{ kind:'user'|'me'|'ai'; seed?; size?:'sm'|'md' }`. Tailwind purge 안전을 위해 **정적 클래스 배열**만 사용(동적 문자열 금지) — user/me는 6색 팔레트(`violet/emerald/sky/rose/amber/indigo-500`)를 `seed` 코드포인트 합 `% 6`으로 선택(시드 없으면 `bg-slate-400`)하고 흰 사람 실루엣 SVG, ai는 `bg-gradient-to-br from-violet-500 to-purple-600` + 흰 로봇 SVG. 표시 전용(`aria-hidden`).
- **Thread 글 상세 헤더(§6.3 C)**: 기존 `PersonaBadge` 헤더를 **‹뒤로 · 제목(중앙 truncate, font-semibold) · 🔖북마크 · ⋯메뉴**로 교체. 뒤로 버튼은 `navigate(-1)`. 페르소나 표시는 헤더에서 제거(원본 카드/아바타로 이전).
- **원본 게시글 핀 카드(§6.3 D)**: 기존 `bg-slate-50` 영역을 **`rounded-2xl border bg-white shadow-sm` 카드**로 재스타일. **📌 원본 게시글** 바이올렛 라벨 + 제목(`<h2>`) + (있을 때) `SafeMarkdown` 본문 + 메타행(Avatar sm·`u/{author}`·상대시간 / 우측 `▲{post.score}` `💬{post.commentCount}`). 점수/댓글수는 기존 `Post` DTO 필드(읽기 전용·비기능, 기존과 동일).
- **ChatBubble 아바타 + 읽음 ✓(§6.3 E)**: 행 컨테이너를 `flex items-end gap-2`(본인이면 `flex-row-reverse`)로 바꾸고 행 끝에 `<Avatar>` 추가(AI=로봇, 본인=me, 타인=user; `seed=authorUsername`). 좌측 헤더의 페르소나 **이모지 중복 제거**(아바타로 이전)하고 페르소나명+`AI` 배지는 유지. 본인 **COMPLETE** 사람 버블 메타행에 바이올렛 읽음 `✓` 추가(PENDING/실패엔 미표시). 버블 꼬리 라운드를 `rounded-b*-sm → rounded-b*-md`로, AI 테두리를 `purple-300 → purple-200`으로 미세 조정. 실패 오버라이드(빨강)·재시도 버튼은 불변.
- **AI 스파클 로딩(§6.3 E.3)**: 기존 `TypingDots`를 `isAi` 분기로 분리 — AI PENDING은 **`✨ AI가 답변을 작성하고 있어요… •••`**(스파클 + 바운싱 점), 사람 PENDING은 기존 **`⟳ 입력 중…`** 유지.
- **알약형 Composer(§6.3 F)**: 입력 행 앞에 **＋ 첨부 버튼** 추가, 입력 박스를 `rounded-2xl → rounded-full px-4`(알약형)로, AI모드 토글 `accent-purple-600 → accent-violet-600`. 전송 버튼은 기존 `bg-brand`(@AI/AI모드면 `bg-purple-600`) 원형 유지. 기본 placeholder를 `메시지를 입력하세요…`로 변경(AI모드 placeholder·@AI 칩/감지 로직은 불변).
- **표현용 placeholder(백엔드 미연동) — 명시**: 헤더 **🔖 북마크**(`Thread.tsx`의 `bookmarked` 로컬 `useState` 토글, 북마크 API/DTO 없음), 헤더 **⋯ 메뉴**(핸들러 없음), Composer **＋ 첨부**(핸들러 없음) 세 버튼은 **순수 시각 요소**다. 각 코드에 주석으로 비연동을 명시했고, 향후 백엔드 연동 시 와이어링 지점으로 남겨둠.
- **스펙 이탈**: 없음 — §6.3 A–G 토큰/클래스/동작을 그대로 따랐고, §6.3 G("변경 없음")로 명시된 라우팅·스토어·엔진·SSE·BYOK·요약·접근성 터치 타깃은 손대지 않았다. `PersonaBadge`는 §6.3 G대로 `bg-brand/10`을 통해 자동 바이올렛화(개별 수정 불필요)되고, Thread 헤더에서만 제거됐다.

### 4.4 디자인 시스템 v0.3 전 화면 전파 (VR-10, 2026-06-18)

WIREFRAME §12("디자인 시스템 v0.3 — 전 화면 적용, 구현 단일 출처")를 그대로 구현한 **순수 표현 계층** 변경. §6.3에서 Thread에 확립한 비주얼 언어(바이올렛 브랜드·카드·아바타)를 나머지 모든 화면에 일관 전파. 라우팅·폼 검증·제출 핸들러·스토어·BYOK 키 흐름(마스킹·localStorage)·인증 가드·무한 스크롤·디바운스 검색·SSE는 **불변**이며, 백엔드/API 계약/테스트는 무변경.

- **공유 토큰(§12.1)**: (a) **카드/리스트 항목** = `rounded-2xl border border-slate-200 bg-white shadow-sm`(기존 `rounded-lg`/`rounded-xl`·무그림자 → 통일), 클릭형은 `transition active:bg-slate-50 hover:border-brand/40` 가산. (b) **입력/textarea/select** = `rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand`(기존 `rounded-lg` → `rounded-xl`). (c) **1차 버튼** = `rounded-xl bg-brand text-white font-semibold hover:bg-brand-dark`(바이올렛, `min-h-[44px]`), **2차** = `border border-slate-300 hover:border-brand hover:text-brand`, **위험(로그아웃)** = `border border-red-200 text-red-600 hover:bg-red-50`. (d) 토글 액센트 `accent-violet-600`. 브랜드 컬러는 §6.3 A 바이올렛 토큰(`brand=#7c3aed`)을 그대로 써서 대부분 `bg-brand`/`text-brand`로 자동 반영(개별 하드코딩 없음).
- **Avatar 재사용(§6.3 B)**: 신규 컴포넌트를 신원 표시에 확대 적용. **Profile**(`frontend/src/pages/Profile.tsx`) 헤더의 `👤` 이모지를 `<Avatar kind="user" seed={username} size="md" />`로 교체. **Community**(`frontend/src/pages/Community.tsx`) 글 리스트 항목에 작성자 `<Avatar kind="user" seed={p.authorUsername} size="sm" />` 추가. (ChatBubble/Thread는 §6.3 E/D에서 이미 적용.)
- **화면별 델타(§12.2)**:
  - **Login**(`pages/Login.tsx`): 폼을 카드로 감싸고 바이올렛 로고 락업, 입력/버튼 §12.1, 키 경고/링크 유지.
  - **Home**(`pages/Home.tsx`): 인기/최신 탭 활성 `border-brand text-brand`(자동), PostCard는 이미 v0.3 카드, EmptyState 1차 버튼 §12.1.
  - **Search/CommunitySearch**(`pages/Search.tsx`, `pages/Community.tsx`): 검색 입력 §12.1, 결과 항목을 카드형 클릭 리스트(`rounded-2xl ... shadow-sm ... hover:border-brand/40`), PersonaBadge 유지, "결과 없음" 박스 radius 통일.
  - **Community 상세**(`pages/Community.tsx`): "이 커뮤니티에 글쓰기" 1차 버튼, 페르소나 박스 카드화, 글 리스트 카드형(제목·메타 + 작성자 Avatar sm).
  - **CreatePost**(`pages/CreatePost.tsx`): 입력/select/textarea §12.1, 게시 1차 버튼, AI 1차답변 토글 `accent-violet-600`.
  - **CreateCommunity**(`pages/CreateCommunity.tsx`, `components/PersonaEditor.tsx`): 입력/슬러그/설명/아이콘 §12.1, PersonaEditor textarea 정합, 만들기 1차 버튼.
  - **Profile**(`pages/Profile.tsx`): 헤더 Avatar md, API 키/로그아웃 섹션 카드화(위험 버튼), 내 커뮤니티/내 글 리스트 카드형. 마스킹/로컬 키 로직 불변.
  - **AppLayout/BottomTabBar**(`layout/AppLayout.tsx`, `layout/BottomTabBar.tsx`): 로고·활성 탭 바이올렛(자동), 구조 변경 없음.
  - **상태 컴포넌트**(`components/states/ErrorState.tsx`·`LoadingState.tsx`·`OfflineBanner.tsx`): 스피너 `border-t-brand`(자동), 배너/카드 radius `rounded-xl` 통일, 동작 불변.
- **스펙 이탈**: 없음 — §12.1 토큰/클래스를 그대로 따랐고, §12.3("회귀 금지")로 명시된 라우팅·검증·핸들러·스토어·BYOK·인증·스크롤·검색·SSE는 손대지 않았다(클래스/마크업만 변경, 동작 변화 없음).

### 4.5 홈 피드 "Invalid cursor" 무한 루프 (2026-06-19)

§4.1-3의 envelope 정규화(`getPosts`가 `{items}` → 배열 반환)는 크래시/빈 화면은 고쳤으나, 함께 버려진 서버 **`nextCursor`** 가 새 회귀를 낳았다. Home이 다음 페이지 커서를 응답에서 받지 못하니 **마지막 항목의 원본 `id`** 를 커서로 도출해 넘겼는데, 서버 커서는 (정렬 키를 인코딩한) **불투명 토큰**이라 원본 id를 디코드하지 못하고 매 요청을 거부했다.

11. **홈 피드 무한 루프 — 원본 id를 커서로 오용 (envelope `nextCursor` 유실)**
    - 증상: 홈 피드 무한 스크롤이 첫 페이지 이후 매 추가 요청마다 서버에서 **"Invalid cursor"** 로 실패하고, 클라가 같은 (잘못된) 커서로 재요청을 반복해 **무한 루프**에 빠졌다. `rest.ts::getPosts`가 `{ items, nextCursor }` envelope를 풀어 `items` 배열만 반환하면서 `nextCursor`를 폐기 → Home은 다음 커서를 알 수 없어 `items[items.length-1].id`(원본 정수/문자열 id)를 커서로 넘겼고, 서버는 이를 불투명 커서로 디코드하지 못해 거부했다.
    - 수정: `getPosts`를 서버 envelope **`{ items, nextCursor }`** 를 그대로 반환하도록 되돌리고(배열 강제 정규화 제거), Home은 서버가 발급한 **불투명 `nextCursor`** 로만 페이지네이션하며 **`nextCursor === null`이면 더 불러오기를 정지**하도록 변경(마지막 항목 id 도출 로직 제거). 이로써 커서 의미 체계가 서버↔클라 간 일치하고 끝 페이지에서 깔끔히 종료된다.

### 4.6 Option A 동선 개편 + 글 이미지 첨부 + 로그인 모달 (2026-06-19)

레트로 터미널 비주얼(v0.5)은 적용됐으나 재설계에서 합의된 **동선/기능**이 코드에 미반영된 상태였다. 본 작업은 표현이 아니라 **IA·작성 흐름·인증 표면·데이터 모델**을 Option A 합의대로 정렬한다. 시각 클래스는 기존 `term-*` 토큰 + 레트로 패턴을 그대로 재사용한다.

**① IA: '작성' 탭 = 글 작성 직결, '커뮤니티 만들기' = 검색 진입**
- `frontend/src/layout/BottomTabBar.tsx`: '작성' 탭 `to`를 `/create-community` → **`/create-post`** 로 변경(아이콘 `IconWrite`·라벨 '작성' 유지).
- `frontend/src/layout/AppLayout.tsx`: 데스크톱 사이드바의 "커뮤니티 만들기"(`/create-community`) NavLink를 **"작성"(`/create-post`, IconWrite)** 으로 교체. 순서 = 홈 / 검색 / 작성 / 나. 커뮤니티 만들기는 검색 화면의 상시 버튼으로 일원화(사이드바에서 제거).
- `frontend/src/App.tsx`: `/create-post`·`/create-community` 라우트는 **둘 다 유지**(만들기는 검색·커뮤니티 편집에서 계속 사용 — 라우트 삭제 없음).

**② 글 작성 커뮤니티 피커 + ③ 빈상태 보조 링크 (`frontend/src/pages/CreatePost.tsx`)**
- slug 라우트(커뮤니티 고정)면 기존 잠금 표시 유지(피커 없음). slug 없는 일반 작성이면 `<select>`를 **펼침형 피커**로 교체. 신규 상태 `pickerOpen:boolean`·`pickerQuery:string`(선택값은 기존 `selectedCommunityId` 유지). 목록은 기존 `getCommunities()` 사용, 이름 부분일치(대소문자 무시) 클라 필터, 행별 `[*]`/`[ ]` 마크.
- **빈상태 보조 링크**: slug 없는 작성 + 로드 후 `communities.length===0`일 때만 피커 대신 `! 가입한 커뮤니티가 없어요 · 검색에서 만들기 →`(`text-term-amber`)를 `/search`로 노출. 1개 이상이면 숨김.
- 기존 submit/canSubmit/route-slug 로직, AI 1차 답변 체크박스, 제목/내용 입력은 보존.

**④ 글 이미지 첨부 (풀스택) — `Post.imageUrl` 컨트랙트**
- 백엔드 `backend/`:
  - `prisma/schema.prisma` `model Post`에 **`imageUrl String?`**(body 아래, `Comment.imageUrl`과 동일한 nullable 패턴) 추가. 마이그레이션 `add_post_image_url`(sqlite, nullable이라 비파괴 — `20260619022438_comment_image_url` 선례와 동일, **DB reset 금지**).
  - `src/routes/posts.ts`: `POST /posts` Body 타입에 `imageUrl?: string` 추가 → `tx.post.create({ data:{ …, imageUrl: imageUrl ?? null } })`, 201 응답에 `imageUrl: post.imageUrl` 포함. `toFeedCard` 입력/반환 타입에 `imageUrl: string|null` 추가(findMany는 include만 지정 → Post 스칼라 전체 선택되어 자동 포함). `GET /posts/:id` 응답에 `imageUrl: post.imageUrl` 추가.
- 프론트 컨트랙트:
  - `frontend/src/api/types.ts`: `Post`·`PostListItem`에 **`imageUrl?: string | null`** 추가.
  - `frontend/src/api/rest.ts`: `CreatePostBody`에 `imageUrl?: string` 추가(`postPost`는 body 그대로 전송 → 추가 변경 불필요).
  - **API 컨트랙트(동결)**: `POST /posts` 요청 본문은 `{ communityId, title, body, imageUrl? }`, 응답 Post DTO와 `GET /posts/:id`·홈/커뮤니티 피드 카드(`toFeedCard`)는 모두 **`imageUrl: string | null`** 을 노출한다. 첨부 없으면 `null`.
- 첨부/표시 UI: `CreatePost.tsx`에 점선 드롭존 `[+] 이미지 첨부`(`<input type=file accept="image/*">` → `uploadImage(file, userId)` → `imageUrl` 상태 + 썸네일 칩 + `[x]` 제거, 실패는 `text-term-danger`). 제출은 `postPost({ communityId, title, body, imageUrl }, userId)`. 표시는 `Thread.tsx` 원본 카드 본문 아래 `<img>`(src/베이스 경로는 ChatBubble 댓글 이미지 렌더 방식 그대로) + `PostCard.tsx` 제목 아래 작은 썸네일(`h-32` 내외, `object-cover`).

**⑤ 로그인: 별도 페이지 → 모달 오버레이**
- 신규 **`frontend/src/stores/uiStore.ts`**(zustand, persist 없음): 컨트랙트 = `{ loginOpen:boolean; openLogin():void; closeLogin():void }`. 사용처는 `import { useUiStore } from '../stores/uiStore'` → `const openLogin = useUiStore(s => s.openLogin)`.
- 신규 **`frontend/src/components/LoginForm.tsx`**: 기존 `pages/Login.tsx`의 폼(닉네임/API키/경고/발급링크/제출)을 추출. props `onSuccess?: () => void`(로그인 resolve 시 호출). `authStore.login`·에러처리·`canSubmit` 로직 보존.
- 신규 **`frontend/src/components/LoginModal.tsx`**: `uiStore.loginOpen`일 때 오버레이(`fixed inset-0 z-[60]` 딤 `bg-[rgba(2,8,5,0.82)]` 중앙 정렬). 카드 = dc.html LOGIN MODAL(`border border-term-cta bg-[#06160c] rounded-[3px] shadow-[0_0_32px_rgba(43,212,111,0.28)]`), 우상단 `[x]`(closeLogin), A-mark + AIDIT(glow-lg) + 부제, `<LoginForm onSuccess={closeLogin} />`. 배경/[x] 클릭으로 닫힘(카드 클릭은 stopPropagation).
- `pages/Login.tsx`는 페이지 셸에서 `<LoginForm onSuccess={() => navigate('/')} />`를 렌더(라우트 유지 — 직접 URL/딥링크 호환). `AppLayout.tsx` 헤더 `[ Login ]`을 Link → `<button onClick={openLogin}>`(text-term-amber 유지)로 바꾸고 레이아웃에 `<LoginModal />`를 렌더. `CreatePost.tsx` 비로그인 게이트는 `navigate('/login')` 하드 리다이렉트 제거 → `openLogin()` + "로그인이 필요해요" 안내 + `[ 로그인 ]` 버튼.

**변경 파일 요약**: `frontend/src/layout/{BottomTabBar,AppLayout}.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/{CreatePost,Login,Thread}.tsx`, `frontend/src/components/{PostCard,LoginForm,LoginModal}.tsx`, `frontend/src/stores/uiStore.ts`, `frontend/src/api/{types,rest}.ts`, `backend/prisma/schema.prisma`(+마이그레이션 `add_post_image_url`), `backend/src/routes/posts.ts`.

**불변(회귀 금지)**: 기존 라우팅(`/create-post`·`/create-community`·`/login` 전부 유지)·스토어·검색 화면(상시 만들기 버튼 + 무결과 인라인 CTA)·SSE·BYOK·테스트 동작. 이미지 nullable이라 기존 글/응답은 `imageUrl=null`로 무영향.

---

### 4.7 글 첨부 이미지를 1차 AI 답변(LLM 쿼리)에 포함 (2026-06-19)

§4.6 ④에서 글의 `imageUrl`은 **저장·표시(Thread/PostCard)만** 됐고 AI 컨텍스트에는 들어가지 않았다 — 컨텍스트 조립(`buildGeminiRequest`)은 컨텍스트 턴을 **텍스트 파트로만** 매핑하고(`parts:[{text}]`), `runPrimaryReply`는 appended 턴 없이 호출했기 때문(서버 `contextAssembler`도 `imageUrl` 미취급). 즉 글 작성 시 첨부한 사진은 LLM에 전달되지 않았다. 본 작업으로 **1차 AI 답변이 멀티모달**이 되도록 연결한다(댓글 `@AI` 이미지가 그 턴에 `inlineData`로 실리던 경로와 동일한 방식).

- **`engine/contextEngine.ts`** — `RunPrimaryReplyArgs`에 `image?: { mimeType; data }`(base64, data: 프리픽스 없음) 추가. `runPrimaryReply`는 image가 있으면 **작성자 user-턴(빈 body) + image의 `inlineData` 파트**를 `buildGeminiRequest({ appended })`로 덧붙인다(글 본문은 이미 segment-0 turn 0 텍스트이므로 사진만 추가). XC-4 불변: appended는 항상 `role:'user'`, 페르소나는 systemInstruction 전용. image 없으면 기존과 동일(텍스트 only, appended 없음).
- **신규 `lib/imageInline.ts`** — `urlToInlineData(url)`: 동일 출처 이미지 URL(`/uploads/<name>`, CSP `connect-src 'self'` 허용)을 `fetch` → blob → base64(`FileReader`)로 변환. 실패 시 `null`(best-effort: 사진 인코딩 실패가 답변 자체를 막지 않도록 — 기존 `ensureSummary`/컨텍스트 실패 폴백과 동일한 그레이스풀 철학).
- **`pages/Thread.tsx`** — 1차 답변 트리거에서 `post.imageUrl`이 있으면 `urlToInlineData`로 변환해 `runPrimaryReply({ …, image })`로 전달(없거나 실패 시 `undefined` → 텍스트 only).
- **검증(`engine/contextEngine.test.ts`)**: ① image 제공 시 `generateContent` contents의 마지막 user 턴에 해당 `inlineData`(mimeType/data) 존재, ② image 없으면 `inlineData` 0개 + 컨텍스트 턴 1개(텍스트 only). 프론트 빌드 + 30 테스트(신규 2) 통과.
- **불변**: 댓글 `@AI` 이미지 경로(Composer)·BYOK·서버 라우트·`Post.imageUrl` 컨트랙트 무변경. 후속 호출들은 여전히 과거 글/댓글 이미지를 재전송하지 않음(컨텍스트는 텍스트; 사진은 "그 턴 신규 업로드"에만 실린다는 기존 설계 유지).

---

### 4.8 커뮤니티 편집 모드 — 기존 값 프리필 + PATCH (2026-06-19)

커뮤니티 상세의 **✎ 편집**(생성자에게만 노출)은 `/create-community`로 식별자를 router state로 넘겼지만, `CreateCommunity`는 **생성 전용 폼**이라 그 state를 읽지 않았다 → 빈 폼이 떴고(프리필 안 됨), 제출하면 `postCommunity`(생성)만 호출돼 슬러그 중복 등으로 실패할 수 있었다. 서버 `PATCH /communities/:id`(생성자 검증 + `name`/`personaPrompt` 비어있으면 거부, `description`/`personaIcon`은 빈 문자열 허용)는 **이미 완비**돼 있었고 프론트의 편집 모드만 없었다. 본 작업으로 편집 흐름을 연결한다.

- **`Community.tsx`** — 편집 링크의 router state를 `{ editId }` → **`{ editSlug: community.slug }`** 로 변경(REST에 id 단건 조회가 없고 `getCommunity(slug)`만 있으므로 slug로 넘긴다).
- **`CreateCommunity.tsx`** — 편집 모드 추가:
  - `useLocation().state`에서 `editSlug`(편집)·`name`(검색→만들기 핸드오프 프리필)을 읽음. `isEdit = Boolean(editSlug)`.
  - `editSlug`면 `getCommunity(editSlug)`로 불러와 `name/slug/description/personaPrompt/personaIcon` 프리필 + `editId` 저장. slug는 생성 후 불변이라 `readOnly` + `slugEdited=true`로 자동추천 잠금(이름 수정이 slug를 덮지 않게). `name`만 있으면(검색 핸드오프) 이름·slug 추천만 채움.
  - 제출 분기: 편집이면 `patchCommunity(editId, { name, personaPrompt, description, personaIcon }, userId)` → `navigate('/c/'+updated.slug)`; 아니면 기존 `postCommunity`. (slug는 PATCH 대상 아님 — 불변.)
  - 제목/부제/CTA가 편집 모드면 "커뮤니티 수정"·"[ 수정하기 ]/[ 수정 중… ]", 프리필 로딩 중 제출 비활성.
- **부수 수정**: 검색 화면 `[+] 만들기`가 넘기던 `state.name`(검색어로 이름 프리필)도 같은 메커니즘으로 이제 실제 반영됨.
- **검증**: 프론트 빌드(tsc+vite) 클린 + 30 테스트 통과. 브라우저 — yoon으로 커뮤니티 생성 후 ✎ 편집 → 이름/주소(읽기전용)/설명/페르소나가 기존 값으로 채워지고 제목이 "커뮤니티 수정"으로 표시됨을 확인.
- **불변(회귀 금지)**: 생성 흐름(빈 폼 + `postCommunity`)·라우팅·서버 라우트·BYOK·테스트. 편집은 생성자만(서버 403 가드).

### 4.9 글(게시글) 편집 모드 — PATCH /posts/:id + Thread [편집] 버튼 (2026-06-19)

OA-6 커뮤니티 편집 패턴을 글에 적용. 작성자는 `Thread` 헤더의 **[편집](✎) 버튼**으로 `/create-post` 편집 모드에 진입해 제목/본문/이미지를 수정할 수 있다.

- **백엔드 `PATCH /posts/:id` 엔드포인트**: 요청 본문 `{ title?, body?, imageUrl? }`(각 필드 선택). 인증: `x-user-id`로 현재 사용자와 `post.authorId` 매치 검증 → 비작성자는 **403 Forbidden**("글 작성자만 수정 가능"), 글 부재는 **404**. 응답: 수정된 `Post` DTO(최상위 `authorId`, `communityId`, `title`, `body`, `imageUrl` 포함). (TRD §4 테이블 추가 필요)
- **프론트 `patchPost` 클라이언트**: `frontend/src/api/rest.ts`에 `patchPost(id, { title?, body?, imageUrl? }, userId)`추가. `PATCH /posts/:id` + `x-user-id` 헤더. 응답 타입 = `Post` DTO. 에러: 403 → "이 글을 수정할 권한이 없어요", 404 → "글을 찾을 수 없어요".
- **`CreatePost.tsx` 편집 모드**: `useLocation().state`에서 `editPostId`를 읽음. `editPostId` 있으면 `getPost(editPostId)`로 로드 → `title/body/imageUrl` 프리필. 제출 분기: 편집이면 `patchPost(editPostId, {...}, userId)` → `navigate('/posts/'+id)`(Thread로 재진입); 아니면 기존 `postPost(생성)`. 제목/CTA가 편집 모드면 "글 수정"·"[ 수정하기 ]/[ 수정 중… ]". 이미지 재업로드·제거도 폼에서 처리. (Community 편집과 동일 메커니즘)
- **`Thread.tsx` 헤더 [편집] 버튼**: 글 상세 헤더의 **⋯ 메뉴 슬롯**(기존 placeholder)에 작성자만 보이는 **`✎ 편집`** 버튼 추가. 비작성자에게는 버튼 미표시(slot 비움). 클릭 시 `Link to="/create-post" state={{editPostId: post.id}}`로 편집 모드 진입. 북마크 🔖는 유지.
  - **스타일(2026-06-19 변경)**: 커뮤니티 상세의 `✎ 편집` 버튼(`Community.tsx`)과 **완전히 동일한 모양**으로 통일 — `shrink-0 rounded-[2px] border border-term-border px-2 py-1 text-xs text-term-dim transition hover:border-term-bright hover:text-term-bright`, 라벨 `✎ 편집`, `title="글 편집"`. (이전 `text-term-amber` 아이콘-only 스타일에서 교체.)
- **검증**: 프론트 빌드(tsc+vite) 클린 + 테스트 green. 브라우저 — 글 작성 후 Thread 헤더에 [편집] 표시 → 클릭 → CreatePost 폼이 제목/본문/이미지로 프리필되고 "글 수정" 제목 표시 → 수정 저장 → Thread 재진입하면 변경사항 반영. 다른 사용자 Thread에는 [편집] 미표시 확인.
- **불변(회귀 금지)**: 글 생성 흐름·1차 AI 답변·라우팅·SSE·BYOK·요약·컨텍스트 조립. 편집은 작성자만(서버 403 가드). 이미지 필드는 이미 POST 응답·`toFeedCard`에 포함되어 있어 무영향.

### 4.10 북마크 — Bookmark 모델 + 3개 엔드포인트 + Thread 🔖 버튼 + Profile 섹션 (2026-06-19)

사용자가 글을 북마크하고, 북마크한 글 목록을 프로필에서 모아본다.

- **DB(`backend/prisma/schema.prisma`)**: 신규 `model Bookmark { id, userId, postId, createdAt, @@unique([userId, postId]), @@index([userId, createdAt]) }`. 마이그레이션 `add_bookmark_model`로 테이블 생성. `resetDb()`에서 bookmark 테이블도 정리.
- **백엔드 3개 엔드포인트**(`backend/src/routes/posts.ts`):
  - **`POST /posts/:id/bookmark`** (인증: `x-user-id` 필수) — idempotent upsert. 이미 북마크되어 있으면 기존 row 반환(upd timestamp 갱신 안 함), 없으면 신규 생성. 201(신규) 또는 200(기존). 응답: `{ bookmarked: true }`.
  - **`DELETE /posts/:id/bookmark`** (인증: `x-user-id` 필수) — idempotent delete. 북마크 없으면 성공(204 또는 200). 응답: `{ bookmarked: false }`.
  - **`GET /users/:id/bookmarks`** (인증 선택) — 해당 사용자의 북마크 목록을 피드 카드로 반환. 쿼리: `prisma.bookmark.findMany({ where: { userId }, include: { post }, orderBy: { createdAt: 'desc' }, take: 50 })` → `toFeedCard`로 변환. 응답: `{ items: PostListItem[], nextCursor?: string }`.
- **`GET /posts/:id` 갱신**: 선택 `x-user-id` 헤더 있을 때만 응답에 `bookmarked: boolean` 추가. 없으면 `bookmarked: false`(또는 필드 생략). 코드: `const bookmarked = userId ? await prisma.bookmark.findUnique({ where: { userId_postId: { userId, postId } } }) !== null : false`.
- **프론트 타입/함수**(`frontend/src/api/rest.ts`·`api/types.ts`):
  - `Post`·`PostListItem` DTO에 `bookmarked?: boolean` 추가(선택 필드, GET 응답용).
  - 신규 함수: `addBookmark(postId: string, userId: string)`, `removeBookmark(postId: string, userId: string)`, `getUserBookmarks(userId: string)` — 각각 POST/DELETE/GET 호출.
- **`Thread.tsx` 헤더 🔖 버튼**(VR-3 구현):
  - 글 상세 헤더의 오른쪽 그룹에 북마크 버튼 추가(`aria-pressed={bookmarked}` 토글).
  - 초기값: `post.bookmarked`(서버에서 계산, 있으면 true, 없으면 false).
  - 낙관적 토글: 클릭 시 즉시 `setBookmarked(!bookmarked)` 후 `addBookmark()/removeBookmark()` 호출.
  - 로그인 필수: 미로그인이면 `openLogin()` 호출 후 반환(요청 미전송).
  - 실패 시 상태 롤백: `catch { setBookmarked(!next); showAiToast('북마크 처리에 실패했습니다.'); }`.
  - 비-표시용(BYOK/SSE/컨텍스트 불변): 북마크는 서버 상태만 반영, 실시간 SSE 브로드캐스트 없음(사용자별 프라이빗 상태).
- **`Profile.tsx` "북마크한 글" 섹션**:
  - 프로필 로드 시 `Promise.all([getUserCommunities(userId), getUserPosts(userId), getUserBookmarks(userId)])`로 함께 로드.
  - "북마크한 글" 섹션(홈 피드와 동일한 카드 리스트) — 최신 북마크순(서버가 `createdAt DESC`로 정렬).
  - 빈상태: `<EmptyState title="북마크한 글이 없어요" />`.
  - 클릭하면 Thread로 진입(PostCard 기존 동작).
- **검증**: 서버 build + test 22개 green. 프론트 build + test 30개 green. 브라우저 — Thread 헤더 🔖 토글 → POST/DELETE 호출 확인, Profile 북마크한 글 목록 표시·빈상태 확인, 로그아웃 후 북마크 폼은 인증 게이트 동작.
- **불변(회귀 금지)**: SSE(북마크 이벤트 없음)·BYOK·컨텍스트·요약·댓글 흐름. 북마크는 글별 사용자 프라이빗 상태이며 다른 사용자의 북마크 여부는 미노출.

### 4.11 KO/EN 양국어 UI (i18n, 2026-06-20)

UI 언어를 한국어(기본)/영어로 전환하는 경량 상태 기반 i18n을 구현한다. 외부 라이브러리 없이 자체 제작했으며, URL 변경 없음(라우팅·슬러그·API 계약 불변).

**`langStore` (`frontend/src/stores/langStore.ts`)**
- `Lang = 'ko' | 'en'`. zustand + persist(`aidit-lang` localStorage 키).
- 초기화: 저장값이 없으면 `navigator.language`의 첫 두 글자로 기본값 결정(`'en'`이면 영어, 나머지는 모두 한국어).
- `setLang(lang)` 호출 시 상태 갱신 + `document.documentElement.lang` 동기화 → SEO·스크린리더 정합. 앱 마운트 시에도 동일하게 `<html lang>`을 초기 언어로 설정.

**`src/i18n` 모듈 (`frontend/src/i18n/`)**
- `dicts/ko.ts` / `dicts/en.ts` — 중첩 키 객체(네임스페이스 = 최상위 키). 두 파일은 동일 구조를 유지해야 하며(누락 키는 빌드 타임 TypeScript로 감지 가능).
- `useT()` 훅 — `langStore`를 구독하고 현재 언어의 dict를 반환. 컴포넌트에서 `const t = useT(); t('feed.empty')` 형태로 사용.
- `tn(key, n)` 헬퍼 — 복수형 분기(`n === 1`이면 단수형, 나머지 복수형). 영어 명사 복수에 사용(`'comment'` / `'comments'`). 한국어는 단/복수 동형이므로 실질적으로 영어 전용.

**`LangToggle` 컴포넌트 (`frontend/src/components/LangToggle.tsx`)**
- `[KO]` / `[EN]` 텍스트 버튼(현재 선택 언어는 `text-term-bright`, 비선택은 `text-term-dim`). 레트로 터미널 토큰 사용.
- 배치: **헤더 우측**(`AppLayout.tsx` — 로그인/유저명 버튼 옆), **프로필 화면**(`Profile.tsx` — 계정 설정 섹션 내).

**네임스페이스별 문자열 마이그레이션**
모든 하드코딩 한국어 UI 문자열을 `t(...)` 호출로 교체했다. 대상 네임스페이스:
- `app` — 앱 셸(헤더·하단 탭·사이드바 라벨·오프라인 배너)
- `auth` — 로그인 모달·폼·에러
- `feed` — 홈 피드·빈상태·커서 버튼
- `post` — 글 작성·편집 폼·이미지 첨부·AI 1차 답변 토글
- `community` — 커뮤니티 상세·생성·편집·PersonaEditor
- `thread` — 스레드 헤더·핀 카드·Composer·재시도·북마크
- `search` — 검색 입력·결과·빈상태
- `profile` — 프로필 헤더·키 입력·내 글/커뮤니티/북마크 섹션
- `error` — 공유 ErrorState·EmptyState 메시지

UGC(사용자가 입력한 글 제목·본문·댓글·커뮤니티 이름/설명/페르소나 프롬프트)는 번역 대상이 아니며 그대로 표시된다.

**AI 언어 배선 (`frontend/src/engine/contextEngine.ts` 외)**
- `systemInstruction` 디렉티브 — AI 페르소나 프롬프트에 "Respond in the same language as the UI: `<lang>`" 지시문을 동적으로 앞붙임. `langStore.getState().lang`을 조립 시점에 읽어 `'ko'`/`'en'`을 주입.
- `SUMMARY_DIRECTIVE` — 요약 프롬프트(`ensureSummary`)가 사용하는 지시문을 언어별로 분기(한국어: 기존 문구, 영어: 동의어 영문 문구). 컨텍스트 조립 시 현재 언어 기준으로 선택.
- Gemini 에러 메시지 맵 (`frontend/src/api/gemini.ts`) — `GeminiError` kind별 사용자 노출 문자열을 `{ ko, en }` 맵으로 전환하고, 표시 시점에 `langStore.getState().lang`으로 언어를 선택해 반환.
- **BYOK·API 키·서버 호출은 무변경**: 언어 설정은 클라이언트 상태 전용이며, 어떤 헤더/바디에도 포함되지 않는다.

**스펙 이탈 / 명시적 비적용**
- URL 변경 없음(`/posts/:id` 등 라우트 불변; lang prefix 없음).
- UGC 미번역(설계 의도).
- 서버·API 계약·테스트 무변경(순수 프론트엔드 변경).
- 세 가지 이상의 언어는 dict 파일과 `Lang` 타입 확장으로 추가 가능하나 현재는 `ko`/`en` 두 값만 유효.

### 4.12 ShellPrompt 컴포넌트 추출 + 전 화면 확장 (2026-06-20)

기존 Home 화면(`pages/Home.tsx`)에만 존재하던 그린 CRT 셸 프롬프트 라인이 **`aidit@yoon`** 으로 사용자명을 하드코딩하고 있어, 로그인한 실제 사용자명이 반영되지 않는 버그가 있었다. 본 작업은 프롬프트를 재사용 가능한 컴포넌트로 추출하고 전체 주요 화면에 일관 적용한다. 라우팅·스토어·API 계약·백엔드·테스트는 무변경이며 **순수 표현 계층** 변경이다.

**`ShellPrompt` 컴포넌트 (`frontend/src/components/ShellPrompt.tsx`)**
- props `{ command: string }` — 화면별 커맨드 문자열(프롬프트 우측에 표시할 텍스트).
- `authStore`를 구독해 `username`을 반응형으로 읽음. 미로그인(`username` 없음)이면 `guest` 폴백.
- 렌더: `` `aidit@{username} > {command}` `` 형태의 단일 행. 기존 Home의 스타일 토큰(`text-term-bright`, `font-mono`, `glow` 드롭섀도우 클래스)을 그대로 계승.
- 블링킹 커서(`animate-blink` + `│` 또는 `▌`)는 기존 Home 구현과 동일하게 줄 끝에 유지.
- 커맨드 문자열은 `t(...)` i18n 대상이 아님 — 터미널 ASCII 관용어이므로 언어에 무관하게 영문 고정.

**하드코딩 사용자명 버그 수정**
- 기존 Home의 `aidit@yoon`은 리터럴 문자열이라 어떤 사용자로 로그인해도 항상 `yoon`을 표시했다.
- `ShellPrompt`가 `authStore.username`을 직접 구독함으로써 로그인 상태 변화(로그인·로그아웃·세션 복원)에 자동 반응한다. `guest`는 비로그인 상태임을 명시적으로 표현하는 폴백이다.

**화면별 커맨드 매핑 (8개 주요 화면)**

| 화면 | 파일 | 커맨드 문자열 |
|------|------|--------------|
| Home | `pages/Home.tsx` | `feed --hot` |
| Community 상세 | `pages/Community.tsx` | `cd /c/{slug}` |
| Thread | `pages/Thread.tsx` | `thread --id {postId}` |
| Search | `pages/Search.tsx` | `search --query` |
| CreatePost | `pages/CreatePost.tsx` | `new post` |
| CreateCommunity | `pages/CreateCommunity.tsx` | `new community` |
| Profile | `pages/Profile.tsx` | `whoami` |
| Login | `pages/Login.tsx` | `auth login` |

- `Community`·`Thread`처럼 라우트 파라미터가 있는 화면은 `slug`/`postId`를 동적으로 보간해 현재 컨텍스트를 반영한다.
- 커맨드는 동작 없는 시각 요소이며 클릭·포커스 이벤트 없음.

**변경 파일**: `frontend/src/components/ShellPrompt.tsx`(신규), `frontend/src/pages/{Home,Community,Thread,Search,CreatePost,CreateCommunity,Profile,Login}.tsx`.

**불변(회귀 금지)**: 라우팅·스토어·API 계약·SSE·BYOK·i18n 딕셔너리·테스트. 기존 Home의 다른 레이아웃 요소는 ShellPrompt 교체 외 무변경.

---

### 4.13 라이브 프롬프트 polish — ShellPrompt a11y · 공유 util · 파생 커맨드 반영 (2026-06-20)

§4.12에서 추출한 `ShellPrompt`에 대한 접근성 수정, 공유 순수 유틸 도입, 그리고 개별 화면의 커맨드 문자열을 현재 폼 상태로부터 파생시키는 후속 polish 작업이다. 라우팅·스토어·API 계약·백엔드·테스트는 무변경이며 **순수 표현 계층** 변경이다.

**ShellPrompt 접근성 수정 (`frontend/src/components/ShellPrompt.tsx`)**
- 전체 프롬프트 행에 `aria-hidden="true"` + `role="presentation"`을 적용해, 스크린리더가 장식용 터미널 텍스트(`aidit@username > command ▌`)를 읽어내지 않도록 한다.
- `aria-live` 영역은 의도적으로 **미사용**: 커맨드 문자열이 바뀔 때마다 스크린리더 알림이 발생하면 노이즈가 되므로, 전체 행을 보조 기술에서 감춘다. 이미 §4.12에서 커맨드는 동작 없는 순수 시각 요소로 확정했으므로, aria-live 제외는 그 결정의 일관된 연장이다.

**공유 순수 유틸 `src/lib/shellArg.ts::formatPromptArg`**
- 커맨드 문자열에 삽입할 동적 인수를 정규화하는 경량 순수 함수. 적용 순서:
  1. 선행·후행·연속 공백을 단일 스페이스로 압축(whitespace-collapse).
  2. 압축 후 ~32자를 초과하면 잘라내고 `…`(유니코드 말줄임표) 추가.
  3. 커맨드 맥락에서 미관상 이질감을 주는 `"` → `\"`, `\`` → `\\\`` 이스케이프(shell 의미 처리가 아닌 표시용).
- 단위 테스트 (`frontend/src/lib/shellArg.test.ts`): 빈 문자열, 공백만, 긴 문자열, 따옴표 포함, 복합 케이스 커버.
- 이 함수는 앱 내 어디에서도 `import { formatPromptArg } from '../lib/shellArg'`로 side-effect 없이 재사용 가능하다.

**`CreateCommunity` — 파생 slug 반영 (`frontend/src/pages/CreateCommunity.tsx`)**
- ShellPrompt에 전달하는 커맨드를 고정 `new community` 대신 폼의 현재 `slug` 상태로부터 파생:
  - slug가 있으면: `mkdir /c/<slug>` (slug를 `formatPromptArg`로 정규화).
  - slug가 비어 있으면: `mkdir /c/new` (빈 상태 폴백).
- 사용자가 커뮤니티 이름을 입력함에 따라 자동 추천된 slug가 커맨드에 실시간 반영된다.

**`CreatePost` — 잘라내기·이스케이프된 title 반영 (`frontend/src/pages/CreatePost.tsx`)**
- ShellPrompt 커맨드를 고정 `new post` 대신 현재 `title`과 `selectedCommunitySlug`로부터 파생:
  - title이 있으면: `post --new r/<slug> "<title>"` (title을 `formatPromptArg`로 정규화; slug 없으면 `r/?`).
  - title이 비어 있으면: `post --new r/<slug>`(또는 `post --new`) 기본 커맨드.
- 긴 제목이 커맨드 행을 overflow하지 않도록 `formatPromptArg`의 32자 잘라내기가 작동한다.

**`Thread` — AI-ask 모드 정적 스왑 (`frontend/src/pages/Thread.tsx`)**
- ShellPrompt 커맨드를 `wantsAI` 불리언에 따라 정적으로 전환:
  - 일반 모드: `tail -f /p/<postId>`
  - AI-ask 모드(`wantsAI === true`): `ai --ask /p/<postId>`
- `wantsAI` 상태는 `Composer` 내부(`aiModeStore` + 수동 `@AI` 감지)에서 결정되므로, Thread가 이를 알려면 콜백이 필요하다. `Composer`에 `onWantsAIChange?: (v: boolean) => void` prop을 추가하고, Thread에서 `useState<boolean>(false)`로 `wantsAI`를 리프트업해 ShellPrompt에 전달한다. Composer의 기존 전송 라우팅(`wantsAI = 토글 ON || 수동 @AI`)·`aiModeStore` 구조는 **불변**이다.
- **라이브 댓글 텍스트 미러링 의도적 제외**: Composer 입력 텍스트(`draft`)는 커맨드에 반영하지 않는다. 타이핑할 때마다 커맨드가 바뀌면 시각적 노이즈가 크고, `aria-hidden` 행이므로 a11y 이득도 없다. `wantsAI` 토글처럼 **의미 있는 상태 전환**만 커맨드에 반영하는 것이 이 화면의 일관된 설계 원칙이다.

**`Search` — 선례 화면으로 유지**
- `Search` 화면의 `search --query` 커맨드는 검색어를 미러링하지 않고 고정 문자열로 유지한다. 이는 `CreateCommunity`·`CreatePost`·`Thread`의 파생 커맨드와 대비되는 의도적 선례(untouched precedent)이며, 향후 동일 패턴 적용 여부 판단의 기준이 된다.

**커맨드 문자열 i18n 비적용 유지**
- §4.12에서 확정한 대로, 커맨드 문자열은 `t(...)` i18n 대상이 아니다. 터미널 ASCII 관용어 특성상 언어 전환(KO↔EN)과 무관하게 영문 고정이 올바른 UX다.

**변경 파일**: `frontend/src/components/ShellPrompt.tsx`, `frontend/src/lib/shellArg.ts`(신규), `frontend/src/lib/shellArg.test.ts`(신규), `frontend/src/pages/{CreateCommunity,CreatePost,Thread}.tsx`, `frontend/src/components/Composer.tsx`(`onWantsAIChange` prop 추가).

**불변(회귀 금지)**: 라우팅·스토어·API 계약·SSE·BYOK·i18n·기존 테스트. `aiModeStore` 구조 및 Composer 전송 라우팅 로직. `Search`·`Home`·`Community`·`Profile`·`Login` ShellPrompt 커맨드(이미 확정 또는 파생 불필요).

---

## 5. 스펙에 없던 추가 보조 자산

구현 응집을 위해 PLAN의 WP 파일 목록 외에 도입한 소규모 자산:

- `frontend/src/stores/postIntentStore.ts` — CreatePost의 "1차 AI 답변 받기" 토글 값을 Thread로 전달(스레드 진입 후 1회 trigger). (FR-4.3 보조)
- `frontend/src/engine/retryAiBubble.ts` — FAILED AI 버블 재시도(같은 버블 재호출 → PATCH) 보조. (FE-12 retry 보조)
- `frontend/src/lib/SafeMarkdown.tsx` — `renderMarkdownSafe` 래퍼 컴포넌트(XC-3 렌더 편의).
- `frontend/src/components/states/` — `EmptyState` / `ErrorState` / `LoadingState` / `OfflineBanner` (FE-14 재사용 컴포넌트 집합).
- `backend/src/domain/segment.ts::openSummarySegment` — 요약 전환 트랜잭션 헬퍼(BE-5s/BE-7 응집).
- `frontend/src/pages/Search.tsx` — 도달 가능한 검색 페이지(`/search`). (2026-06-18)
- `frontend/src/pages/Profile.tsx` — 프로필 페이지(`/me`: 로그아웃·API 키 변경·내 커뮤니티·내 글). (2026-06-18)
- `frontend/src/pages/Community.tsx` — 이제 `CommunitySearch`도 export하고 slug 없는 진입 시 리다이렉트 처리. (2026-06-18)
- `frontend/src/stores/authStore.ts::updateKey` — localStorage API 키 갱신(L1 유지, 키 미전송). (2026-06-18)
- `frontend/src/stores/aiModeStore.ts` — 스레드별 AI 모드 토글 상태(세션, 미영속). (2026-06-18)
- 백엔드 `GET /users/:id/posts`·`GET /users/:id/communities` — 프로필 "내 글/내 커뮤니티" 조회용. 각각 평탄 `PostListItem`/`Community` 형상(후자에 비계약 `postCount` 가산 필드 — 무해 additive). (2026-06-18)

---

## 6. 테스트 현황 (XC-T)

- **백엔드 (`backend/`, vitest, app.inject + 격리 SQLite): 22/22 green**
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
cd backend
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
