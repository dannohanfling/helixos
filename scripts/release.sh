#!/usr/bin/env bash
# The whole gate before a commit lands on main: static checks, production build, then every browser walk against a fresh
# dev server built from this tree. Exits non-zero on the first failure, so `scripts/release.sh && git commit ...` can never
# commit on a red check. No output is piped through tail or head anywhere in this chain.
#
#   scripts/release.sh                 # everything
#   scripts/release.sh ladders ai      # static checks + build + only these walks
set -euo pipefail

# Wrapped in a function so bash parses the whole file before executing: an edit while it runs can't corrupt the tail.
main() {
  cd "$(dirname "$0")/.."

  # The dev server stops before the checks, and its generated types go: while it runs it rewrites .next/dev/types, and the
  # typecheck read a half-written validator (14 Oct). The fresh start after the build writes them again.
  scripts/dev-server.sh stop
  rm -rf .next/dev/types
  # The route types are written again from the tree as it stands: the build's copy can name files that moved.
  npx next typegen
  scripts/verify.sh --build
  # The build above replaces .next; the auth walk's helper servers run `next start` from it, so restart the dev server
  # afterwards rather than before. From a clean .next/dev: the dev server's cache kept from before a build can lose a route
  # (5 Oct: /socrates/scripts/<id>/sheet answered 404 after every build until .next/dev was cleared, twice in a row in the gate).
  scripts/dev-server.sh fresh
  if [[ $# -gt 0 ]]; then
    scripts/smoke.sh "$@"
  else
    scripts/smoke.sh all
  fi

  printf '\nrelease: every check passed; safe to commit\n'
}
main "$@"
