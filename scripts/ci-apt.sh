#!/usr/bin/env bash
set -euo pipefail

mirrors=/etc/apt/apt-mirrors.txt
stamp="${RUNNER_TEMP:-/tmp}/orden-apt-updated"
get=(sudo apt-get -q -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o Acquire::ForceIPv4=true)
tries=${ORDEN_APT_TRIES:-6}
pause=${ORDEN_APT_PAUSE_S:-60}

drop_first_mirror() {
  [ -f "$mirrors" ] || return 0
  [ "$(grep -c '^[^#[:space:]]' "$mirrors")" -gt 1 ] || return 0
  echo "ci-apt: $(grep -m1 '^[^#[:space:]]' "$mirrors") failed; trying the next mirror" >&2
  sudo sed -i '0,/^[^#[:space:]]/{/^[^#[:space:]]/d}' "$mirrors"
}

fetched() {
  if [ ! -f "$stamp" ]; then
    timeout 3m "${get[@]}" update || return 1
    touch "$stamp"
  fi
  [ "$#" -eq 0 ] || timeout 6m "${get[@]}" install -y --download-only "$@"
}

if [ "${1:-}" = --playwright ]; then
  shift
  # shellcheck disable=SC2046 # one package a line
  set -- --no-install-recommends $({ python3 -m playwright install-deps --dry-run "$@" || true; } | sed -n 's/^  \(\S*\)$/\1/p')
  [ "$#" -gt 1 ] || exit 0
fi
for try in $(seq "$tries"); do
  fetched "$@" && break
  if [ "$try" -ge "$tries" ]; then
    echo "::error::ci-apt: apt failed $tries times: $*"
    exit 1
  fi
  echo "::warning::ci-apt: apt failed (try $try of $tries); a fresh index in $((pause * try))s"
  rm -f "$stamp"
  drop_first_mirror
  sleep $((pause * try))
done
[ "$#" -gt 0 ] || exit 0
"${get[@]}" install -y "$@"
