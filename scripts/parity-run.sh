#!/usr/bin/env bash
set -euo pipefail
script=$1
shift
name=$(basename "$script" -drive.py)
mkdir -p "parity/$name"
drive=("$script" --exe "$EXE" --identifier "$IDENTIFIER" --out "parity/$name" "$@")
seated() {
  bash scripts/ci-apt.sh xserver-xorg-core xserver-xorg-video-dummy xserver-xorg-input-libinput dmz-cursor-theme
  "$PY" -m pip install --quiet evdev
  sudo modprobe uinput || true
  sudo chmod 666 /dev/uinput
  conf="$RUNNER_TEMP/parity-xorg.conf"
  printf '%s\n' \
    'Section "ServerFlags"' '  Option "AutoAddDevices" "true"' '  Option "AllowEmptyInput" "true"' 'EndSection' \
    'Section "Device"' '  Identifier "dummy"' '  Driver "dummy"' '  VideoRam 256000' 'EndSection' \
    'Section "Screen"' '  Identifier "screen"' '  Device "dummy"' '  DefaultDepth 24' \
    '  SubSection "Display"' '    Depth 24' '    Virtual 1600 1000' '  EndSubSection' 'EndSection' \
    'Section "InputClass"' '  Identifier "pads"' '  MatchIsTouchpad "on"' '  Driver "libinput"' 'EndSection' >"$conf"
  sudo Xorg :7 -noreset -config "$conf" -logfile "$RUNNER_TEMP/parity-xorg.log" &
  xorg=$!
  sleep 4
  said=0
  DISPLAY=:7 XCURSOR_THEME=DMZ-White XCURSOR_SIZE=24 dbus-run-session -- bash -c 'openbox & sleep 1; exec "$0" "$@"' "$PY" "${drive[@]}" || said=$?
  sudo kill "$xorg" || true
  sudo grep -i -E "touchpad|libinput|gesture|\(EE\)" "$RUNNER_TEMP/parity-xorg.log" | tail -20 || true
  return "$said"
}
case "$(uname -s)" in
  Linux)
    if [ "$name" = parity-pointer ] && [ -n "${RUNNER_TEMP:-}" ]; then
      seated
    else
      xvfb-run -a -s '-screen 0 1600x1000x24' dbus-run-session -- bash -c 'openbox & sleep 1; exec "$0" "$@"' "$PY" "${drive[@]}"
    fi
    ;;
  *) "$PY" "${drive[@]}" ;;
esac
