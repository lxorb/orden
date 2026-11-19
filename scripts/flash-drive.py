#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
from drive_scheme import switch
from linux_app import run
from linux_desk import DESK, OUT, failures, window, ratio, box, press, until

SWITCHES = int(sys.argv[4]) if len(sys.argv) > 4 else 10
def fail(what, name):
    print(f"::error::{DESK}: {what}")
    failures.append(what)
TABS = (
    "[...document.querySelectorAll('.tab .pick[data-tab]')].map((one) => { const r = one.getBoundingClientRect();"
    " return { id: one.dataset.tab, web: orden.pages.each().some(([id]) => id === one.dataset.tab),"
    " chosen: !!one.closest('.tab.active'), x: r.x, y: r.y, width: r.width, height: r.height } })"
)
PANE = (
    "(() => { const one = document.querySelector('.pane, main'); if (!one) return null;"
    " const r = one.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
)
def tabs():
    return run(TABS) or []
said = "not tried"
for _ in range(3):
    said = switch(run, box, press, "dark")
    if run("document.documentElement.dataset.theme") == "dark":
        break
    time.sleep(1.5)
if run("document.documentElement.dataset.theme") != "dark":
    raise SystemExit(f"::error::{DESK}: the app would not go dark: {said}")
web = next((one for one in tabs() if one["web"]), None)
note = next((one for one in tabs() if not one["web"]), None)
if not web or not note:
    raise SystemExit(f"::error::{DESK}: no web tab and note tab side by side in the strip ({tabs()})")
press(web)
until("orden.pages.each().some(([, page]) => page.sent && page.sent.visible)", 20)
time.sleep(3)
x0, y0 = window()
scale = ratio()
hole = run(
    "(() => { const all = orden.pages.each().map(([, page]) => page.sent)"
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
try:
    recorder.wait(timeout=15)
except subprocess.TimeoutExpired:
    recorder.terminate()
    try:
        recorder.wait(timeout=15)
    except subprocess.TimeoutExpired:
        recorder.kill()
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
