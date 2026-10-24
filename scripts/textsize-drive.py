#!/usr/bin/env python3
"""Settings > Editor > Text size moved with a pointer, the way a hand does, and the
note's text looked at. #680: on Linux the slider changed nothing a reader could see.

    python3 scripts/textsize-drive.py <sway|x11> <out folder> <app pid>

Settings opened by its key, the Editor pane chosen, the Text size slider dragged from a
quarter of the way to nearly three quarters; the editor's text has to be larger, as the
page computes it and as the screen shows it, after Settings is closed, and still after
the page is loaded again.
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
        subprocess.run(["grim", str(OUT / f"textsize-{name}.png")], check=False)

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
        subprocess.run(["import", "-window", "root", str(OUT / f"textsize-{name}.png")], check=False)


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


def fail(what, name):
    print(f"::error::{DESK}: {what}")
    failures.append(what)
    shoot(name)


SIZE = "(() => { const c = document.querySelector('.cm-content'); return c ? parseFloat(getComputedStyle(c).fontSize) : null })()"
SLIDER = "input[type=range][min='0.8']"


def text_box():
    return run("(() => { const c = document.querySelector('.cm-content'); if (!c) return null; const r = c.getBoundingClientRect();"
               " return { x: r.x, y: r.y, width: Math.min(r.width, 500), height: Math.min(r.height, 220) } })()")


def ink(name):
    """How many dark pixels the start of the note's text has on the screen."""
    from PIL import Image

    shoot(name)
    box = text_box()
    if not isinstance(box, dict):
        return None
    x, y = window()
    scale = ratio()
    image = Image.open(OUT / f"textsize-{name}.png").convert("L")
    if DESK == "sway":
        # grim shoots every output at the largest scale: the window's place, in its pixels.
        outputs = json.loads(subprocess.check_output(["swaymsg", "-r", "-t", "get_outputs"]))
        most = max(one["scale"] for one in outputs)
        left = min(one["rect"]["x"] for one in outputs)
        top = min(one["rect"]["y"] for one in outputs)
        k = most
        x, y = (x - left) * k, (y - top) * k
    else:
        k = 1
    area = (int(x + box["x"] * scale * k), int(y + box["y"] * scale * k),
            int(x + (box["x"] + box["width"]) * scale * k), int(y + (box["y"] + box["height"]) * scale * k))
    crop = image.crop(area)
    return sum(1 for value in crop.getdata() if value < 110)


until("!!document.querySelector('.cm-content')", 30)
time.sleep(2)
before = run(SIZE)
inked = ink("before")
run("document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true }))")
time.sleep(2)
tab = run("(() => { const b = [...document.querySelectorAll('button, [role=tab]')].find((one) => one.textContent.trim() === 'Editor');"
          " if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()")
if not isinstance(tab, dict):
    fail("Settings has no Editor pane to choose", "settings")
    sys.exit(1)
press(tab)
time.sleep(1.5)
slider = box(SLIDER)
if not isinstance(slider, dict):
    fail("no Text size slider in the Editor pane", "slider")
    sys.exit(1)
x, y = window()
scale = ratio()
start = (x + (slider["x"] + slider["width"] * 0.25) * scale, y + (slider["y"] + slider["height"] / 2) * scale)
move(*start)
time.sleep(0.3)
if DESK == "sway":
    tell("press")
else:
    xdo("mousedown", "1")
time.sleep(0.3)
for step in range(1, 11):
    move(start[0] + slider["width"] * scale * 0.05 * step, start[1])
    time.sleep(0.05)
if DESK == "sway":
    tell("release")
else:
    xdo("mouseup", "1")
time.sleep(1)
value = run(f"document.querySelector(\"{SLIDER}\").value")
run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
time.sleep(1.5)
after = run(SIZE)
inked_after = ink("after")
print(f"{DESK}: the slider at {value}; the note's text {before}px -> {after}px; ink {inked} -> {inked_after}")
if not after or not before or after <= before * 1.1:
    fail(f"the note's text did not grow: {before}px -> {after}px (the slider at {value})", "not-grown")
if inked is not None and inked_after is not None and inked_after <= inked * 1.1:
    fail(f"the note's text on the screen did not grow: {inked} -> {inked_after} dark pixels", "not-drawn")
run("location.reload()")
time.sleep(8)
until("!!document.querySelector('.cm-content')", 30)
kept = run(SIZE)
print(f"{DESK}: loaded again, the note's text is {kept}px")
if not kept or abs(kept - after) > 0.5:
    fail(f"the size did not last a load: {after}px -> {kept}px", "not-kept")
(OUT / "textsize.json").write_text(json.dumps({"before": before, "after": after, "kept": kept, "ink": [inked, inked_after], "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
