#!/usr/bin/env bash
set -euo pipefail

repo=${1:?a checkout of lxorb/apt}
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$repo" && pwd)
postinst="$here/apps/desktop/src-tauri/linux/postinst"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for suite in stable unstable; do
  shopt -s nullglob
  debs=("$repo/pool/$suite"/*.deb)
  shopt -u nullglob
  [ ${#debs[@]} -gt 0 ] || continue
  out="$work/$suite"
  mkdir -p "$out"
  for deb in "${debs[@]}"; do
    case "$(dpkg-deb --field "$deb" Version)" in
      *+moved) cp "$deb" "$out/" ;;
      *)
        tree="$work/tree"
        rm -rf "$tree"
        dpkg-deb -R "$deb" "$tree"
        version=$(dpkg-deb --field "$deb" Version)
        sed -i "s/^Version: .*/Version: $version+moved/" "$tree/DEBIAN/control"
        if [ -f "$tree/DEBIAN/postinst" ]; then
          { head -n 1 "$tree/DEBIAN/postinst"; sed -e '1d' -e '/^exit 0$/d' "$postinst"; tail -n +2 "$tree/DEBIAN/postinst"; } >"$tree/DEBIAN/postinst.next"
          mv "$tree/DEBIAN/postinst.next" "$tree/DEBIAN/postinst"
        else
          cp "$postinst" "$tree/DEBIAN/postinst"
        fi
        chmod 0755 "$tree/DEBIAN/postinst"
        dpkg-deb --root-owner-group -b "$tree" "$out/$(basename "$deb" .deb)+moved.deb" >/dev/null
        echo "$suite: $version -> $version+moved"
        ;;
    esac
  done
  APT_BASE_URL=https://apt.orden.so bash "$here/scripts/apt-repo.sh" "$suite" "$out" "$repo"
done

touch "$repo/.nojekyll"
