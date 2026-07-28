#!/usr/bin/env node
// Re-calibrate the token estimator against the provider (TRD §6.4).
//
// Run this when the model changes — a different tokenizer invalidates the
// constants in src/domain/tokenEstimate.ts (and their twin in
// frontend/src/api/llm.ts).
//
// Cost, scoped precisely (TRD §6.4): Vertex AI / Firebase AI Logic documents
// "There's no charge for calling countTokens" with a 3000 RPM quota; the Gemini
// Developer API docs — the endpoint below — say nothing about countTokens billing.
// So expect no token charge, but note it DOES consume RPM quota. This script makes
// ~10 calls, well inside that. Runtime never calls countTokens per message: the
// point of this script is to keep a pure-local estimate honest.
//
// Usage:
//   CAL_KEY=<a provider key> node scripts/calibrate-token-estimate.mjs
//   CAL_KEY=... LLM_MODEL=gemini-x-flash node scripts/calibrate-token-estimate.mjs
//
// The key is read from the environment and never written anywhere.

import { estimateTokens } from '../src/domain/tokenEstimate.ts';

const KEY = process.env.CAL_KEY;
const MODEL = process.env.LLM_MODEL ?? 'gemini-3.1-flash-lite';

if (!KEY) {
  console.error('CAL_KEY is required (a provider API key; never stored).');
  process.exit(2);
}

const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:countTokens?key=${KEY}`;

async function actual(text) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
  });
  if (!res.ok) {
    throw new Error(`countTokens ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).totalTokens;
}

// Dense = Hangul/CJK/kana, matching the estimator's split.
const DENSE = /[가-힣ᄀ-ᇿ㄰-㆏぀-ヿ一-鿿]/g;
const split = (t) => {
  const dense = (t.match(DENSE) ?? []).length;
  return { dense, rest: t.length - dense };
};

// TWO content families, because measurement showed Korean token density varies
// ~1.5x between them and a single-family fit misleads (TRD §6.4).
const SAMPLES = [
  // (A) chat-shaped: what comments / AI replies / condensed docs look like
  ['chat/turns', [
    '「아라」: 에이전트한테 일을 맡길 때 각자 어떻게 하시나요? 저는 계획을 먼저 세우게 합니다.',
    '「바다」: 저는 파일 경로랑 에러 전문을 먼저 다 붙여줘요. 그것만 해도 헛다리 짚는 게 확 줄어요.',
  ].join('\n')],
  ['chat/ko-prose', [
    '코드 에이전트에 일을 맡길 때 가장 중요한 것은 컨텍스트를 어떻게 주느냐다. 파일 경로와 에러 전문을 먼저 붙여주면 헛다리를 짚는 일이 크게 줄어든다.',
    '반대로 여러 파일을 건드리는 기능 추가나 리팩터링에서는 계획을 먼저 세우게 하고 사람이 그 계획을 검토하는 편이 낫다.',
    '컨텍스트를 너무 많이 주면 오히려 산만해지는 경우도 있다. 현재 작업과 직접적인 인과관계가 있는 범위로 좁히는 것이 좋다.',
  ].join('\n\n')],
  ['chat/en-prose',
    'When delegating work to a coding agent, the decisive factor is how context is supplied. Providing the file path and the full error text up front sharply reduces wasted exploration.'],
  ['chat/short-ko', '정리된 내용 기준으로 알려줘.'],
  ['chat/short-en', 'Summarize the discussion so far.'],
  // (B) doc-shaped: technical Korean with markup — condensed documents trend here
  ['doc/markdown', [
    '# 코드 에이전트 사용 가이드', '', '## 1. 상황별 접근 전략',
    '- **정보 중심 접근**: 디버깅과 단순 수정에 적합하다. 파일 경로와 스택 트레이스를 함께 제공한다.',
    '', '| 단계 | 도구 | 사람이 하는 일 |', '|---|---|---|', '| 분석 | 대화 | 에러 로그 제공 |',
    '', '## 미해결 질문', '- 컨텍스트 선택을 자동화할 수 있을까?',
  ].join('\n')],
];

const rows = [];
for (const [name, text] of SAMPLES) {
  const a = await actual(text);
  const { dense, rest } = split(text);
  const est = estimateTokens(text);
  rows.push({ name, dense, rest, actual: a, est });
  const err = ((est - a) / a) * 100;
  console.log(
    `${name.padEnd(16)} dense=${String(dense).padStart(4)} rest=${String(rest).padStart(4)} ` +
      `actual=${String(a).padStart(4)} est=${String(est).padStart(4)} err=${err.toFixed(0)}%`,
  );
}

// Least squares for tokens ~= a*dense + b*rest (no intercept: empty text = 0).
let hh = 0, hr = 0, rr = 0, ht = 0, rt = 0;
for (const r of rows) {
  hh += r.dense * r.dense;
  hr += r.dense * r.rest;
  rr += r.rest * r.rest;
  ht += r.dense * r.actual;
  rt += r.rest * r.actual;
}
const det = hh * rr - hr * hr;
const a = (ht * rr - rt * hr) / det;
const b = (rt * hh - ht * hr) / det;

const sumEst = rows.reduce((s, r) => s + r.est, 0);
const sumAct = rows.reduce((s, r) => s + r.actual, 0);

console.log(`\nmodel: ${MODEL}`);
console.log(`current estimator aggregate error: ${(((sumEst - sumAct) / sumAct) * 100).toFixed(1)}%`);
console.log(`least-squares fit: tokens ~= ${a.toFixed(3)}*dense + ${b.toFixed(3)}*rest`);
console.log(`  => DENSE_CHARS_PER_TOKEN ~= ${(1 / a).toFixed(2)}, REST_CHARS_PER_TOKEN ~= ${(1 / b).toFixed(2)}`);
console.log(
  '\nIf the aggregate error is no longer near zero (or has gone NEGATIVE, which is\n' +
    'the unsafe direction), update BOTH src/domain/tokenEstimate.ts and\n' +
    'frontend/src/api/llm.ts, refresh the fixtures in test/tokenEstimate.test.ts,\n' +
    'and restate the numbers in TRD §6.4.',
);
