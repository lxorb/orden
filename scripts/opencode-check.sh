#!/usr/bin/env bash
set -euo pipefail

binary=$1
home=$(mktemp -d)
pid=
stop() {
  [ -z "$pid" ] || kill "$pid" 2>/dev/null || true
  [ -z "$pid" ] || wait "$pid" 2>/dev/null || true
  rm -rf "$home" 2>/dev/null || true
}
trap stop EXIT
port=$((20000 + RANDOM % 20000))
echo "$binary says $("$binary" --version)"
XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" XDG_CACHE_HOME="$home/cache" XDG_STATE_HOME="$home/state" \
  OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_CLAUDE_CODE=1 \
  "$binary" serve --hostname 127.0.0.1 --port "$port" >"$home/log" 2>&1 &
pid=$!
began=$SECONDS
for _ in $(seq 240); do
  if curl -fsS -m 5 "http://127.0.0.1:$port/global/health" >"$home/health" 2>/dev/null; then
    echo "it served $(cat "$home/health") after $((SECONDS - began)) s"
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.5
done
echo "::error::$binary did not serve"
cat "$home/log"
exit 1
