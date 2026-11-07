#!/usr/bin/env bash

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-$PWD/wayland-out}
mkdir -p "$out"

unset DISPLAY GDK_BACKEND WAYLAND_DISPLAY
x11_before=$(ls /tmp/.X11-unix 2>/dev/null || true)
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
export HOME=${HOME:-/root}

export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=4
cat > "$out/sway.conf" <<'CONF'
xwayland force
default_border none
default_floating_border none
output HEADLESS-1 mode --custom 2560x1440@60Hz transform 90 scale 1.77 position 0 0
output HEADLESS-2 mode --custom 2560x1440@60Hz scale 1 position 814 0
output HEADLESS-3 mode --custom 1920x1080@60Hz scale 1.75 position 3374 0
output HEADLESS-4 mode --custom 2560x1600@60Hz scale 2 position 4472 0
CONF
sway -c "$out/sway.conf" > "$out/sway.log" 2>&1 &
sway_pid=$!

sock=""
for _ in $(seq 100); do
  sock=$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1 || true)
  [ -n "$sock" ] && break
  sleep 0.1
done
[ -n "$sock" ] || { echo "::error::sway did not start"; cat "$out/sway.log"; exit 1; }
export SWAYSOCK=$sock
WAYLAND_DISPLAY=$(basename "$(ls "$XDG_RUNTIME_DIR"/wayland-* | grep -v '\.lock$' | head -1)")
export WAYLAND_DISPLAY
swaymsg -t get_outputs > "$out/outputs.json"
for _ in $(seq 100); do
  for socket in $(ls /tmp/.X11-unix 2>/dev/null || true); do
    if ! grep -qx "$socket" <<< "$x11_before"; then
      export DISPLAY=":${socket#X}"
    fi
  done
  [ -n "${DISPLAY:-}" ] && break
  sleep 0.1
done
[ -n "${DISPLAY:-}" ] || { echo "::error::sway started no Xwayland"; cat "$out/sway.log"; exit 1; }
echo "Xwayland on $DISPLAY"

if [ -n "${DPI:-}" ]; then
  printf 'Xft/DPI %s\n' "$((DPI * 1024))" > "$out/xsettingsd.conf"
  xsettingsd -c "$out/xsettingsd.conf" > "$out/xsettingsd.log" 2>&1 &
  sleep 1
  echo "XSETTINGS: Xft/DPI $DPI"
fi
echo "sway on $WAYLAND_DISPLAY, outputs:"
python3 -c 'import json,sys; [print(" ", o["name"], o["rect"], "scale", o["scale"], o["transform"]) for o in json.load(open(sys.argv[1]))]' "$out/outputs.json"

portal_pid=""
if [ "${PORTAL:-0}" = 1 ]; then
  python3 "$here/wayland-portal.py" "$out/portal.log" &
  portal_pid=$!
  for _ in $(seq 50); do
    grep -q '"owned"' "$out/portal.log" 2>/dev/null && break
    sleep 0.1
  done
  grep -q '"owned"' "$out/portal.log" || { echo "::error::the stand-in portal did not start"; exit 1; }
fi

strangers() {
  [ -n "${CLASS-nib}" ] || return 0
  swaymsg -t get_tree | python3 -c '
import json, sys
def walk(node):
    if node.get("pid") and node.get("type") in ("con", "floating_con") and node.get("shell") == "xwayland":
        name = (node.get("window_properties") or {}).get("instance")
        if name != sys.argv[1] or (node.get("name") or "").endswith("Chromium"):
            print(repr(name), "|", node.get("name"))
    for child in node.get("nodes", []) + node.get("floating_nodes", []):
        walk(child)
walk(json.load(sys.stdin))
' "${CLASS-nib}"
}

views() {
  swaymsg -t get_tree | python3 -c '
import json, sys
def walk(node, floating=False):
    if node.get("pid") and node.get("type") in ("con", "floating_con"):
        print(node.get("app_id"), "|", node.get("name"), "|",
              "floating" if node["type"] == "floating_con" else "tiled", "|",
              "focused" if node.get("focused") else "-", "|",
              node["rect"]["width"], "x", node["rect"]["height"])
    for child in node.get("nodes", []) + node.get("floating_nodes", []):
        walk(child)
walk(json.load(sys.stdin))
'
}

