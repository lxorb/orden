#!/bin/bash
set -Eeuo pipefail

R=${ORDEN_FORMER_ROOT:-}
old_opt=$R/opt/nibd
new_opt=$R/opt/ordend
old_etc=$R/etc/nibd
new_etc=$R/etc/ordend
old_said=$R/etc/nib
new_said=$R/etc/orden
old_state=$R/var/lib/nibd
new_state=$R/var/lib/ordend
units=$R/etc/systemd/system
bin=$R/usr/local/bin
mark=$old_opt/carry-failed
kept=$old_opt/carry-kept
stage=$new_opt.carry
shared=("$bin/orden-update" "$bin/orden-open" "$bin/orden-agents" "$R/etc/profile.d/orden.sh")
browsers=(xdg-open sensible-browser x-www-browser www-browser)
renamed=(
  "etc/apt/apt.conf.d/52nib-upgrades etc/apt/apt.conf.d/52orden-upgrades"
  "etc/sysctl.d/90-nib.conf etc/sysctl.d/90-orden.conf"
  "etc/ssh/sshd_config.d/01-nib.conf etc/ssh/sshd_config.d/01-orden.conf"
)
moved=
mine=$(sha256sum "$0" | cut -d' ' -f1)

say() {
  echo "orden-former-layout: $*" >&2
}


there() {
  [ -e "$1" ] || [ -L "$1" ]
}

holds() {
  [ -d "$1" ] && [ -n "$(ls -A "$1")" ]
}

files_in() {
  [ -d "$1" ] && [ -n "$(find "$1" -type f -print -quit)" ]
}

refuse() {
  say "$1"
  if [ -d "$old_opt" ]; then
    printf '%s\n%s\n' "$mine" "$1" >"$mark"
  fi
  exit 1
}

unmake() {
  local path name
  rm -rf "$new_opt" "$new_etc" "$new_said" "$stage"
  rm -f "$units/ordend.service" "$units/orden-agents.service"
  rmdir "$new_state" "$R/run/ordend" 2>/dev/null || true
  for path in "${shared[@]}"; do
    name=$(basename "$path")
    rm -f "$path"
    if there "$kept/$name"; then cp -a "$kept/$name" "$path"; fi
  done
  rm -rf "$kept"
  if there "$bin/nib-open"; then
    for name in "${browsers[@]}"; do
      ln -sf nib-open "$bin/$name"
    done
  fi
}

undone() {
  trap - ERR
  unmake
  refuse "$1; the old layout stays as it was"
}

listed() {
  (
    cd "$1"
    find . -type f -exec sha256sum {} + | sort -k 2
    find . ! -type f | sort
  )
}

prepare() {
  local path secret
  [ -d "$old_opt" ] || exit 0
  if there "$new_opt/former-layout.sh"; then return 0; fi
  if [ "$(head -n 1 "$mark" 2>/dev/null)" = "$mine" ]; then
    say "this move failed here before ($(sed -n 2p "$mark")); the old layout stays until a newer build tries again"
    exit 1
  fi
  for path in "$new_opt" "$new_etc" "$new_said" "$units/ordend.service" "$units/orden-agents.service"; do
    if there "$path"; then refuse "$path is already there, so nothing is moved over it"; fi
  done
  if holds "$new_state"; then refuse "$new_state already holds something, so nothing is moved over it"; fi
  [ -r "$old_etc/env" ] || refuse "there is no $old_etc/env to carry"
  [ -r "$old_said/machine" ] || refuse "there is no $old_said/machine to carry"

  trap 'undone "the new layout could not be made (line $LINENO)"' ERR
  rm -rf "$kept" "$stage"
  mkdir "$kept" "$stage"
  for path in "${shared[@]}"; do
    if there "$path"; then cp -a "$path" "$kept/"; fi
  done

  cp -a "$old_opt" "$stage/opt"
  rm -rf "$stage/opt/nibd.cjs" "$stage/opt/bundle" "$stage/opt/carry-kept" "$stage/opt/carry-failed"
  install -m 755 "$0" "$stage/opt/former-layout.sh"

  cp -a "$old_etc" "$stage/etc"
  sed 's/^NIBD_/ORDEND_/' "$old_etc/env" >"$stage/etc/env"
  chmod 600 "$stage/etc/env"
  secret=$(sed -n 's/^NIBD_SECRET=//p; s/^ORDEND_SECRET=//p' "$old_etc/env" | head -n 1)
  if [ -z "$secret" ] || [ "$(sed -n 's/^ORDEND_SECRET=//p' "$stage/etc/env" | head -n 1)" != "$secret" ]; then
    undone "the link's secret did not carry"
  fi

  install -d -m 755 "$stage/said"
  sed 's/^NIB_ORIGIN=/ORDEN_ORIGIN=/' "$old_said/machine" >"$stage/said/machine"
  chmod 644 "$stage/said/machine"
  grep -q '^ORDEN_ORIGIN=.' "$stage/said/machine" || undone "the origin did not carry"

  mv "$stage/etc" "$new_etc"
  mv "$stage/said" "$new_said"
  mv "$stage/opt" "$new_opt"
  rmdir "$stage"
  trap - ERR
  say "the new layout is ready beside the old one"
}

