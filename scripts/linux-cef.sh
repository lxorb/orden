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
#     bash scripts/linux-cef.sh cef [dir]    # the CEF distribution the pin names, in dir
#
# A CI job runs the first in a fresh checkout and never the second. The Tauri 2 CLI in
# package.json cannot build a Tauri 3 app, so a Linux build or `dev` runs the CLI at the
# version of Tauri Linux's manifest pins, through the last line above, which puts the
# manifest in place first.
#
# **The CEF distribution.** The `cef` crate's build script downloads the engine itself
# where CEF_PATH names none, and the Tauri bundler copies it into each package from
# there. `cef` lays it out beforehand instead, from the same server and checked against
# the digest the server's index gives, in `dir` (default ~/.cache/orden-cef), and says
# CEF_PATH for the rest of a CI job. One thing is added: two empty libraries under the
# names of ANGLE's, libEGL.so and libGLESv2.so. CEF 154 links ANGLE into libcef.so on
# Linux and no longer ships the two, and the bundler (tauri-bundler 3.0.0-alpha.4)
# still copies them into the .deb and .rpm by name, failing on a file that is not there.
# Chromium loads them from beside libcef.so only when ANGLE is not linked in, so they
# are never opened. Take them out once the bundler stops naming them.
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
  cef)
    dir="${2:-$HOME/.cache/orden-cef}"
    case "$(uname -m)" in
      x86_64) platform=linux64 ;;
      aarch64) platform=linuxarm64 ;;
      *) echo "no CEF for $(uname -m)" >&2; exit 1 ;;
    esac
    # The crate's version is the engine's after the plus: 154.5.0+154.0.34 is CEF 154.0.34.
    lock_version=$(sed -n '/^name = "cef"$/{n;s/^version = "\(.*\)"$/\1/p}' "$app/linux/Cargo.lock" | head -1)
    engine="${lock_version#*+}"
    if [ ! -f "$dir/archive.json" ] || ! grep -q "cef_binary_$engine+" "$dir/archive.json"; then
      read -r name sha1 < <(curl -fsSL https://cef-builds.spotifycdn.com/index.json | python3 -c '
import json, sys
platform, engine = sys.argv[1], sys.argv[2]
for one in json.load(sys.stdin)[platform]["versions"]:
    if one["cef_version"].split("+")[0] == engine:
        archive = next(f for f in one["files"] if f["type"] == "minimal")
        print(archive["name"], archive["sha1"])
        break
' "$platform" "$engine") || true
      [ -n "${name:-}" ] || { echo "the CEF index has no $engine for $platform" >&2; exit 1; }
      work=$(mktemp -d)
      trap 'rm -rf "$work"' EXIT
      curl -fsSL -o "$work/$name" "https://cef-builds.spotifycdn.com/${name//+/%2B}"
      echo "$sha1  $work/$name" | sha1sum -c -
      tar -xjf "$work/$name" -C "$work"
      root="$work/${name%.tar.bz2}"
      rm -rf "$dir"
      mkdir -p "$dir"
      cp -a "$root"/Release/. "$root"/Resources/. "$dir"/
      cp -a "$root"/include "$root"/cmake "$root"/libcef_dll "$root"/CMakeLists.txt "$dir"/
      printf '{"type":"minimal","name":"%s","sha1":"%s"}\n' "$name" "$sha1" > "$dir/archive.json"
    fi
    for angle in libEGL.so libGLESv2.so; do
      [ -e "$dir/$angle" ] || cc -shared -o "$dir/$angle" -x c /dev/null
    done
    echo "CEF_PATH=$dir" >>"${GITHUB_ENV:-/dev/null}"
    echo "CEF $engine for $platform in $dir"
    ;;
  *)
    echo "usage: $0 [use|back|lock|tauri <args>|cef [dir]]" >&2
    exit 2
    ;;
esac