wait_for_views() {
  local want=$1
  for _ in $(seq 120); do
    [ "$(views | wc -l)" -ge "$want" ] && return 0
    sleep 0.5
  done
  return 1
}

site_pid=""
pointer_pid=""
config="${XDG_CONFIG_HOME:-$HOME/.config}/ch.emilvinu.nib"
endpoint() {
  mkdir -p "$config"
  secret=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  printf '{"port":0,"secret":"%s","eval":true,"pid":0}' "$secret" > "$config/automation.json"
  chmod 600 "$config/automation.json"
}
command=("$@")
if [ "${DRIVE:-0}" = 1 ] || [ "${SESSION:-0}" = 1 ] || [ "${EXTENSIONS:-0}" = 1 ] || [ "${PASS:-0}" = 1 ]; then
  NIB_CEF_DEBUG_PORT=${NIB_CEF_DEBUG_PORT:-9339}
  export NIB_CEF_DEBUG_PORT
fi
if [ "${DRIVE:-0}" = 1 ] || [ "${MEDIA:-0}" = 1 ] || [ "${CHECK:-0}" = 1 ] || [ "${DRAG:-0}" = 1 ] || [ "${POPUP:-0}" = 1 ] || [ "${SCHEME:-0}" = 1 ] || [ "${FLASH:-0}" = 1 ] || [ "${GROUND:-0}" = 1 ] || [ "${WORKER:-0}" = 1 ] || [ "${SESSION:-0}" = 1 ] || [ "${EXTENSIONS:-0}" = 1 ] || [ "${GRANTS:-0}" = 1 ] || [ "${GLOBALS:-0}" = 1 ]; then
  mkdir -p "$out/site"
  video=""
  [ "${MEDIA:-0}" = 1 ] && video='<video src="none.webm" autoplay muted></video>'
  printf '<!doctype html><title>one colour</title><style>html,body{margin:0;height:100%%;background:#ff00ff}</style>%s' "$video" > "$out/site/index.html"
  [ "${GROUND:-0}" = 1 ] && printf '<!doctype html><title>light only</title><header style="background:#fff;padding:20px;border-bottom:1px solid #ddd">A white header</header><main style="padding:40px 20px;color:#202124;font:28px sans-serif"><h1>Store and share files online</h1><p>Words, dark, on whatever the page stands on.</p></main>' > "$out/site/index.html"
  [ "${FLASH:-0}" = 1 ] && printf '<!doctype html><title>dark</title><meta name="color-scheme" content="dark"><style>html,body{margin:0;height:100%%;background:#1e1e1e}</style>' > "$out/site/index.html"
  [ "${SCHEME:-0}" = 1 ] && printf '<!doctype html><title>scheme</title><style>html,body{margin:0;height:100%%;background:#0000ff}@media (prefers-color-scheme: dark){html,body{background:#00ff00}}</style>' > "$out/site/index.html"
  if [ "${GLOBALS:-0}" = 1 ]; then
    said='<script>let ipc = 1</script><script>fetch("/said?" + new URLSearchParams({ who: "WHO", declared: String(ipc), ipc: typeof window.ipc, internals: typeof window.__TAURI_INTERNALS__ }))</script>'
    printf '<!doctype html><title>asked</title>%s<iframe src="http://localhost:8765/frame.html"></iframe>' "${said/WHO/page}" > "$out/site/index.html"
    printf '<!doctype html><title>frame</title>%s' "${said/WHO/frame}" > "$out/site/frame.html"
  fi
  if [ "${WORKER:-0}" = 1 ]; then
    cat > "$out/site/index.html" <<'PAGE'
<!doctype html><title>a worker waiting</title>
<script>
  const loaded = Math.round(performance.timeOrigin)
  const code = new Blob(['onmessage = (event) => postMessage(event.data)'], { type: 'text/javascript' })
  const worker = new Worker(URL.createObjectURL(code))
  worker.onmessage = (event) => { document.title = 'a worker answered at ' + event.data }
  worker.postMessage(loaded)
</script>
PAGE
  fi
  if [ "${SESSION:-0}" = 1 ]; then
    cat > "$out/site/index.html" <<'PAGE'
