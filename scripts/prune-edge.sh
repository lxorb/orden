#!/usr/bin/env bash
set -euo pipefail

tag=${1:?usage: prune-edge.sh <tag> <desktop|phone>}
side=${2:?usage: prune-edge.sh <tag> <desktop|phone>}
case "$side" in desktop | phone) ;; *) echo "prune-edge.sh: no side $side" >&2; exit 2 ;; esac
kept=$(cat)

gh release view "$tag" --json assets --jq '.assets[].name' | while read -r name; do
  case "$name" in *.apk | *.app.zip) of=phone ;; *) of=desktop ;; esac
  [ "$of" = "$side" ] || continue
  grep -qxF "$name" <<<"$kept" && continue
  for attempt in 1 2 3; do
    gh release delete-asset "$tag" "$name" --yes && break
    gh release view "$tag" --json assets --jq '.assets[].name' | grep -qxF "$name" || break
    [ "$attempt" -lt 3 ] || exit 1
    sleep 10
  done
done
