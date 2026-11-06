#!/usr/bin/env bash
set -euo pipefail

suite=${1:?stable or unstable}
debs=${2:?a folder of .debs}
repo=${3:?a checkout of the repository}
key=${APT_KEY_FINGERPRINT:?the fingerprint of the signing key}
base=${APT_BASE_URL:-https://apt.orden.so}
base=${base%/}

case "$suite" in
  stable | unstable) ;;
  *)
    echo "the suite is stable or unstable, not $suite" >&2
    exit 1
    ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
debs=$(cd "$debs" && pwd)
mkdir -p "$repo"
cd "$repo"

shopt -s nullglob
found=("$debs"/*.deb)
if [ ${#found[@]} -eq 0 ]; then
  echo "no .deb in $debs" >&2
  exit 1
fi

pool="pool/$suite"
rm -rf "$pool"
mkdir -p "$pool"
for deb in "${found[@]}"; do
  name=$(dpkg-deb --field "$deb" Package)
  version=$(dpkg-deb --field "$deb" Version)
  arch=$(dpkg-deb --field "$deb" Architecture)
  cp "$deb" "$pool/${name}_${version}_${arch}.deb"
  echo "$suite: $name $version $arch"
done

dists="dists/$suite"
rm -rf "$dists"
for arch in amd64 arm64; do
  dir="$dists/main/binary-$arch"
  mkdir -p "$dir"
  apt-ftparchive --arch "$arch" packages "$pool" >"$dir/Packages"
  gzip -9 --no-name --keep --force "$dir/Packages"
done

apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Orden \
  -o APT::FTPArchive::Release::Label=Orden \
  -o APT::FTPArchive::Release::Suite="$suite" \
  -o APT::FTPArchive::Release::Codename="$suite" \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Components=main \
  -o APT::FTPArchive::Release::Description="Orden, $suite" \
  release "$dists" >"$dists/Release.next"
mv "$dists/Release.next" "$dists/Release"

gpg --batch --yes --local-user "$key" --clearsign --output "$dists/InRelease" "$dists/Release"
gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$dists/Release.gpg" "$dists/Release"

cp "$here/packaging/apt/orden-archive-keyring.asc" orden-archive-keyring.asc
gpg --batch --yes --dearmor --output orden-archive-keyring.gpg orden-archive-keyring.asc
for page in index.html README.md; do
  sed "s|@BASE@|$base|g" "$here/packaging/apt/$page" >"$page"
done
