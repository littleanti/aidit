#!/usr/bin/env bash
# Aidit verification + build pipeline (self-hosted CI/CD).
#
# This repo has no GitHub Actions workflow ON PURPOSE — deployment runs on our own
# server (README "배포 · CI"). So the gate lives here, as code: the same commands
# a reviewer can read, a developer can run locally, and the server can invoke.
#
#   ./deploy/pipeline.sh              # verify only (default)
#   ./deploy/pipeline.sh --with-e2e   # + Playwright (boots its own servers)
#   ./deploy/pipeline.sh --with-build # + production build artifacts
#   ./deploy/pipeline.sh --all
#
# Exit code is the gate: 0 = safe to deploy, non-zero = stop. Every step prints a
# PASS/FAIL line so a failing run says WHICH gate failed without reading scrollback.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

WITH_E2E=0
WITH_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --with-e2e) WITH_E2E=1 ;;
    --with-build) WITH_BUILD=1 ;;
    --all) WITH_E2E=1; WITH_BUILD=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

FAILED=()
STEP=0

# Run one gate. Keeps going after a failure so ONE run reports every problem
# instead of making the operator re-run per fix; the exit code still gates.
run_step() {
  local name="$1"; shift
  STEP=$((STEP + 1))
  printf '\n=== [%d] %s ===\n' "$STEP" "$name"
  if "$@"; then
    # printf '%s' on purpose: bash's builtin printf parses a format string that
    # starts with "--" as an option and errors with "invalid option".
    printf '%s\n' "--- PASS: $name"
  else
    printf '%s\n' "--- FAIL: $name"
    FAILED+=("$name")
  fi
}

in_backend()  { ( cd "$ROOT/backend"  && "$@" ); }
in_frontend() { ( cd "$ROOT/frontend" && "$@" ); }

printf 'Aidit pipeline — node %s\n' "$(node -v)"

# --- correctness gates -----------------------------------------------------
run_step "backend typecheck"   in_backend  npm run --silent typecheck
run_step "backend tests"       in_backend  npm test --silent
# Guards the SQLite->Postgres derived schema against drift (TRD §15.1): a model
# added to schema.prisma but not synced would otherwise ship a broken prod DDL.
run_step "postgres schema sync" in_backend npm run --silent db:pg:check
run_step "frontend typecheck"  in_frontend npm run --silent typecheck
run_step "frontend tests"      in_frontend npm test --silent

# --- optional gates --------------------------------------------------------
if [ "$WITH_E2E" -eq 1 ]; then
  # playwright.config.ts starts the backend + Vite itself (webServer), so this
  # needs no manually-started servers. AIDIT_PIPELINE=1 makes it refuse to reuse
  # an already-running dev server: a pipeline must test THIS commit's build, not
  # whatever a developer happens to have open.
  run_step "frontend e2e" env AIDIT_PIPELINE=1 bash -c 'cd frontend && npm run --silent e2e'
fi

if [ "$WITH_BUILD" -eq 1 ]; then
  run_step "backend build"  in_backend  npm run --silent build
  run_step "frontend build" in_frontend npm run --silent build
fi

# --- verdict ---------------------------------------------------------------
printf '\n==================== SUMMARY ====================\n'
if [ "${#FAILED[@]}" -eq 0 ]; then
  printf 'ALL %d GATES PASSED — safe to deploy.\n' "$STEP"
  exit 0
fi
printf '%d of %d gates FAILED:\n' "${#FAILED[@]}" "$STEP"
for f in "${FAILED[@]}"; do printf '  - %s\n' "$f"; done
printf 'Deployment must NOT proceed.\n'
exit 1
