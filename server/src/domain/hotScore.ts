// BE-9a — Hot score (TRD §9).
//
//   hotScore = log10(max(score, 1)) + (commentCount * 0.5) + ageDecay
//   ageDecay = -(hoursSince(createdAt)) / 12
//
// Pure function: no I/O, no Date.now() except the explicit `now` parameter so it
// stays deterministic/testable (M5).

export function hotScore(
  score: number,
  commentCount: number,
  createdAt: Date,
  now: Date = new Date(),
): number {
  const hoursSince = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const ageDecay = -hoursSince / 12;
  return Math.log10(Math.max(score, 1)) + commentCount * 0.5 + ageDecay;
}
