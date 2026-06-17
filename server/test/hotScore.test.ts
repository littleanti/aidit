// WP XC-T — UNIT: hotScore (TRD §9).
//
//   hotScore = log10(max(score,1)) + commentCount*0.5 + ageDecay
//   ageDecay = -(hoursSince(createdAt)) / 12
//
// Pure function, deterministic with an explicit `now`. We assert the exact
// formula plus the monotonicity/ordering properties the hot feed relies on.

import { describe, it, expect } from "vitest";

import { hotScore, effectiveHotScore } from "../src/domain/hotScore.js";

const T0 = new Date("2026-06-17T00:00:00.000Z");

describe("hotScore (TRD §9)", () => {
  it("matches the exact formula at age 0", () => {
    // score=1 -> log10(1)=0; commentCount=0; ageDecay=0
    expect(hotScore(1, 0, T0, T0)).toBeCloseTo(0, 10);
    // score=10 -> log10(10)=1; +2 comments*0.5=1 -> 2
    expect(hotScore(10, 2, T0, T0)).toBeCloseTo(2, 10);
  });

  it("floors score at 1 (log10(max(score,1)))", () => {
    expect(hotScore(0, 0, T0, T0)).toBeCloseTo(0, 10);
    expect(hotScore(-5, 0, T0, T0)).toBeCloseTo(0, 10);
  });

  it("applies ageDecay = -hoursSince/12", () => {
    const twelveHoursLater = new Date(T0.getTime() + 12 * 3600 * 1000);
    // log10(1)=0, no comments, 12h => ageDecay = -1
    expect(hotScore(1, 0, T0, twelveHoursLater)).toBeCloseTo(-1, 10);
  });

  it("is strictly increasing in score (fixed comments/age)", () => {
    const a = hotScore(1, 0, T0, T0);
    const b = hotScore(10, 0, T0, T0);
    const c = hotScore(100, 0, T0, T0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("is strictly increasing in commentCount (fixed score/age)", () => {
    expect(hotScore(5, 1, T0, T0)).toBeGreaterThan(hotScore(5, 0, T0, T0));
    expect(hotScore(5, 2, T0, T0)).toBeGreaterThan(hotScore(5, 1, T0, T0));
  });

  it("decays monotonically as time passes (fixed score/comments)", () => {
    const h1 = new Date(T0.getTime() + 1 * 3600 * 1000);
    const h6 = new Date(T0.getTime() + 6 * 3600 * 1000);
    const h24 = new Date(T0.getTime() + 24 * 3600 * 1000);
    const s0 = hotScore(50, 3, T0, T0);
    const s1 = hotScore(50, 3, T0, h1);
    const s6 = hotScore(50, 3, T0, h6);
    const s24 = hotScore(50, 3, T0, h24);
    expect(s1).toBeLessThan(s0);
    expect(s6).toBeLessThan(s1);
    expect(s24).toBeLessThan(s6);
  });

  it("orders fresher posts above identically-scored older ones", () => {
    const now = new Date(T0.getTime() + 48 * 3600 * 1000);
    const older = { score: 10, commentCount: 4, createdAt: T0 };
    const newer = {
      score: 10,
      commentCount: 4,
      createdAt: new Date(T0.getTime() + 24 * 3600 * 1000),
    };
    expect(effectiveHotScore(newer, now)).toBeGreaterThan(
      effectiveHotScore(older, now),
    );
  });

  it("effectiveHotScore equals hotScore for the same inputs", () => {
    const now = new Date(T0.getTime() + 5 * 3600 * 1000);
    const p = { score: 7, commentCount: 2, createdAt: T0 };
    expect(effectiveHotScore(p, now)).toBeCloseTo(
      hotScore(p.score, p.commentCount, p.createdAt, now),
      10,
    );
  });
});
