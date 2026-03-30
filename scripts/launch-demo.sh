#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SANDBOX_PID=""
AGENT_PID=""
DASHBOARD_PID=""

find_free_port() {
  local port="$1"

  while true; do
    if node -e "
      const net = require('node:net');
      const server = net.createServer();
      server.once('error', () => process.exit(1));
      server.once('listening', () => server.close(() => process.exit(0)));
      server.listen(${port}, '127.0.0.1');
    " >/dev/null 2>&1; then
      echo "$port"
      return
    fi

    port=$((port + 1))
  done
}

cleanup() {
  for pid in "$DASHBOARD_PID" "$AGENT_PID" "$SANDBOX_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

SANDBOX_PORT="$(find_free_port 4173)"
AGENT_PORT="$(find_free_port 8787)"
DASHBOARD_PORT="$(find_free_port 5173)"

SANDBOX_URL="http://127.0.0.1:${SANDBOX_PORT}"
AGENT_URL="http://127.0.0.1:${AGENT_PORT}"
DASHBOARD_URL="http://127.0.0.1:${DASHBOARD_PORT}"

echo "Starting Reform demo services..."
echo "Sandbox app:   ${SANDBOX_URL}"
echo "Agent API:     ${AGENT_URL}"
echo "Dashboard UI:  ${DASHBOARD_URL}"
echo

(
  cd "$ROOT_DIR"
  npm run --workspace @reform/sandbox-app dev -- --host 127.0.0.1 --port "${SANDBOX_PORT}" --strictPort
) &
SANDBOX_PID=$!

(
  cd "$ROOT_DIR"
  REFORM_AGENT_PORT="${AGENT_PORT}" REFORM_APP_URL="${SANDBOX_URL}" npm run --workspace @reform/agent server
) &
AGENT_PID=$!

(
  cd "$ROOT_DIR"
  VITE_AGENT_API_URL="${AGENT_URL}" npm run --workspace @reform/dashboard dev -- --host 127.0.0.1 --port "${DASHBOARD_PORT}" --strictPort
) &
DASHBOARD_PID=$!

echo "Services launched. Press Ctrl+C to stop all of them."
wait
