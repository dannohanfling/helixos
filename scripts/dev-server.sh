#!/usr/bin/env bash
# Starts or stops the dev server on :3000 with every setting the walks need. Idempotent; waits until /login answers.
#
#   scripts/dev-server.sh start | stop | restart | status
set -euo pipefail

# Wrapped in a function so bash parses the whole file before executing: an edit while it runs can't corrupt the tail.
main() {
  cd "$(dirname "$0")/.."

  LOG="${DEV_LOG:-screenshots/logs/dev.log}"
  PORT="${PORT:-3000}"

  stop() {
    fuser -k "$PORT/tcp" 2>/dev/null || true
    sleep 1
  }
  start() {
    mkdir -p "$(dirname "$LOG")"
    if curl -sf -o /dev/null "http://localhost:$PORT/login"; then
      echo "dev-server: already up on :$PORT"
      return
    fi
    # Values here are for local walks only. Production reads its own environment; AI_BASE_URL is ignored there by design.
    SETUP_TOKEN="${SETUP_TOKEN:-main-setup-token}" \
    CRON_SECRET="${CRON_SECRET:-change-me}" \
    SESSION_SECRET="${SESSION_SECRET:-dev-secret-dev-secret-dev-secret-123}" \
    GHL_WEBHOOK_PUBLIC_KEY="${GHL_WEBHOOK_PUBLIC_KEY:-LcZjV/epRdfWK7Ah/K3pR4K5ulVZRnaRt6vHVnshlMg=}" \
    AI_BASE_URL="${AI_BASE_URL:-http://localhost:4020}" \
    FATHOM_BASE_URL="${FATHOM_BASE_URL:-http://localhost:4030}" \
    OPENALEX_BASE_URL="${OPENALEX_BASE_URL:-http://localhost:4040}" \
    OPENALEX_API_KEY="${OPENALEX_API_KEY:-test-key}" \
    BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-vercel_blob_rw_TESTSTORE_testsecret}" \
    PROOF_BLOB_READ_WRITE_TOKEN="${PROOF_BLOB_READ_WRITE_TOKEN:-vercel_blob_rw_PROOFSTORE_testsecret}" \
    VERCEL_BLOB_API_URL="${VERCEL_BLOB_API_URL:-http://localhost:4050}" \
    NEXT_PUBLIC_VERCEL_BLOB_API_URL="${NEXT_PUBLIC_VERCEL_BLOB_API_URL:-http://localhost:4050}" \
    REWARDS_CONFIG_OVERRIDE="${REWARDS_CONFIG_OVERRIDE:-screenshots/logs/rewards-config.override.json}" \
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
    status) curl -sf -o /dev/null "http://localhost:$PORT/login" && echo "up" || { echo "down"; exit 1; } ;;
    *) echo "usage: scripts/dev-server.sh start|stop|restart|status" >&2; exit 2 ;;
  esac
}
main "$@"
