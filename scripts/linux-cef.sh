#!/usr/bin/env bash
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
    sharun=https://raw.githubusercontent.com/FabianLars/Anylinux-AppImages/3e280d1b2270fecfcb2c2c823b490c782ecf1277/useful-tools/lib
    export ANYLINUX_LIB_SOURCE="${ANYLINUX_LIB_SOURCE:-$sharun/anylinux.c}"
    export GTK_CLASS_FIX_SOURCE="${GTK_CLASS_FIX_SOURCE:-$sharun/gtk-class-fix.c}"
    case "$(uname -s):${1:-}" in
      Linux:build | Linux:bundle)
        lib="/usr/lib/$(uname -m)-linux-gnu"
        files=""
        for module in libsoftokn3.so libfreeblpriv3.so libfreebl3.so libnssckbi.so libnssdbm3.so; do
          for at in "$lib/$module" "$lib/nss/$module"; do
            if [ -f "$at" ]; then
              files="$files${files:+,}\"/usr/lib/$module\":\"$(readlink -f "$at")\""
              break
            fi
          done
        done
        for module in "$lib"/libEGL_mesa.so.0 "$lib"/libGLX_mesa.so.0 "$lib"/libgallium-*.so "$lib"/dri/*_dri.so; do
          [ -f "$module" ] || continue
          name="${module#"$lib"/}"
          files="$files${files:+,}\"/usr/lib/$name\":\"$(readlink -f "$module")\""
        done
        vendor=/usr/share/glvnd/egl_vendor.d/50_mesa.json
        [ -f "$vendor" ] && files="$files${files:+,}\"/share/glvnd/egl_vendor.d/50_mesa.json\":\"$vendor\""
        [ -n "$files" ] && set -- "$@" --config "{\"bundle\":{\"linux\":{\"appimage\":{\"files\":{$files}}}}}"
        ;;
    esac
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
