#!/usr/bin/env bash
# Runs one or more Playwright walks against the dev server, reseeding the demo database before each so walks never
# inherit each other's state. Exits non-zero on the first failure. Output goes to the terminal and to screenshots/logs/.
#
#   scripts/smoke.sh ai ladders wave3         # named walks (scripts/smoke-<name>.ts); "base" runs scripts/smoke.ts
#   scripts/smoke.sh all                      # every walk, in the order below
#
# The dev server must already be running on :3000 (scripts/dev-server.sh start). The auth walk also needs a current
# `next build`; the ai walk needs the server started with AI_BASE_URL=http://localhost:4020; the wave3 walk covers the signed
# GoHighLevel webhook only when the server has GHL_WEBHOOK_PUBLIC_KEY. dev-server.sh sets all of these. The email walk runs the
# reminder code directly against scripts/mock-sendgrid.ts on a scratch database and does not use the server.
set -euo pipefail

# Wrapped in a function so bash parses the whole file before executing: an edit while it runs can't corrupt the tail.
main() {
  cd "$(dirname "$0")/.."

  ALL=(base firstday loop rewards coach wave3 composer library wizards ladders socrates ghl ai essence fathom email headers auth)
  BASE_URL="${BASE_URL:-http://localhost:3000}"

  if [[ $# -eq 0 ]]; then
    echo "usage: scripts/smoke.sh <walk>... | all   (walks: ${ALL[*]})" >&2
    exit 2
  fi
  if ! curl -sf -o /dev/null "$BASE_URL/login"; then
    echo "smoke: no server at $BASE_URL. Start it with scripts/dev-server.sh start" >&2
    exit 1
  fi

  walks=("$@")
  [[ "${walks[0]}" == "all" ]] && walks=("${ALL[@]}")
  mkdir -p screenshots/logs

  for w in "${walks[@]}"; do
    script="scripts/smoke-$w.ts"
    [[ "$w" == "base" ]] && script="scripts/smoke.ts"
    if [[ ! -f "$script" ]]; then
      echo "smoke: no such walk '$w' ($script)" >&2
      exit 2
    fi
    printf '\n== reseed ==\n'
    npm run db:seed
    printf '\n== walk: %s ==\n' "$w"
    # tee keeps the full output on disk; pipefail keeps the walk's exit status, so a failing walk still fails this script.
    timeout 600 npx tsx "$script" "$BASE_URL" 2>&1 | tee "screenshots/logs/smoke-$w.log"
  done

  printf '\nsmoke: %s passed\n' "${walks[*]}"
}
main "$@"
