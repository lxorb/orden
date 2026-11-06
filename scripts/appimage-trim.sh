#!/usr/bin/env bash

set -euo pipefail

image=$(realpath "$1")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

offset=$("$image" --appimage-offset)
"$image" --appimage-extract > /dev/null

echo "taken out of $(basename "$image"):"
find squashfs-root \( -name 'libwayland-*' -o -name 'libxkbcommon*' -o -name 'libEGL*' \
  -o -name 'libGL*' -o -name 'libgbm*' -o -name 'libdrm*' \) -prune -print -exec rm -rf {} +
find squashfs-root -path '*gstreamer-1.0/*' \( -name 'libgstjack.so' -o -name 'libgstfluidsynthmidi.so' \)   -print -delete

compression=$(unsquashfs -s -o "$offset" "$image" | sed -n 's/^Compression //p' | head -1)
head -c "$offset" "$image" > runtime
mksquashfs squashfs-root squashfs -root-owned -noappend -quiet -comp "${compression:-gzip}"
cat runtime squashfs > trimmed
chmod +x trimmed
mv trimmed "$image"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$image.sig" ]; then
  rm "$image.sig"
  pnpm --dir "$OLDPWD" --filter @orden/desktop exec tauri signer sign "$image" > /dev/null
  echo "signed again: $(basename "$image").sig"
fi
