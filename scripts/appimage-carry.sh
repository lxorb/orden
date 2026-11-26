#!/usr/bin/env bash

set -euo pipefail

image=$(realpath "$1")
shift
packer=$(find "${XDG_CACHE_HOME:-$HOME/.cache}/tauri" "$PWD/apps/desktop" -name quick-sharun.sh -print -quit 2>/dev/null || true)
[ -n "$packer" ] || { echo "::error::no quick-sharun.sh: the AppImage was not made by this bundler"; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
here=$PWD
cd "$work"

"$image" --appimage-extract > /dev/null
while [ $# -ge 2 ]; do
  install -D -m "$([ -x "$here/$1" ] && echo 755 || echo 644)" "$here/$1" "squashfs-root/$2"
  echo "carried $1 to $2 in $(basename "$image")"
  shift 2
done

APPDIR="$work/squashfs-root" OUTPATH="$work/out" OUTNAME="$(basename "$image")" sh "$packer" --make-appimage > packed.log 2>&1 ||
  { cat packed.log; exit 1; }
mv "$work/out/$(basename "$image")" "$image"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$image.sig" ]; then
  rm "$image.sig"
  bash "$here/scripts/linux-cef.sh" tauri signer sign "$image" > /dev/null
  echo "signed again: $(basename "$image").sig"
fi
