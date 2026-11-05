#!/usr/bin/env bash
# Puts a release's .rpms into the dnf and zypper repository, as one suite, signed.
#
#   APT_KEY_FINGERPRINT=<the signing key, imported into gpg already> \
#   APT_BASE_URL=https://apt.orden.so \
#   APT_PUBLIC_KEY=<its public half; packaging/apt/orden-archive-keyring.asc if unset> \
#     scripts/rpm-repo.sh <stable|unstable> <folder of .rpms> <folder to write into>
#
# The apt repository's bucket, key and address (scripts/apt-repo.sh), under `rpm/`:
#
#   rpm/<suite>/orden-<version>-<release>.<arch>.rpm, each signed
#   rpm/<suite>/repodata/repomd.xml, repomd.xml.asc and what repomd.xml names
#   rpm/orden.repo (stable) or rpm/orden-unstable.repo, the file a reader drops in
#   orden-archive-keyring.asc, which both .repo files name
#
# A suite holds one version, the newest, as an apt suite does; the other suite is never
# touched. See packaging/linux.md, "dnf and zypper".
set -euo pipefail

suite=${1:?stable or unstable}
rpms=${2:?a folder of .rpms}
out=${3:?a folder to write into}
key=${APT_KEY_FINGERPRINT:?the fingerprint of the signing key}
base=${APT_BASE_URL:-https://apt.orden.so}
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

# Each package signed in its header, which dnf and zypper check against the key the
# .repo file names (gpgcheck), and the index signed beside it (repo_gpgcheck).
rpmsign --addsign --define "__gpg $(command -v gpg)" --define "_gpg_name $key" --define '_gpg_digest_algo sha256' "$dir"/*.rpm
# And read back with the published key alone, as a reader's rpm reads them.
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

# gzip rather than zstd, which an older libsolv or dnf cannot read.
createrepo_c --quiet --no-database --general-compress-type=gz --checksum=sha256 "$dir"
gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml"

sed -e "s|@BASE@|$base|g" -e "s|@SUITE@|$suite|g" -e "s|@ID@|$id|g" -e "s|@NAME@|$name|g" \
  "$here/packaging/rpm/orden.repo" >"rpm/$id.repo"
cp "$public" orden-archive-keyring.asc
