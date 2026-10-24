#!/usr/bin/env python3
"""A page written only for light, with no ground of its own, stands on white in either
of the app's schemes. #763: under a dark scheme such a page was dark text on dark, its
own white parts a frame round it.

Run with Orden up on scripts/wayland-launch.sh's page for it (GROUND=1): a white header,
dark words, and no colour for the page itself. In the app's light scheme and its dark
one, the page's body has to be white and its words have to show.

    python3 scripts/ground-drive.py <sway|x11> <out folder> <app pid>
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
        subprocess.run(["grim", str(OUT / f"ground-{name}.png")], check=False)

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
        subprocess.run(["import", "-window", "root", str(OUT / f"ground-{name}.png")], check=False)


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


VISIBLE = "nib.pages.each().some(([, page]) => page.sent && page.sent.visible)"
WEB_TAB = (
    "(() => { const one = [...document.querySelectorAll('.tab .pick[data-tab]')]"
    ".find((tab) => nib.pages.each().some(([id]) => id === tab.dataset.tab));"
    " if (!one) return null; const r = one.getBoundingClientRect();"
    " return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
)
HOLE = (
    "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
    ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
)
TOGGLE = "button.act[aria-label='Light'], button.act[aria-label='Dark']"


def colour_at(x, y):
    """The colour on the screen at `x`, `y`, as the screen has it."""
    shot = OUT / "scheme-now.png"
    if DESK == "sway":
        subprocess.run(["grim", "-g", f"{int(x)},{int(y)} 1x1", str(shot)], check=False)
    else:
        subprocess.run(["import", "-window", "root", "-crop", f"1x1+{int(x)}+{int(y)}", str(shot)], check=False)
    try:
        from PIL import Image

        return Image.open(shot).convert("RGB").getpixel((0, 0))
    except Exception:  # noqa: BLE001 - a picture that could not be read is no colour
        return None


def page_is(colour):
    if colour is None:
        return None
    red, green, blue = colour
    if blue > 180 and green < 80 and red < 80:
        return "light"
    if green > 180 and blue < 80 and red < 80:
        return "dark"
    return None


for _ in range(30):
    if run(VISIBLE):
        break
    tab = run(WEB_TAB)
    if isinstance(tab, dict):
        press(tab)
    time.sleep(1)
else:
    raise SystemExit(f"::error::{DESK}: no web tab's page in sight")
time.sleep(2)

seen = []
for turn in range(2):
    app = run("document.documentElement.dataset.theme")
    hole = run(HOLE)
    if not isinstance(hole, dict):
        fail(f"turn {turn}: no hole for the page", f"{turn}-hole")
        break
    time.sleep(1.5)
    x, y = window()
    scale = ratio()
    # The page's body, below its header: what the page left to its ground.
    left = int(x + (hole["x"] + 20) * scale)
    top = int(y + (hole["y"] + 90) * scale)
    width = int((hole["width"] - 40) * scale)
    height = int(min(hole["height"] - 120, 300) * scale)
    shot = OUT / f"ground-{turn}.png"
    if DESK == "sway":
        subprocess.run(["grim", "-g", f"{left},{top} {width}x{height}", str(shot)], check=False)
    else:
        subprocess.run(["import", "-window", "root", "-crop", f"{width}x{height}+{left}+{top}", str(shot)], check=False)
    from PIL import Image

    pixels = list(Image.open(shot).convert("L").getdata())
    light = sum(1 for one in pixels if one > 235) / len(pixels)
    words = sum(1 for one in pixels if one < 90) / len(pixels)
    print(f"{DESK}: turn {turn}: the app is {app}; the page's body is {light:.0%} white, {words:.1%} words")
    seen.append({"app": app, "white": light, "words": words})
    if light < 0.8:
        fail(f"turn {turn}: with the app {app}, the page's own ground is not white ({light:.0%})", f"{turn}-dark")
    if words < 0.002:
        fail(f"turn {turn}: with the app {app}, the page's words do not show ({words:.1%})", f"{turn}-words")
    button = box(TOGGLE)
    if not isinstance(button, dict):
        fail("no button to switch the app's scheme", "toggle")
        break
    press(button)
    if not until(f"document.documentElement.dataset.theme !== {json.dumps(app)}"):
        fail(f"turn {turn}: the app's scheme did not switch", f"{turn}-toggle")
        break

(OUT / "ground.json").write_text(json.dumps({"seen": seen, "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
