import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../db.js";

// WP BE-13 — Metrics + VisitEvent.
//
// Server stays KEY-BLIND (PLAN L1): no apiKey is ever read, stored, or relayed.
// Two endpoints:
//   POST /metrics/visit — idempotent daily visit record (author D1-retention basis).
//   GET  /metrics       — §8 KPIs derivable from the DB.
//
// KPIs that require client-only events (e.g. Gemini API success rate, P95 SSE
// propagation latency) are NOT observable server-side in a key-blind PoC, so we
// return them as `null` with a note in `unavailable`.

// Acting user is carried in the x-user-id header (L11: persisted User.id).
function actingUserId(req: FastifyRequest): string | null {
  const header = req.headers["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  return userId ?? null;
}

// "YYYY-MM-DD" for the given instant in UTC (stable, server-tz independent).
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The calendar day after the given "YYYY-MM-DD" string, again in UTC.
function nextIsoDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

const plugin: FastifyPluginAsync = async (app) => {
  // POST /metrics/visit — record that the acting user visited today. Idempotent:
  // upsert on @@unique([userId, date]) so repeat calls in a day are no-ops.
  app.post("/metrics/visit", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = actingUserId(req);
    if (!userId) {
      return reply.code(401).send({ error: "Missing x-user-id" });
    }

    // Guard against unknown ids (FK would otherwise throw).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return reply.code(401).send({ error: "Unknown user" });
    }

    const date = isoDate(new Date());
    await prisma.visitEvent.upsert({
      where: { userId_date: { userId, date } },
      update: {},
      create: { userId, date },
    });

    return reply.code(200).send({ userId, date });
  });

  // GET /metrics — compute §8 KPIs from the database.
  app.get("/metrics", async (_req, reply) => {
    // --- avgAtAiRepliesPerPost: AI_REPLY comments per post, averaged over posts.
    const postCount = await prisma.post.count();
    const aiReplyCount = await prisma.comment.count({
      where: { type: "AI_REPLY" },
    });
    const avgAtAiRepliesPerPost = postCount === 0 ? 0 : aiReplyCount / postCount;

    // --- avgUniqueCommentersPerThread: distinct HUMAN authorId per post, averaged.
    // Group human comments by (postId, authorId); each group is one unique
    // commenter on one thread. Count groups per post, then average over all posts.
    const humanGroups = await prisma.comment.groupBy({
      by: ["postId", "authorId"],
      where: { type: "HUMAN", authorId: { not: null } },
    });
    const uniqueCommentersByPost = new Map<string, number>();
    for (const g of humanGroups) {
      uniqueCommentersByPost.set(
        g.postId,
        (uniqueCommentersByPost.get(g.postId) ?? 0) + 1,
      );
    }
    let uniqueCommentersSum = 0;
    for (const n of uniqueCommentersByPost.values()) uniqueCommentersSum += n;
    const avgUniqueCommentersPerThread =
      postCount === 0 ? 0 : uniqueCommentersSum / postCount;

    // --- summarySuccessRate: COMPLETE AI_SUMMARY / total AI_SUMMARY.
    const summaryTotal = await prisma.comment.count({
      where: { type: "AI_SUMMARY" },
    });
    const summaryComplete = await prisma.comment.count({
      where: { type: "AI_SUMMARY", status: "COMPLETE" },
    });
    const summarySuccessRate =
      summaryTotal === 0 ? null : summaryComplete / summaryTotal;

    // --- authorD1RetentionRate: of users whose first Post exists, the fraction
    // that have a VisitEvent dated the day after their first post's date.
    // Find each author's earliest post.
    const firstPosts = await prisma.post.groupBy({
      by: ["authorId"],
      _min: { createdAt: true },
    });

    let retentionDenominator = 0;
    let retentionNumerator = 0;
    for (const fp of firstPosts) {
      const firstCreatedAt = fp._min.createdAt;
      if (!firstCreatedAt) continue;
      retentionDenominator += 1;
      const d1 = nextIsoDate(isoDate(firstCreatedAt));
      const visit = await prisma.visitEvent.findUnique({
        where: { userId_date: { userId: fp.authorId, date: d1 } },
        select: { id: true },
      });
      if (visit) retentionNumerator += 1;
    }
    const authorD1RetentionRate =
      retentionDenominator === 0
        ? null
        : retentionNumerator / retentionDenominator;

    return reply.send({
      postCount,
      // §8 KPI targets are documented in CLAUDE.md; here we expose raw measured values.
      avgAtAiRepliesPerPost, // target >= 2
      avgUniqueCommentersPerThread, // target >= 3
      summarySuccessRate, // target >= 0.95 (null when no summaries yet)
      authorD1RetentionRate, // target >= 0.25 (null when no authored posts yet)
      // KPIs that depend on client-only events the key-blind server never sees.
      geminiSuccessRate: null, // target >= 0.97 — measured in the browser (BYOK).
      p95PropagationMs: null, // target < 1500 — measured client-side end-to-end.
      unavailable: {
        geminiSuccessRate:
          "Gemini calls happen browser-side (BYOK, key-blind server); success/failure is not observable here.",
        p95PropagationMs:
          "SSE propagation latency is an end-to-end client measurement; not recorded server-side.",
      },
    });
  });
};

export default plugin;
