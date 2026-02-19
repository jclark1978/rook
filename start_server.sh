#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/.logs"
SERVER_PID_FILE="$PID_DIR/rook-server.pid"
WEB_PID_FILE="$PID_DIR/rook-web.pid"
SERVER_LOG="$LOG_DIR/rook-server.log"
WEB_LOG="$LOG_DIR/rook-web.log"

mkdir -p "$PID_DIR" "$LOG_DIR"

is_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

start_process() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && is_running "$existing_pid"; then
      echo "$name already running (PID $existing_pid)."
      return 0
    fi
    rm -f "$pid_file"
  fi

  nohup "$@" >"$log_file" 2>&1 &
  local new_pid=$!
  echo "$new_pid" >"$pid_file"
  echo "Started $name (PID $new_pid). Logs: $log_file"
}

echo "Starting Rook services from $ROOT_DIR"

start_process \
  "server" \
  "$SERVER_PID_FILE" \
  "$SERVER_LOG" \
  npm run -w @rook/server dev

start_process \
  "web" \
  "$WEB_PID_FILE" \
  "$WEB_LOG" \
  npm run -w @rook/web dev -- --host 0.0.0.0 --port 5173

echo "Done."
echo "Server health: http://10.17.66.222:3001/health"
echo "Web app:       http://10.17.66.222:5173"
echo "Use ./stop_server.sh to stop both services."
