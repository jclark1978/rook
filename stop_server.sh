#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.pids"
SERVER_PID_FILE="$PID_DIR/rook-server.pid"
WEB_PID_FILE="$PID_DIR/rook-web.pid"

is_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

stop_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name is not running (no PID file)."
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "$name PID file was empty; cleaned up."
    return 0
  fi

  if ! is_running "$pid"; then
    rm -f "$pid_file"
    echo "$name is not running (stale PID $pid removed)."
    return 0
  fi

  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! is_running "$pid"; then
      rm -f "$pid_file"
      echo "Stopped $name (PID $pid)."
      return 0
    fi
    sleep 0.25
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "Force-stopped $name (PID $pid)."
}

stop_matching() {
  local name="$1"
  local pattern="$2"
  local matched
  matched="$(pgrep -f "$pattern" || true)"
  if [[ -z "$matched" ]]; then
    echo "No stray $name processes found."
    return 0
  fi

  echo "Stopping stray $name processes: $matched"
  pkill -f "$pattern" || true

  for _ in {1..20}; do
    if ! pgrep -f "$pattern" >/dev/null 2>&1; then
      echo "Stopped stray $name processes."
      return 0
    fi
    sleep 0.25
  done

  pkill -9 -f "$pattern" || true
  echo "Force-stopped stray $name processes."
}

echo "Stopping Rook services..."
stop_process "web" "$WEB_PID_FILE"
stop_process "server" "$SERVER_PID_FILE"

# Clean up any additional manually started dev processes not tracked by PID files.
stop_matching "web (vite)" "node .*node_modules/.bin/vite --host 0.0.0.0 --port 5173"
stop_matching "server (tsx watch)" "node .*node_modules/.bin/tsx watch src/index.ts"

echo "Done."
