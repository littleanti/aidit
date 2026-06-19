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

// XC-8 — hot decay refresh (read-time recompute).
//
// The stored Post.hotScore is written on create/upvote/comment, but its ageDecay
// term goes stale between writes. Rather than run a background sweep, the hot feed
// recomputes the *effective* hotScore for the rows it returns, using the current
// `now`. Keyset pagination is unaffected: the cursor anchor and DB ORDER BY still
// use the stored hotScore (monotonic per write), and we only re-sort the in-page
// rows by their freshly-computed value so the visible ordering reflects real age.
export function effectiveHotScore(
  p: { score: number; commentCount: number; createdAt: Date },
  now: Date = new Date(),
): number {
  return hotScore(p.score, p.commentCount, p.createdAt, now);
}
