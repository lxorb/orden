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
