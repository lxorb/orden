#!/bin/bash
set -euo pipefail
image=$1
secret=ci-$RANDOM-$RANDOM
cleanup() {
  docker logs orden-machine >machine.log 2>&1 || true
  docker rm -f orden-machine orden-traced >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name orden-machine -e ORDEND_SECRET="$secret" -e TZ=Europe/Zurich \
  -p 127.0.0.1:7680:7680 "$image"

docker run -d --name orden-traced --cap-add SYS_PTRACE -e ORDEND_SECRET="$secret" \
  -p 127.0.0.1:7681:7680 --entrypoint bash "$image" -c '
    set -e
    apt-get update -qq && apt-get install -y -qq strace >/dev/null
    mkdir -p /home/nib/.claude /home/nib/.codex
    echo not-a-real-token >/home/nib/.claude/.credentials.json
    echo "{\"token\":\"not-a-real-token\"}" >/home/nib/.codex/auth.json
    chown -R nib:nib /home/nib
    exec strace -f -qq -o /tmp/trace \
      -e trace=open,openat,openat2,creat,execve,stat,lstat,newfstatat,statx,readlink,readlinkat,chdir,getdents64 \
      node /opt/ordend/ordend.cjs'

ORDEND_URL=ws://127.0.0.1:7680 ORDEND_TRACED_URL=ws://127.0.0.1:7681 ORDEND_SECRET=$secret \
  pnpm exec vitest run --config vitest.image.config.ts

ORDEND_SURVIVE_URL=ws://127.0.0.1:7680 ORDEND_SECRET=$secret \
  ORDEND_SURVIVE_RESTARTS='["docker exec orden-machine pkill -KILL -f /opt/ordend/ordend.cjs"]' \
  pnpm exec vitest run --config vitest.image.config.ts test/survive.drive.ts

before=$(docker exec orden-machine pgrep -f /opt/ordend/ordend.cjs)
docker exec orden-machine pkill -KILL -f /opt/ordend/ordend.cjs
again=
for _ in $(seq 1 30); do
  sleep 1
  now=$(docker exec orden-machine pgrep -f /opt/ordend/ordend.cjs || true)
  if [ -n "$now" ] && [ "$now" != "$before" ] && curl -fs http://127.0.0.1:7680/health >/dev/null; then
    again=1
    break
  fi
done
[ -n "$again" ] && [ "$(docker inspect -f '{{.State.Running}}' orden-machine)" = true ]
echo "ordend started again in the same machine"

docker exec -u nib -w /home/nib orden-machine bash -lc '
  set -euo pipefail
  version=$(claude --version | cut -d" " -f1)
  case "$(uname -m)" in x86_64) platform=linux-x64 ;; aarch64) platform=linux-arm64 ;; esac
  expected=$(curl -fsSL "https://downloads.claude.ai/claude-code-releases/$version/manifest.json" |
    jq -r ".platforms[\"$platform\"].checksum")
  actual=$(sha256sum "$(readlink -f ~/.local/bin/claude)" | cut -d" " -f1)
  echo "claude $version $platform: $actual"
  [ "$expected" = "$actual" ]

  checked=0
  for manifest in $(find ~/.local/lib/node_modules/@openai -name package.json -path "*/@openai/codex*/package.json" -not -path "*/node_modules/*/node_modules/*/node_modules/*"); do
    [ "$(jq -r .name "$manifest")" = "@openai/codex" ] || continue
    version=$(jq -r .version "$manifest")
    tarball="codex-$version.tgz"
    fetched=$(grep -rh -- "/-/$tarball" ~/.npm/_cacache/index-v5 | cut -f2 | jq -r ".integrity" | sort -u)
    published=$(npm view "@openai/codex@$version" dist.integrity)
    echo "@openai/codex@$version: $fetched"
    [ -n "$fetched" ] && [ "$fetched" = "$published" ]
    checked=$((checked + 1))
  done
  [ "$checked" -ge 2 ]
'

docker exec orden-traced cat /tmp/trace >trace.log
python3 - trace.log <<'PY'
import re, sys
ran, touched = set(), {}
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    pid, _, call = line.partition(" ")
    if "execve" in call:
        if re.search(r"= 0\s*$", call):
            ran.add(pid)
    elif re.search(r"/home/nib/\.(claude|codex)", call):
        touched.setdefault(pid, line.strip())
bad = {pid: line for pid, line in touched.items() if pid not in ran}
for line in bad.values():
    print("ordend itself:", line)
print(f"{len(touched)} processes touched the agents files; {len(bad)} of them were ordend")
sys.exit(1 if bad or not touched else 0)
PY
