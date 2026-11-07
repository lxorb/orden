#!/usr/bin/env bash
set -euo pipefail

root=$(cd "${1:?the folder the suite was written into}" && pwd)
suite=${2:?stable or unstable}
case "$suite" in
  stable) id=orden ;;
  unstable) id=orden-unstable ;;
  *) echo "the suite is stable or unstable, not $suite" >&2; exit 1 ;;
esac

if command -v zypper >/dev/null; then
  manager=zypper
  zypper() { command zypper --non-interactive --gpg-auto-import-keys "$@"; }
  zypper install rpm-build binutils >/dev/null
else
  manager=dnf
  dnf -y -q install rpm-build binutils >/dev/null
fi

repo=$(mktemp -d)/$id.repo
sed -e "s|^baseurl=.*/|baseurl=file://$root/rpm/|" -e "s|^gpgkey=.*/|gpgkey=file://$root/rpm/|" "$root/rpm/$id.repo" >"$repo"
cat "$repo"
case "$manager" in
  zypper) zypper addrepo "$repo" ;;
  dnf) cp "$repo" /etc/yum.repos.d/ ;;
esac

wanted=$(find "$root/rpm/$suite" -name "orden-*.$(uname -m).rpm" -exec rpm -qp --queryformat '%{VERSION}-%{RELEASE}' {} \;)
[ -n "$wanted" ] || { echo "no orden for $(uname -m) in $suite" >&2; exit 1; }

installed() {
  local now
  now=$(rpm -q --queryformat '%{VERSION}-%{RELEASE}' orden)
  [ "$now" = "$wanted" ] || { echo "$manager installed orden $now, not $wanted" >&2; exit 1; }
  rpm -q --queryformat '%{DSAHEADER:pgpsig}%{RSAHEADER:pgpsig}\n' orden | grep -v '^(none)(none)$'
  program=$(readlink -f "$(command -v orden || command -v nib)")
  missing=$(ldd "$program" /usr/share/Orden/libcef.so | grep 'not found' || true)
  [ -z "$missing" ] || { echo "what Orden links and $manager did not install:" >&2; echo "$missing" >&2; exit 1; }
  echo "orden $now from $suite, on $manager"
}

case "$manager" in
  zypper) zypper refresh && zypper install orden ;;
  dnf) dnf -y install orden ;;
esac
installed
rpm -e orden

build=$(mktemp -d)
cat >"$build/old.spec" <<'EOF'
Name: orden
Version: 0.0.1
Release: 1
Summary: An old Orden
License: AGPL-3.0-only
%description
An old Orden.
%install
mkdir -p %{buildroot}/usr/share/Orden
echo old >%{buildroot}/usr/share/Orden/old
%files
/usr/share/Orden/old
EOF
rpmbuild --quiet --define "_topdir $build" --define "source_date_epoch_from_changelog 0" -bb "$build/old.spec"
rpm -i --nosignature "$build"/RPMS/*/orden-0.0.1-1.*.rpm
rpm -q orden
case "$manager" in
  zypper) zypper refresh && zypper update orden ;;
  dnf) dnf -y upgrade orden ;;
esac
[ ! -e /usr/share/Orden/old ] || { echo "the old version's file is still there" >&2; exit 1; }
installed
