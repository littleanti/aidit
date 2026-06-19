import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// WP XC-T (backend) — global setup.
//
// Provision a FRESH, isolated SQLite database for the whole test run, separate
// from the dev DB, and apply the Prisma schema with `db push`. The DATABASE_URL
// is set here BEFORE any test process imports src/db.ts so the singleton
// PrismaClient connects to the test file. Cleaned up on teardown.

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const TEST_DB_FILE = resolve(serverRoot, "prisma", "test.db");
const TEST_DB_URL = "file:./test.db"; // relative to prisma/schema.prisma

function removeDbFiles(): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const f = `${TEST_DB_FILE}${suffix}`;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.NODE_ENV = "test";

  removeDbFiles();

  // Apply the schema to the fresh file. We removed any prior test DB above, so a
  // plain `db push` just creates the tables from schema.prisma on an empty file
  // (no migration history needed for an ephemeral test DB). `--force-reset` is
  // intentionally NOT used: there is nothing to reset and it trips Prisma's
  // destructive-action guard.
  execSync("npx prisma db push --skip-generate", {
    cwd: serverRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
}

export async function teardown(): Promise<void> {
  removeDbFiles();
}
