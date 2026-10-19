#!/usr/bin/env bash
# Runs one or more Playwright walks against the dev server, reseeding the demo database before each so walks never
# inherit each other's state. Exits non-zero on the first failure. Output goes to the terminal and to screenshots/logs/.
#
#   scripts/smoke.sh ai ladders wave3         # named walks (scripts/smoke-<name>.ts); "base" runs scripts/smoke.ts
#   scripts/smoke.sh all                      # every walk in scripts/smoke-walks.txt, in its order
#   scripts/smoke.sh --plan all               # print the order and each planned fresh server; runs nothing
#
# The dev server must already be running on :3000 (scripts/dev-server.sh start). The auth walk also needs a current
# `next build`; the ai walk needs the server started with AI_BASE_URL=http://localhost:4020; the wave3 walk covers the signed
# GoHighLevel webhook only when the server has GHL_WEBHOOK_PUBLIC_KEY. dev-server.sh sets all of these. The email walk runs the
# reminder code directly against scripts/mock-sendgrid.ts on a scratch database and does not use the server.
#
# Conventions every walk inherits:
# - A walk reads the record and acts on what it finds; it never assumes state a previous step left.
# - A fill into a field that may already hold text is checked after typing (fillField / fillExact): a fill that lands mid-hydration
#   inserts at the caret instead of replacing.
# - Every assertion that quantifies over a collection ("every slide is clean", "no request carried the key", "no rung was posted")
#   is paired with an assertion that the collection is non-empty, and where the count is knowable, that it is the expected count.
#   "Exports clean" is never shipped without "exports N slides": an assertion over nothing passes for nothing.
# - A check derives its list of subjects from the source of truth; it does not restate it. Pages come from src/app, fields from
#   the schema, steps from the wizard's own definition. Where a list must be written by hand, the check asserts it against a count
#   read from the source, so drift fails instead of passing (the headers walk once "checked" two pages that no longer existed).
# - Example content is never copied into a client record as a value. An example may be read and its shape copied (sections,
#   their names, their order), never its words: a sentence a coach did not write and did not choose must never be theirs to ship.
# - An assertion's expected value is read from the source that produced it, never typed from memory: a seed's line comes from the
#   seed file, a rendered string from the element, a ratio from the engine. And a check that can pass on its own parsing is not a
#   check: read the subject through the element, not through an accessor that returns something plausible when nothing rendered.
set -euo pipefail

