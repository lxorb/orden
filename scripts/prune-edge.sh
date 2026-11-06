#!/usr/bin/env bash
# Takes off the rolling release one side's files that this build did not put there: the
# last build's, whose names carry its version. Two workflows fill `edge`, release.yml the
# desktop's files and publish-mobile.yml the phones' (an .apk, the simulator's .app.zip),
# and each takes off only its own, so neither takes the other's (#669).
#
#   scripts/prune-edge.sh edge desktop <names   # this build's file names, one a line
#
# GitHub answers a delete with a 500 now and then, having deleted the file or not
# (2026-11-05, which left the build's apt, rpm and snap unpublished): a refused delete is
# tried again, and is done once the file is gone.
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
