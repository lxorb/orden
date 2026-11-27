#!/usr/bin/env bash
set -euo pipefail
dir=${1:-assets}
mkdir -p "$dir"
cd "$dir"
[ -f video.mp4 ] || ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1920x1080:rate=60 -t 20 -c:v libx264 -preset fast -b:v 6M -pix_fmt yuv420p video.mp4
[ -f video.webm ] || ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1920x1080:rate=60 -t 20 -c:v libvpx-vp9 -b:v 4M -deadline realtime -cpu-used 8 -row-mt 1 -pix_fmt yuv420p video.webm
latest() {
  curl -fsSL ${GITHUB_TOKEN:+-H "authorization: Bearer $GITHUB_TOKEN"} "https://api.github.com/repos/$1/releases?per_page=20" |
    python3 -c 'import json,sys,re
for r in json.load(sys.stdin):
    if r["prerelease"]: continue
    for a in r["assets"]:
        if re.search(sys.argv[1], a["name"]):
            print(a["browser_download_url"]); sys.exit()' "$2"
}
take() {
  [ -d "$1" ] && return 0
  url=$(latest "$2" "$3")
  echo "$1: $url"
  curl -fsSL -o "$1.zip" "$url"
  mkdir -p "$1.tmp"
  unzip -q "$1.zip" -d "$1.tmp"
  if [ -f "$1.tmp/manifest.json" ]; then mv "$1.tmp" "$1"; else mv "$1.tmp"/*/ "$1"; rm -rf "$1.tmp"; fi
  rm "$1.zip"
}
take ubo gorhill/uBlock 'chromium\.zip$'
take ubol uBlockOrigin/uBOL-home 'chromium\.zip$'
ls -la