<!doctype html><title>a session waiting</title>
<script>
  const hidden = location.search.includes('private')
  const name = hidden ? 'hidden' : 'signed'
  const found = document.cookie.includes(name + '=in')
  document.cookie = name + '=in; path=/'
  document.title = 'a ' + (hidden ? 'private' : 'session') + ' cookie ' + (found ? 'kept' : 'made')
</script>
PAGE
  fi
  if [ "${CHECK:-0}" = 1 ]; then
    clip=(-f lavfi -i testsrc2=size=320x240:rate=30 -f lavfi -i sine=frequency=440 -t 4)
    ffmpeg -loglevel error -y "${clip[@]}" -c:v libvpx-vp9 -b:v 300k -c:a libopus "$out/site/vp9.webm"
    ffmpeg -loglevel error -y "${clip[@]}" -c:v libaom-av1 -cpu-used 8 -b:v 300k -c:a libopus "$out/site/av1.webm"
    ffmpeg -loglevel error -y "${clip[@]}" -c:v libx264 -pix_fmt yuv420p -c:a aac "$out/site/h264.mp4"
    cat > "$out/site/video.html" <<'PAGE'
<!doctype html><title>three codecs</title>
<body style="margin:0;background:#202020;color:#eee;font:15px sans-serif">
<script>
const clips = [
  ['vp9-opus', 'vp9.webm', 'video/webm; codecs="vp9, opus"'],
  ['av1-opus', 'av1.webm', 'video/webm; codecs="av01.0.05M.08, opus"'],
  ['h264-aac', 'h264.mp4', 'video/mp4; codecs="avc1.640015, mp4a.40.2"'],
]
for (const [name, src, type] of clips) {
  const box = document.createElement('figure')
  const v = document.createElement('video')
  Object.assign(v, { src, muted: true, autoplay: true, loop: true, width: 320, height: 240 })
  const said = document.createElement('figcaption')
  box.append(v, said)
  document.body.append(box)
  const can = v.canPlayType(type)
  let done = false
  const finish = (ok, why) => {
    if (done) return
    done = true
    said.textContent = name + ': ' + (ok ? 'plays' : 'does not play') + ' (' + why + ', canPlayType "' + can + '")'
    fetch('/report?' + new URLSearchParams({ name, can, ok, why, w: v.videoWidth, h: v.videoHeight, t: v.currentTime.toFixed(2) }))
  }
  v.addEventListener('error', () => finish(false, 'error ' + (v.error && v.error.code)))
  v.addEventListener('timeupdate', () => { if (v.currentTime > 1) finish(true, 'played') })
  setTimeout(() => finish(false, 'timeout'), 9000)
  v.play().catch((e) => finish(false, 'play ' + e.name))
}
</script>
PAGE
  fi
  python3 -m http.server 8765 --bind 127.0.0.1 --directory "$out/site" > "$out/site.log" 2>&1 &
  site_pid=$!
  endpoint
  set -- "$@" http://127.0.0.1:8765/
fi
dns_name=probe.test
dns_provider=https://127.0.0.1:8443/dns-query
if [ "${DNS:-0}" = 1 ]; then
  mkdir -p "$out/site" "$out/doh"
  printf '<!doctype html><title>reached by name</title><p>reached by name</p>' > "$out/site/index.html"
  python3 -m http.server 8765 --bind 127.0.0.1 --directory "$out/site" > "$out/site.log" 2>&1 &
  site_pid=$!
  (
    cd "$out/doh"
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=Orden run authority" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" \
      -keyout ca.key -out ca.pem 2> /dev/null
    openssl req -newkey rsa:2048 -nodes -subj "/CN=127.0.0.1" -keyout doh.key -out doh.csr 2> /dev/null
    printf 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > doh.ext
    openssl x509 -req -in doh.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 \
      -extfile doh.ext -out doh.pem 2> /dev/null
  )
  mkdir -p "$HOME/.pki/nssdb"
  certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password 2> /dev/null || true
  certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n "Orden run authority" -i "$out/doh/ca.pem"
  python3 "$here/doh-server.py" 8443 "$out/doh/doh.pem" "$out/doh/doh.key" "$dns_name" "$out/doh/asked.txt" > "$out/doh/server.log" 2>&1 &
  doh_pid=$!
  endpoint
  set -- "$@" "http://$dns_name:8765/"
