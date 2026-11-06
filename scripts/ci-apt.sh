#!/usr/bin/env bash
set -euo pipefail

mirrors=/etc/apt/apt-mirrors.txt
stamp="${RUNNER_TEMP:-/tmp}/orden-apt-updated"
get=(sudo apt-get -q -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)

drop_first_mirror() {
  [ -f "$mirrors" ] || return 0
  [ "$(grep -c '^[^#[:space:]]' "$mirrors")" -gt 1 ] || return 0
  echo "ci-apt: $(grep -m1 '^[^#[:space:]]' "$mirrors") is too slow; trying the next mirror" >&2
  sudo sed -i '0,/^[^#[:space:]]/{/^[^#[:space:]]/d}' "$mirrors"
}

fetch() {
  local within=$1
  shift
  for try in 1 2 3; do
    if timeout "$within" "$@"; then
      return 0
    fi
    drop_first_mirror
  done
  echo "ci-apt: no mirror answered within $within, three times: $*" >&2
  return 1
}

if [ ! -f "$stamp" ]; then
  fetch 3m "${get[@]}" update
  touch "$stamp"
fi
if [ "${1:-}" = --playwright ]; then
  shift
  # shellcheck disable=SC2046 # one package a line
  set -- --no-install-recommends $({ python3 -m playwright install-deps --dry-run "$@" || true; } | sed -n 's/^  \(\S*\)$/\1/p')
  [ "$#" -gt 1 ] || exit 0
fi
[ "$#" -gt 0 ] || exit 0
fetch 6m "${get[@]}" install -y --download-only "$@"
"${get[@]}" install -y "$@"
