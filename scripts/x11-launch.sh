#!/usr/bin/env bash
# Orden started under a bare X server, Xvfb, with no compositor and no Wayland at all:
# the session an X11 desktop gives it. The window has to map and the app has to stay up,
# and a picture of the screen is kept. #427 was the AppImage's own WebKitGTK aborting on
# Fedora 44 at start; this is that start, under X11.
#
# With KWIN=1, KWin is the window manager on that server, and with DRAG=1 the window is
# then moved by its tab strip, resized by its edge and maximised by a double click on the
# strip with xdotool's pointer (scripts/window-drag.py, #427).
#
# Run inside `dbus-run-session`, with the command that starts Orden:
#
#   dbus-run-session -- scripts/x11-launch.sh /path/to/AppRun
#
# Everything it saw is left in $OUT (default ./x11-out).
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
  # KWin's own services, started by the session bus, on the same display; without it its
  # shortcut service aborts and KWin goes with it.
  dbus-update-activation-environment DISPLAY XDG_RUNTIME_DIR 2>/dev/null || true
  # Without compositing, which a server with no GPU has nothing to do it with.
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
if [ "${DRAG:-0}" = 1 ]; then
  # The app's endpoint open to `eval`, for where its tab strip is.
  config="${XDG_CONFIG_HOME:-$HOME/.config}/ch.emilvinu.nib"
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
  xwininfo -root -tree | grep -iE 'orden|nib|read me' | head
  # Up for a while, and still up after it.
  sleep 10
  kill -0 "$app" 2>/dev/null || { echo "::error::Orden ended after its window mapped"; status=1; }
fi
# Idle, before anything is done with it: what it costs the CPU (#427, scripts/idle-cpu.py).
if [ "$status" = 0 ] && [ "${IDLE:-0}" = 1 ]; then
  sleep 15
  python3 "$here/idle-cpu.py" "$app" 20 | tee "$out/idle.txt"
  [ "${PIPESTATUS[0]}" = 0 ] || status=1
  find "$HOME" -path '*ch.emilvinu.nib*' -name nib.log -exec grep -hE ' (pump|gpu): ' {} + 2>/dev/null | tee -a "$out/idle.txt" || true
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
find "$HOME" -path '*ch.emilvinu.nib*' -name 'nib.log' -exec cp {} "$out/nib.log" \; 2>/dev/null || true
[ -f "$out/nib.log" ] && { echo "::group::nib.log"; cat "$out/nib.log"; echo "::endgroup::"; }
echo "::group::orden's output"
cat "$out/orden.log"
echo "::endgroup::"
if grep -nE 'SIGABRT|Aborted|core dumped|Check failed|FATAL' "$out/orden.log"; then
  echo "::error::Orden or its engine aborted"
  status=1
fi
exit $status
