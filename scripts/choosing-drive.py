#!/usr/bin/env python3

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
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "so.orden.Orden"
POINTER = OUT / "pointer.fifo"
PAGES = 8771
SITE = f"http://127.0.0.1:{PAGES}"
PAGE = "<!doctype html><title>{0}</title><body style='margin:0;height:100vh;background:{1}'>{0}"

class Pages(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        name = self.path.strip("/") or "page"
        colour = "#c8e6c9" if name == "left" else "#bbdefb"
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE.format(name, colour).encode())

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

threading.Thread(target=Serving(("127.0.0.1", PAGES), Pages).serve_forever, daemon=True).start()

for _ in range(60):
    if run("1 + 1") == 2:
        break
    time.sleep(0.5)

def web_tab(name):
    run("(nib.workspace.openWebsite(), 'opened')")
    time.sleep(0.5)
    tab = run("nib.workspace.activeTabId")
    run(f"(nib.pages.go({json.dumps(tab)}, '{SITE}/{name}'), 'sent')")
    return tab

LEFT = web_tab("left")
time.sleep(1)
run(f"(nib.workspace.split('row', {json.dumps(LEFT)}), 'split')")
time.sleep(1)
RIGHT = web_tab("right")
time.sleep(4)

PANE_OF = "(id) => nib.workspace.tabs.find((tab) => tab.id === id).paneId"
WHO = f"JSON.stringify([nib.workspace.activeTabId, nib.workspace.panes.focusedId, ({PANE_OF})({json.dumps(LEFT)}), ({PANE_OF})({json.dumps(RIGHT)})])"
active, focused, LEFT_PANE, RIGHT_PANE = json.loads(run(WHO) or "[null,null,null,null]")
if not LEFT_PANE or LEFT_PANE == RIGHT_PANE:
    raise SystemExit(f"::error::the two web tabs are not in two panes: {run(WHO)}")

RATIO = run("devicePixelRatio") or 1

def middle(tab):
    for _ in range(40):
        sent = run(f"(() => {{ const page = nib.pages.of({json.dumps(tab)}); return page && page.sent && page.sent.visible ? page.sent.pane : null }})()")
        if isinstance(sent, dict) and sent.get("width", 0) > 10:
            left, top = window()
            return left + (sent["x"] + sent["width"] / 2) * RATIO, top + (sent["y"] + sent["height"] / 2) * RATIO
        time.sleep(0.25)
    raise SystemExit(f"::error::the page of {tab} is not on the screen")

def chosen_after(tab, pane, what):
    for _ in range(20):
        time.sleep(0.15)
        now, focused, _, _ = json.loads(run(WHO))
        if now == tab and focused == pane:
            print(f"{what}: chosen")
            return True
    failures.append(f"{what}: the tab worked in is {now}, the pane {focused}")
    print(f"::error::{what}: the tab worked in is {now}, the pane {focused}")
    return False

failures = []
for round_ in range(1, 4):
    run(f"(nib.workspace.focusPane({json.dumps(LEFT_PANE)}), 'left')")
    time.sleep(0.5)
    press(*middle(RIGHT))
    chosen_after(RIGHT, RIGHT_PANE, f"round {round_}: the right page pressed with the left pane worked in")
    press(*middle(LEFT))
    chosen_after(LEFT, LEFT_PANE, f"round {round_}: the left page pressed")
    press(*middle(RIGHT))
    chosen_after(RIGHT, RIGHT_PANE, f"round {round_}: the right page pressed again")
    run(f"(nib.workspace.focusPane({json.dumps(LEFT_PANE)}), 'left')")
    time.sleep(0.5)
    press(*middle(RIGHT))
    chosen_after(RIGHT, RIGHT_PANE, f"round {round_}: the right page, which had the keyboard, pressed")

(OUT / "choosing.json").write_text(json.dumps({"failures": failures}, indent=2))
if failures:
    raise SystemExit(f"::error::{len(failures)} presses into a page left another pane worked in")
print("every press into a page chose its tab and its pane")
