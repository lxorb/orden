#!/usr/bin/env bash
set -euo pipefail

suite=${1:?stable or unstable}
rpms=${2:?a folder of .rpms}
out=${3:?a folder to write into}
key=${APT_KEY_FINGERPRINT:?the fingerprint of the signing key}
base=${RPM_BASE_URL:-https://rpm.orden.so}
public=${APT_PUBLIC_KEY:-}
base=${base%/}

case "$suite" in
  stable) id=orden name=Orden ;;
  unstable) id=orden-unstable name='Orden (unstable)' ;;
  *)
    echo "the suite is stable or unstable, not $suite" >&2
    exit 1
    ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
public=$(realpath "${public:-$here/packaging/apt/orden-archive-keyring.asc}")
rpms=$(cd "$rpms" && pwd)
mkdir -p "$out"
cd "$out"

shopt -s nullglob
found=("$rpms"/*.rpm)
if [ ${#found[@]} -eq 0 ]; then
  echo "no .rpm in $rpms" >&2
  exit 1
fi

dir="rpm/$suite"
rm -rf "$dir"
mkdir -p "$dir"
for rpm in "${found[@]}"; do
  file=$(rpm -qp --queryformat '%{NAME}-%{VERSION}-%{RELEASE}.%{ARCH}.rpm' "$rpm")
  cp "$rpm" "$dir/$file"
  echo "$suite: $file"
done

rpmsign --addsign --define "__gpg $(command -v gpg)" --define "_gpg_name $key" --define '_gpg_digest_algo sha256' "$dir"/*.rpm
keys=$(mktemp -d)
trap 'rm -rf "$keys"' EXIT
rpmkeys --dbpath "$keys" --import "$public"
for rpm in "$dir"/*.rpm; do
  rpmkeys --dbpath "$keys" --checksig "$rpm" | grep -q ': digests signatures OK$' || {
    rpmkeys --dbpath "$keys" --checksig -v "$rpm" >&2
    echo "$rpm is not signed by the published key" >&2
    exit 1
  }
done

createrepo_c --quiet --no-database --general-compress-type=gz --checksum=sha256 "$dir"
gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml"

sed -e "s|@BASE@|$base|g" -e "s|@SUITE@|$suite|g" -e "s|@ID@|$id|g" -e "s|@NAME@|$name|g" \
  "$here/packaging/rpm/orden.repo" >"rpm/$id.repo"
cp "$public" rpm/orden-archive-keyring.asc
