#!/usr/bin/env python3

import json
import subprocess
import sys
import time

from drive_scheme import other, switch
from linux_app import run
from linux_desk import DESK, OUT, failures, window, ratio, box, press, fail

VISIBLE = "orden.pages.each().some(([, page]) => page.sent && page.sent.visible)"
WEB_TAB = (
    "(() => { const one = [...document.querySelectorAll('.tab .pick[data-tab]')]"
    ".find((tab) => orden.pages.each().some(([id]) => id === tab.dataset.tab));"
    " if (!one) return null; const r = one.getBoundingClientRect();"
    " return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
)
HOLE = (
    "(() => { const all = orden.pages.each().map(([, page]) => page.sent)"
    ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
)

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
    said = switch(run, box, press, other(app))
    if said != "switched":
        fail(f"turn {turn}: the app's scheme did not switch: {said}", f"{turn}-toggle")
        break

(OUT / "ground.json").write_text(json.dumps({"seen": seen, "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
