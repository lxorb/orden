#!/bin/bash
set -u

dmg="$1"
where="$2"
expect="$3"
cli="$(cd "$(dirname "$0")/.." && pwd)/apps/cli/nib.mjs"
support="$HOME/Library/Application Support/ch.emilvinu.nib"
endpoint="$support/automation.json"
mount="/tmp/nib-image-$where"

hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
source_app="$(find "$mount" -maxdepth 1 -name '*.app' | head -1)"
name="$(basename "$source_app")"
case "$where" in
  applications) folder=/Applications ;;
  home) folder="$HOME/Applications" ;;
  image) folder="$mount" ;;
esac
mkdir -p "$folder"
if [ "$where" != image ]; then
  rm -rf "${folder:?}/$name"
  ditto "$source_app" "$folder/$name"
fi
app="$folder/$name"
echo "running $app"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist"

running() { pgrep -f "$1/Contents/MacOS/" >/dev/null; }

carried() {
  for name in Orden.app nibeditor.app; do
    [ ! -d "$app" ] && [ -d "$folder/$name" ] && app="$folder/$name"
  done
  return 0
}

say_eval() { node "$cli" eval "$1" --yes 2>&1; }

launch() {
  open "$app"
  for _ in $(seq 60); do
    [ -f "$endpoint" ] && node "$cli" verbs >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "the app never answered at $endpoint"
  pgrep -fl "/Contents/MacOS/" || echo "nothing of it is running"
  ls -la "$support" 2>&1 | head
  node "$cli" verbs 2>&1 | head -5
  return 1
}

quit_app() {
  osascript -e 'quit app id "ch.emilvinu.nib"' >/dev/null 2>&1 || true
  for _ in $(seq 20); do running "$app" || return 0; sleep 1; done
  pkill -f "$app/Contents/MacOS/" || true
  sleep 2
}

rm -rf "$support"
launch || exit 1
python3 - "$endpoint" <<'EOF'
import json, sys
path = sys.argv[1]
held = json.load(open(path))
held["eval"] = True
json.dump(held, open(path, "w"))
EOF
quit_app
carried
launch || exit 1
version="$(say_eval "await window.__TAURI_INTERNALS__.invoke('plugin:app|version')")"
echo "running after a quit: $version"
case "$version" in *"$expect"*)
  quit_app
  hdiutil detach "$mount" >/dev/null 2>&1 || true
  echo "updated to $expect on the way out"
  exit 0 ;;
esac

logs() {
  for log in "$HOME/Library/Logs/ch.emilvinu.nib"/*; do
    [ -f "$log" ] && { echo "--- $log"; tail -40 "$log"; }
  done
}
cat "$endpoint"; echo
notice=""
for at in $(seq 120); do
  notice="$(say_eval "document.querySelector('.notice')?.textContent?.trim() ?? ''")"
  case "$notice" in *"$expect"*) break ;; esac
  [ $((at % 20)) = 1 ] && echo "($at) said: $notice"
  [ "$at" = 60 ] && node "$cli" commands run update 2>&1
  sleep 2
done
echo "notice: $notice"
case "$notice" in *"$expect"*) ;; *) echo "no notice offered $expect"; logs; quit_app; exit 1 ;; esac

log_before="$(ls -t "$HOME/Library/Logs/ch.emilvinu.nib" 2>/dev/null | head -1)"
say_eval "[...document.querySelectorAll('.notice .nib-button')].at(-1).click(), 'pressed'"

for _ in $(seq 60); do running "$app" || break; sleep 1; done
back=no
for _ in $(seq 60); do
  if running "$app" || pgrep -f "/Contents/MacOS/nib" >/dev/null; then back=yes; break; fi
  sleep 1
done
echo "came back by itself: $back"
pgrep -fl "/Contents/MacOS/" || true

carried
installed="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null || echo none)"
ls "$folder"
echo "on disk now: $installed"
logs

[ "$back" = yes ] || launch || true
sleep 15
again="$(say_eval "document.querySelector('.notice')?.textContent?.trim() ?? ''")"
version="$(say_eval "await window.__TAURI_INTERNALS__.invoke('plugin:app|version')")"
echo "notice after the restart: '$again'"
echo "running version: $version"
quit_app
hdiutil detach "$mount" >/dev/null 2>&1 || true

verdict=0
[ "$installed" = "$expect" ] || { echo "FAILED ($where): the bundle on disk is $installed, not $expect"; verdict=1; }
case "$again" in *"$expect"*) echo "FAILED ($where): the notice came back after the restart"; verdict=1 ;; esac
case "$version" in *"$expect"*) ;; *) echo "FAILED ($where): the app runs $version, not $expect"; verdict=1 ;; esac
[ "$back" = yes ] || { echo "FAILED ($where): Restart now did not start the app again"; verdict=1; }
exit $verdict
