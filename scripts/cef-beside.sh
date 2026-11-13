#!/usr/bin/env bash
set -euo pipefail

dir="${1:?usage: $0 <folder holding the built binary>}"

case "$(uname -s)" in
  Darwin) exit 0 ;;
  MINGW* | MSYS* | CYGWIN*) library=libcef.dll ;;
  *) library=libcef.so ;;
esac

if [ -e "$dir/$library" ]; then
  echo "$library is beside the binary in $dir"
  exit 0
fi

distribution="${CEF_PATH:-}"
if [ -z "$distribution" ] || [ ! -e "$distribution/$library" ]; then
  target=$(cd "$dir/.." && pwd)
  while [ "$target" != / ] && [ "$(basename "$target")" != target ]; do
    target=$(dirname "$target")
  done
  recorded=$(find "$target" -path '*cef-dll-sys-*' -name output -type f 2>/dev/null | head -1 || true)
  distribution=""
  if [ -n "$recorded" ]; then
    distribution=$(sed -n 's/^cargo:\{1,2\}metadata=CEF_DIR=//p' "$recorded" | tail -1)
    if command -v cygpath >/dev/null 2>&1 && [ -n "$distribution" ]; then
      distribution=$(cygpath -u "$distribution")
    fi
  fi
  echo "cef-beside: build output ${recorded:-none}, CEF_DIR '${distribution:-}'"
fi

if [ -z "$distribution" ] || [ ! -e "$distribution/$library" ]; then
  echo "no CEF distribution with $library was found for $dir" >&2
  ls "$dir" >&2 || true
  exit 1
fi

cp -R "$distribution"/. "$dir"/
echo "CEF copied from $distribution to $dir"