launch() {
  there "$new_opt/former-layout.sh" || exit 0
  if systemctl is-active --quiet orden-former-layout.service; then exit 0; fi
  systemctl daemon-reload
  systemd-run --no-block --collect --unit=orden-former-layout /bin/bash "$new_opt/former-layout.sh" switch
  say "switching to the new layout"
}

answers() {
  local port tries
  port=$(sed -n 's/^ORDEND_PORT=//p' "$new_etc/env" | head -n 1)
  port=${port:-7680}
  for tries in $(seq 1 60); do
    if curl -fs --max-time 3 "http://127.0.0.1:$port/health" >/dev/null; then
      sleep 5
      if systemctl is-active --quiet ordend.service &&
        curl -fs --max-time 3 "http://127.0.0.1:$port/health" >/dev/null; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

cgroups() {
  local root=$R/sys/fs/cgroup dir id pid pids tries
  [ -d "$root/nibd" ] || return 0
  mkdir -p "$root/ordend"
  for dir in "$root/nibd"/*/; do
    [ -d "$dir" ] || continue
    id=$(basename "$dir")
    mkdir -p "$root/ordend/$id"
    for tries in 1 2 3 4 5; do
      pids=$(cat "$dir/cgroup.procs" 2>/dev/null || true)
      [ -n "$pids" ] || break
      for pid in $pids; do
        echo "$pid" >"$root/ordend/$id/cgroup.procs" 2>/dev/null || true
      done
    done
    rmdir "$dir" 2>/dev/null || true
  done
  rmdir "$root/nibd" 2>/dev/null || true
  [ ! -d "$root/nibd" ]
}

back() {
  trap - ERR
  say "$1; going back to the old layout"
  systemctl disable --now ordend.service orden-agents.service || true
  if [ -n "$moved" ] && [ -d "$new_state" ]; then
    if [ -d "$old_state" ]; then rmdir "$old_state" || true; fi
    mv "$new_state" "$old_state" || say "what the terminals saved could not be put back: it is at $new_state"
  fi
  unmake
  printf '%s\n%s\n' "$mine" "$1" >"$mark"
  systemctl daemon-reload || true
  systemctl enable nibd.service nib-agents.service || true
  systemctl start --no-block nibd.service || true
  say "the old layout runs again; $mark says why"
  exit 1
}

switch() {
  local pair from to
  trap 'back "the switch stopped (line $LINENO)"' ERR
  systemctl stop nibd.service
  if holds "$old_state" && holds "$new_state"; then
    if files_in "$old_state"; then back "$old_state and $new_state both hold saved terminals"; fi
  elif holds "$old_state"; then
    listed "$old_state" >"$new_opt/carry.before"
    if [ -d "$new_state" ]; then rmdir "$new_state"; fi
    mv "$old_state" "$new_state"
    moved=1
    listed "$new_state" >"$new_opt/carry.after"
    cmp -s "$new_opt/carry.before" "$new_opt/carry.after" || back "what $old_state held did not arrive whole"
  fi
  systemctl disable nibd.service nib-agents.service || true
  systemctl enable ordend.service orden-agents.service
  systemctl start ordend.service
  answers || back "ordend did not answer from the new layout"
  trap - ERR

  cgroups || say "some sessions stay in the old cgroup until they end"
  rm -rf "$old_opt" "$old_etc" "$old_said" "$R/run/nibd"
  if ! files_in "$old_state"; then rm -rf "$old_state"; fi
  rm -f "$units/nibd.service" "$units/nib-agents.service" "$R/etc/profile.d/nib.sh" \
    "$bin/nib-update" "$bin/nib-agents" "$bin/nib-open" \
    "$new_opt/former-layout.sh" "$new_opt/carry.before" "$new_opt/carry.after"
  for pair in "${renamed[@]}"; do
    from=$R/${pair% *}
    to=$R/${pair#* }
    if [ -f "$from" ] && ! there "$to"; then mv "$from" "$to" || true; fi
  done
  systemctl daemon-reload || true
  systemctl start --no-block orden-agents.service || true
  say "moved to the new layout; the old one is gone"
}

case "${1:-}" in
  prepare)
    prepare
    ;;
  launch)
    launch
    ;;
  switch)
    switch
    ;;
  *)
    echo "usage: former-layout.sh prepare | launch | switch" >&2
    exit 2
    ;;
esac
