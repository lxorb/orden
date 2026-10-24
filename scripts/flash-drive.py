#!/usr/bin/env python3
"""Tabs switched in the dark, filmed frame by frame: no frame of the pane may be white.
#762: on Linux every switch of tab flashed the page white for a moment.

Run with Orden up on scripts/wayland-launch.sh's or scripts/x11-launch.sh's dark page
(FLASH=1), under one of two desktops; the screen is filmed for the whole of it, by
wf-recorder under sway and by ffmpeg's x11grab under an X server. The app is put in its
dark scheme, and the strip's note tab and web tab chosen in turn, ten times each. Every
frame's pane is read: a pane more than a tenth white in any frame is a flash, and the
run fails with that frame kept in <out>.

    python3 scripts/flash-drive.py <sway|x11> <out folder> <app pid> [switches]
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DESK, OUT, APP = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
ROUNDS = int(sys.argv[4]) if len(sys.argv) > 4 else 5
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
POINTER = OUT / "pointer.fifo"
failures = []
done = []


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

    def tell(line):
        with open(POINTER, "w") as pointer:
            pointer.write(line + "\n")

    def move(x, y):
        tell(f"move {x} {y}")

    def click():
        tell("click")

    def shoot(name):
        subprocess.run(["grim", str(OUT / f"flash-{name}.png")], check=False)

    # On the wide screen at scale 1, where the sidebar and its space switcher show: on
    # the narrow one the sidebar is folded away.
    subprocess.run(["swaymsg", f"[pid={APP}] move container to output HEADLESS-2, focus"], check=False)
    time.sleep(2)

else:

    def xdo(*words):
        return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout

    def window():
        found = [w for w in xdo("search", "--onlyvisible", "--name", "Orden").split() if w]
        best, area, at = None, 0, (0, 0)
        for one in found:
            got = dict(
                line.split("=", 1) for line in xdo("getwindowgeometry", "--shell", one).split() if "=" in line
            )
            size = int(got.get("WIDTH", 0)) * int(got.get("HEIGHT", 0))
            if size > area:
                best, area, at = one, size, (int(got["X"]), int(got["Y"]))
        return at

    def move(x, y):
        xdo("mousemove", str(int(x)), str(int(y)))

    def click():
        xdo("click", "1")

    def shoot(name):
        subprocess.run(["import", "-window", "root", str(OUT / f"flash-{name}.png")], check=False)


def ratio():
    return run("devicePixelRatio") or 1


def box(selector, text=None):
    """Where an element of the window's page is, in its own pixels: the first that
    matches and is drawn, with `text` as its words where given."""
    return run(
        "(() => { for (const one of document.querySelectorAll(%s)) {"
        " const r = one.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;"
        " if (%s !== null && one.textContent.trim() !== %s) continue;"
        " return { x: r.x, y: r.y, width: r.width, height: r.height } } return null })()"
        % (json.dumps(selector), json.dumps(text), json.dumps(text))
    )


def at(rect):
    """The middle of `rect` on the screen."""
    x, y = window()
    scale = ratio()
    return x + (rect["x"] + rect["width"] / 2) * scale, y + (rect["y"] + rect["height"] / 2) * scale


def press(rect):
    move(*at(rect))
    time.sleep(0.25)
    click()


def until(code, seconds=4):
    for _ in range(int(seconds / 0.2)):
        said = run(code)
        if said:
            return said
        time.sleep(0.2)
    return None


SWITCHES = int(sys.argv[4]) if len(sys.argv) > 4 else 10


def fail(what, name):
    print(f"::error::{DESK}: {what}")
    failures.append(what)


TABS = (
    "[...document.querySelectorAll('.tab .pick[data-tab]')].map((one) => { const r = one.getBoundingClientRect();"
    " return { id: one.dataset.tab, web: nib.pages.each().some(([id]) => id === one.dataset.tab),"
    " chosen: !!one.closest('.tab.active'), x: r.x, y: r.y, width: r.width, height: r.height } })"
)
PANE = (
    "(() => { const one = document.querySelector('.pane, main'); if (!one) return null;"
    " const r = one.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
)
TOGGLE = "button.act[aria-label='Light'], button.act[aria-label='Dark']"


def tabs():
    return run(TABS) or []


# Dark, as the reader who was flashed: the scheme switched where it is light.
for _ in range(3):
    if run("document.documentElement.dataset.theme") == "dark":
        break
    button = box(TOGGLE)
    if isinstance(button, dict):
        press(button)
    time.sleep(1.5)
if run("document.documentElement.dataset.theme") != "dark":
    raise SystemExit(f"::error::{DESK}: the app would not go dark")

web = next((one for one in tabs() if one["web"]), None)
note = next((one for one in tabs() if not one["web"]), None)
if not web or not note:
    raise SystemExit(f"::error::{DESK}: no web tab and note tab side by side in the strip ({tabs()})")
press(web)
until("nib.pages.each().some(([, page]) => page.sent && page.sent.visible)", 20)
time.sleep(3)

# Where the pane is on the screen, in the screen's pixels: what every frame is read in.
x0, y0 = window()
scale = ratio()
hole = run(
    "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
    ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
)
if not isinstance(hole, dict):
    raise SystemExit(f"::error::{DESK}: no hole for the web tab's page")
area = (
    int(x0 + hole["x"] * scale) + 4,
    int(y0 + hole["y"] * scale) + 4,
    int(x0 + (hole["x"] + hole["width"]) * scale) - 4,
    int(y0 + (hole["y"] + hole["height"]) * scale) - 4,
)
print(f"{DESK}: the pane is {area} on the screen")

film = OUT / "flash.mkv"
if DESK == "sway":
    output = json.loads(subprocess.check_output(["swaymsg", "-r", "-t", "get_outputs"]))
    on = next((one["name"] for one in output if one["rect"]["x"] <= area[0] < one["rect"]["x"] + one["rect"]["width"]), output[0]["name"])
    recorder = subprocess.Popen(["wf-recorder", "-o", on, "-r", "60", "-y", "-f", str(film)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    origin = next(one["rect"] for one in output if one["name"] == on)
    area = (area[0] - origin["x"], area[1] - origin["y"], area[2] - origin["x"], area[3] - origin["y"])
else:
    width, height = (int(n) for n in subprocess.check_output(["xdotool", "getdisplaygeometry"], text=True).split())
    recorder = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "60",
         "-video_size", f"{width}x{height}", "-i", os.environ.get("DISPLAY", ":0"),
         "-c:v", "ffv1", str(film)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)

for turn in range(SWITCHES):
    for one, name in ((note, "the note"), (web, "the web tab")):
        press(one)
        time.sleep(1.2)
time.sleep(1)
if DESK == "sway":
    recorder.send_signal(2)
else:
    recorder.communicate(b"q", timeout=30)
recorder.wait(timeout=30)

# Every frame's pane: how much of it is white.
frames = OUT / "frames"
frames.mkdir(exist_ok=True)
left, top, right, bottom = area
subprocess.run(
    ["ffmpeg", "-loglevel", "error", "-y", "-i", str(film), "-vf",
     f"crop={right - left}:{bottom - top}:{left}:{top},scale=160:-1", str(frames / "%05d.png")],
    check=True,
)
from PIL import Image

worst, flashes, count = 0.0, [], 0
for path in sorted(frames.glob("*.png")):
    count += 1
    image = Image.open(path).convert("RGB")
    pixels = list(image.getdata())
    white = sum(1 for r, g, b in pixels if r > 220 and g > 220 and b > 220) / len(pixels)
    worst = max(worst, white)
    if white > 0.1:
        flashes.append((path.name, round(white, 2)))
    else:
        path.unlink()
print(f"{DESK}: {count} frames of {SWITCHES * 2} switches; the whitest pane was {worst:.0%} white")
if not count:
    fail("no frames were filmed", "film")
if flashes:
    fail(f"{len(flashes)} frames flashed white, the first {flashes[:5]}", "flash")

(OUT / "flash.json").write_text(json.dumps({"frames": count, "worst": worst, "flashes": flashes, "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