fi
if [ "${DOWNLOAD:-0}" = 1 ]; then
  mkdir -p "$out/downloads"
  NIB_DOWNLOADS_DIR="$(cd "$out/downloads" && pwd)"
  export NIB_DOWNLOADS_DIR
  python3 "$here/download-server.py" 8765 "$out/served.txt" > "$out/site.log" 2>&1 &
  site_pid=$!
  endpoint
  set -- "$@" http://127.0.0.1:8765/
fi
if [ "${CARRY:-0}" = 1 ]; then
  mkdir -p "$out/site"
  python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from carry_page import PAGE; open(sys.argv[2], "wb").write(PAGE)' "$here" "$out/site/carry.html"
  python3 -m http.server 8765 --bind 127.0.0.1 --directory "$out/site" > "$out/site.log" 2>&1 &
  site_pid=$!
  endpoint
fi
if [ "${WATCH:-0}" = 1 ]; then
  mkdir -p "$out/spaces"
  NIB_SPACES_DIR="$(cd "$out/spaces" && pwd)"
  export NIB_SPACES_DIR
  endpoint
fi
ext_name="Orden run extension"
if [ "${EXTENSIONS:-0}" = 1 ]; then
  mkdir -p "$out/extension"
  python3 - "$out/extension" "$ext_name" <<'MAKE'
import json, struct, sys, zlib
from pathlib import Path
folder, name = Path(sys.argv[1]), sys.argv[2]
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
rows = b"".join(b"\x00" + b"\x2b\x8a\x6e\xff" * 16 for _ in range(16))
icon = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
(folder / "icon.png").write_bytes(icon)
(folder / "popup.html").write_text(f"<!doctype html><title>{name} popup</title><p>{name}</p>")
(folder / "page.html").write_text(f"<!doctype html><title>{name} page</title><p>{name}</p>")
(folder / "background.js").write_text(
    "chrome.runtime.onMessage.addListener((asked) => {\n"
    "  if (asked === 'open') chrome.tabs.create({ url: chrome.runtime.getURL('page.html?background') })\n"
    "})\n"
)
(folder / "manifest.json").write_text(json.dumps({
    "manifest_version": 3, "name": name, "version": "1.0",
    "icons": {"16": "icon.png"},
    "action": {"default_title": name, "default_icon": "icon.png", "default_popup": "popup.html"},
    "background": {"service_worker": "background.js"},
}))
MAKE
  NIB_CEF_ARGS="load-extension=$(cd "$out/extension" && pwd),disable-features=DisableLoadExtensionCommandLineSwitch"
  export NIB_CEF_ARGS
fi
[ "${TEXTSIZE:-0}" = 1 ] && endpoint
[ "${KILL:-0}" = 1 ] && endpoint
[ "${RESERVED:-0}" = 1 ] && endpoint
[ "${PDFMARK:-0}" = 1 ] && endpoint
if [ "${EXPORTPDF:-0}" = 1 ]; then
  mkdir -p "$out/spaces"
  NIB_SPACES_DIR="$(cd "$out/spaces" && pwd)"
  export NIB_SPACES_DIR
  endpoint
fi
[ "${CLOSING:-0}" = 1 ] && endpoint
[ "${OPENS:-0}" = 1 ] && endpoint
[ "${CHOOSING:-0}" = 1 ] && endpoint
[ "${CORNER:-0}" = 1 ] && endpoint
[ "${PASS:-0}" = 1 ] && endpoint
if [ "${CERT:-0}" = 1 ]; then
  endpoint
  set -- "$@" "https://${CERT_HOST:-example.com}/"
