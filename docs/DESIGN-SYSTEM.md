# Aidit — Design System (v1, 로고 기반 리브랜딩)

> 2026-06-19. Aidit 로고(블루→바이올렛 그라디언트 "A" 화살표 마크)를 단일 출처로 한
> 비주얼 아이덴티티 정의서. 이 문서가 색·타이포·로고·시그니처 사양의 **단일 출처(SoT)**다.
> 기존 `WIREFRAME.md §6.3`(플랫 바이올렛 `#7c3aed`)은 본 문서로 **대체**된다.

---

## 0. 디자인 의도 (Design thesis)

로고 마크의 실제 픽셀 색을 추출한 결과 코어 색은 **인디고-바이올렛 `#6848F8`** — 기존 브랜드의
더 붉은 바이올렛(`#7c3aed`)보다 **더 파랗다**. 리브랜딩의 핵심은 브랜드를 *플랫 퍼플*에서
로고의 **블루→바이올렛 그라디언트 정체성**으로 재정렬하는 것이다.

- **시그니처(딱 하나의 기억점)**: 로고의 그라디언트 "A" 마크와 그 **블루→바이올렛 그라디언트**.
  과감함은 한 곳에만 쓴다 → **전송 버튼 / 주요 CTA / 로고 / 로그인 히어로**에만 그라디언트.
  채팅 버블·네비·칩 등 나머지는 **단색 brand 토큰**으로 조용하게 유지(절제).

---

## 1. 컬러 토큰 (로고에서 추출)

브랜드 스케일은 로고 코어(`#6848F8`)를 **500**에 고정한 인디고-바이올렛 한 줄이다.
Tailwind 기본 `purple`(더 붉음)을 쓰지 않고 아래 `brand-*`로 **전부 교체**한다.

| 토큰 | HEX | 용도 |
| --- | --- | --- |
| `brand-50`  | `#EFEDFE` | AI 버블 배경, 옅은 틴트 면, 칩 배경 |
| `brand-100` | `#E2DDFD` | hover 틴트, 칩 |
| `brand-200` | `#C8BEFB` | 틴트 면의 보더 |
| `brand-300` | `#AC9CF9` | 비활성 강조 |
| `brand-400` | `#8E76F9` | 보조 강조 |
| `brand-500` | `#6848F8` | **DEFAULT** — 로고 코어, 단색 채움, 활성 네비 |
| `brand-600` | `#5733E6` | **링크·라벨 텍스트**, hover/pressed (대비 ↑) |
| `brand-700` | `#4424C0` | 강한 강조, pressed |
| `ink`       | `#15132E` | "Aidit" 워드마크 / 강한 헤딩 (쿨 니어블랙) |
| `canvas`    | `#F6F5FB` | 앱 배경 (기존 slate-50 대체, 미세 바이올렛 틴트) |

**시그니처 그라디언트** (`--brand-gradient` / Tailwind `bg-brand-gradient`):
`linear-gradient(140deg, #5B6CF5 0%, #6848F8 55%, #8B5CF6 100%)`

- 대비: 본문/링크 텍스트는 `brand-600`(≈6:1) 사용. 단색 채움·활성 아이콘은 `brand-500`.
  흰 글자를 얹는 면(전송 버튼·본인 버블)은 `brand-500`/`brand-600` 또는 그라디언트.

### 토큰 매핑 (기존 → 신규)

| 기존 (하드코딩) | 신규 |
| --- | --- |
| `#7c3aed` / `brand.DEFAULT` | `brand-500 #6848F8` |
| `#6d28d9` / `brand.dark` | `brand-600 #5733E6` |
| `bg-purple-50` | `bg-brand-50` |
| `bg-purple-100` | `bg-brand-100` |
| `border-purple-200` / `-300` | `border-brand-200` |
| `text-purple-700` / `-600` | `text-brand-700` (라벨) / `text-brand-600` (링크) |
| `bg-purple-600` (전송·@AI 상태) | `bg-brand-gradient` (전송 시그니처) |
| `accent-violet-600` | `accent-[#6848F8]` (= brand-500) |
| `bg-slate-50` (앱/포커스 면) | `bg-canvas` (앱 배경만; 입력 면은 유지 가능) |