# Wrapped in a function so bash parses the whole file before executing: an edit while it runs can't corrupt the tail.
main() {
  cd "$(dirname "$0")/.."

  # The walk list lives in its own file (H-1163), one walk a line, so a new walk is one added line there.
  ALL=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line//[[:space:]]/}"
    [[ -n "$line" ]] && ALL+=("$line")
  done < scripts/smoke-walks.txt
  BASE_URL="${BASE_URL:-http://localhost:3000}"

  # A fresh server every SMOKE_FRESH_EVERY walks, and before a walk when the server is over SMOKE_FRESH_RSS_MB or not
  # answering (H-1116, H-1163): a whole run otherwise grows next-server past the container's memory and the kernel kills it
  # mid-walk (13 GB, 19 Oct). Restarts happen only between walks. A walk that fails still fails the run with its own exit
  # status: nothing is retried and nothing is marked passed. Local runs only.
  FRESH_EVERY="${SMOKE_FRESH_EVERY:-10}"
  FRESH_RSS_MB="${SMOKE_FRESH_RSS_MB:-9000}"
  plan=0
  if [[ "${1:-}" == "--plan" ]]; then
    plan=1
    shift
  fi

  if [[ $# -eq 0 ]]; then
    echo "usage: scripts/smoke.sh <walk>... | all   (walks: ${ALL[*]})" >&2
    exit 2
  fi
  walks=("$@")
  [[ "${walks[0]}" == "all" ]] && walks=("${ALL[@]}")

  # Why a fresh server goes before walk number $1 (counting from 0) named $2, or nothing. The memory and answer checks need a
  # running server, so --plan shows only the planned ones.
  planned_fresh() {
    local i="$1" w="$2"
    if [[ "$w" == "tenancy" || "$w" == "team" ]]; then echo "the $w walk opens many pages at once"; return; fi
    # 19 Oct: body grew next-server from a few GB to 12.8 GB inside the one walk, twice, and passed on a fresh server.
    if [[ "$w" == "body" ]]; then echo "the body walk alone grows the server close to the limit"; return; fi
    if (( FRESH_EVERY > 0 && i > 0 && i % FRESH_EVERY == 0 )); then echo "every $FRESH_EVERY walks"; return; fi
  }
  if (( plan )); then
    for i in "${!walks[@]}"; do
      why="$(planned_fresh "$i" "${walks[$i]}")"
      if [[ -n "$why" ]]; then printf '%s	fresh (%s)
' "${walks[$i]}" "$why"; else printf '%s
' "${walks[$i]}"; fi
    done
    exit 0
  fi

  if ! curl -sf -o /dev/null "$BASE_URL/login"; then
    echo "smoke: no server at $BASE_URL. Start it with scripts/dev-server.sh start" >&2
    exit 1
  fi

  mkdir -p screenshots/logs

  # Warm the routes every walk starts on (login, the demo sign-in, Today) before the first walk: a cold dev server compiles
  # them on first request, which has taken minutes, and a walk's 30-second wait is only an honest signal on a compiled route.
  # The warm-up has its own long timeout and asserts nothing but "it responded"; if it times out, that is the app, and the run
  # fails here, loudly, rather than inside a walk.
  printf '\n== warm-up ==\n'
  npm run db:seed
  if ! timeout 330 npx tsx scripts/smoke-warm.ts "$BASE_URL"; then
    echo "smoke: warm-up failed: login, the demo sign-in or Today did not respond within five minutes" >&2
    exit 1
  fi

  # The deck-images walk renders a .pptx in LibreOffice; prove the Impress module is present before any walk, so a missing
  # package fails here with one plain line and the install command, not mid-walk.
  if printf '%s\n' "${walks[@]}" | grep -qx deck-images; then
    printf '\n== libreoffice check ==\n'
    npx tsx scripts/check-libreoffice.ts || exit 1
  fi

  # The dev server's memory in MB (every next-server process together), or 0 when there is none.
  server_mb() {
    ps -eo rss=,args= 2>/dev/null | awk '/next-server/ && !/awk/ { kb += $1 } END { printf "%d", kb / 1024 }'
  }

  for i in "${!walks[@]}"; do
    w="${walks[$i]}"
    script="scripts/smoke-$w.ts"
    [[ "$w" == "base" ]] && script="scripts/smoke.ts"
    if [[ ! -f "$script" ]]; then
      echo "smoke: no such walk '$w' ($script)" >&2
      exit 2
    fi
    # The tenancy walk opens every page whose tree imports a probed action, in one go; after the walks before it the dev
    # server's compile has climbed past the container's memory (15 Oct: the kernel killed next-server at 13 GB, H-178). A fresh
    # server, both caches cleared, walks it well under the limit; local only.
    # The team walk's sweep of the closed pages (16 Oct, H-470 gate) climbed the same way: the kernel killed next-server at 13 GB
    # with /more or /conversations/playbook still compiling, so it gets the same fresh start.
    if [[ "$BASE_URL" == "http://localhost:3000" ]]; then
      why="$(planned_fresh "$i" "$w")"
      if [[ -z "$why" ]]; then
        mb="$(server_mb)"
        if (( mb > FRESH_RSS_MB )); then why="the server is at ${mb} MB"
        elif ! curl -sf -m 20 -o /dev/null "$BASE_URL/login"; then why="the server is not answering"
        fi
      fi
      if [[ -n "$why" ]]; then
        printf '\n== fresh server before %s (%s) ==\n' "$w" "$why"
        scripts/dev-server.sh fresh
      else
        # The size each walk starts at, so the thresholds can be tuned from the logs.
        printf '\n== server at %s MB before %s ==\n' "$mb" "$w"
      fi
    fi
    printf '\n== reseed ==\n'
    npm run db:seed
    printf '\n== walk: %s ==\n' "$w"
    # tee keeps the full output on disk; pipefail keeps the walk's exit status, so a failing walk still fails this script.
    # Ten minutes a walk, except the board walk: on 18 Oct it passed every check it reached on main and still ran out at
    # 614 s, past the H-290 section with the council sections still to go (it plays the Boardroom's turns at speaking pace).
    limit=600
    [[ "$w" == "board" ]] && limit=1200
    timeout "$limit" npx tsx "$script" "$BASE_URL" 2>&1 | tee "screenshots/logs/smoke-$w.log"
  done

  printf '\nsmoke: %s passed\n' "${walks[*]}"
}
main "$@"
