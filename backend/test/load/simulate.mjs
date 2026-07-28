#!/usr/bin/env node
// Load simulation harness — measures the two claims that matter for a
// multi-user AI thread, against the REAL app (no mocks, no fakes):
//
//   A. SSE fan-out latency: with N concurrent subscribers on one thread, how
//      long after a comment is accepted does each subscriber see the frame?
//      Reported as P50/P95/P99 over N x M observations.
//
//   B. Summary-race convergence: when K callers hit the 128K threshold at the
//      same instant, does EXACTLY ONE win (201) while the rest get 409 and
//      converge without retrying? (BE-7 idempotency guard.)
//
// HONEST SCOPE — this is a SIMULATION, not a production load test:
//   * the app runs IN-PROCESS on this machine over loopback,
//   * the DB is a throwaway SQLite file,
//   * no LLM is called (BYOK happens in the browser; the server is key-blind),
//   * client and server share one CPU, so absolute numbers are optimistic on
//     network latency and pessimistic on CPU contention.
//   Treat the numbers as a floor for the server's own fan-out cost, not as a
//   capacity projection.
//
// Usage:
//   node test/load/simulate.mjs                # defaults: 20 subscribers, 10 comments
//   SUBSCRIBERS=50 COMMENTS=20 node test/load/simulate.mjs
//   node test/load/simulate.mjs --markdown     # emit a markdown table for the README

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..", "..");

const SUBSCRIBERS = Number(process.env.SUBSCRIBERS ?? 20);
const COMMENTS = Number(process.env.COMMENTS ?? 10);
const RACERS = Number(process.env.RACERS ?? 8);
const EMIT_MARKDOWN = process.argv.includes("--markdown");

// --- isolated DB -----------------------------------------------------------
const DB_FILE = resolve(serverRoot, "prisma", "load.db");
function removeDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = `${DB_FILE}${suffix}`;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}
removeDb();
process.env.DATABASE_URL = "file:./load.db";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "load-sim-secret";
execSync("npx prisma db push --skip-generate", {
  cwd: serverRoot,
  stdio: "ignore",
  env: { ...process.env },
});

const { build } = await import("../../src/app.ts");
const { prisma } = await import("../../src/db.ts");

const app = await build();
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const base = `http://127.0.0.1:${address.port}`;

// --- helpers ---------------------------------------------------------------

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (shouldn't happen on these routes) */
  }
  return { status: res.status, json, text };
}

async function makeGuest(nickname) {
  const res = await api("/auth/guest", {
    method: "POST",
    body: { username: nickname },
  });
  if (res.status !== 201) {
    throw new Error(`guest login failed: ${res.status} ${res.text}`);
  }
  return res.json;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : "n/a");

/**
 * Attach one raw SSE subscriber. Records the arrival time of every
 * comment.created frame keyed by the comment's clientId, so the driver can
 * subtract the publish instant per comment.
 */
