#!/bin/bash
set -euo pipefail

if compgen -G '/etc/cloudflare/certs/*' >/dev/null; then
  for cert in /etc/cloudflare/certs/*; do
    case "$cert" in
      *.crt | *.pem) cp "$cert" "/usr/local/share/ca-certificates/cloudflare-$(basename "${cert%.*}").crt" ;;
    esac
  done
  update-ca-certificates >/dev/null
fi
bundle=/etc/ssl/certs/ca-certificates.crt
export NODE_EXTRA_CA_CERTS=$bundle SSL_CERT_FILE=$bundle REQUESTS_CA_BUNDLE=$bundle \
  CURL_CA_BUNDLE=$bundle GIT_SSL_CAINFO=$bundle

if [ -n "${TZ:-}" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" >/etc/timezone
fi

mkdir -p /home/nib /var/lib/nibd /run/nibd
chown nib:nib /home/nib
install -d -o nib -g nib /home/nib/.local /home/nib/.local/bin
chmod 700 /var/lib/nibd

if [ "${NIB_AGENTS:-1}" != 0 ]; then
  setpriv --reuid=nib --regid=nib --init-groups \
    env -i HOME=/home/nib USER=nib LOGNAME=nib PATH=/usr/local/bin:/usr/bin:/bin \
    NODE_EXTRA_CA_CERTS=$bundle SSL_CERT_FILE=$bundle LANG=C.UTF-8 \
    nice -n 10 /usr/local/bin/nib-agents >/tmp/nib-agents.log 2>&1 &
fi

nibd=
stopping=
trap 'stopping=1; [ -n "$nibd" ] && kill -TERM "$nibd" 2>/dev/null' TERM INT
ends=()
while :; do
  node /opt/nibd/nibd.cjs &
  nibd=$!
  code=0
  wait "$nibd" || code=$?
  if [ -n "$stopping" ]; then
    wait "$nibd" 2>/dev/null || true
    exit 0
  fi
  [ "$code" = 0 ] && exit 0
  now=$(date +%s)
  recent=()
  for at in "${ends[@]}" "$now"; do
    [ $((now - at)) -lt 600 ] && recent+=("$at")
  done
  ends=("${recent[@]}")
  echo "nib-entrypoint: nibd ended with $code (${#ends[@]} in ten minutes)" >&2
  [ "${#ends[@]}" -ge 5 ] && exit "$code"
  sleep 1
done
