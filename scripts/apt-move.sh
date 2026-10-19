#!/usr/bin/env bash
# The last thing the old apt repository on GitHub Pages (lxorb/apt, at
# https://lxorb.github.io/apt) serves: the version each of its suites already holds,
# once more, under a version one step newer and with a postinst that points every apt
# source naming the old address at the new one, https://apt.orden.so. Signed with the
# same key, so the next `apt upgrade` from the old address installs it, and the
# `apt update` after that reads the new one, where the next real version is.
#
# Not a redirect: GitHub Pages answers no path with one, and the .debs of the new
# address are past the hundred megabytes a file in a GitHub repository may be, so the
# old repository can neither send apt elsewhere nor hold what is there. The page at its
# root says where it went.
#
#   APT_KEY_FINGERPRINT=<the signing key, imported into gpg already> \
#     scripts/apt-move.sh <checkout of lxorb/apt>
#
# `+moved` sorts after the version it is added to and before every later one (dpkg
# compares 0.16.0+moved after 0.16.0 and before 0.16.1, 0.16.1-769+moved before
# 0.16.1-770), so nobody is held back and nobody is sent backwards.
set -euo pipefail

repo=${1:?a checkout of lxorb/apt}
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$repo" && pwd)
postinst="$here/apps/desktop/src-tauri/linux/postinst"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for suite in stable unstable; do
  shopt -s nullglob
  debs=("$repo/pool/$suite"/*.deb)
  shopt -u nullglob
  [ ${#debs[@]} -gt 0 ] || continue
  out="$work/$suite"
  mkdir -p "$out"
  for deb in "${debs[@]}"; do
    case "$(dpkg-deb --field "$deb" Version)" in
      *+moved) cp "$deb" "$out/" ;;
      *)
        tree="$work/tree"
        rm -rf "$tree"
        dpkg-deb -R "$deb" "$tree"
        version=$(dpkg-deb --field "$deb" Version)
        sed -i "s/^Version: .*/Version: $version+moved/" "$tree/DEBIAN/control"
        if [ -f "$tree/DEBIAN/postinst" ]; then
          # The move first, just under its own first line, and its own after it.
          { head -n 1 "$tree/DEBIAN/postinst"; sed -e '1d' -e '/^exit 0$/d' "$postinst"; tail -n +2 "$tree/DEBIAN/postinst"; } >"$tree/DEBIAN/postinst.next"
          mv "$tree/DEBIAN/postinst.next" "$tree/DEBIAN/postinst"
        else
          cp "$postinst" "$tree/DEBIAN/postinst"
        fi
        chmod 0755 "$tree/DEBIAN/postinst"
        dpkg-deb --root-owner-group -b "$tree" "$out/$(basename "$deb" .deb)+moved.deb" >/dev/null
        echo "$suite: $version -> $version+moved"
        ;;
    esac
  done
  APT_BASE_URL=https://apt.orden.so bash "$here/scripts/apt-repo.sh" "$suite" "$out" "$repo"
done

# Served as the files they are, with nothing of Jekyll's in front of them.
touch "$repo/.nojekyll"
