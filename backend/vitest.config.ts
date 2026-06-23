import { defineConfig } from "vitest/config";

// WP XC-T (backend) — test runner config.
//
// Tests run against a FRESH SQLite file DB provisioned by test/setup-global.ts
// (prisma db push). No real network and no LLM calls: every route is exercised
// through Fastify's `app.inject` (and the SSE transport is driven via a fake
// socket). Single-fork / no concurrency so the in-memory rate-limit + pubsub
// singletons and the shared DB file behave deterministically.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/setup-global.ts"],
    // Workers run in separate processes; env mutations in globalSetup do NOT
    // propagate to them. Pin the test DB + NODE_ENV here so every worker's
    // src/db.ts singleton connects to the same fresh test database.
    env: {
      DATABASE_URL: "file:./test.db",
      NODE_ENV: "test",
      // Pin ON (signup) mode for `npm test`; OFF/guest mode runs via
      // vitest.guest.config.ts (`npm run test:guest`). This keeps both-mode
      // coverage independent of the production default (which is now OFF/guest).
      AUTH_SIGNUP_REQUIRED: "true",
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