fi
if [ "${DRIVE:-0}" = 1 ] || [ "${CHECK:-0}" = 1 ] || [ "${DRAG:-0}" = 1 ] || [ "${POPUP:-0}" = 1 ] || [ "${SCHEME:-0}" = 1 ] || [ "${FLASH:-0}" = 1 ] || [ "${TEXTSIZE:-0}" = 1 ] || [ "${GROUND:-0}" = 1 ] || [ "${OPENS:-0}" = 1 ] || [ "${CHOOSING:-0}" = 1 ] || [ "${CARRY:-0}" = 1 ]; then
  if command -v xkbcli > /dev/null; then
    xkbcli compile-keymap --layout us > "$out/keymap.txt"
    export KEY_MAP="$out/keymap.txt"
  fi
  python3 "$here/wayland-pointer.py" "$out/pointer.fifo" > "$out/pointer.log" 2>&1 &
  pointer_pid=$!
  said="a pointer is on the seat"
  [ -n "${KEY_MAP:-}" ] && said="and a keyboard"
  for _ in $(seq 100); do
    grep -q "$said" "$out/pointer.log" 2>/dev/null && break
    sleep 0.1
  done
  grep -q "$said" "$out/pointer.log" || { echo "::error::the stand-in pointer did not start"; cat "$out/pointer.log"; exit 1; }
  sleep 0.5
fi

mkdir -p "$out/handed"
cat > "$out/handed/xdg-open" <<SHIM
#!/bin/sh
echo "\$*" >> "$out/handed.txt"
SHIM
chmod +x "$out/handed/xdg-open"
export PATH="$out/handed:$PATH"

started=$(date +%s%N)
"$@" > "$out/orden.log" 2>&1 &
app_pid=$!

status=0
if wait_for_views 1; then
  echo "the window mapped after $(( ($(date +%s%N) - started) / 1000000 )) ms:"
  views
  if [ -n "$(strangers)" ]; then
    echo "::error::a window not under the desktop entry's name, ${CLASS-nib}, or Chromium's own:"
    strangers
    status=1
  fi
else
  echo "::error::no window mapped in 60 s"
  status=1
fi

if [ "$status" = 0 ] && [ -n "${SECOND:-}" ]; then
  sleep 3
  $SECOND > "$out/second.log" 2>&1 || true
  if wait_for_views 2; then
    echo "--quick-add, handed to the running app, brought quick add up:"
    views
  else
    echo "::error::--quick-add brought no window up"
    status=1
  fi
fi

if [ "$status" = 0 ] && [ -n "$portal_pid" ]; then
  if wait_for_views 2; then
    echo "the portal's press brought quick add up:"
    views
  else
    echo "::error::the portal's press brought no window up"
    status=1
  fi
  echo "what the portal was asked:"
  cat "$out/portal.log"
  grep -q '"BindShortcuts"' "$out/portal.log" || { echo "::error::nothing was bound through the portal"; status=1; }
  grep -q 'CTRL+ALT+space' "$out/portal.log" || { echo "::error::quick add's key was not the one preferred"; status=1; }
fi

if [ "$status" = 0 ] && [ "${IDLE:-0}" = 1 ]; then
  sleep 15
  python3 "$here/idle-cpu.py" "$app_pid" 20 | tee "$out/idle.txt"
  [ "${PIPESTATUS[0]}" = 0 ] || status=1
  find "$HOME" -path '*ch.emilvinu.nib*' -name nib.log -exec grep -hE ' (pump|gpu): ' {} + 2>/dev/null | tee -a "$out/idle.txt" || true
fi

if [ "$status" = 0 ] && [ "${DRIVE:-0}" = 1 ]; then
  python3 "$here/compositing-check.py" "$NIB_CEF_DEBUG_PORT" || status=1
  python3 "$here/wayland-drive.py" "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${GROUND:-0}" = 1 ]; then
  sleep 3
  python3 "$here/ground-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${TEXTSIZE:-0}" = 1 ]; then
  sleep 3
  python3 "$here/textsize-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${FLASH:-0}" = 1 ]; then
  sleep 3
  python3 "$here/flash-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${CERT:-0}" = 1 ]; then
  sleep 3
  python3 "$here/cert-drive.py" "$out" "${CERT_HOST:-example.com}" || status=1
fi

if [ "$status" = 0 ] && [ "${DNS:-0}" = 1 ]; then
  sleep 3
  python3 "$here/dns-drive.py" "$out" choose "$dns_name" "$dns_provider" "$out/doh/asked.txt" || status=1
  if [ "$status" = 0 ]; then
    sleep 10
    kill -TERM "$app_pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    : > "$out/doh/asked.txt"
    endpoint
    "${command[@]}" > "$out/orden-again.log" 2>&1 &
    app_pid=$!
    if wait_for_views 1; then
      sleep 3
      python3 "$here/dns-drive.py" "$out" again "$dns_name" "$dns_provider" "$out/doh/asked.txt" || status=1
    else
      echo "::error::no window mapped when started again"
      status=1
    fi
  fi
