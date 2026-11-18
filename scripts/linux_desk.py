import json
import subprocess
import sys
import time
from pathlib import Path

from linux_app import run

DESK, OUT, APP = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
NAME = Path(sys.argv[0]).stem.removesuffix("-drive")
POINTER = OUT / "pointer.fifo"
failures = []

def tell(line):
    with open(POINTER, "w") as pointer:
        pointer.write(line + "\n")

def xdo(*words):
    return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout

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

    def move(x, y):
        tell(f"move {x} {y}")

    def click():
        tell("click")

    def shoot(name):
        subprocess.run(["grim", str(OUT / f"{NAME}-{name}.png")], check=False)

    subprocess.run(["swaymsg", f"[pid={APP}] move container to output HEADLESS-2, focus"], check=False)
    time.sleep(2)

else:

    def window():
        found = [w for w in xdo("search", "--onlyvisible", "--name", "Orden").split() if w]
        area, at = 0, (0, 0)
        for one in found:
            got = dict(
                line.split("=", 1) for line in xdo("getwindowgeometry", "--shell", one).split() if "=" in line
            )
            size = int(got.get("WIDTH", 0)) * int(got.get("HEIGHT", 0))
            if size > area:
                area, at = size, (int(got["X"]), int(got["Y"]))
        return at

    def move(x, y):
        xdo("mousemove", str(int(x)), str(int(y)))

    def click():
        xdo("click", "1")

    def shoot(name):
        subprocess.run(["import", "-window", "root", str(OUT / f"{NAME}-{name}.png")], check=False)

def ratio():
    return run("devicePixelRatio") or 1

def box(selector, text=None):
    return run(
        "(() => { for (const one of document.querySelectorAll(%s)) {"
        " const r = one.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;"
        " if (%s !== null && one.textContent.trim() !== %s) continue;"
        " return { x: r.x, y: r.y, width: r.width, height: r.height } } return null })()"
        % (json.dumps(selector), json.dumps(text), json.dumps(text))
    )

def at(rect):
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

def colour_at(x, y):
    shot = OUT / "scheme-now.png"
    if DESK == "sway":
        subprocess.run(["grim", "-g", f"{int(x)},{int(y)} 1x1", str(shot)], check=False)
    else:
        subprocess.run(["import", "-window", "root", "-crop", f"1x1+{int(x)}+{int(y)}", str(shot)], check=False)
    try:
        from PIL import Image

        return Image.open(shot).convert("RGB").getpixel((0, 0))
    except Exception:
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
