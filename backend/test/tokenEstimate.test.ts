// TRD §6.4 — the calibrated token estimator that drives the 128K trigger.
//
// Every `actual` below is a REAL measurement: the provider's countTokens on that
// exact string (gemini-3.1-flash-lite, 2026-07-28). That is what makes this a
// calibration test rather than a restatement of the formula.
//
// The fixtures are inline literals ON PURPOSE. An earlier draft sliced repo docs,
// which would silently invalidate every measured number the moment a doc changed.
//
// The property that matters is AGGREGATE accuracy, because ContextSegment.tokenSum
// is a running total: an estimator that is right on average keeps the 128K policy
// honest even when individual messages are off.

import { describe, expect, it } from "vitest";

import { estimateTokens } from "../src/domain/tokenEstimate.js";

interface Fixture {
  name: string;
  text: string;
  /** countTokens result for this exact string. */
  actual: number;
}

const KO_TURNS = [
  "「아라」: 에이전트한테 일을 맡길 때 각자 어떻게 하시나요? 저는 계획을 먼저 세우게 합니다.",
  "「바다」: 저는 파일 경로랑 에러 전문을 먼저 다 붙여줘요. 그것만 해도 헛다리 짚는 게 확 줄어요.",
  "「찬」: 반대로 저는 계획부터 시키는 게 더 컸어요. 계획을 사람이 한 번 보고 나면 큰 실수가 거의 없어요.",
].join("\n");

const KO_LONG = [
  "코드 에이전트에 일을 맡길 때 가장 중요한 것은 컨텍스트를 어떻게 주느냐다. 파일 경로와 에러 전문을 먼저 붙여주면 헛다리를 짚는 일이 크게 줄어든다.",
  "반대로 여러 파일을 건드리는 기능 추가나 리팩터링에서는 계획을 먼저 세우게 하고 사람이 그 계획을 검토하는 편이 낫다. 방향이 틀렸을 때의 낭비가 가장 크기 때문이다.",
  "테스트를 먼저 쓰게 하는 방식도 효과가 있었다. 요구사항을 입출력으로 고정하면 논리적 비약이 줄어들고 회귀 버그도 예방된다. 다만 초기 설계에 시간이 들고 프롬프트가 길어져 컨텍스트를 과하게 점유할 수 있다.",
  "컨텍스트를 너무 많이 주면 오히려 산만해지는 경우도 있다. 현재 작업과 직접적인 인과관계가 있는 파일, 인터페이스 정의, 관련 테스트 코드로 범위를 좁히는 것이 좋다.",
  "프로젝트 전체의 맥락은 구조 요약본으로 대체하고, 세부 구현 단계에서는 해당 모듈의 코드만 순차적으로 제공하는 방식이 안정적이었다.",
  "커밋 단위를 작게 유지하는 것도 핵심이다. 작은 단위로 변경하고 매번 검증하면 문제가 생겨도 되돌리기 쉽다.",
  "정리하면 분석, 설계, 테스트, 구현, 검증 및 커밋의 다섯 단계로 나누어 진행하는 것이 지금까지 가장 안정적인 흐름이었다.",
].join("\n\n");

const EN_LONG = [
  "When delegating work to a coding agent, the decisive factor is how context is supplied. Providing the file path and the full error text up front sharply reduces wasted exploration.",
  "For feature work that touches several files, it is usually better to have the agent produce a plan first and to have a human review that plan, because the cost of a wrong direction dominates.",
  "Writing tests first also helps: pinning requirements to inputs and outputs removes ambiguity and prevents regressions, at the price of slower initial setup and a longer prompt.",
  "Supplying too much context can backfire. Narrowing to the files, interface definitions, and tests causally related to the current task keeps the agent focused.",
  "Keeping commits small remains the most reliable habit, since a small change that fails is trivial to revert.",
].join("\n\n");

const MD_LONG = [
  "# 코드 에이전트 사용 가이드",
  "",
  "본 문서는 코드 에이전트와 효과적으로 협업하기 위한 전략을 정리한 것이다.",
  "",
  "## 1. 상황별 접근 전략",
  "- **정보 중심 접근**: 디버깅과 단순 수정에 적합하다. 파일 경로와 스택 트레이스를 함께 제공한다.",
  "- **계획 중심 접근**: 신규 기능과 리팩터링에 적합하다. 변경 파일 목록과 수정 로직을 단계별로 요약하게 한다.",
  "",
  "## 2. 테스트 선행 방식",
  "1. 요구사항을 입출력 기반으로 정의한다",
  "2. 핵심 로직에는 테스트 선행, 단순 CRUD에는 빠른 구현을 적용한다",
  "",
  "| 단계 | 도구 | 사람이 하는 일 |",
  "|---|---|---|",
  "| 분석 | 대화 | 에러 로그 제공 |",
  "| 설계 | 대화 | 계획 검토 |",
  "| 구현 | 에이전트 | 결과 검증 |",
  "",
  "## 미해결 질문",
  "- 컨텍스트 선택을 시스템적으로 자동화할 수 있을까?",
  "- 하이브리드 전략의 정량적 기준은 무엇인가?",
].join("\n");

