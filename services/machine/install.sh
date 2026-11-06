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
  local nibd="$here/nibd.cjs"
  [ -f "$nibd" ] || nibd="$here/dist/nibd.cjs"

  install -d /opt/nibd
  local pty
  pty=$(node -p "require('$here/package.json').dependencies['node-pty']")
  if [ "$(cat /opt/nibd/pty 2>/dev/null)" != "$pty" ]; then
    rm -rf /opt/nibd/pty.new /opt/nibd/node_modules.old
    install -d /opt/nibd/pty.new
    (cd /opt/nibd/pty.new && npm install --omit=dev --no-audit --no-fund --no-save "node-pty@$pty")
    if [ -d /opt/nibd/node_modules ]; then mv /opt/nibd/node_modules /opt/nibd/node_modules.old; fi
    mv /opt/nibd/pty.new/node_modules /opt/nibd/node_modules
    rm -rf /opt/nibd/pty.new /opt/nibd/node_modules.old
    echo "$pty" >/opt/nibd/pty
  fi
  (cd /opt/nibd && node -e "require('node-pty')")
  local program
  for program in nibd hold; do
    local built="${nibd%/nibd.cjs}/$program.cjs"
    install -m 644 "$built" "/opt/nibd/$program.cjs.new"
    mv "/opt/nibd/$program.cjs.new" "/opt/nibd/$program.cjs"
  done

  install -m 644 "$here/profile.sh" /etc/profile.d/nib.sh
  install -m 755 "$here/agents.sh" /usr/local/bin/nib-agents
  install -m 755 "$here/nib-open" /usr/local/bin/nib-open
  for name in xdg-open sensible-browser x-www-browser www-browser; do
    ln -sf nib-open "/usr/local/bin/$name"
  done
  mkdir -p /var/lib/nibd /run/nibd
  chmod 700 /var/lib/nibd

  if [ -d /etc/systemd/system ] && [ "$mode" != image ]; then
    install -m 755 "$here/nib-update" /usr/local/bin/nib-update
    install -m 644 "$here"/server/*.service /etc/systemd/system/
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
  cat >/etc/apt/apt.conf.d/52nib-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF

  if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    [ -f /swapfile ] || { fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi
  echo 'vm.swappiness = 10' >/etc/sysctl.d/90-nib.conf
  sysctl -q --system || true

  passwd -l root >/dev/null
  install -d -m 755 /etc/ssh/sshd_config.d
  cat >/etc/ssh/sshd_config.d/01-nib.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers nib
EOF
  if [ -s /etc/nibd/ssh_key ]; then
    install -d -m 700 -o nib -g nib /home/nib/.ssh
    install -m 600 -o nib -g nib /etc/nibd/ssh_key /home/nib/.ssh/authorized_keys
    systemctl enable --now ssh.service >/dev/null 2>&1 || true
    systemctl reload ssh.service >/dev/null 2>&1 || true
  else
    systemctl disable --now ssh.socket ssh.service >/dev/null 2>&1 || true
  fi

  local zone
  zone=$(sed -n 's/^TZ=//p' /etc/nibd/env 2>/dev/null || true)
  if [ -n "$zone" ] && [ -f "/usr/share/zoneinfo/$zone" ]; then
    timedatectl set-timezone "$zone" 2>/dev/null || ln -sf "/usr/share/zoneinfo/$zone" /etc/localtime
  fi

  systemctl daemon-reload
  systemctl enable nibd.service nib-agents.service cloudflared.service
  systemctl restart nibd.service
  systemctl start --no-block nib-agents.service
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
