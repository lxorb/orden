#!/usr/bin/env bash
set -euo pipefail
script=$1
shift
name=$(basename "$script" -drive.py)
mkdir -p "parity/$name"
drive=("$script" --exe "$EXE" --identifier "$IDENTIFIER" --out "parity/$name" "$@")
case "$(uname -s)" in
  Linux) xvfb-run -a -s '-screen 0 1600x1000x24' dbus-run-session -- bash -c 'openbox & sleep 1; exec "$0" "$@"' "$PY" "${drive[@]}" ;;
  *) "$PY" "${drive[@]}" ;;
esac
