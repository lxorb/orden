#!/usr/bin/env bash
# Puts Linux's manifest in place of the app's, so Cargo and the Tauri CLI build Orden on
# CEF (Chromium) from the same folder and the same files as every other platform.
#
# Linux is the one platform on Tauri 3 and `tauri-runtime-cef`; macOS, Windows and the
# phones stay on Tauri 2, and one manifest cannot hold both (see the `cef` feature in
# apps/desktop/src-tauri/Cargo.toml). apps/desktop/src-tauri/linux/Cargo.toml is written
# from the app's own by scripts/linux-manifest.mjs, with its own lock file beside it.
#
#     bash scripts/linux-cef.sh              # Linux's manifest and lock in place
#     bash scripts/linux-cef.sh back         # the app's own again
#     bash scripts/linux-cef.sh lock         # Linux's lock file brought up to its manifest
#     bash scripts/linux-cef.sh tauri build  # the Tauri CLI at Linux's pin, from apps/desktop
#
# A CI job runs the first in a fresh checkout and never the second. The Tauri 2 CLI in
# package.json cannot build a Tauri 3 app, so a Linux build or `dev` runs the CLI at the
# version of Tauri Linux's manifest pins, through the last line above, which puts the
# manifest in place first.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
app="$here/apps/desktop/src-tauri"
kept="$app/target/.app-manifest"

use() {
  if ! cmp -s "$app/linux/Cargo.toml" "$app/Cargo.toml"; then
    mkdir -p "$kept"
    cp "$app/Cargo.toml" "$kept/Cargo.toml"
    cp "$app/Cargo.lock" "$kept/Cargo.lock"
  fi
  cp "$app/linux/Cargo.toml" "$app/Cargo.toml"
  if [ -f "$app/linux/Cargo.lock" ]; then
    cp "$app/linux/Cargo.lock" "$app/Cargo.lock"
  else
    rm -f "$app/Cargo.lock"
  fi
}

back() {
  if [ -f "$kept/Cargo.toml" ]; then
    cp "$kept/Cargo.toml" "$app/Cargo.toml"
    cp "$kept/Cargo.lock" "$app/Cargo.lock"
    rm -rf "$kept"
  fi
}

case "${1:-use}" in
  use) use ;;
  back) back ;;
  lock)
    use
    trap back EXIT
    (cd "$app" && cargo update --workspace)
    cp "$app/Cargo.lock" "$app/linux/Cargo.lock"
    ;;
  tauri)
    use
    shift
    pin=$(sed -n 's/^tauri = { version = "=\([^"]*\)".*/\1/p' "$app/linux/Cargo.toml" | head -1)
    [ -n "$pin" ] || { echo "no tauri pin in $app/linux/Cargo.toml" >&2; exit 1; }
    cd "$here/apps/desktop"
    exec npx --yes "@tauri-apps/cli@$pin" "$@"
    ;;
  *)
    echo "usage: $0 [use|back|lock|tauri <args>]" >&2
    exit 2
    ;;
esac
