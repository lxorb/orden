#!/usr/bin/env bash
# Puts the unstable web build beside the release's, in the release's dist, so that
# one Worker deploy serves both (services/sync/src/channel.ts, #424).
#
#   scripts/web-channels.sh <release dist> <unstable dist>
#
# The unstable build's bundle goes into the release's `assets/`. Every name in there
# carries the hash of its bytes, so a name both builds wrote is the same file, and the
# folder stays one the edge serves without the Worker. A name written twice with
# different bytes would mean that is no longer true, and stops the deploy rather than
# serving one build the other's file.
#
# Everything else the unstable build wrote - its pages and the files of its `public/` -
# goes under `_unstable/`, which is where the Worker looks for them.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <release dist> <unstable dist>" >&2
  exit 2
fi

stable=$1
unstable=$2

for dist in "$stable" "$unstable"; do
  if [ ! -f "$dist/index.html" ]; then
    echo "$dist has no index.html; build it first" >&2
    exit 1
  fi
done

if [ -e "$stable/_unstable" ]; then
  echo "$stable already holds an unstable build" >&2
  exit 1
fi

added=0
shared=0
if [ -d "$unstable/assets" ]; then
  while IFS= read -r -d '' file; do
    name=${file#"$unstable/assets/"}
    target="$stable/assets/$name"
    if [ -e "$target" ]; then
      if ! cmp -s "$file" "$target"; then
        echo "assets/$name differs between the two builds; its name should say so" >&2
        exit 1
      fi
      shared=$((shared + 1))
    else
      mkdir -p "$(dirname "$target")"
      cp "$file" "$target"
      added=$((added + 1))
    fi
  done < <(find "$unstable/assets" -type f -print0)
fi

mkdir "$stable/_unstable"
find "$unstable" -mindepth 1 -maxdepth 1 ! -name assets -exec cp -R {} "$stable/_unstable/" \;

echo "unstable: $added files added to assets/, $shared already there, pages in _unstable/"
