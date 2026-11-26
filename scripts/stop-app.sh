stop_app() {
  pkill -TERM -f "$1" || true
  for _ in $(seq 100); do pgrep -f "$1" >/dev/null || return 0; sleep 0.2; done
  pkill -KILL -f "$1" || true
  for _ in $(seq 50); do pgrep -f "$1" >/dev/null || return 0; sleep 0.2; done
  echo "$1 is still running" >&2
  return 1
}
