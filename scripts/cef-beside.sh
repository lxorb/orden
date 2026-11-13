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

distribution=$(sed -n 's/^cargo:\{1,2\}metadata=CEF_DIR=//p' "$dir"/build/cef-dll-sys-*/output 2>/dev/null | tail -1)
if command -v cygpath >/dev/null 2>&1 && [ -n "$distribution" ]; then
  distribution=$(cygpath -u "$distribution")
fi
if [ -z "$distribution" ] || [ ! -e "$distribution/$library" ]; then
  echo "no CEF distribution is recorded under $dir/build (CEF_DIR: '${distribution:-}')" >&2
  exit 1
fi

cp -R "$distribution"/. "$dir"/
echo "CEF copied from $distribution to $dir"
