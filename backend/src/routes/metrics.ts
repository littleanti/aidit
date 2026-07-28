import type { FastifyPluginAsync } from "fastify";

import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";

// WP BE-13 — Metrics + VisitEvent. Event sink per TRD §16.
//
// Server stays KEY-BLIND (PLAN L1): no apiKey is ever read, stored, or relayed.
// Three endpoints:
//   POST /metrics/visit  — idempotent daily visit record (author D1-retention basis).
//   POST /metrics/events — browser-only event sink (allow-listed names -> counters).
//   GET  /metrics        — §8 KPIs derivable from the DB.
//
// P95 SSE propagation latency still needs an end-to-end client measurement that a
// counter cannot express, so it stays `null` with a note in `unavailable`.
// llmSuccessRate used to be there too; the sink below closes it.

/**
 * Events this server counts. Mirrors the track() call sites in
 * frontend/src/lib/metrics.ts consumers — adding an event means editing BOTH
 * sides on purpose: what we count is a contract, not a side effect.
 */
const ALLOWED_EVENTS = new Set([
  "login",
  "register",
  "ai_reply_invoked",
  "llm_success",
  "llm_failure",
  "summary_success",
  "summary_failure",
  "document_invoked",
  "document_success",
  "document_failure",
  "document_context_missing",
]);

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
  app.post("/metrics/visit", async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;

    const date = isoDate(new Date());
    await prisma.visitEvent.upsert({
      where: { userId_date: { userId, date } },
      update: {},
      create: { userId, date },
    });

    return reply.code(200).send({ userId, date });
  });

  // POST /metrics/events — the browser-only event sink (TRD §16).
  //
  // Deliberately UNAUTHENTICATED: instrumentation fires before login too (a failed
  // 'login' event is exactly the interesting case), and requiring a token would
  // erase that window. Abuse is bounded by the rate limit policy instead.
  //
  // `props` IS NOT READ. Not stored, not logged, not echoed. This endpoint takes
  // arbitrary JSON from anyone, and anything we logged from it could carry a user's
  // API key into the server's logs on a single client-side mistake — the one thing
  // a key-blind server must never allow. So this is a COUNTER, not a log.
  app.post("/metrics/events", async (req, reply) => {
    const body = req.body as { event?: unknown } | undefined;
    const event = typeof body?.event === "string" ? body.event : "";

    // Unknown/malformed -> 202 and say so. A 4xx would turn telemetry into noise in
    // the client console and would break the moment the frontend adds an event
    // ahead of a server deploy. Silence would be worse: the caller could not tell
    // that nothing was counted.
    if (!ALLOWED_EVENTS.has(event)) {
      return reply.code(202).send({ counted: false });
    }

    const date = isoDate(new Date());
    // Atomic increment on (name, date): several instances share one counter row.
    await prisma.eventCounter.upsert({
      where: { name_date: { name: event, date } },
      update: { count: { increment: 1 } },
      create: { name: event, date, count: 1 },
    });

    return reply.code(202).send({ counted: true });
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

    // --- Browser-reported counters (TRD §16). All-time totals per event name.
    const counterRows = await prisma.eventCounter.groupBy({
      by: ["name"],
      _sum: { count: true },
    });
    const eventCounts: Record<string, number> = {};
    for (const r of counterRows) eventCounts[r.name] = r._sum.count ?? 0;

    const llmOk = eventCounts.llm_success ?? 0;
    const llmFail = eventCounts.llm_failure ?? 0;
    // Null (not 0) until at least one attempt is reported: a rate over zero
    // attempts is not "0% success", it is "unknown".
    const llmSuccessRate = llmOk + llmFail === 0 ? null : llmOk / (llmOk + llmFail);

    return reply.send({
      postCount,
      // §8 KPI targets are documented in CLAUDE.md; here we expose raw measured values.
      avgAtAiRepliesPerPost, // target >= 2
      avgUniqueCommentersPerThread, // target >= 3
      summarySuccessRate, // target >= 0.95 (null when no summaries yet)
      authorD1RetentionRate, // target >= 0.25 (null when no authored posts yet)
      llmSuccessRate, // target >= 0.97 — from browser-reported counters (§16)
      eventCounts, // raw allow-listed counters, for anything derived client-side
      p95PropagationMs: null, // target < 1500 — measured client-side end-to-end.
      unavailable: {
        p95PropagationMs:
          "SSE propagation latency is an end-to-end client measurement; a counter cannot express a distribution (TRD §16.3).",
      },
    });
  });
};

export default plugin;