async function attachSubscriber(postId, arrivals) {
  const res = await fetch(`${base}/posts/${postId}/stream`, {
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`stream attach failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const at = performance.now();
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine.slice(6));
            const clientId = payload?.comment?.clientId;
            if (clientId) {
              const list = arrivals.get(clientId) ?? [];
              list.push(at);
              arrivals.set(clientId, list);
            }
          } catch {
            /* heartbeat / non-JSON frame */
          }
        }
      }
    } catch {
      /* stream closed at teardown */
    }
  })();

  return () => reader.cancel().catch(() => {});
}

// --- Scenario A: SSE fan-out latency --------------------------------------

async function scenarioFanout() {
  const author = await makeGuest("author");
  const community = await prisma.community.create({
    data: {
      slug: `load-${Date.now().toString(36)}`,
      name: "Load Sim",
      personaPrompt: "load simulation persona",
      creatorId: author.id,
    },
    select: { id: true },
  });
  const created = await api("/posts", {
    method: "POST",
    token: author.token,
    body: { communityId: community.id, title: "load", body: "load body" },
  });
  if (created.status !== 201) {
    throw new Error(`post create failed: ${created.status} ${created.text}`);
  }
  const postId = created.json.id;

  // Attach N subscribers and let their snapshot replay finish.
  const arrivals = new Map();
  const detachers = [];
  for (let i = 0; i < SUBSCRIBERS; i += 1) {
    detachers.push(await attachSubscriber(postId, arrivals));
  }
  await new Promise((r) => setTimeout(r, 300));

  // Post M comments sequentially, recording each publish instant.
  const publishedAt = new Map();
  const commenter = await makeGuest("poster");
  for (let i = 0; i < COMMENTS; i += 1) {
    const clientId = `load-${i}`;
    const t0 = performance.now();
    const res = await api(`/posts/${postId}/comments`, {
      method: "POST",
      token: commenter.token,
      body: { type: "HUMAN", body: `comment ${i}`, status: "COMPLETE", clientId },
    });
    if (res.status !== 201) {
      throw new Error(`comment failed: ${res.status} ${res.text}`);
    }
    publishedAt.set(clientId, t0);
    await new Promise((r) => setTimeout(r, 20));
  }

  // Wait until every subscriber has seen every comment (bounded).
  const expected = SUBSCRIBERS * COMMENTS;
  const deadline = Date.now() + 15_000;
  const seen = () =>
    [...publishedAt.keys()].reduce(
      (acc, id) => acc + (arrivals.get(id)?.length ?? 0),
      0,
    );
  while (seen() < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }

  const samples = [];
  for (const [clientId, t0] of publishedAt) {
    for (const at of arrivals.get(clientId) ?? []) samples.push(at - t0);
  }
  const delivered = seen();

  for (const detach of detachers) detach();

  return {
    subscribers: SUBSCRIBERS,
    comments: COMMENTS,
    expected,
    delivered,
    lossPct: ((expected - delivered) / expected) * 100,
    latency: stats(samples),
  };
}

// --- Scenario B: summary-race convergence ---------------------------------

async function scenarioSummaryRace() {
  const author = await makeGuest("racer0");
  const community = await prisma.community.create({
    data: {
      slug: `race-${Date.now().toString(36)}`,
      name: "Race Sim",
      personaPrompt: "race simulation persona",
      creatorId: author.id,
    },
    select: { id: true },
  });
  const created = await api("/posts", {
    method: "POST",
    token: author.token,
    body: { communityId: community.id, title: "race", body: "race body" },
  });
  const postId = created.json.id;

  // K callers all believe segment 0 is active and try to open segment 1 at once.
  const racers = [];
  for (let i = 0; i < RACERS; i += 1) {
    racers.push(await makeGuest(`racer${i + 1}`));
  }

  const t0 = performance.now();
  const results = await Promise.all(
    racers.map((r, i) =>
      api(`/posts/${postId}/comments`, {
        method: "POST",
        token: r.token,
        body: {
          type: "AI_SUMMARY",
          body: `summary from racer ${i}`,
          status: "COMPLETE",
          clientId: `race-${i}`,
          segmentExpected: 0,
          tokenCount: 100,
        },
      }),
    ),
  );
  const elapsed = performance.now() - t0;

  const winners = results.filter((r) => r.status === 201).length;
  const losers = results.filter((r) => r.status === 409).length;
  const other = results.filter((r) => r.status !== 201 && r.status !== 409);

  const segments = await prisma.contextSegment.count({ where: { postId } });
  const activeSegments = await prisma.contextSegment.count({
    where: { postId, isActive: true },
  });
  const summaries = await prisma.comment.count({
    where: { postId, type: "AI_SUMMARY" },
  });

  return {
    racers: RACERS,
    winners,
    losers,
    otherStatuses: other.map((r) => r.status),
    segments,
    activeSegments,
    summaries,
    elapsedMs: elapsed,
    // Convergence = exactly one winner, everyone else a clean 409, and the DB
    // left with exactly one extra segment and exactly one active segment.
    converged:
      winners === 1 &&
      losers === RACERS - 1 &&
      other.length === 0 &&
      segments === 2 &&
      activeSegments === 1 &&
      summaries === 1,
  };
}

// --- run -------------------------------------------------------------------

const fanout = await scenarioFanout();
const race = await scenarioSummaryRace();

await app.close();
await prisma.$disconnect();
removeDb();

if (EMIT_MARKDOWN) {
  console.log(`
| 지표 | 값 |
|---|---|
| 동시 SSE 구독자 | ${fanout.subscribers} |
| 게시한 댓글 | ${fanout.comments} |
| 전달 관측치 | ${fanout.delivered} / ${fanout.expected} (유실 ${fmt(fanout.lossPct)}%) |
| fan-out 지연 P50 | ${fmt(fanout.latency.p50)} ms |
| fan-out 지연 P95 | ${fmt(fanout.latency.p95)} ms |
| fan-out 지연 P99 | ${fmt(fanout.latency.p99)} ms |
| fan-out 지연 최대 | ${fmt(fanout.latency.max)} ms |
| 동시 요약 경쟁자 | ${race.racers} |
| 승자 / 409 패자 | ${race.winners} / ${race.losers} |
| 열린 세그먼트 · 활성 | ${race.segments} · ${race.activeSegments} |
| 요약 버블 수 | ${race.summaries} |
| 수렴 판정 | ${race.converged ? "PASS" : "FAIL"} |
`);
} else {
  console.log("\n=== A. SSE fan-out latency ===");
  console.log(
    `subscribers=${fanout.subscribers} comments=${fanout.comments} ` +
      `delivered=${fanout.delivered}/${fanout.expected} loss=${fmt(fanout.lossPct)}%`,
  );
  console.log(
    `min=${fmt(fanout.latency.min)}ms mean=${fmt(fanout.latency.mean)}ms ` +
      `P50=${fmt(fanout.latency.p50)}ms P95=${fmt(fanout.latency.p95)}ms ` +
      `P99=${fmt(fanout.latency.p99)}ms max=${fmt(fanout.latency.max)}ms`,
  );

  console.log("\n=== B. Summary-race convergence ===");
  console.log(
    `racers=${race.racers} winners=${race.winners} losers409=${race.losers} ` +
      `otherStatuses=[${race.otherStatuses.join(",")}]`,
  );
  console.log(
    `segments=${race.segments} active=${race.activeSegments} ` +
      `summaryBubbles=${race.summaries} elapsed=${fmt(race.elapsedMs)}ms ` +
      `converged=${race.converged ? "PASS" : "FAIL"}`,
  );
  console.log(
    `\nnode=${process.version} platform=${process.platform} cpus=${
      (await import("node:os")).cpus().length
    }`,
  );
}

process.exit(fanout.delivered === fanout.expected && race.converged ? 0 : 1);