> SummaryBubble의 `from-amber-50 via-purple-50 to-purple-100`은 요약 밴드의 의도된
> "따뜻한 강조"이므로 `via/to`만 `brand` 틴트로 교체(`from-amber-50 via-brand-50 to-brand-100`).

---

## 2. 타이포그래피

CSP(스크립트/connect 잠금)와 PWA 오프라인 요건상 **웹폰트 CDN을 쓸 수 없다.** 따라서 개성은
**새 글꼴이 아니라 굵기·자간·스케일**로 만든다. 본문 스택은 현행 유지(`-apple-system … 'Noto Sans KR'`).

- **워드마크 "Aidit"**: `font-bold`, 자간 `tracking-[-0.02em]`, 색 `text-ink`. 마크와 가로 락업.
- **헤딩**: `text-ink`(쿨 니어블랙) — 기존 `text-slate-900`보다 브랜드와 조화.
- **유틸/데이터**(점수·시간): `text-slate-500`, 필요 시 `tabular-nums`.

---

## 3. 로고 자산

`frontend/public/`:

| 파일 | 내용 |
| --- | --- |
| `favicon.svg` | 그라디언트 "A" 마크, 투명 배경 (모던 브라우저 기본 파비콘) |
| `favicon-32.png` / `favicon-16.png` | PNG 폴백 |
| `apple-touch-icon.png` (180) | 그라디언트 면 + 흰 마크 (iOS 홈) |
| `icon-192.png` / `icon-512.png` | 그라디언트 타일 + 흰 마크 (PWA 앱 아이콘) |
| `maskable-512.png` | 풀블리드 그라디언트 + 흰 마크(세이프존 62%) |

- **컴포넌트 `Logo.tsx`**: 인라인 SVG 마크(그라디언트) + "Aidit" 워드마크. `size` prop으로
  헤더(작게)·로그인 히어로(크게) 공용. 마크 path는 `favicon.svg`와 동일.
- **마크 path**:
  `M22.9 7.4 Q24 5 25.1 7.4 L42 41 Q42.8 42.5 41 42.5 L33 42.5 Q31.8 42.5 31.2 41.4 L24.9 29.6 Q24 28 23.1 29.6 L16.8 41.4 Q16.2 42.5 15 42.5 L7 42.5 Q5.2 42.5 6 41 Z`

---

## 4. 적용 지점 (컴포넌트)

| 영역 | 변경 |
| --- | --- |
| **헤더**(`AppLayout`) | 텍스트 "Aidit" → `<Logo>` 락업(마크+워드마크). |
| **로그인**(`Login`) | 상단에 큰 `<Logo>` 히어로 + CTA(시작하기) `bg-brand-gradient`. |
| **하단 탭/사이드바** | 활성 색 `text-brand`(=brand-500). |
| **전송 버튼**(`Composer`) | `bg-brand-gradient`(시그니처). @AI/일반 모두 그라디언트, 비AI는 brand 단색 허용. |
| **AI 버블/요약**(`ChatBubble`/`SummaryBubble`) | `purple-*` → `brand-*` 틴트. |
| **본인 버블** | `bg-brand`(단색, 흰 글자) 유지 — 그라디언트는 전송 버튼에만. |
| **테마 컬러** | `index.html` `theme-color` + manifest `theme_color` → `#6848F8`. |
| **파비콘 링크** | `index.html`에 `favicon.svg` + png 폴백 + apple-touch. |
| **앱 배경** | `index.css` body `bg-canvas`. |

## 5. 품질 바닥선

반응형(모바일 360–430px), 가시적 키보드 포커스(`focus-visible`), `prefers-reduced-motion` 존중,
브랜드 색 대비 충족(텍스트 `brand-600`). 기존 정렬 보정(`UI-ALIGNMENT-AUDIT.md`) 회귀 금지.
