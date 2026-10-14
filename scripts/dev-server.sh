#!/usr/bin/env bash
# Starts or stops the dev server on :3000 with every setting the walks need. Idempotent; waits until /login answers.
#
#   scripts/dev-server.sh start | stop | restart | fresh | status
set -euo pipefail

# Wrapped in a function so bash parses the whole file before executing: an edit while it runs can't corrupt the tail.
main() {
  cd "$(dirname "$0")/.."

  LOG="${DEV_LOG:-screenshots/logs/dev.log}"
  PORT="${PORT:-3000}"

  # Stop asks first (TERM) and waits until the server is gone, parent and child, before killing what is left: a hard kill
  # mid-write left Turbopack's cache under .next/cache half-written, and the next server then answered 404 on a nested page
  # (/coach/community, /oauth/authorize) it had compiled fine (14 Oct).
  stop() {
    pkill -TERM -f "next dev -p $PORT" 2>/dev/null || true
    fuser -k -TERM "$PORT/tcp" 2>/dev/null || true
    for _ in $(seq 1 30); do
      if ! fuser "$PORT/tcp" >/dev/null 2>&1 && ! pgrep -f "next dev -p $PORT" >/dev/null 2>&1; then
        sleep 1
        return
      fi
      sleep 1
    done
    pkill -9 -f "next dev -p $PORT" 2>/dev/null || true
    fuser -k -9 "$PORT/tcp" 2>/dev/null || true
    sleep 1
  }
  # A clean server: stopped, both caches cleared (.next/dev and Turbopack's persistent one), started again.
  fresh() {
    stop
    rm -rf .next/dev .next/cache/turbopack
    start
  }
  start() {
    mkdir -p "$(dirname "$LOG")"
    if curl -sf -o /dev/null "http://localhost:$PORT/login"; then
      echo "dev-server: already up on :$PORT"
      return
    fi
    # Values here are for local walks only. Production reads its own environment; AI_BASE_URL is ignored there by design.
    # TZ=UTC: the server runs in UTC as Vercel does, so a wall time parsed in the server's zone shows up in the walks hours off.
    SETUP_TOKEN="${SETUP_TOKEN:-main-setup-token}" \
    CRON_SECRET="${CRON_SECRET:-change-me}" \
    SESSION_SECRET="${SESSION_SECRET:-dev-secret-dev-secret-dev-secret-123}" \
    GHL_WEBHOOK_PUBLIC_KEY="${GHL_WEBHOOK_PUBLIC_KEY:-LcZjV/epRdfWK7Ah/K3pR4K5ulVZRnaRt6vHVnshlMg=}" \
    AI_BASE_URL="${AI_BASE_URL:-http://localhost:4020}" \
    MAGIC_FUNNEL_ANTHROPIC_KEY="${MAGIC_FUNNEL_ANTHROPIC_KEY:-sk-ant-good}" \
    FATHOM_BASE_URL="${FATHOM_BASE_URL:-http://localhost:4030}" \
    OPENALEX_BASE_URL="${OPENALEX_BASE_URL:-http://localhost:4040}" \
    OPENALEX_API_KEY="${OPENALEX_API_KEY:-test-key}" \
    UCHAT_BASE_URL="${UCHAT_BASE_URL:-http://localhost:4060}" \
    AIRTABLE_API_URL="${AIRTABLE_API_URL:-http://localhost:4070}" \
    INSTACART_API_URL="${INSTACART_API_URL:-http://localhost:4071}" \
    INSTACART_API_KEY="${INSTACART_API_KEY:-test-instacart-key}" \
    WHOOP_API_URL="${WHOOP_API_URL:-http://localhost:4072}" \
    WHOOP_AUTH_URL="${WHOOP_AUTH_URL:-http://localhost:4072/oauth/oauth2}" \
    WHOOP_CLIENT_ID="${WHOOP_CLIENT_ID:-test-whoop-client}" \
    WHOOP_CLIENT_SECRET="${WHOOP_CLIENT_SECRET:-test-whoop-secret}" \
    USDA_API_URL="${USDA_API_URL:-http://localhost:4073/fdc/v1}" \
    USDA_API_KEY="${USDA_API_KEY:-test-usda-key}" \
    OFF_API_URL="${OFF_API_URL:-http://localhost:4073/off/api/v2}" \
    BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-vercel_blob_rw_TESTSTORE_testsecret}" \
    PROOF_BLOB_READ_WRITE_TOKEN="${PROOF_BLOB_READ_WRITE_TOKEN:-vercel_blob_rw_PROOFSTORE_testsecret}" \
    VERCEL_BLOB_API_URL="${VERCEL_BLOB_API_URL:-http://localhost:4050}" \
    NEXT_PUBLIC_VERCEL_BLOB_API_URL="${NEXT_PUBLIC_VERCEL_BLOB_API_URL:-http://localhost:4050}" \
    REWARDS_CONFIG_OVERRIDE="${REWARDS_CONFIG_OVERRIDE:-screenshots/logs/rewards-config.override.json}" \
    TZ=UTC \
      nohup npx next dev -p "$PORT" >"$LOG" 2>&1 &
    for _ in $(seq 1 60); do
      if curl -sf -o /dev/null "http://localhost:$PORT/login"; then
        echo "dev-server: up on :$PORT (log: $LOG)"
        return
      fi
      sleep 2
    done
    echo "dev-server: did not come up; see $LOG" >&2
    exit 1
  }

  case "${1:-}" in
    start) start ;;
    stop) stop ;;
    restart) stop; start ;;
    fresh) fresh ;;
    status) curl -sf -o /dev/null "http://localhost:$PORT/login" && echo "up" || { echo "down"; exit 1; } ;;
    *) echo "usage: scripts/dev-server.sh start|stop|restart|fresh|status" >&2; exit 2 ;;
  esac
}
main "$@"
