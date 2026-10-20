# Sourced by the release wrapper before Orden starts (#438).
#
# Chromium sandboxes its renderers in unprivileged user namespaces in this package: the
# setuid helper the .deb installs cannot live in the Nix store. NixOS allows the
# namespaces. A system that refuses them - Ubuntu 23.10 and later through AppArmor,
# older Debian through a sysctl - leaves Chromium no sandbox at all, and it stops with
# "No usable sandbox!" before a window opens. That is said here, before it starts, with
# what to do about it. Never `--no-sandbox` in its place: the renderers run what a page
# or a note hands them.
#
# A setuid helper named in CHROME_DEVEL_SANDBOX is a sandbox, and then nothing is said.
orden_userns_refused() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && return 0
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] && return 0
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = 0 ] && return 0
  return 1
}

if [ -z "${CHROME_DEVEL_SANDBOX:-}" ] && orden_userns_refused; then
  printf '%s\n' \
    "Orden: this system does not allow unprivileged user namespaces, which is how Orden's" \
    "engine (Chromium) sandboxes its pages when installed through Nix, so it will likely" \
    "stop with \"No usable sandbox!\". NixOS allows them. Elsewhere either allow them -" \
    "  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   (Ubuntu 23.10 and later)" \
    "  sudo sysctl -w kernel.unprivileged_userns_clone=1               (older Debian)" \
    "- or install Orden's .deb or AppImage instead: https://github.com/lxorb/orden/releases/latest" >&2
  if command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name=Orden "Orden cannot sandbox its pages" \
      "This system does not allow unprivileged user namespaces. Allow them (kernel.apparmor_restrict_unprivileged_userns=0) or install the .deb or AppImage. More in the terminal." \
      >/dev/null 2>&1 || true
  fi
fi
unset -f orden_userns_refused
