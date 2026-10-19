#!/usr/bin/env python3
"""What #418 asked of Orden on Linux, looked at and measured, the same way on any build.

Run by scripts/wayland-launch.sh with CHECK=1, once Orden's window is up under the
headless sway it started, on the drive's page of one colour, with the compositor's own
pointer and keyboard (scripts/wayland-pointer.py). The same script runs against the CEF
build and against the last WebKitGTK one, on the same runner, so each number has the
other beside it. Nothing here reaches into the app's insides: the window's own page is
asked through the app's endpoint (`eval`), and everything else is looked at.

  launch     the window up, and a picture of it.
  buttons    each button with words on it in the window, and how far its ink sits from
             the middle: WebKitGTK drew the words high in their buttons.
  search     Settings' search typed into, a key at a time: from each key to the results
             changed and drawn, and the frames the window drew meanwhile.
  ctrl-tab   Ctrl+Tab pressed with the keyboard in the window's own page, and then in a
             web tab's page: the tab strip has to move on both times.
  switch     a web tab chosen in the strip, photographed as fast as the compositor lets:
             the page has to be where its hole is in every picture it is in at all
             (WebKitGTK drew it elsewhere for a few frames first).
  video      a page of three videos - VP9 and Opus, AV1 and Opus, H.264 and AAC - and
             which of them played. The standard CEF build has the open codecs and not
             H.264 or AAC.

Everything goes to <out>/418.json, with pictures beside it.

    python3 scripts/wayland-418.py <out folder> <app pid>
"""

import json
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(sys.argv[1])
APP = sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
POINTER = OUT / "pointer.fifo"
SITE = "http://127.0.0.1:8765"
found = {}

# evdev codes.
TAB, COMMA, BACKSPACE = 15, 51, 14
LETTERS = {"f": 33, "o": 24, "n": 49, "t": 20, "h": 35, "e": 18, "m": 50}


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
    """`code` run in the window's page, and what it came to."""
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=20) as answer:
                said = json.loads(answer.read())
            break
        except (TimeoutError, OSError):
            time.sleep(1)
    else:
        return None
    if not said.get("ok"):
        print(f"eval said: {said}")
        return None
    return said.get("value")


def sway(*words):
    return json.loads(subprocess.check_output(["swaymsg", "-r", *words]))


def window_node():
    def walk(node):
        if str(node.get("pid")) == APP:
            yield node
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            yield from walk(child)

    every = sorted(
        walk(sway("-t", "get_tree")),
        key=lambda node: node["rect"]["width"] * node["rect"]["height"],
    )
    return every[-1] if every else None


def output_of_window():
    def walk(node, output):
        if node.get("type") == "output":
            output = node["name"]
        if str(node.get("pid")) == APP:
            yield output
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            yield from walk(child, output)

    name = next(walk(sway("-t", "get_tree"), None), None)
    return next(one for one in sway("-t", "get_outputs") if one["name"] == name)


def tell(line):
    with open(POINTER, "w") as pointer:
        pointer.write(line + "\n")


def click(x, y):
    """A press of the compositor's pointer at `x`, `y` of the window, in its own pixels."""
    at = window_node()["rect"]
    tell(f"move {at['x'] + x} {at['y'] + y}\nclick")
    time.sleep(0.3)


def shoot(name):
    """The window's output, in its own pixels, and the scale and origin to read it with."""
    output = output_of_window()
    node = window_node()
    scale = output["scale"]
    path = OUT / f"418-{name}.png"
    subprocess.run(["grim", "-s", str(scale), "-o", output["name"], str(path)], check=True)
    origin = (
        node["rect"]["x"] - output["rect"]["x"],
        node["rect"]["y"] - output["rect"]["y"],
    )
    return path, scale, origin


def tabs():
    return (
        run(
            "[...document.querySelectorAll('.tab .pick[data-tab]')].map((one) => {"
            " const r = one.getBoundingClientRect();"
            " return { id: one.dataset.tab, web: nib.pages.each().some(([id]) => id === one.dataset.tab),"
            " chosen: !!one.closest('.tab.active'), x: r.x + r.width / 2, y: r.y + r.height / 2 } })"
        )
        or []
    )


def chosen():
    return next((one["id"] for one in tabs() if one["chosen"]), None)


def choose(tab):
    click(tab["x"], tab["y"])
    for _ in range(20):
        time.sleep(0.25)
        if chosen() == tab["id"]:
            return True
    return False