fi

if [ "$status" = 0 ] && [ "${DOWNLOAD:-0}" = 1 ]; then
  sleep 3
  python3 "$here/download-drive.py" "$out" "$NIB_DOWNLOADS_DIR" "$out/served.txt" || status=1
fi

if [ "$status" = 0 ] && [ "${GLOBALS:-0}" = 1 ]; then
  sleep 3
  python3 "$here/globals-drive.py" "$out" "${command[0]}" || status=1
fi

if [ "$status" = 0 ] && [ "${PASS:-0}" = 1 ]; then
  sleep 3
  python3 "$here/pass-drive.py" "$out" || status=1
  find "$HOME" -path '*ch.emilvinu.nib*' -name nib.log -exec grep -h 'pass' {} + 2>/dev/null | tail -20 || true
fi

if [ "$status" = 0 ] && [ "${GRANTS:-0}" = 1 ]; then
  sleep 3
  python3 "$here/grants-drive.py" "$out" || status=1
fi

if [ "$status" = 0 ] && [ "${EXTENSIONS:-0}" = 1 ]; then
  started_again() {
    kill -TERM "$app_pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    endpoint
    "${command[@]}" > "$out/orden-$1.log" 2>&1 &
    app_pid=$!
    if wait_for_views 1; then
      sleep 3
      return 0
    fi
    echo "::error::no window mapped when started again ($1)"
    return 1
  }
  sleep 3
  if python3 "$here/extensions-drive.py" "$out" installed "$ext_name"; then
    unset NIB_CEF_ARGS
    if started_again again; then
      python3 "$here/extensions-drive.py" "$out" again "$ext_name" || status=1
    else
      status=1
    fi
    if [ "$status" = 0 ] && python3 "$here/extensions-drive.py" "$out" firefox-install "$ext_name"; then
      if started_again firefox; then
        python3 "$here/extensions-drive.py" "$out" firefox-run "$ext_name" || status=1
      else
        status=1
      fi
    else
      status=1
    fi
  else
    status=1
  fi
fi

