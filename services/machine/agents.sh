#!/bin/bash
set -uo pipefail

export NPM_CONFIG_PREFIX="$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME/.local/bin"

if ! command -v claude >/dev/null 2>&1; then
  installer=$(mktemp)
  if curl -fsSL https://claude.ai/install.sh -o "$installer"; then
    bash "$installer" || echo "claude: the installer failed" >&2
  else
    echo "claude: the installer could not be fetched" >&2
  fi
  rm -f "$installer"
fi

npm install -g --no-audit --no-fund @openai/codex@latest || echo "codex: npm failed" >&2