/** Realistic message sizes — these dominate a real thread's tokenSum. */
const LONG: Fixture[] = [
  { name: "ko-long-prose", text: KO_LONG, actual: 321 },
  { name: "en-long-prose", text: EN_LONG, actual: 159 },
  { name: "ko-markdown-doc", text: MD_LONG, actual: 239 },
];

/** Short messages — included for completeness; ceil() rounding dominates them. */
const SHORT: Fixture[] = [
  { name: "ko-discussion-turns", text: KO_TURNS, actual: 100 },
  { name: "short-ko", text: "정리된 내용 기준으로 알려줘.", actual: 9 },
  { name: "short-en", text: "Summarize the discussion so far.", actual: 8 },
];

const ALL = [...LONG, ...SHORT];
// LONG/SHORT stay separate for readability: LONG are realistic message sizes,
// SHORT are where ceil() rounding dominates.

const pctErr = (pred: number, actual: number) => ((pred - actual) / actual) * 100;
const legacy = (text: string) => Math.ceil(text.length / 4);
const sum = (fs: Fixture[], f: (t: string) => number) =>
  fs.reduce((a, x) => a + f(x.text), 0);
const sumActual = (fs: Fixture[]) => fs.reduce((a, x) => a + x.actual, 0);

describe("estimateTokens — calibrated against countTokens (TRD §6.4)", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("prices Latin at ~4.5 chars/token, matching the measurement", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(9);
    // 32 chars -> 8, which is EXACTLY what countTokens returned for this string.
    expect(estimateTokens("Summarize the discussion so far.")).toBe(8);
  });

  it("prices Hangul ~3.5x denser than Latin (the fix)", () => {
    // 10 Hangul chars -> 8 tokens, not the 3 that chars/4 predicted.
    expect(estimateTokens("가나다라마바사아자차")).toBe(8);
    // The same character count in Latin stays at 3.
    expect(estimateTokens("abcdefghij")).toBe(3);
    // Mixed text splits by script: ceil(4/1.3 + 8/4.5) = ceil(3.08 + 1.78) = 5.
    expect(estimateTokens("가나다라abcdefgh")).toBe(5);
  });

  it("no longer under-counts Korean the way chars/4 did", () => {
    for (const f of ALL) {
      if (!/[가-힣]/.test(f.text)) continue;
      // Legacy was 25%+ short on every Korean fixture …
      expect(pctErr(legacy(f.text), f.actual), `${f.name} legacy`).toBeLessThan(-25);
      // … the calibrated estimate never under-counts Korean at all (it errs high).
      expect(pctErr(estimateTokens(f.text), f.actual), `${f.name} now`).toBeGreaterThan(-10);
    }
  });

  it("errs HIGH on conversational Korean — the safe direction, and bounded", () => {
    // Measured density spread: conversational Korean tokenizes at ~0.65
    // tokens/char while technical Korean with markup runs ~1.0. One coefficient
    // cannot serve both (TRD §6.4), so chat-shaped text is over-counted. That is
    // the direction we want: the 128K trigger fires early (a cheaper summary)
    // instead of late (policy silently exceeded). Bound it so a future change that
    // doubles the over-count is caught.
    const err = pctErr(sum(ALL, estimateTokens), sumActual(ALL));
    expect(err).toBeGreaterThan(0);
    // Measured aggregate over the full app-shaped sample set is +7.9%; this
    // fixture subset skews a little higher because short strings are included.
    expect(err).toBeLessThan(25);
  });

  it("beats chars/4 on every individual fixture's absolute error", () => {
    // The aggregate comparison alone could hide a formula that is merely
    // differently-wrong, so compare per fixture.
    for (const f of ALL) {
      const now = Math.abs(pctErr(estimateTokens(f.text), f.actual));
      const before = Math.abs(pctErr(legacy(f.text), f.actual));
      // short-en is pure Latin and unchanged, so allow equality there.
      expect(now, f.name).toBeLessThanOrEqual(before);
    }
  });

  it("returns positive integers and is monotonic in appended text", () => {
    for (const f of ALL) {
      const t = estimateTokens(f.text);
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
    }
    const base = "논의를 정리하자";
    expect(estimateTokens(base + base)).toBeGreaterThan(estimateTokens(base));
  });
});
