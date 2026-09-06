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

  scripts/verify.sh --build
  # The build above replaces .next; the auth walk's helper servers run `next start` from it, so restart the dev server
  # afterwards rather than before.
  scripts/dev-server.sh restart
  if [[ $# -gt 0 ]]; then
    scripts/smoke.sh "$@"
  else
    scripts/smoke.sh all
  fi

  printf '\nrelease: every check passed; safe to commit\n'
}
main "$@"
