import { defineConfig } from "vitest/config";

// WP XC-T (backend) — GUEST-mode test runner config.
//
// Identical to vitest.config.ts but forces AUTH_SIGNUP_REQUIRED=false so the
// same suite runs against the passwordless guest-entry mode. Worker forks only
// receive env from this `env:` block (setup-global.ts process.env mutations do
// NOT propagate), so the mode flag must live here for config.ts to read it.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/setup-global.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      NODE_ENV: "test",
      AUTH_SIGNUP_REQUIRED: "false",
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