again() {
  kill -TERM "$app_pid" 2>/dev/null || true
  for _ in $(seq 50); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
  kill -KILL "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  endpoint
  "${command[@]}" >> "$out/orden-again.log" 2>&1 &
  app_pid=$!
  wait_for_views 1 || { echo "::error::no window mapped when started again"; return 1; }
  sleep 3
}
if [ "$status" = 0 ] && [ "${WATCH:-0}" = 1 ]; then
  sleep 5
  space=$(python3 "$here/watch-drive.py" "$out" where - | tail -1)
  if [ -z "$space" ] || [ ! -d "$space" ]; then
    echo "::error::the app made no working folder for its space in $NIB_SPACES_DIR: $space"
    status=1
  else
    echo "the space: $space"
    mkdir -p "$space/deep/inner" "$space/locked"
    for n in $(seq 400); do mkdir -p "$space/many/$n"; done
    chmod 000 "$space/locked"
    again && python3 "$here/watch-drive.py" "$out" folders "$space" || status=1
    if [ "$status" = 0 ]; then
      kill -TERM "$app_pid" 2>/dev/null || true
      for _ in $(seq 50); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
      kill -KILL "$app_pid" 2>/dev/null || true
      was=$(cat /proc/sys/fs/inotify/max_user_watches)
      used=$(cat /proc/[0-9]*/fdinfo/* 2>/dev/null | grep -c '^inotify' || true)
      echo "inotify: $used watches in use of $was; the limit lowered to $((used + 120))"
      sudo sysctl -q fs.inotify.max_user_watches=$((used + 120))
      again && python3 "$here/watch-drive.py" "$out" limit "$space" || status=1
      grep -h "could not watch all of" "$out"/orden*.log | head -3 || true
      sudo sysctl -q fs.inotify.max_user_watches="$was"
    fi
    chmod 755 "$space/locked"
  fi
fi

if [ "$status" = 0 ] && [ "${CLOSING:-0}" = 1 ]; then
  sleep 3
  if python3 "$here/closing-drive.py" "$out" open; then
    sleep 10
    again && python3 "$here/closing-drive.py" "$out" close || status=1
  else
    status=1
  fi
fi

if [ "$status" = 0 ] && [ "${SCHEME:-0}" = 1 ]; then
  sleep 3
  python3 "$here/scheme-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${CORNER:-0}" = 1 ]; then
  sleep 3
  python3 "$here/corner-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${CHOOSING:-0}" = 1 ]; then
  sleep 3
  python3 "$here/choosing-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${OPENS:-0}" = 1 ]; then
  sleep 3
  python3 "$here/opens-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${POPUP:-0}" = 1 ]; then
  sleep 3
  python3 "$here/popup-drive.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${DRAG:-0}" = 1 ]; then
  sleep 3
  python3 "$here/window-drag.py" sway "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${CHECK:-0}" = 1 ]; then
  APP_COMMAND="${command[0]}" python3 "$here/wayland-418.py" "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${RESERVED:-0}" = 1 ]; then
  sleep 3
  python3 "$here/reserved-drive.py" "$out" || status=1
fi

if [ "$status" = 0 ] && [ "${PDFMARK:-0}" = 1 ]; then
  sleep 3
  python3 "$here/pdf-mark-drive.py" "$out" || status=1
fi

if [ "$status" = 0 ] && [ "${CARRY:-0}" = 1 ]; then
  sleep 3
  python3 "$here/carry-drive.py" "$out" "$app_pid" || status=1
fi

if [ "$status" = 0 ] && [ "${KILL:-0}" = 1 ]; then
  sleep 3
  if python3 "$here/kill-drive.py" "$out" write; then
    sleep 0.1
    tree="$app_pid" under="$app_pid"
    while [ -n "$under" ]; do
      under=$(ps -e -o pid=,ppid= | awk -v set=" $under " 'index(set, " " $2 " ") { printf "%s ", $1 }')
      tree="$tree $under"
    done
    # shellcheck disable=SC2086 # one pid per word
    kill -KILL $tree 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    sleep 1
    endpoint
    "${command[@]}" > "$out/orden-again.log" 2>&1 &
    app_pid=$!
    if wait_for_views 1; then
      sleep 3
      python3 "$here/kill-drive.py" "$out" read || status=1
    else
      echo "::error::no window mapped when started again"
      status=1
    fi
  else
    status=1
  fi
fi

if [ "$status" = 0 ] && [ "${WORKER:-0}" = 1 ]; then
  sleep 3
  python3 "$here/worker-drive.py" "$out" opened || status=1
  if [ "$status" = 0 ]; then
    sleep 10
    kill -TERM "$app_pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    since=$(date +%s%3N)
    endpoint
    "${command[@]}" > "$out/orden-again.log" 2>&1 &
    app_pid=$!
    if wait_for_views 1; then
      sleep 3
      python3 "$here/worker-drive.py" "$out" "started again" "$since" || status=1
    else
      echo "::error::no window mapped when started again"
      status=1
    fi
  fi
fi

if [ "$status" = 0 ] && [ "${EXPORTPDF:-0}" = 1 ]; then
  sleep 3
  python3 "$here/pdf-drive.py" "$out" || status=1
fi

if [ "$status" = 0 ] && [ "${SESSION:-0}" = 1 ]; then
  closed() {
    swaymsg '[title=".*"] kill' > /dev/null || true
    for _ in $(seq 100); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
    if kill -0 "$app_pid" 2>/dev/null; then
      echo "::error::the app did not quit with its window closed"
      status=1
    fi
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  }
  again() {
    endpoint
    "${command[@]}" > "$out/orden-again.log" 2>&1 &
    app_pid=$!
    wait_for_views 1 || { echo "::error::no window mapped when started again"; status=1; }
    sleep 3
  }
  sleep 3
  python3 "$here/session-drive.py" "$out" first || status=1
  if [ "$status" = 0 ]; then
    read -r pages windows < "$out/session-counts"
    sleep 10
    closed
  fi
  if [ "$status" = 0 ]; then
    again
    python3 "$here/session-drive.py" "$out" again "$pages" "$windows" || status=1
  fi
  if [ "$status" = 0 ]; then
    sleep 35
    tree="$app_pid" under="$app_pid"
    while [ -n "$under" ]; do
      under=$(ps -e -o pid=,ppid= | awk -v set=" $under " 'index(set, " " $2 " ") { printf "%s ", $1 }')
      tree="$tree $under"
    done
    # shellcheck disable=SC2086 # one pid per word
    kill -KILL $tree 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    again
    python3 "$here/session-drive.py" "$out" killed "$pages" "$windows" || status=1
    if [ "$status" = 0 ]; then
      closed
      again
    fi
  fi
fi

if [ "$status" = 0 ] && [ "${DRIVE:-0}" = 1 ] && [ "${COLD:-0}" -gt 0 ]; then
  screens=$(swaymsg -t get_outputs | python3 -c 'import json,sys; print(" ".join(o["name"] for o in json.load(sys.stdin)))')
  for run in $(seq "$COLD"); do
    kill -TERM "$app_pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    screen=$(echo $screens | cut -d' ' -f$(( (run - 1) % $(echo $screens | wc -w) + 1 )))
    swaymsg focus output "$screen" > /dev/null
    endpoint
    "${command[@]}" > "$out/orden-cold-$run.log" 2>&1 &
    app_pid=$!
    if ! wait_for_views 1; then
      echo "::error::no window mapped on start $run"
      status=1
      break
    fi
    sleep 3
    echo "started again ($run of $COLD) on $screen:"
    COLD_RUN=$run python3 "$here/wayland-drive.py" "$out" "$app_pid" cold || status=1
  done
fi

if [ "$status" = 0 ] && [ -n "${QUICK_ADD_FLOATS:-}" ]; then
  views | grep -q '| floating |' || { echo "::error::quick add's window is tiled"; status=1; }
fi

sleep 2
if ! kill -0 "$app_pid" 2>/dev/null; then
  echo "::error::Orden ended before the run did"
  status=1
fi
if [ -n "$(strangers)" ]; then
  echo "::error::as the run ends, a window not under ${CLASS-nib}, or Chromium's own:"
  strangers
  status=1
fi
views > "$out/views.txt" || true
for screen in $(swaymsg -t get_outputs | python3 -c 'import json,sys; print(" ".join(o["name"] for o in json.load(sys.stdin)))'); do
  grim -o "$screen" "$out/end-$screen.png" 2>/dev/null || true
done
swaymsg -t get_tree > "$out/tree.json" || true
kill "$app_pid" 2>/dev/null || true
wait "$app_pid" 2>/dev/null || true
[ -n "$portal_pid" ] && kill "$portal_pid" 2>/dev/null || true
[ -n "$site_pid" ] && kill "$site_pid" 2>/dev/null || true
[ -n "${doh_pid:-}" ] && kill "$doh_pid" 2>/dev/null || true
[ -n "$pointer_pid" ] && kill "$pointer_pid" 2>/dev/null || true
kill "$sway_pid" 2>/dev/null || true

find "$HOME" -path '*ch.emilvinu.nib*' -name 'nib.log' -exec cp {} "$out/nib.log" \; 2>/dev/null || true
echo "::group::orden's output"
cat "$out/orden.log"
echo "::endgroup::"
if [ -f "$out/nib.log" ]; then
  echo "::group::nib.log"
  cat "$out/nib.log"
  echo "::endgroup::"
  if [ -n "${KEYS:-}" ]; then
    grep -q "global keys: $KEYS" "$out/nib.log" || { echo "::error::nib.log does not say 'global keys: $KEYS'"; status=1; }
  fi
fi

if [ -s "$out/handed.txt" ]; then
  echo "::error::the system's browser was handed what nobody asked it to open:"
  cat "$out/handed.txt"
  status=1
fi

if grep -nE 'EGL_BAD_PARAMETER|Could not create default EGL display|Error 71|Protocol error|-CRITICAL|cannot open display|Failed to create GBM|Aborting|GStreamer-WARNING|:FATAL:|Check failed' "$out"/orden*.log "$out/second.log" 2>/dev/null; then
  echo "::error::the graphics stack failed"
  status=1
fi

exit $status
