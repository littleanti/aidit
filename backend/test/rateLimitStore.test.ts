// §15.3 — rate-limit store: the two backends must behave the SAME, and the Redis
// one must share its counters across instances.
//
// The architectural claim under test: "scaling out does not multiply the limit".
// The in-memory contrast test is as important as the Redis one — it documents the
// exact bug the adapter exists to fix (2 instances => 2x the effective limit).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitStore,
  type RateLimitStore,
} from "../src/store/rateLimitStore.js";
import { RedisCommandClient } from "../src/redis/client.js";
import { startFakeRedis, type FakeRedis } from "./fakeRedis.js";

const WINDOW = 60_000;

/** Exhaust `max` allowed hits, asserting each one is allowed. */
async function fill(store: RateLimitStore, key: string, max: number) {
  for (let i = 0; i < max; i += 1) {
    const d = await store.hit(key, WINDOW, max);
    expect(d.allowed, `hit ${i + 1}/${max}`).toBe(true);
  }
}

describe("InMemoryRateLimitStore", () => {
  it("allows up to max then denies with a Retry-After", async () => {
    const store = new InMemoryRateLimitStore();
    await fill(store, "u:1", 3);

    const denied = await store.hit("u:1", WINDOW, 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(WINDOW);
    store.close();
  });

  it("keys are independent", async () => {
    const store = new InMemoryRateLimitStore();
    await fill(store, "u:1", 2);
    expect((await store.hit("u:1", WINDOW, 2)).allowed).toBe(false);
    // A different identity is unaffected.
    expect((await store.hit("u:2", WINDOW, 2)).allowed).toBe(true);
    store.close();
  });

  it("a denied attempt does not push the window forward", async () => {
    const store = new InMemoryRateLimitStore();
    await fill(store, "u:1", 1);
    const first = await store.hit("u:1", WINDOW, 1);
    await new Promise((r) => setTimeout(r, 30));
    const second = await store.hit("u:1", WINDOW, 1);
    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    // Retry-After must shrink as time passes, not reset on every rejection.
    expect(second.retryAfterMs).toBeLessThan(first.retryAfterMs);
    store.close();
  });

  it("concurrent hits never over-permit", async () => {
    const store = new InMemoryRateLimitStore();
    const results = await Promise.all([
      store.hit("burst", WINDOW, 2),
      store.hit("burst", WINDOW, 2),
      store.hit("burst", WINDOW, 2),
    ]);
    expect(results.filter((r) => r.allowed).length).toBe(2);
    store.close();
  });

  it("hits leave the window once it elapses", async () => {
    const store = new InMemoryRateLimitStore();
    const tinyWindow = 60;
    expect((await store.hit("u:1", tinyWindow, 1)).allowed).toBe(true);
    expect((await store.hit("u:1", tinyWindow, 1)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, tinyWindow + 20));
    expect((await store.hit("u:1", tinyWindow, 1)).allowed).toBe(true);
    store.close();
  });

  it("does NOT share counters across instances (why the adapter exists)", async () => {
    const instanceA = new InMemoryRateLimitStore();
    const instanceB = new InMemoryRateLimitStore();

    await fill(instanceA, "u:1", 2);
    expect((await instanceA.hit("u:1", WINDOW, 2)).allowed).toBe(false);

    // Same identity, other instance: the limit is effectively doubled.
    expect((await instanceB.hit("u:1", WINDOW, 2)).allowed).toBe(true);

    instanceA.close();
    instanceB.close();
  });
});

describe("RedisRateLimitStore — shared across instances", () => {
  let redis: FakeRedis;
  const clients: RedisCommandClient[] = [];
  const stores: RateLimitStore[] = [];

  beforeEach(async () => {
    redis = await startFakeRedis();
  });

  afterEach(async () => {
    for (const s of stores.splice(0)) s.close();
    clients.splice(0);
    await redis.close();
  });

  function attach(): RateLimitStore {
    const client = new RedisCommandClient({ host: "127.0.0.1", port: redis.port });
    clients.push(client);
    const store = new RedisRateLimitStore(client);
    stores.push(store);
    return store;
  }

  it("allows up to max then denies with a Retry-After", async () => {
    const store = attach();
    await fill(store, "u:1", 3);

    const denied = await store.hit("u:1", WINDOW, 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(WINDOW);
  });

  it("TWO instances share one budget (the fix)", async () => {
    const instanceA = attach();
    const instanceB = attach();

    // 2 hits on A + 1 on B exhausts a budget of 3 …
    expect((await instanceA.hit("u:1", WINDOW, 3)).allowed).toBe(true);
    expect((await instanceA.hit("u:1", WINDOW, 3)).allowed).toBe(true);
    expect((await instanceB.hit("u:1", WINDOW, 3)).allowed).toBe(true);

    // … so the 4th is denied NO MATTER which instance it lands on.
    expect((await instanceB.hit("u:1", WINDOW, 3)).allowed).toBe(false);
    expect((await instanceA.hit("u:1", WINDOW, 3)).allowed).toBe(false);
  });

  it("keys are independent across instances", async () => {
    const instanceA = attach();
    const instanceB = attach();
    await fill(instanceA, "u:1", 1);
    expect((await instanceB.hit("u:1", WINDOW, 1)).allowed).toBe(false);
    expect((await instanceB.hit("u:2", WINDOW, 1)).allowed).toBe(true);
  });

  it("concurrent hits never over-permit (why INCR, not read-then-add)", async () => {
    const store = attach();
    // REGRESSION: the first implementation counted a sorted set BEFORE adding the
    // hit, so three simultaneous requests all read count=0 and ALL passed a limit
    // of two. INCR is atomic, so each concurrent request gets a distinct count.
    const results = await Promise.all([
      store.hit("burst", WINDOW, 2),
      store.hit("burst", WINDOW, 2),
      store.hit("burst", WINDOW, 2),
    ]);
    expect(results.filter((r) => r.allowed).length).toBe(2);
    expect((await store.hit("burst", WINDOW, 2)).allowed).toBe(false);
  });

  it("the window expires, so the budget recovers", async () => {
    const store = attach();
    const tinyWindow = 60;
    expect((await store.hit("u:1", tinyWindow, 1)).allowed).toBe(true);
    expect((await store.hit("u:1", tinyWindow, 1)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, tinyWindow + 20));
    expect((await store.hit("u:1", tinyWindow, 1)).allowed).toBe(true);
  });

  it("costs one INCR per hit, and sets the TTL only on the first", async () => {
    const store = attach();
    await store.hit("u:1", WINDOW, 3);
    await store.hit("u:1", WINDOW, 3);

    const sent = redis.commandLog().map((c) => c[0]?.toUpperCase());
    // First hit opens the window (INCR + PEXPIRE); the second is INCR only —
    // re-arming the TTL on every hit would keep pushing the reset out so a
    // continuously-sending client would never get a fresh window.
    expect(sent).toEqual(["INCR", "PEXPIRE", "INCR"]);
  });

  it("re-arms a lost TTL instead of locking the identity out forever", async () => {
    const store = attach();
    // Simulate a key that exists with no TTL (a lost PEXPIRE): PTTL returns -1.
    const raw = new RedisCommandClient({ host: "127.0.0.1", port: redis.port });
    clients.push(raw);
    await raw.command("INCR", "aidit:rl:orphan");
    await raw.command("INCR", "aidit:rl:orphan");

    const denied = await store.hit("orphan", WINDOW, 1);
    expect(denied.allowed).toBe(false);
    // Falls back to the full window rather than reporting a negative TTL …
    expect(denied.retryAfterMs).toBe(WINDOW);
    // … and the key now HAS a TTL, so the next window can open.
    const ttl = await raw.command("PTTL", "aidit:rl:orphan");
    expect(typeof ttl).toBe("number");
    expect(ttl as number).toBeGreaterThan(0);
    raw.close();
  });

  it("FAILS OPEN when Redis is unreachable", async () => {
    // Point a client at a port nothing is listening on: commands time out.
    const client = new RedisCommandClient({ host: "127.0.0.1", port: 1 });
    const store = new RedisRateLimitStore(client);
    stores.push(store);

    const decision = await store.hit("u:1", WINDOW, 1);
    // A Redis outage must not turn every write into a 429.
    expect(decision.allowed).toBe(true);
  });
});

describe("createRateLimitStore", () => {
  it("falls back to in-memory without / with an invalid REDIS_URL", () => {
    const noop = () => {};
    expect(createRateLimitStore(null, noop)).toBeInstanceOf(InMemoryRateLimitStore);
    expect(createRateLimitStore("postgres://nope", noop)).toBeInstanceOf(
      InMemoryRateLimitStore,
    );
  });

  it("returns the Redis store for a valid redis:// URL", () => {
    const noop = () => {};
    const store = createRateLimitStore("redis://127.0.0.1:6399", noop);
    expect(store).toBeInstanceOf(RedisRateLimitStore);
    store.close();
  });
});
