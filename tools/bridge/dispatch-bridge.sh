#!/usr/bin/env bash
#
# Motion Lite — dispatch bridge poller
# -------------------------------------
# Polls the Motion Lite dispatch queue, claims one job at a time, runs
# `claude --print` locally with the prompt, and POSTs the result back.
#
# Configured via .env (created by setup.sh).
#

set -u

cd "$(dirname "$0")"
BRIDGE_DIR="$(pwd)"

if [ ! -f "$BRIDGE_DIR/.env" ]; then
  echo "[bridge] no .env — run: bash $BRIDGE_DIR/setup.sh first" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$BRIDGE_DIR/.env"

: "${MOTION_URL:?MOTION_URL not set}"
: "${BRIDGE_SECRET:?BRIDGE_SECRET not set}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
WORKER_ID="${WORKER_ID:-$(hostname -s)}"
CLAUDE_TIMEOUT="${CLAUDE_TIMEOUT:-300}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "starting bridge — worker=$WORKER_ID server=$MOTION_URL poll=${POLL_INTERVAL}s"

while true; do
  # Claim next queued job
  resp=$(curl -s -m 15 \
    -H "x-bridge-secret: $BRIDGE_SECRET" \
    -H "x-bridge-worker: $WORKER_ID" \
    "$MOTION_URL/api/dispatch/queue" || echo '{}')

  count=$(echo "$resp" | jq -r '.dispatches | length // 0' 2>/dev/null || echo 0)

  if [ "$count" = "0" ] || [ -z "$count" ]; then
    sleep "$POLL_INTERVAL"
    continue
  fi

  job=$(echo "$resp" | jq -r '.dispatches[0]')
  id=$(echo "$job" | jq -r '.id')
  agent=$(echo "$job" | jq -r '.agent_id // "default"')
  prompt=$(echo "$job" | jq -r '.input_context // ""')
  task_title=$(echo "$job" | jq -r '.task_title // ""')

  if [ -z "$prompt" ] || [ "$prompt" = "null" ]; then
    log "job $id has no prompt, marking failed"
    curl -s -X PATCH \
      -H "x-bridge-secret: $BRIDGE_SECRET" \
      -H "Content-Type: application/json" \
      -d '{"status":"failed","error":"empty prompt","worker_id":"'"$WORKER_ID"'"}' \
      "$MOTION_URL/api/dispatch/$id" >/dev/null
    continue
  fi

  log "claimed job $id (agent=$agent) — $task_title"

  # Heartbeat in background while claude runs (so server knows we're alive)
  (
    while sleep 30; do
      curl -s -X PATCH \
        -H "x-bridge-secret: $BRIDGE_SECRET" \
        -H "Content-Type: application/json" \
        -d '{"status":"working","heartbeat_at":'"$(date +%s)"',"worker_id":"'"$WORKER_ID"'"}' \
        "$MOTION_URL/api/dispatch/$id" >/dev/null 2>&1 || break
    done
  ) &
  HB_PID=$!

  # Run claude with timeout
  result=$(echo "$prompt" | timeout "$CLAUDE_TIMEOUT" claude --print 2>&1)
  exit_code=$?

  kill "$HB_PID" 2>/dev/null || true
  wait "$HB_PID" 2>/dev/null || true

  if [ $exit_code -eq 0 ]; then
    log "job $id done (${#result} chars)"
    payload=$(jq -n --arg s "done" --arg w "$WORKER_ID" --arg r "$result" \
      '{status:$s, worker_id:$w, result_summary:$r}')
    curl -s -X PATCH \
      -H "x-bridge-secret: $BRIDGE_SECRET" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$MOTION_URL/api/dispatch/$id" >/dev/null
  else
    log "job $id failed (exit=$exit_code)"
    payload=$(jq -n --arg s "failed" --arg w "$WORKER_ID" --arg e "claude exited $exit_code: ${result:0:500}" \
      '{status:$s, worker_id:$w, error:$e}')
    curl -s -X PATCH \
      -H "x-bridge-secret: $BRIDGE_SECRET" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$MOTION_URL/api/dispatch/$id" >/dev/null
  fi
done
