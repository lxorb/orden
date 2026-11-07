#!/usr/bin/env bash
set -euo pipefail

out=${OUT:-$PWD/x11-out}
mkdir -p "$out"
unset WAYLAND_DISPLAY GDK_BACKEND
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
export HOME=${HOME:-/root}
export DISPLAY=:77

Xvfb "$DISPLAY" -screen 0 1600x1000x24 > "$out/xvfb.log" 2>&1 &
xvfb=$!
for _ in $(seq 50); do xdpyinfo > /dev/null 2>&1 && break; sleep 0.1; done
here=$(cd "$(dirname "$0")" && pwd)
wm=""
if [ "${KWIN:-0}" = 1 ]; then
  dbus-update-activation-environment DISPLAY XDG_RUNTIME_DIR 2>/dev/null || true
  KWIN_COMPOSE=N QT_QPA_PLATFORM=xcb kwin_x11 --replace > "$out/kwin.log" 2>&1 &
  wm=$!
  for _ in $(seq 40); do
    xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id' && break
    sleep 0.25
  done
  if ! kill -0 "$wm" 2>/dev/null || ! xprop -root _NET_SUPPORTING_WM_CHECK | grep -q 'window id'; then
    echo "::error::KWin did not start"
    cat "$out/kwin.log"
    exit 1
  fi
  echo "KWin is the window manager: $(xprop -root _NET_SUPPORTING_WM_CHECK)"
fi
site=""
if [ "${POPUP:-0}" = 1 ] || [ "${FLASH:-0}" = 1 ] || [ "${ZOOM:-0}" = 1 ]; then
  mkdir -p "$out/site"
  printf '<!doctype html><title>one colour</title><style>html,body{margin:0;height:100%%;background:#ff00ff}</style>' > "$out/site/index.html"
  [ "${FLASH:-0}" = 1 ] && printf '<!doctype html><title>dark</title><meta name="color-scheme" content="dark"><style>html,body{margin:0;height:100%%;background:#1e1e1e}</style>' > "$out/site/index.html"
  python3 -m http.server 8765 --bind 127.0.0.1 --directory "$out/site" > "$out/site.log" 2>&1 &
  site=$!
  set -- "$@" http://127.0.0.1:8765/
fi
if [ "${DRAG:-0}" = 1 ] || [ "${POPUP:-0}" = 1 ] || [ "${FLASH:-0}" = 1 ] || [ "${TREE:-0}" = 1 ] || [ "${ZOOM:-0}" = 1 ]; then
  config="${XDG_CONFIG_HOME:-$HOME/.config}/${DRIVEN_ID:-so.orden.Orden}"
  mkdir -p "$config"
  printf '{"port":0,"secret":"%s","eval":true,"pid":0}' "$(python3 -c 'import secrets; print(secrets.token_hex(32))')" > "$config/automation.json"
  chmod 600 "$config/automation.json"
fi

"$@" > "$out/orden.log" 2>&1 &
app=$!

status=0
mapped=""
for _ in $(seq 120); do
  if ! kill -0 "$app" 2>/dev/null; then
    echo "::error::Orden ended at start under X11"
    status=1
    break
  fi
  if xwininfo -root -tree 2>/dev/null | grep -qiE '"Orden|"Read me|"nib'; then
    mapped=yes
    break
  fi
  sleep 0.5
done
[ "$status" = 0 ] && [ -z "$mapped" ] && { echo "::error::no window mapped under X11 in 60 s"; status=1; }
if [ "$status" = 0 ]; then
  echo "the window mapped under X11:"
  xwininfo -root -tree 2>/dev/null | grep -iE 'orden|nib|read me' | head || true
  [ -n "${config:-}" ] && { python3 "$here/crash_told.py" "$config" || true; }
  sleep 10
  strangers=$(xwininfo -root -children 2>/dev/null | python3 -c '
import re, subprocess, sys
for one in re.finditer(r"^\s+(0x[0-9a-f]+) \"(.*)\": \(\"([^\"]*)\"", sys.stdin.read(), re.M):
    shown = subprocess.run(["xwininfo", "-id", one.group(1)], capture_output=True, text=True).stdout
    if "IsViewable" in shown and (one.group(3) != sys.argv[1] or one.group(2).endswith("Chromium")):
        print(one.group(0).strip())
' "${CLASS:-orden}" || true)
  if [ -n "$strangers" ]; then
    echo "::error::a window not under the desktop entry's name, ${CLASS:-orden}, or Chromium's own:"
    echo "$strangers"
    status=1
  fi
  kill -0 "$app" 2>/dev/null || { echo "::error::Orden ended after its window mapped"; status=1; }
fi
if [ "$status" = 0 ] && [ "${IDLE:-0}" = 1 ]; then
  sleep 15
  python3 "$here/idle-cpu.py" "$app" 20 | tee "$out/idle.txt"
  [ "${PIPESTATUS[0]}" = 0 ] || status=1
  find "$HOME" -path "*${DRIVEN_ID:-so.orden.Orden}*" \( -name orden.log -o -name nib.log \) -exec grep -hE ' (pump|gpu): ' {} + 2>/dev/null | tee -a "$out/idle.txt" || true
fi

if [ "$status" = 0 ] && [ "${FLASH:-0}" = 1 ]; then
  python3 "$here/flash-drive.py" x11 "$out" "$app" || status=1
fi
if [ "$status" = 0 ] && [ "${POPUP:-0}" = 1 ]; then
  python3 "$here/popup-drive.py" x11 "$out" "$app" || status=1
fi
if [ "$status" = 0 ] && [ "${TREE:-0}" = 1 ]; then
  python3 "$here/page-drive.py" tree "$out" || status=1
fi
if [ "$status" = 0 ] && [ "${BACK:-0}" = 1 ]; then
  python3 "$here/page-drive.py" back "$out" || status=1
fi
if [ "$status" = 0 ] && [ "${ZOOM:-0}" = 1 ]; then
  python3 "$here/page-drive.py" zoom "$out" || status=1
fi
if [ "$status" = 0 ] && [ "${DRAG:-0}" = 1 ]; then
  python3 "$here/window-drag.py" x11 "$out" "$app" || status=1
  if [ -n "$wm" ] && ! kill -0 "$wm" 2>/dev/null; then
    echo "::error::KWin ended during the drive"
    status=1
  fi
fi
import -window root "$out/x11.png" 2>/dev/null || xwd -root -silent | convert xwd:- "$out/x11.png" || true
kill "$app" 2>/dev/null || true
wait "$app" 2>/dev/null || true
[ -n "$wm" ] && kill "$wm" 2>/dev/null || true
kill "$xvfb" 2>/dev/null || true
[ -n "$site" ] && kill "$site" 2>/dev/null || true
find "$HOME" -path "*${DRIVEN_ID:-so.orden.Orden}*" \( -name orden.log -o -name nib.log \) -exec cp {} "$out/app.log" \; 2>/dev/null || true
[ -f "$out/app.log" ] && { echo "::group::the app's log"; cat "$out/app.log"; echo "::endgroup::"; }
echo "::group::orden's output"
cat "$out/orden.log"
echo "::endgroup::"
if grep -nE 'SIGABRT|Aborted|core dumped|Check failed|FATAL' "$out/orden.log"; then
  echo "::error::Orden or its engine aborted"
  status=1
fi
exit $status
