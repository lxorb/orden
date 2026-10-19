#!/usr/bin/env python3
"""Orden's window moved by its own tab strip, resized by its edge and maximised by a
double click on the strip, the way a hand does each - and each looked at. #427: under
KDE the strip moved nothing on CEF (src-tauri/src/window_drag.rs).

Run with Orden up, its endpoint open to `eval` (as scripts/wayland-launch.sh and
scripts/x11-launch.sh leave it), under one of two desktops:

  sway   the compositor's own pointer (scripts/wayland-pointer.py's FIFO in <out>), and
         sway's tree for where the window is. The window is floated first, as only a
         floating window moves under a tiling compositor.
  x11    xdotool's pointer on the X server, and the window as the X server has it.

    python3 scripts/window-drag.py <sway|x11> <out folder> <app pid>

Every step leaves a picture in <out> and its numbers in <out>/drag.json, and the run
fails where the window did not move, grow or fill the screen.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DESK, OUT, APP = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
POINTER = OUT / "pointer.fifo"
seen = {}
failures = []


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


def run(code):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=10) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


def fail(what):
    print(f"::error::{what}")
    failures.append(what)


# Where the window is on the screen, x, y, width, height, and the pointer's moves.
if DESK == "sway":

    def sway(*words):
        return json.loads(subprocess.check_output(["swaymsg", "-r", *words]))

    def window():
        def walk(node):
            if str(node.get("pid")) == APP or (
                node.get("type") in ("con", "floating_con") and "Orden" in (node.get("name") or "")
            ):
                yield node
            for child in node.get("nodes", []) + node.get("floating_nodes", []):
                yield from walk(child)

        found = sorted(walk(sway("-t", "get_tree")), key=lambda n: n["rect"]["width"] * n["rect"]["height"])
        rect = found[-1]["rect"]
        return rect["x"], rect["y"], rect["width"], rect["height"]

    def tell(line):
        with open(POINTER, "w") as pointer:
            pointer.write(line + "\n")

    def move(x, y):
        tell(f"move {x} {y}")

    def press():
        tell("press")

    def release():
        tell("release")

    def double_click():
        tell("click")
        time.sleep(0.08)
        tell("click")

    def shoot(name):
        subprocess.run(["grim", str(OUT / f"drag-{name}.png")], check=False)

    def screen():
        output = next(one for one in sway("-t", "get_outputs") if one["name"] == "HEADLESS-2")["rect"]
        return output["width"], output["height"]

    # On the screen at scale 1, wide enough for the window to stay on it as it moves and grows.
    subprocess.run(
        ["swaymsg", '[title="Orden"] floating enable, move container to output HEADLESS-2, resize set 900 600, move position 100 100'],
        check=False,
    )
    time.sleep(1.5)
else:

    def xdo(*words):
        return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout

    def wid():
        # By its title, which is the page's and ends in the app's name; its pid is not
        # always said on the window.
        found = [w for w in xdo("search", "--onlyvisible", "--name", "Orden").split() if w]
        best, area = None, 0
        for one in found:
            shape = xdo("getwindowgeometry", "--shell", one)
            got = dict(line.split("=", 1) for line in shape.split() if "=" in line)
            size = int(got.get("WIDTH", 0)) * int(got.get("HEIGHT", 0))
            if size > area:
                best, area = one, size
        return best

    def window():
        shape = xdo("getwindowgeometry", "--shell", wid())
        got = dict(line.split("=", 1) for line in shape.split() if "=" in line)
        return int(got["X"]), int(got["Y"]), int(got["WIDTH"]), int(got["HEIGHT"])

    def move(x, y):
        xdo("mousemove", str(int(x)), str(int(y)))

    def press():
        xdo("mousedown", "1")

    def release():
        xdo("mouseup", "1")

    def double_click():
        xdo("click", "--repeat", "2", "--delay", "80", "1")

    def shoot(name):
        subprocess.run(["import", "-window", "root", str(OUT / f"drag-{name}.png")], check=False)

    def screen():
        size = xdo("getdisplaygeometry").split()
        return int(size[0]), int(size[1])

    # A size of its own, away from the corner, so a move and a resize both show.
    xdo("windowsize", wid(), "900", "600")
    xdo("windowmove", wid(), "100", "100")
    time.sleep(1.5)


def drag(start, by, steps=12):
    """The button pressed at `start` on the screen, the pointer carried `by`, let go."""
    move(*start)
    time.sleep(0.3)
    press()
    time.sleep(0.25)
    for step in range(1, steps + 1):
        move(start[0] + by[0] * step / steps, start[1] + by[1] * step / steps)
        time.sleep(0.04)
    time.sleep(0.3)
    release()
    time.sleep(1.0)


# A press on the tab strip's own empty part, where Tauri's drag region is.
# A point the region itself is on top at, looked for across its width: the strip's
# region lies under the tabs, and shows only where there are none.
region = run(
    "(() => { for (const one of document.querySelectorAll('[data-tauri-drag-region]')) {"
    " const r = one.getBoundingClientRect(); if (r.width < 20 || r.height < 8) continue;"
    " const y = r.y + r.height / 2;"
    " for (let x = r.x + r.width - 12; x > r.x + 8; x -= 6) {"
    " if (document.elementFromPoint(x, y) === one) return { x, y } } } return null })()"
)
if not isinstance(region, dict):
    fail("no drag region to press on")
    region = {"x": 300, "y": 12}
seen["region"] = region

before = window()
shoot("before")
drag((before[0] + region["x"], before[1] + region["y"]), (160, 90))
moved = window()
shoot("moved")
seen["move"] = {"before": before, "after": moved}
print(f"{DESK}: the strip dragged by (160, 90): {before} -> {moved}")
if abs(moved[0] - before[0] - 160) > 20 or abs(moved[1] - before[1] - 90) > 20:
    fail(f"{DESK}: the window did not follow the strip ({before} -> {moved})")

# What the page hears of the pointer from here on, kept in the page and read back with
# the numbers: a drag that moved nothing is then a press the page never had, or one it
# had and did nothing with.
run(
    "(() => { window.__dragHeard = []; for (const kind of ['mousedown', 'mouseup', 'pointercancel', 'lostpointercapture', 'blur', 'focus'])"
    " window.addEventListener(kind, (e) => window.__dragHeard.push([kind, Math.round(performance.now()),"
    " e.clientX ?? null, e.clientY ?? null, e.button ?? null, e.buttons ?? null, innerWidth, innerHeight]), true);"
    " return true })()"
)

# The right edge, two pixels in, carried out by 120.
at = window()
drag((at[0] + at[2] - 2, at[1] + at[3] // 2), (120, 0))
grown = window()
seen["heard"] = run("window.__dragHeard")
print(f"{DESK}: the page heard {seen['heard']}")
shoot("resized")
seen["resize"] = {"before": at, "after": grown}
print(f"{DESK}: the right edge dragged by 120: {at} -> {grown}")
if grown[2] - at[2] < 80:
    fail(f"{DESK}: the window did not grow by its edge ({at} -> {grown})")

# A double click on the strip, which maximises. Not under sway, which has no such state
# for a floating window.
if DESK != "sway":
    at = window()
    move(at[0] + region["x"], at[1] + region["y"])
    time.sleep(0.3)
    double_click()
    time.sleep(1.5)
    full = window()
    shoot("maximised")
    width, height = screen()
    seen["maximise"] = {"before": at, "after": full, "screen": [width, height]}
    print(f"{DESK}: a double click on the strip: {at} -> {full} on a {width}x{height} screen")
    if full[2] < width * 0.9 or full[3] < height * 0.85:
        fail(f"{DESK}: a double click on the strip did not fill the screen ({full})")

(OUT / "drag.json").write_text(json.dumps({"seen": seen, "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