def hole():
    for _ in range(60):
        sent = run(
            "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        if isinstance(sent, dict) and sent.get("width", 0) > 10:
            return sent
        time.sleep(0.5)
    return None


def settled():
    seen, same = None, 0
    for _ in range(40):
        now = [(one["id"], one["chosen"]) for one in tabs()]
        same = same + 1 if now and now == seen else 0
        if same >= 3:
            return
        seen = now
        time.sleep(1)


def is_page(rgb):
    red, green, blue = rgb[:3]
    return red > 230 and blue > 230 and green < 40


def launch():
    path, _, _ = shoot("launch")
    found["launch"] = {
        "picture": path.name,
        "title": run("document.title"),
        "strip": run("!!document.querySelector('.strip')"),
        "agent": run("navigator.userAgent"),
    }
    print(f"launch: {found['launch']}")


def ink_rows(image, box, scale):
    """The first and last row of ink inside `box` (the window's pixels) of a picture: the
    pixels far from the button's own colour, read off its inside edge."""
    pixels = image.load()
    width, height = image.size
    left, top, right, bottom = (int(round(v * scale)) for v in box)
    left, top = max(0, left + 2), max(0, top + 2)
    right, bottom = min(width, right - 2), min(height, bottom - 2)
    if right - left < 4 or bottom - top < 4:
        return None
    ring = [pixels[x, top] for x in range(left, right)] + [
        pixels[x, bottom - 1] for x in range(left, right)
    ]
    ground = tuple(statistics.median(one[c] for one in ring) for c in range(3))
    rows = [
        y
        for y in range(top, bottom)
        if sum(
            1
            for x in range(left, right)
            if sum(abs(pixels[x, y][c] - ground[c]) for c in range(3)) > 90
        )
        >= 1
    ]
    if not rows:
        return None
    return rows[0], rows[-1], top, bottom


def buttons(where):
    listed = run(
        "[...document.querySelectorAll('button')].filter((b) => {"
        " const r = b.getBoundingClientRect(); const t = (b.innerText || '').trim();"
        " return r.width > 24 && r.height > 16 && r.height < 60 && t.length >= 2 && t.length < 28"
        " && !t.includes('\\n') && !b.querySelector('svg, img') && r.y >= 0 && r.y < innerHeight"
        " && getComputedStyle(b).visibility !== 'hidden' }).slice(0, 14).map((b) => {"
        " const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);"
        " return { text: b.innerText.trim(), x: r.x, y: r.y, width: r.width, height: r.height,"
        " font: cs.fontFamily, size: cs.fontSize, line: cs.lineHeight } })"
    ) or []
    path, scale, origin = shoot(f"buttons-{where}")
    image = Image.open(path).convert("RGB")
    measured = []
    crops = []
    for one in listed:
        box = (
            origin[0] + one["x"],
            origin[1] + one["y"],
            origin[0] + one["x"] + one["width"],
            origin[1] + one["y"] + one["height"],
        )
        rows = ink_rows(image, box, scale)
        if not rows:
            continue
        first, last, top, bottom = rows
        above, below = (first - top) / scale, (bottom - 1 - last) / scale
        measured.append(
            {
                **one,
                "above": round(above, 1),
                "below": round(below, 1),
                # Positive: the ink sits high in its button.
                "high_by": round((below - above) / 2, 1),
            }
        )
        crops.append(image.crop(tuple(int(round(v * scale)) for v in box)))
    if crops:
        strip = Image.new("RGB", (max(c.width for c in crops), sum(c.height + 4 for c in crops)), "white")
        y = 0
        for crop in crops:
            strip.paste(crop, (0, y))
            y += crop.height + 4
        strip.save(OUT / f"418-buttons-{where}-crops.png")
    highs = [one["high_by"] for one in measured]
    found[f"buttons-{where}"] = {
        "picture": path.name,
        "count": len(measured),
        "median_high_by_px": statistics.median(highs) if highs else None,
        "each": measured,
    }
    print(f"buttons ({where}): median {found[f'buttons-{where}']['median_high_by_px']} px high, {len(measured)} buttons")


def settings_open():
    if run("!!document.querySelector('.nib-field.search input')"):
        return True
    tell(f"chord ctrl {COMMA}")
    for _ in range(12):
        time.sleep(0.25)
        if run("!!document.querySelector('.nib-field.search input')"):
            return True
    run(
        "(() => { const b = [...document.querySelectorAll('button[title], [role=button][title]')]"
        ".find((one) => one.title.startsWith('Settings')); if (b) b.click(); return !!b })()"
    )
    for _ in range(12):
        time.sleep(0.25)
        if run("!!document.querySelector('.nib-field.search input')"):
            return True
    return False


SEARCH_SETUP = """
const input = document.querySelector('.nib-field.search input')
input.focus()
const m = { frames: [], keys: [], on: true }
window.__nib418 = m
let last = performance.now()
const loop = (t) => { m.frames.push(t - last); last = t; if (m.on) requestAnimationFrame(loop) }
requestAnimationFrame(loop)
input.addEventListener('keydown', (e) => m.keys.push({ key: e.key, down: performance.now() }), true)
const watched = input.closest('aside, section, [role=dialog], main') || document.body
new MutationObserver(() => {
  const k = m.keys[m.keys.length - 1]
  if (k && !k.changed) {
    k.changed = performance.now()
    requestAnimationFrame(() => requestAnimationFrame(() => { k.drawn = performance.now() }))
  }
}).observe(watched, { subtree: true, childList: true, characterData: true, attributes: true })
return document.activeElement === input
"""

SEARCH_READ = """
const m = window.__nib418
m.on = false
return { keys: m.keys, frames: m.frames }
"""


def frame_stats(frames):
    frames = sorted(frames[2:])
    if not frames:
        return None

    def at(share):
        return round(frames[min(len(frames) - 1, int(share * len(frames)))], 1)

    return {
        "count": len(frames),
        "p50_ms": at(0.5),
        "p95_ms": at(0.95),
        "p99_ms": at(0.99),
        "max_ms": round(frames[-1], 1),
        "over_20ms": sum(1 for one in frames if one > 20),
        "over_50ms": sum(1 for one in frames if one > 50),
    }


def search():
    if not settings_open():
        found["search"] = {"error": "Settings did not open"}
        print("::warning::Settings did not open")
        return
    time.sleep(1.0)
    focused = run(SEARCH_SETUP)
    # Idle first, for a second, so the frames typed through are told from the ones at rest.
    time.sleep(1.0)
    for word in ["font", "theme"]:
        for letter in word:
            tell(f"key {LETTERS[letter]}")
            time.sleep(0.25)
        shoot(f"search-{word}")
        for _ in word:
            tell(f"key {BACKSPACE}")
            time.sleep(0.2)
    time.sleep(0.5)
    read = run(SEARCH_READ) or {}
    keys = [k for k in read.get("keys", []) if k.get("drawn")]
    latencies = sorted(round(k["drawn"] - k["down"], 1) for k in keys)
    changed = sorted(round(k["changed"] - k["down"], 1) for k in keys)
    found["search"] = {
        "focused": focused,
        "keys": len(read.get("keys", [])),
        "key_to_drawn_ms": {
            "median": statistics.median(latencies) if latencies else None,
            "max": latencies[-1] if latencies else None,
            "each": latencies,
        },
        "key_to_results_ms": {
            "median": statistics.median(changed) if changed else None,
            "max": changed[-1] if changed else None,
        },
        "frames": frame_stats(read.get("frames", [])),
    }
    print(f"search: {found['search']['key_to_drawn_ms']} frames {found['search']['frames']}")
    tell("key 1")  # Escape
    time.sleep(0.8)


def ctrl_tab():
    result = {}
    every = tabs()
    web = next((one for one in every if one["web"]), None)
    other = next((one for one in every if not one["web"]), None)
    if not web or not other:
        found["ctrl-tab"] = {"error": f"two tabs wanted, the strip has {every}"}
        print("::warning::no two tabs for Ctrl+Tab")
        return
    # In the window's own page.
    choose(other)
    time.sleep(0.5)
    before = chosen()
    tell(f"chord ctrl {TAB}")
    time.sleep(1.2)
    after = chosen()
    shoot("ctrl-tab-from-app")
    result["from_the_window"] = {"before": before, "after": after, "moved": before != after}
    # In the web tab's page: chosen, clicked into, then Ctrl+Tab.
    choose(web)
    time.sleep(1.0)
    pane = hole()
    if pane:
        click(pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2)
        time.sleep(0.8)
        before = chosen()
        tell(f"chord ctrl {TAB}")
        time.sleep(1.2)
        after = chosen()
        shoot("ctrl-tab-from-page")
        result["from_a_web_page"] = {"before": before, "after": after, "moved": before != after}
    found["ctrl-tab"] = result
    print(f"ctrl-tab: {result}")


def switch():
    every = tabs()
    web = next((one for one in every if one["web"]), None)
    other = next((one for one in every if not one["web"]), None)
    if not web or not other:
        found["switch"] = {"error": "two tabs wanted"}
        return
    choose(web)
    time.sleep(1.0)
    pane = hole()
    choose(other)
    time.sleep(1.0)
    if not pane:
        found["switch"] = {"error": "no hole"}
        return
    output = output_of_window()
    node = window_node()
    scale = output["scale"]
    rect = node["rect"]
    frames = []
    stop = threading.Event()

    def shooting():
        n = 0
        while not stop.is_set():
            path = OUT / f"418-switch-{n:03d}.png"
            geometry = f"{rect['x']},{rect['y']} {rect['width']}x{rect['height']}"
            subprocess.run(["grim", "-s", str(scale), "-g", geometry, str(path)], check=False)
            frames.append((time.monotonic(), path))
            n += 1

    began = time.monotonic()
    shooter = threading.Thread(target=shooting)
    shooter.start()
    time.sleep(0.15)
    clicked = time.monotonic()
    click(web["x"], web["y"])
    time.sleep(1.6)
    stop.set()
    shooter.join()
    want = (pane["x"], pane["y"], pane["x"] + pane["width"], pane["y"] + pane["height"])
    seen = []
    for at, path in frames:
        image = Image.open(path).convert("RGB")
        pixels = image.load()
        width, height = image.size
        xs, ys = [], []
        for y in range(0, height, 2):
            for x in range(0, width, 2):
                if is_page(pixels[x, y]):
                    xs.append(x)
                    ys.append(y)
        if not xs:
            state, box = "none", None
        else:
            box = tuple(round(v / scale) for v in (min(xs), min(ys), max(xs) + 2, max(ys) + 2))
            off = max(abs(a - b) for a, b in zip(box, want))
            state = "in place" if off <= 4 else "misplaced"
        seen.append({"ms": round((at - clicked) * 1000), "state": state, "box": box, "picture": path.name})
    misplaced = [one for one in seen if one["state"] == "misplaced"]
    # Keep the pictures worth looking at: the misplaced ones and the first in place.
    kept = {one["picture"] for one in misplaced}
    kept |= {next((one["picture"] for one in seen if one["state"] == "in place"), "")}
    for _, path in frames:
        if path.name not in kept:
            path.unlink(missing_ok=True)
    found["switch"] = {
        "hole": want,
        "pictures": len(seen),
        "misplaced": len(misplaced),
        "first_in_place_ms": next((one["ms"] for one in seen if one["state"] == "in place"), None),
        "each": seen,
        "since_start_ms": round((clicked - began) * 1000),
    }
    print(f"switch: {len(seen)} pictures, {len(misplaced)} misplaced")


def video():
    command = os.environ.get("APP_COMMAND")
    if not command:
        found["video"] = {"error": "no APP_COMMAND to hand the page to"}
        return
    log = OUT / "site.log"
    before = log.read_text().count("/report?") if log.exists() else 0
    subprocess.Popen([command, f"{SITE}/video.html"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    reports = []
    for _ in range(60):
        time.sleep(0.5)
        lines = [one for one in log.read_text().splitlines() if "/report?" in one]
        reports = lines[before:]
        if len(reports) >= 3:
            break
    time.sleep(0.5)
    shoot("video")
    said = []
    for line in reports:
        query = line.split("/report?", 1)[1].split(" ", 1)[0]
        said.append(dict(urllib.parse.parse_qsl(query)))
    found["video"] = {"reports": said}
    print(f"video: {said}")


settled()
for step in (launch, lambda: buttons("window"), search, ctrl_tab, switch, video):
    try:
        step()
    except Exception as error:  # a step that broke is a row, not the end of the run
        print(f"::warning::{getattr(step, '__name__', 'step')} broke: {error}")
        found.setdefault("broken", []).append(f"{getattr(step, '__name__', 'step')}: {error}")
if settings_open():
    time.sleep(1.0)
    try:
        buttons("settings")
    except Exception as error:
        found.setdefault("broken", []).append(f"buttons settings: {error}")
    tell("key 1")

(OUT / "418.json").write_text(json.dumps(found, indent=2))
print(json.dumps({k: v for k, v in found.items() if k not in ("switch",)}, indent=2)[:6000])
