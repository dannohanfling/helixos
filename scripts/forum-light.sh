#!/bin/bash
# Lights this session's agent on The Forum (H-19, H-26 B): Claude Code's hooks call it on SessionStart and UserPromptSubmit
# with "working" and on Stop with "waiting". It uses the session's own agent token from its environment (HELIXOS_AGENT_TOKEN,
# or any HELIXOS_TOKEN_<NAME>, whose name is the agent's), waits at most 3 seconds, prints nothing (a hook's stdout would
# land in the conversation) and always exits 0, so it can never fail a session. No prompt text ever goes to the Forum.
status="${1:-working}"
now="${2:-}"
token="${HELIXOS_AGENT_TOKEN:-}"
name="${HELIXOS_AGENT_NAME:-}"
if [ -z "$token" ]; then
  for v in $(compgen -A variable | grep '^HELIXOS_TOKEN_' | head -1); do
    token="${!v}"
    if [ -z "$name" ]; then
      raw="${v#HELIXOS_TOKEN_}"
      name="$(printf '%s' "${raw:0:1}" | tr '[:lower:]' '[:upper:]')$(printf '%s' "${raw:1}" | tr '[:upper:]' '[:lower:]')"
    fi
  done
fi
if [ -z "$token" ] || [ -z "$name" ]; then exit 0; fi
case "$status" in working|waiting|idle|done) ;; *) exit 0 ;; esac
base="${HELIXOS_URL:-https://helixos.evolveomega.com}"
# The agent's name and the line are ours, never a prompt's words; both are plain ASCII words here, so no JSON escaping is needed.
name="$(printf '%s' "$name" | tr -cd 'A-Za-z0-9 _-' | cut -c1-40)"
now="$(printf '%s' "$now" | tr -cd 'A-Za-z0-9 ,.:_-' | cut -c1-120)"
args="\"agent\":\"$name\",\"status\":\"$status\""
if [ -n "$now" ]; then args="$args,\"now\":\"$now\""; fi
body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"forum_report\",\"arguments\":{$args}}}"
curl -sS -m 3 -o /dev/null -X POST "$base/api/mcp" \
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  --data "$body" >/dev/null 2>&1 || true
exit 0
