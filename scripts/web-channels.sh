#!/usr/bin/env bash
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
find "$unstable" -mindepth 1 -maxdepth 1 ! -name assets ! -name _headers -exec cp -R {} "$stable/_unstable/" \;

echo "unstable: $added files added to assets/, $shared already there, pages in _unstable/"
