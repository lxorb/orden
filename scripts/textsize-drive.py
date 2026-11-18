#!/usr/bin/env python3

import json
import subprocess
import sys
import time
from linux_app import run
from linux_desk import DESK, OUT, failures, tell, xdo, window, move, shoot, ratio, box, press, until, fail

SIZE = "(() => { const c = document.querySelector('.cm-content'); return c ? parseFloat(getComputedStyle(c).fontSize) : null })()"
SLIDER = "input[type=range][min='0.8']"
SETTINGS = "[role=region][aria-label=Settings]"

def text_box():
    return run("(() => { const c = document.querySelector('.cm-content'); if (!c) return null; const r = c.getBoundingClientRect();"
               " return { x: r.x, y: r.y, width: Math.min(r.width, 500), height: Math.min(r.height, 220) } })()")

def ink(name):
    from PIL import Image

    shoot(name)
    box = text_box()
    if not isinstance(box, dict):
        return None
    x, y = window()
    scale = ratio()
    image = Image.open(OUT / f"textsize-{name}.png").convert("L")
    if DESK == "sway":
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
run("(orden.settings.open = false, true)")
if not until(f"!document.querySelector({json.dumps(SETTINGS)}) && !!document.querySelector('.cm-content')", 10):
    fail("closing the Settings tab did not bring the note back", "settings-open")
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
