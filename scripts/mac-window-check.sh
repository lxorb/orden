#!/bin/bash
# Where a Mac puts Orden's window when it opens (#679, #343): the first time, with no
# place kept, it has to sit at the top of the screen's working area - straight under
# the menu bar, with no strip of desktop over it - and across the middle; a place the
# reader left it in has to be where it opens next. On a runner that is nobody's
# machine, under an identifier of its own. Usage: mac-window-check.sh <the built .app>
set -u

app="$1"
identifier="ch.emilvinu.nib.probe.mac-window"
cli="$(cd "$(dirname "$0")/.." && pwd)/apps/cli/nib.mjs"
support="$HOME/Library/Application Support/$identifier"
export NIB_ENDPOINT="$support/automation.json"
shots="${SHOTS:-mac-window-shots}"
mkdir -p "$shots"

say_eval() { node "$cli" eval "$1" --yes 2>&1; }
running() { pgrep -f "$app/Contents/MacOS/" >/dev/null; }
up() {
  for _ in $(seq 60); do
    [ -f "$NIB_ENDPOINT" ] && running && node "$cli" verbs >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "nothing answered from $app"
  return 1
}
quit_app() {
  osascript -e "quit app id \"$identifier\"" >/dev/null 2>&1 || true
  for _ in $(seq 20); do running || return 0; sleep 1; done
  pkill -f "$app/Contents/MacOS/" || true
  sleep 2
}

# Where the window is against the working area of the screen it is on, in points: the
# strip of desktop over it, and how far off the middle it is across.
where='(async () => {
  const i = window.__TAURI_INTERNALS__
  const at = await i.invoke("plugin:window|outer_position", { label: "main" })
  const size = await i.invoke("plugin:window|outer_size", { label: "main" })
  const screen = await i.invoke("plugin:window|current_monitor", { label: "main" })
  const scale = screen.scaleFactor
  const work = screen.workArea
  const over = (at.y - work.position.y) / scale
  const left = (at.x - work.position.x) / scale
  const right = (work.position.x + work.size.width - at.x - size.width) / scale
  return JSON.stringify({ over, left, right, x: at.x / scale, y: at.y / scale, width: size.width / scale, height: size.height / scale, work: { x: work.position.x / scale, y: work.position.y / scale, width: work.size.width / scale, height: work.size.height / scale } })
})()'

read_place() { say_eval "await $where" | tail -1; }

# The eval verb, for the questions below, and no place kept.
rm -rf "$support"
open "$app"
up || exit 1
python3 - "$NIB_ENDPOINT" <<'PY'
import json, sys
path = sys.argv[1]
held = json.load(open(path))
held["eval"] = True
json.dump(held, open(path, "w"))
PY
quit_app
rm -f "$support/window.json"

verdict=0
open "$app"
up || exit 1
sleep 2
first="$(read_place)"
echo "opened with no place kept: $first"
screencapture -x "$shots/first.png" 2>/dev/null || true
python3 - "$first" <<'PY' || verdict=1
import json, sys
said = json.loads(sys.argv[1])
over, left, right = said["over"], said["left"], said["right"]
problems = []
if abs(over) > 1:
    problems.append(f"{over:.0f} points of desktop over the window, under the menu bar")
if abs(left - right) > 2:
    problems.append(f"{left:.0f} points left of it and {right:.0f} right: not across the middle")
for one in problems:
    print("FAILED:", one)
sys.exit(1 if problems else 0)
PY

# Somewhere of the reader's own, as the last close wrote it down, and it is where the
# next launch opens.
quit_app
printf '{"x":140,"y":220,"width":600,"height":400,"maximized":false}' > "$support/window.json"
open "$app"
up || exit 1
sleep 2
again="$(read_place)"
echo "opened again after being moved: $again"
screencapture -x "$shots/again.png" 2>/dev/null || true
python3 - "$again" <<'PY' || verdict=1
import json, sys
said = json.loads(sys.argv[1])
off = abs(said["x"] - 140) + abs(said["y"] - 220)
if off > 2:
    print(f"FAILED: moved to 140, 220 and opened again at {said['x']:.0f}, {said['y']:.0f}")
    sys.exit(1)
PY

quit_app
rm -rf "$support"
[ "$verdict" = 0 ] && echo "the window opened under the menu bar across the middle, and again where it was left"
exit $verdict
