#!/usr/bin/env bash
# Static verification: typecheck, lint, unit tests, and (with --build) a production build.
# Exits non-zero the moment any step fails. Nothing here is piped through tail or head, so no failure can be masked.
#
#   scripts/verify.sh            # tsc + eslint + vitest
#   scripts/verify.sh --build    # ... + next build
set -euo pipefail

# Wrapped in a function so bash parses the whole file before executing: an edit while it runs can't corrupt the tail.
main() {
  cd "$(dirname "$0")/.."

  step() { printf '\n== %s ==\n' "$1"; }

  step "typecheck"
  npx tsc --noEmit

  step "lint"
  npx eslint src scripts

  step "unit tests"
  VITE_CONFIG_NATIVE_IGNORE_WARNING=1 npx vitest run

  # A table rebuild that selects a column the old table lacks fails on every database: caught here, before any walk seeds one.
  step "migrations"
  npx tsx --tsconfig tsconfig.json scripts/check-migrations.ts

  if [[ "${1:-}" == "--build" ]]; then
    step "production build"
    # A build needs a session secret; the value is irrelevant because no request runs during the build.
    SESSION_SECRET="${SESSION_SECRET:-verify-only-secret-verify-only-secret-1234}" npx next build
  fi

  printf '\nverify: all steps passed\n'
}
main "$@"
