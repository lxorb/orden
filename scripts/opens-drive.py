#!/usr/bin/env python3
"""Every way a page opens a window, pressed by a pointer the way a hand presses it, and
what came of each. #1074: on some sites a press that opens a window did nothing.

A page of this run's own, in a web tab, with one wide button or link for each way:

  - a link with `target="_blank"`, and with `rel="noopener"`: a tab at the address;
  - `window.open(url)` in the press, after a `setTimeout` and after an `await`: a tab;
  - `window.open(url, name, 'width=..,height=..')`, a sign-in's popup: the page gets the
    window back, the popup has `window.opener` and its message reaches the page;
  - `window.open('about:blank')` and `window.open()`, then sent somewhere, and
    `window.open('')` written into: the page gets the window, and it goes there;
  - a form sent by POST to `target="_blank"`: the server hears a POST;
  - `window.open(url)` from a frame, and from a sandboxed frame with `allow-popups`;
  - `window.open` of a file the server hands over as a download: the server is asked.

Each case is pressed, and the server this drive runs says what the page and whatever it
opened asked for; a case whose requests are not all heard in time is a failure. Before
#1074 the popup lost its opener, and the blank windows and the POST opened nothing, or
the wrong thing: the page was answered `null` and a tab was built afresh at the address.

Run with Orden up (OPENS=1 in scripts/wayland-launch.sh):

    python3 scripts/opens-drive.py <sway|x11> <out folder> <app pid>

`sway` presses with the compositor's own pointer (scripts/wayland-pointer.py's FIFO in
<out>); `x11` with the X server's test extension, on $DISPLAY.
"""

import ctypes
import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import unquote

DESK, OUT, APP = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
POINTER = OUT / "pointer.fifo"
PAGES = 8770
SITE = f"http://127.0.0.1:{PAGES}"

# Each case: what is pressed, and every request that has to be heard once it is.
CASES = {
    "link_blank": ["GET /landing?link_blank"],
    "link_noopener": ["GET /landing?link_noopener"],
    "open_url": ["GET /landing?open_url"],
    "open_later": ["GET /landing?open_later"],
    "open_await": ["GET /landing?open_await"],
    "open_sized": [
        "GET /said?open_sized_win",
        "GET /signin?opener_yes",
        "GET /said?message_signed_in",
    ],
    "open_blank": ["GET /said?open_blank_win", "GET /landing?open_blank"],
    "open_nothing": ["GET /said?open_nothing_win", "GET /landing?open_nothing"],
    "open_written": ["GET /said?open_written_win", "GET /said?written"],
    "form_post": ["POST /posted?form_post"],
    "frame": ["GET /landing?frame"],
    "sandboxed": ["GET /landing?sandboxed"],
    "download": ["GET /download.bin"],
}

BUTTON = "display:block;box-sizing:border-box;width:100%;height:40px;margin:0 0 4px;font:16px sans-serif"
OPENER = f"""<!doctype html><title>opener</title>
<style>body{{margin:0}} a,button,iframe{{{BUTTON};border:0;background:#cde}}</style>
<script>
function said(what) {{ fetch('/said?' + what) }}
addEventListener('message', (e) => said('message_' + e.data))
function kept(name, w) {{ said(name + (w ? '_win' : '_null')); return w }}
addEventListener('load', () => {{
  const at = {{}}
  for (const one of document.querySelectorAll('[data-case]')) {{
    const r = one.getBoundingClientRect()
    at[one.dataset.case] = [r.x + r.width / 2, r.y + r.height / 2]
  }}
  said('at=' + encodeURIComponent(JSON.stringify(at)))
}})
</script>
<a data-case=link_blank href="/landing?link_blank" target=_blank>link_blank</a>
<a data-case=link_noopener href="/landing?link_noopener" target=_blank rel=noopener>link_noopener</a>
<button data-case=open_url onclick="window.open('/landing?open_url')">open_url</button>
<button data-case=open_later onclick="setTimeout(() => window.open('/landing?open_later'), 300)">open_later</button>
<button data-case=open_await onclick="(async () => {{ await fetch('/tick'); window.open('/landing?open_await') }})()">open_await</button>
<button data-case=open_sized onclick="kept('open_sized', window.open('/signin', 'signin', 'width=480,height=600'))">open_sized</button>
<button data-case=open_blank onclick="const w = kept('open_blank', window.open('about:blank')); if (w) w.location = '/landing?open_blank'">open_blank</button>
<button data-case=open_nothing onclick="const w = kept('open_nothing', window.open()); if (w) w.location.href = '/landing?open_nothing'">open_nothing</button>
<button data-case=open_written onclick="const w = kept('open_written', window.open('', '')); if (w) {{ w.document.write('<title>written</title>written<scr' + 'ipt>fetch(&quot;/said?written&quot;);setTimeout(() => close(), 500)</scr' + 'ipt>'); w.document.close() }}">open_written</button>
<form method=post action="/posted?form_post" target=_blank style="margin:0"><input type=hidden name=a value=1><button data-case=form_post>form_post</button></form>
<iframe data-case=frame src="/frame?frame"></iframe>
<iframe data-case=sandboxed sandbox="allow-scripts allow-popups" src="/frame?sandboxed"></iframe>
<button data-case=download onclick="window.open('/download.bin')">download</button>
"""
FRAME = f"""<!doctype html><style>body{{margin:0}}button{{{BUTTON}}}</style>
<button onclick="window.open('/landing?' + location.search.slice(1))">frame</button>"""
# A sign-in's popup: it tells the page that opened it, and closes, as an OAuth one does.
SIGNIN = """<!doctype html><title>sign-in</title><script>
fetch('/signin?opener_' + (window.opener ? 'yes' : 'no'))
if (window.opener) window.opener.postMessage('signed_in', '*')
setTimeout(() => window.close(), 500)
</script>signed in"""
# Anything opened goes again once it has loaded, so no window is left over the page.
LANDED = """<!doctype html><title>landed</title>landed<script>
if (window.opener) setTimeout(() => window.close(), 500)
</script>"""

