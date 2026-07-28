import { defineConfig } from "vitest/config";

// WP XC-T (backend) — test runner config.
//
// Tests run against a FRESH SQLite file DB provisioned by test/setup-global.ts
// (prisma db push). No real network and no LLM calls: every route is exercised
// through Fastify's `app.inject` (and the SSE transport is driven via a fake
// socket). Single-fork / no concurrency so the in-memory rate-limit + pubsub
// singletons and the shared DB file behave deterministically.
//
// FOOTGUN (observed 2026-07-28): the test DB path is FIXED (prisma/test.db), so
// two SIMULTANEOUS `npm test` invocations in this package stomp on each other's
// database and produce spurious failures (15 phantom failures in one such run).
// Run the suite serially — deploy/pipeline.sh does exactly that; don't launch a
// second run alongside it.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/setup-global.ts"],
    // Workers run in separate processes; env mutations in globalSetup do NOT
    // propagate to them. Pin the test DB + NODE_ENV here so every worker's
    // src/db.ts singleton connects to the same fresh test database. Auth is now
    // a runtime dual-mode (register/session/guest always active), so there is no
    // mode flag to pin — the contract suite exercises every endpoint directly.
    env: {
      DATABASE_URL: "file:./test.db",
      NODE_ENV: "test",
    },
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
