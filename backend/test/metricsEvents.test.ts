// TRD §16 — the browser-only event sink.
//
// The sink exists because the key-blind server cannot observe the LLM call at all
// (it happens in the browser with the user's key), so `llmSuccessRate` was a
// documented `null`. These tests pin the three properties that make the sink safe
// to expose unauthenticated:
//   1) only allow-listed event NAMES are counted,
//   2) `props` are never persisted (the endpoint is a counter, not a log),
//   3) counting is additive per (name, date) so several instances share one row.
// Plus the payoff: GET /metrics derives llmSuccessRate from those counters.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { makeApp, prisma, resetDb } from "./helpers.js";

let app: FastifyInstance;

const send = (body: unknown) =>
  app.inject({ method: "POST", url: "/metrics/events", payload: body as object });

const today = () => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  if (!app) app = await makeApp();
  await resetDb();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe("POST /metrics/events — allow-listed counters (TRD §16)", () => {
  it("counts an allow-listed event and reports that it counted", async () => {
    const res = await send({ event: "llm_success", props: { ms: 120 } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ counted: true });

    const row = await prisma.eventCounter.findUnique({
      where: { name_date: { name: "llm_success", date: today() } },
    });
    expect(row?.count).toBe(1);
  });

  it("increments the SAME row instead of appending (multi-instance safe)", async () => {
    await send({ event: "llm_success" });
    await send({ event: "llm_success" });
    await send({ event: "llm_success" });

    const rows = await prisma.eventCounter.findMany({
      where: { name: "llm_success" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
  });

  it("does NOT count an unknown event, and says so without a 4xx", async () => {
    // A 400 here would make telemetry noisy in the client and would break the
    // moment the frontend ships an event ahead of the server.
    const res = await send({ event: "definitely_not_an_event" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ counted: false });
    expect(await prisma.eventCounter.count()).toBe(0);
  });

  it("tolerates a missing/malformed body without counting anything", async () => {
    for (const body of [{}, { event: 42 }, { event: "" }, { nope: true }]) {
      const res = await send(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(202);
      expect(res.json()).toEqual({ counted: false });
    }
    expect(await prisma.eventCounter.count()).toBe(0);
  });

  it("never persists props — nothing but (name, date, count) is stored", async () => {
    // The scenario this guards: a client bug puts an API key into props. If the
    // sink stored or echoed props, that key would land in server state/logs and
    // key-blindness (L1) would be broken by telemetry of all things.
    const secret = "AIza-DO-NOT-PERSIST-THIS";
    const res = await send({
      event: "llm_failure",
      props: { apiKey: secret, nested: { alsoKey: secret } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).not.toContain(secret);

    const rows = await prisma.eventCounter.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
    // The stored row carries no free-form column at all.
    expect(Object.keys(rows[0]).sort()).toEqual(["count", "date", "id", "name"]);
  });

  it("requires no authentication (pre-login events must still be countable)", async () => {
    // 'login' fires before a token exists; demanding auth would erase exactly the
    // window we most want to observe.
    const res = await send({ event: "login" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ counted: true });
  });
});

describe("GET /metrics — llmSuccessRate from the counters (TRD §16.3)", () => {
  it("is null with no reported attempts, not 0", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // "no data" and "everything failed" must not look the same.
    expect(body.llmSuccessRate).toBeNull();
    expect(body.eventCounts).toEqual({});
  });

  it("derives the rate from success/failure counts", async () => {
    for (let i = 0; i < 9; i += 1) await send({ event: "llm_success" });
    await send({ event: "llm_failure" });

    const body = (await app.inject({ method: "GET", url: "/metrics" })).json();
    expect(body.llmSuccessRate).toBeCloseTo(0.9, 6);
    expect(body.eventCounts.llm_success).toBe(9);
    expect(body.eventCounts.llm_failure).toBe(1);
  });

  it("no longer lists llmSuccessRate as unavailable, but still lists p95", async () => {
    const body = (await app.inject({ method: "GET", url: "/metrics" })).json();
    expect(body.unavailable.llmSuccessRate).toBeUndefined();
    // Honest remaining gap: a counter cannot express a latency distribution.
    expect(body.unavailable.p95PropagationMs).toBeTruthy();
    expect(body.p95PropagationMs).toBeNull();
  });
});
