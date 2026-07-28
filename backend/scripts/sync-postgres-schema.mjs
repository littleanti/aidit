#!/usr/bin/env node
// TRD §15.1 — derive prisma/schema.postgres.prisma from prisma/schema.prisma.
//
// Prisma does NOT allow env() in `datasource.provider`, so a single schema file
// cannot serve both SQLite (dev/test) and Postgres (production). Instead we keep
// ONE editable source of truth (schema.prisma, provider = sqlite) and generate a
// derived Postgres copy whose ONLY difference is the datasource block.
//
// Usage:
//   node scripts/sync-postgres-schema.mjs           # write the derived schema
//   node scripts/sync-postgres-schema.mjs --check   # verify it is up to date
//
// --check exits 1 when the derived file is missing or stale, so CI (or a
// pre-deploy step) can fail before the two schemas silently drift apart.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const SOURCE = resolve(serverRoot, "prisma", "schema.prisma");
const DERIVED = resolve(serverRoot, "prisma", "schema.postgres.prisma");

const BANNER = `// ============================================================================
// GENERATED FILE — DO NOT EDIT.
//
// Derived from prisma/schema.prisma by scripts/sync-postgres-schema.mjs
// (npm run db:pg:sync). The ONLY difference is the datasource provider:
// sqlite (dev/test) -> postgresql (production). Edit the SOURCE schema and
// re-run the sync; \`npm run db:pg:check\` fails if this file is stale.
// ============================================================================
`;

/** Replace the datasource block's provider with postgresql. */
function toPostgres(source) {
  // Match the datasource block and swap only its provider line, so any future
  // datasource fields (relationMode, directUrl, ...) survive untouched.
  const datasourceRe = /datasource\s+\w+\s*\{[\s\S]*?\}/;
  const block = source.match(datasourceRe);
  if (!block) {
    throw new Error("no datasource block found in prisma/schema.prisma");
  }
  const patchedBlock = block[0].replace(
    /provider\s*=\s*"sqlite"/,
    'provider = "postgresql"',
  );
  if (patchedBlock === block[0]) {
    throw new Error(
      'datasource provider is not "sqlite" — the source schema changed shape; update this script deliberately.',
    );
  }
  return BANNER + source.replace(datasourceRe, patchedBlock);
}

function main() {
  const check = process.argv.includes("--check");
  const source = readFileSync(SOURCE, "utf8");
  const expected = toPostgres(source);

  if (check) {
    if (!existsSync(DERIVED)) {
      console.error(
        "[db:pg:check] prisma/schema.postgres.prisma is MISSING — run `npm run db:pg:sync`.",
      );
      process.exit(1);
    }
    const actual = readFileSync(DERIVED, "utf8");
    if (actual !== expected) {
      console.error(
        "[db:pg:check] prisma/schema.postgres.prisma is STALE — run `npm run db:pg:sync` and commit the result.",
      );
      process.exit(1);
    }
    console.log("[db:pg:check] Postgres schema is in sync with schema.prisma.");
    return;
  }

  writeFileSync(DERIVED, expected, "utf8");
  console.log("[db:pg:sync] wrote prisma/schema.postgres.prisma");
}

main();
