#!/usr/bin/env python3
"""A web tab's page in the rounded card it fills: its two bottom corners are the card's,
not square. #1088: what is open stands in a card with rounded corners, and a web tab's
page - a native view, drawn over the card - stood square out of both of its lower corners.

A page of one colour, magenta edge to edge, in a web tab, and a picture of the screen: just
inside each bottom corner of the page's rectangle there must be no magenta - the card's
corner is there - while the middle of its bottom edge and its two top corners, under the
bar, are the page's.

Run with Orden up (CORNER=1 in scripts/wayland-launch.sh):

    python3 scripts/corner-drive.py <sway|x11> <out folder> <app pid>

`sway` photographs with grim, `x11` through the X server, on $DISPLAY.
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

DESK, OUT, APP = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
PAGES = 8772
MAGENTA = (255, 0, 255)


class Pages(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"<!doctype html><title>magenta</title><body style='margin:0;height:100vh;background:#ff00ff'>")


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

    def picture():
        """The screen the window is on, as its width, height and RGB bytes: grim's PPM of
        that one output, since grim draws every output at once at the largest scale."""
        subprocess.run(["swaymsg", f"[pid={APP}] move container to output HEADLESS-2, focus"], check=False)
        time.sleep(2)
        raw = subprocess.run(
            ["grim", "-o", "HEADLESS-2", "-t", "ppm", "-"], capture_output=True, check=True
        ).stdout
        parts = raw.split(maxsplit=4)
        return int(parts[1]), int(parts[2]), parts[4]

else:

    class Image(ctypes.Structure):
        _fields_ = [("width", ctypes.c_int), ("height", ctypes.c_int), ("xoffset", ctypes.c_int),
                    ("format", ctypes.c_int), ("data", ctypes.POINTER(ctypes.c_ubyte)),
                    ("byte_order", ctypes.c_int), ("bitmap_unit", ctypes.c_int),
                    ("bitmap_bit_order", ctypes.c_int), ("bitmap_pad", ctypes.c_int),
                    ("depth", ctypes.c_int), ("bytes_per_line", ctypes.c_int),
                    ("bits_per_pixel", ctypes.c_int)]

    X = ctypes.CDLL("libX11.so.6")
    X.XOpenDisplay.restype = ctypes.c_void_p
    X.XOpenDisplay.argtypes = [ctypes.c_char_p]
    X.XDefaultRootWindow.restype = ctypes.c_ulong
    X.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    X.XGetImage.restype = ctypes.POINTER(Image)
    X.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
                            ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
    SHOWN = X.XOpenDisplay(os.environ.get("DISPLAY", ":0").encode())

    def picture():
        """The X server's screen, as its width, height and RGB bytes."""
        image = X.XGetImage(SHOWN, X.XDefaultRootWindow(SHOWN), 0, 0, 1600, 1000, 0xFFFFFFFF, 2).contents
        line = image.bytes_per_line
        raw = ctypes.string_at(image.data, line * image.height)
        rgb = bytearray()
        for y in range(image.height):
            row = raw[y * line : y * line + image.width * 4]
            for x in range(0, len(row), 4):
                rgb += bytes((row[x + 2], row[x + 1], row[x]))
        return image.width, image.height, bytes(rgb)


def near(colour, other, slack=40):
    return all(abs(one - two) <= slack for one, two in zip(colour, other))


threading.Thread(target=Serving(("127.0.0.1", PAGES), Pages).serve_forever, daemon=True).start()
for _ in range(60):
    if run("1 + 1") == 2:
        break
    time.sleep(0.5)
run("(nib.workspace.openWebsite(), 'opened')")
time.sleep(0.5)
tab = run("nib.workspace.activeTabId")
run(f"(nib.pages.go({json.dumps(tab)}, 'http://127.0.0.1:{PAGES}/'), 'sent')")
time.sleep(5)

place = None
for _ in range(40):
    place = run(f"(() => {{ const page = nib.pages.of({json.dumps(tab)}); return page && page.sent && page.sent.visible ? page.sent.pane : null }})()")
    if isinstance(place, dict) and place.get("width", 0) > 10:
        break
    time.sleep(0.25)
corner = run("parseFloat(getComputedStyle(document.querySelector('main')).getPropertyValue('--card-radius')) || 0")
if not isinstance(place, dict) or not corner:
    raise SystemExit(f"::error::no page placed in a rounded card: {place!r}, corner {corner!r}")

wide, tall, data = picture()


def at(x, y):
    one = (y * wide + x) * 3
    return tuple(data[one : one + 3])


# The page's own rectangle, read off the picture rather than worked out: every row that
# holds magenta, and the furthest it reaches either way.
MARK = bytes(MAGENTA)
rows = []
for y in range(tall):
    row = data[y * wide * 3 : (y + 1) * wide * 3]
    first = row.find(MARK)
    while first != -1 and first % 3:
        first = row.find(MARK, first + 1)
    if first == -1:
        continue
    last = row.rfind(MARK)
    while last != -1 and last % 3:
        last = row.rfind(MARK, 0, last)
    rows.append((y, first // 3, last // 3))
if not rows:
    raise SystemExit("::error::the page is nowhere on the screen")
x0 = min(one[1] for one in rows)
x1 = max(one[2] for one in rows)
y0, y1 = rows[0][0], rows[-1][0]
points = {
    "the bottom left corner": (x0, y1),
    "the bottom right corner": (x1, y1),
    "the middle of the bottom edge": ((x0 + x1) // 2, y1),
    "the top left corner": (x0, y0),
    "the top right corner": (x1, y0),
}
seen = {name: at(*point) for name, point in points.items()}
print(f"the card's corner is {corner} px; the page is from {(x0, y0)} to {(x1, y1)}: {seen}")

failures = []
for name in ("the bottom left corner", "the bottom right corner"):
    if near(seen[name], MAGENTA):
        failures.append(f"the page is square at {name}: {seen[name]}")
for name in ("the middle of the bottom edge", "the top left corner", "the top right corner"):
    if not near(seen[name], MAGENTA):
        failures.append(f"the page is not drawn at {name}: {seen[name]}")
(OUT / "corner.json").write_text(json.dumps({"seen": seen, "failures": failures}, indent=2))
for one in failures:
    print(f"::error::{one}")
if failures:
    raise SystemExit(1)
print("the page wears the card's corners at its bottom, and is the page everywhere else")