heard = []


class Pages(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, body, kind="text/html", extra=()):
        self.send_response(200)
        self.send_header("content-type", kind)
        self.send_header("cache-control", "no-store")
        for key, value in extra:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else body.encode())

    def do_GET(self):
        heard.append(f"GET {self.path}")
        if self.path.startswith("/opener"):
            self.reply(OPENER)
        elif self.path.startswith("/frame"):
            self.reply(FRAME)
        elif self.path.startswith("/signin"):
            self.reply(SIGNIN)
        elif self.path.startswith("/download"):
            self.reply(b"x" * 64, "application/octet-stream", [("content-disposition", "attachment; filename=d.bin")])
        else:
            self.reply(LANDED)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", 0)))
        heard.append(f"POST {self.path}")
        self.reply(LANDED)


class Serving(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")


PORT, SECRET = endpoint()


def run(code, timeout=10):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=timeout) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


if DESK == "sway":

    def window():
        def walk(node):
            if str(node.get("pid")) == APP:
                yield node
            for child in node.get("nodes", []) + node.get("floating_nodes", []):
                yield from walk(child)

        tree = json.loads(subprocess.check_output(["swaymsg", "-r", "-t", "get_tree"]))
        found = sorted(walk(tree), key=lambda n: n["rect"]["width"] * n["rect"]["height"])
        rect = found[-1]["rect"]
        return rect["x"], rect["y"]

    def press(x, y):
        with open(POINTER, "w") as pointer:
            pointer.write(f"move {x} {y}\nclick\n")

    # On the wide screen at scale 1, as popup-drive.py puts it.
    subprocess.run(["swaymsg", f"[pid={APP}] move container to output HEADLESS-2, focus"], check=False)
    time.sleep(2)

else:
    X = ctypes.CDLL("libX11.so.6")
    TEST = ctypes.CDLL("libXtst.so.6")
    X.XOpenDisplay.restype = ctypes.c_void_p
    X.XOpenDisplay.argtypes = [ctypes.c_char_p]
    X.XFlush.argtypes = [ctypes.c_void_p]
    TEST.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    TEST.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    SHOWN = X.XOpenDisplay(os.environ.get("DISPLAY", ":0").encode())

    def window():
        return 0, 0

    def press(x, y):
        TEST.XTestFakeMotionEvent(SHOWN, -1, int(x), int(y), 0)
        TEST.XTestFakeButtonEvent(SHOWN, 1, 1, 0)
        TEST.XTestFakeButtonEvent(SHOWN, 1, 0, 0)
        X.XFlush(SHOWN)


def where():
    """Each case's middle in the page, as the page last said."""
    for one in reversed(heard):
        if one.startswith("GET /said?at="):
            return json.loads(unquote(one[len("GET /said?at=") :]))
    return {}


def hole():
    """Where the window put the web tab's page, in the window's own pixels."""
    for _ in range(40):
        sent = run(
            "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        if isinstance(sent, dict) and sent.get("width", 0) > 10:
            return sent
        time.sleep(0.5)
    return None


threading.Thread(target=Serving(("127.0.0.1", PAGES), Pages).serve_forever, daemon=True).start()

for _ in range(60):
    if run("1 + 1") == 2:
        break
    time.sleep(0.5)
run("(nib.workspace.openWebsite(), 'opened')")
time.sleep(0.5)
OWN = run("nib.workspace.activeTabId")
for _ in range(10):
    run(f"(nib.pages.go({json.dumps(OWN)}, '{SITE}/opener'), 'sent')")
    time.sleep(3)
    if where():
        break
place = hole()
if not where() or not place:
    raise SystemExit("::error::the page of cases never came up in its tab")
RATIO = run("devicePixelRatio") or 1
OTHERS = (
    "(() => { const ws = nib.workspace; for (const tab of [...ws.tabs])"
    f" if (tab.kind === 'web' && tab.id !== {json.dumps(OWN)}) ws.close(tab.id);"
    f" ws.activate({json.dumps(OWN)}); return true }})()"
)

failures = []
for case, wanted in CASES.items():
    at = where().get(case)
    if not at:
        failures.append(f"{case}: not on the page")
        continue
    left, top = window()
    began = len(heard)
    press(left + (place["x"] + at[0]) * RATIO, top + (place["y"] + at[1]) * RATIO)
    missing = wanted
    for _ in range(25):
        time.sleep(0.2)
        missing = [one for one in wanted if one not in heard[began:]]
        if not missing:
            break
    asked = [one for one in heard[began:] if not one.startswith(("GET /tick", "GET /favicon"))]
    if missing:
        failures.append(f"{case}: never heard {missing}; heard {asked}")
        print(f"::error::{case}: never heard {missing}; heard {asked}")
    else:
        print(f"{case}: {asked}")
    run(OTHERS)
    time.sleep(1.2)

(OUT / "opens.json").write_text(json.dumps({"failures": failures, "heard": heard}, indent=2))
if failures:
    raise SystemExit(f"::error::{len(failures)} of {len(CASES)} ways of opening a window failed")
print(f"every one of {len(CASES)} ways of opening a window did what it asked for")
