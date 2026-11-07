#!/bin/bash
set -euo pipefail

NODE_VERSION=22.23.3
UV_VERSION=0.12.23

here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-image}
export DEBIAN_FRONTEND=noninteractive

case "$(uname -m)" in
  x86_64) node_arch=x64 uv_arch=x86_64 ;;
  aarch64) node_arch=arm64 uv_arch=aarch64 ;;
  *)
    echo "install.sh: no machine for $(uname -m)" >&2
    exit 1
    ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fetch() {
  curl -fsSL --retry 3 --retry-delay 2 -o "$work/$2" "$1"
}

system() {
  apt-get update
  apt-get install -y --no-install-recommends \
    bash zsh fish sudo tini \
    git curl wget ca-certificates gnupg xz-utils \
    build-essential python3 python3-pip python3-venv python-is-python3 \
    ripgrep fd-find jq tmux vim nano less unzip zip zstd \
    openssh-client locales tzdata util-linux procps
  ln -sf /usr/bin/fdfind /usr/local/bin/fd

  mkdir -p -m 755 /etc/apt/keyrings
  wget -qO /etc/apt/keyrings/githubcli.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
    >/etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y --no-install-recommends gh

  local file="node-v$NODE_VERSION-linux-$node_arch.tar.xz"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$file" "$file"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" SHASUMS256.txt
  (cd "$work" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
  tar -xJf "$work/$file" -C /usr/local --strip-components=1 --no-same-owner \
    --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
  node --version
  npm --version

  file="uv-$uv_arch-unknown-linux-gnu.tar.gz"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$file" "$file"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$file.sha256" "$file.sha256"
  (cd "$work" && sha256sum -c --quiet "$file.sha256")
  tar -xzf "$work/$file" -C "$work"
  install -m 755 "$work/uv-$uv_arch-unknown-linux-gnu/uv" "$work/uv-$uv_arch-unknown-linux-gnu/uvx" /usr/local/bin/

  rm -rf /var/lib/apt/lists/*
}

user() {
  if id ubuntu >/dev/null 2>&1 && [ "$(id -u ubuntu)" = 1000 ] && ! pgrep -u ubuntu >/dev/null; then
    userdel -r ubuntu 2>/dev/null || true
  fi
  if ! id nib >/dev/null 2>&1; then
    if getent passwd 1000 >/dev/null; then
      useradd -m -s /bin/bash nib
    else
      useradd -m -u 1000 -s /bin/bash nib
    fi
  fi
  install -d -o nib -g nib /home/nib/.local /home/nib/.local/bin
  echo 'nib ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/nib
  chmod 440 /etc/sudoers.d/nib
}

files() {
  local ordend="$here/ordend.cjs"
  [ -f "$ordend" ] || ordend="$here/dist/ordend.cjs"

  local opt=/opt/ordend main=ordend state=/var/lib/ordend run=/run/ordend former=
  if [ ! -d /opt/ordend ] && [ -d /opt/nibd ]; then
    opt=/opt/nibd main=nibd state=/var/lib/nibd run=/run/nibd former=1
  fi

  install -d "$opt"
  local pty
  pty=$(node -p "require('$here/package.json').dependencies['node-pty']")
  if [ "$(cat "$opt/pty" 2>/dev/null)" != "$pty" ]; then
    rm -rf "$opt/pty.new" "$opt/node_modules.old"
    install -d "$opt/pty.new"
    (cd "$opt/pty.new" && npm install --omit=dev --no-audit --no-fund --no-save "node-pty@$pty")
    if [ -d "$opt/node_modules" ]; then mv "$opt/node_modules" "$opt/node_modules.old"; fi
    mv "$opt/pty.new/node_modules" "$opt/node_modules"
    rm -rf "$opt/pty.new" "$opt/node_modules.old"
    echo "$pty" >"$opt/pty"
  fi
  (cd "$opt" && node -e "require('node-pty')")
  local program
  for program in ordend hold; do
    local built="${ordend%/ordend.cjs}/$program.cjs" kept=$program
    [ "$program" = ordend ] && kept=$main
    install -m 644 "$built" "$opt/$kept.cjs.new"
    mv "$opt/$kept.cjs.new" "$opt/$kept.cjs"
  done

  install -m 644 "$here/profile.sh" /etc/profile.d/orden.sh
  rm -f /etc/profile.d/nib.sh
  install -m 755 "$here/agents.sh" /usr/local/bin/orden-agents
  install -m 755 "$here/orden-open" /usr/local/bin/orden-open
  for name in nib-open xdg-open sensible-browser x-www-browser www-browser; do
    ln -sf orden-open "/usr/local/bin/$name"
  done
  mkdir -p "$state" "$run"
  chmod 700 "$state"

  if [ -d /etc/systemd/system ] && [ "$mode" != image ]; then
    install -m 755 "$here/orden-update" /usr/local/bin/orden-update
    if [ -n "$former" ]; then
      ln -sf orden-update /usr/local/bin/nib-update
      ln -sf orden-agents /usr/local/bin/nib-agents
    else
      install -m 644 "$here"/server/*.service /etc/systemd/system/
    fi
  fi
}

server() {
  apt-get update
  apt-get install -y --no-install-recommends unattended-upgrades openssh-server

  wget -qO /usr/share/keyrings/cloudflare-main.gpg https://pkg.cloudflare.com/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    >/etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y --no-install-recommends cloudflared

  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  cat >/etc/apt/apt.conf.d/52orden-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF

  if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    [ -f /swapfile ] || { fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi
  echo 'vm.swappiness = 10' >/etc/sysctl.d/90-orden.conf
  sysctl -q --system || true

  passwd -l root >/dev/null
  install -d -m 755 /etc/ssh/sshd_config.d
  cat >/etc/ssh/sshd_config.d/01-orden.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers nib
EOF
  if [ -s /etc/ordend/ssh_key ]; then
    install -d -m 700 -o nib -g nib /home/nib/.ssh
    install -m 600 -o nib -g nib /etc/ordend/ssh_key /home/nib/.ssh/authorized_keys
    systemctl enable --now ssh.service >/dev/null 2>&1 || true
    systemctl reload ssh.service >/dev/null 2>&1 || true
  else
    systemctl disable --now ssh.socket ssh.service >/dev/null 2>&1 || true
  fi

  local zone
  zone=$(sed -n 's/^TZ=//p' /etc/ordend/env 2>/dev/null || true)
  if [ -n "$zone" ] && [ -f "/usr/share/zoneinfo/$zone" ]; then
    timedatectl set-timezone "$zone" 2>/dev/null || ln -sf "/usr/share/zoneinfo/$zone" /etc/localtime
  fi

  systemctl daemon-reload
  systemctl enable ordend.service orden-agents.service cloudflared.service
  systemctl restart ordend.service
  systemctl start --no-block orden-agents.service
  systemctl restart cloudflared.service || true
}

case "$mode" in
  image)
    system
    user
    files
    ;;
  --server)
    system
    user
    files
    server
    ;;
  --files)
    files
    ;;
  *)
    echo "usage: install.sh [--server | --files]" >&2
    exit 2
    ;;
esac
