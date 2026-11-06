#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(sys.argv[1])
APP = sys.argv[2]
COLD = len(sys.argv) > 3 and sys.argv[3] == "cold"
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
POINTER = OUT / "pointer.fifo"
SLACK = 3
failures = []

LAYERS = [
    ("the web tab's menu", '.webbar button[aria-haspopup="menu"]'),
]

def fail(what):
    print(f"::error::{what}")
    failures.append(what)

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
            break
        except (TimeoutError, OSError):
            time.sleep(1)
    else:
        raise SystemExit("::error::the app's endpoint never answered")
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

    found = sorted(
        walk(sway("-t", "get_tree")),
        key=lambda node: node["rect"]["width"] * node["rect"]["height"],
    )
    return found[-1] if found else None

RATIO = [1.0]

def click(node, x, y):
    at = node["rect"]
    with open(POINTER, "w") as pointer:
        pointer.write(f"move {at['x'] + x * RATIO[0]} {at['y'] + y * RATIO[0]}\nclick\n")
    time.sleep(0.3)
    with open(POINTER, "w") as pointer:
        pointer.write(f"move {at['x'] + at['width'] * 0.6} {at['y'] + at['height'] * 0.6}\n")

def box(selector):
    return run(
        "(() => { const one = document.querySelector(%s); if (!one) return null;"
        " const r = one.getBoundingClientRect();"
        " return { x: r.x, y: r.y, width: r.width, height: r.height } })()" % json.dumps(selector)
    )

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

def choose(node, tab):
    click(node, tab["x"], tab["y"])
    for _ in range(20):
        time.sleep(0.25)
        if any(one["id"] == tab["id"] and one["chosen"] for one in tabs()):
            return True
    return False

def settled():
    seen, same = None, 0
    for _ in range(40):
        now = [(one["id"], one["chosen"]) for one in tabs()]
        same = same + 1 if now and now == seen else 0
        if same >= 3:
            return
        seen = now
        time.sleep(1)

def web_tab():
    return next((one for one in tabs() if one["web"]), None)

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

def is_page(rgb):
    red, green, blue = rgb
    return red > 230 and blue > 230 and green < 40

def bounding(shot):
    image = Image.open(shot).convert("RGB")
    pixels = image.load()
    width, height = image.size
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            if is_page(pixels[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1

def left_of(hole, layer):
    def size(one):
        return max(0, one[2] - one[0]) * max(0, one[3] - one[1])

    both = (max(hole[0], layer[0]), max(hole[1], layer[1]), min(hole[2], layer[2]), min(hole[3], layer[3]))
    whole = size(hole)
    return (whole - size(both)) / whole if whole else 0

def share(shot, area):
    image = Image.open(shot).convert("RGB")
    pixels = image.load()
    width, height = image.size
    left, top, right, bottom = (max(0, int(v)) for v in area)
    right, bottom = min(right, width), min(bottom, height)
    seen = hits = 0
    for y in range(top, bottom, 2):
        for x in range(left, right, 2):
            seen += 1
            hits += is_page(pixels[x, y])
    return hits / max(1, seen)

def ink(shot, area):
    image = Image.open(shot).convert("RGB")
    pixels = image.load()
    width, height = image.size
    left, top, right, bottom = (max(0, int(v)) for v in area)
    right, bottom = min(right, width), min(bottom, height)
    return sum(
        1
        for y in range(top, bottom)
        for x in range(left, right)
        if sum(pixels[x, y]) < 300
    )

def shoot(output, name, scale):
    path = OUT / f"{name}-{output}.png"
    subprocess.run(["grim", "-s", str(scale), "-o", output, str(path)], check=True)
    return path

def near(got, want, scale):
    return got is not None and all(
        abs(a - b) <= SLACK * max(1, scale) for a, b in zip(got, want)
    )

def where_now():

    def walk(node, output):
        if node.get("type") == "output":
            output = node["name"]
        if str(node.get("pid")) == APP:
            yield output
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            yield from walk(child, output)

    return next(walk(sway("-t", "get_tree"), None), None) or sway("-t", "get_outputs")[0]["name"]

def look(output, moved=True, tag=""):
    info = next(one for one in sway("-t", "get_outputs") if one["name"] == output)
    scale = info["scale"]
    tag = f"cold-{os.environ.get('COLD_RUN', '1')}-" if COLD else tag
    if moved:
        subprocess.run(["swaymsg", f"[pid={APP}] move container to output {output}"], check=True)
        subprocess.run(["swaymsg", f"[pid={APP}] focus"], check=False)
        time.sleep(2.5)
    node = window_node()
    if not node:
        fail(f"{output}: no window to look at")
        return
    origin = (node["rect"]["x"] - info["rect"]["x"], node["rect"]["y"] - info["rect"]["y"])

    ratio = run("devicePixelRatio") or 1
    RATIO[0] = ratio
    if os.environ.get("DPI") and abs(ratio - int(os.environ["DPI"]) / 96) > 0.02:
        fail(f"{output}: the window's page is drawn at {ratio}, not the desktop's {int(os.environ['DPI']) / 96:.3f}")

    def on_screen(rect, inset=0):
        return (
            (origin[0] + (rect["x"] + inset) * ratio) * scale,
            (origin[1] + (rect["y"] + inset) * ratio) * scale,
            (origin[0] + (rect["x"] + rect["width"] - inset) * ratio) * scale,
            (origin[1] + (rect["y"] + rect["height"] - inset) * ratio) * scale,
        )

    web = web_tab()
    if web is None:
        fail(f"{output}: no web tab in the strip")
        return
    if not web["chosen"] and not choose(node, web):
        fail(f"{output}: a click on the web tab in the strip did not choose it")
        return
    pane = hole()
    if not pane:
        fail(f"{output}: no hole to look at")
        return
    want = on_screen(pane)
    for _ in range(40):
        first = shoot(output, f"{tag}page", scale)
        got = bounding(first)
        if got is not None:
            break
        time.sleep(0.5)
    print(f"{output} at {scale}, the page's ratio {ratio}: the hole is {tuple(round(v) for v in want)}, the page is {got}")
    if not near(got, want, scale):
        fail(f"{output} at {scale}: the page is at {got}, its hole at {tuple(round(v) for v in want)}")
        return
    strip = box(".strip")
    strip_area = on_screen(strip) if isinstance(strip, dict) else None
    inked = ink(first, strip_area) if strip_area else 0

    other = next((one for one in tabs() if not one["web"]), None)
    if other is None:
        fail(f"{output}: no other tab in the strip to choose")
    elif not choose(node, other):
        fail(f"{output}: a click on another tab in the strip did not choose it")
    else:
        time.sleep(1.0)
        gone = bounding(shoot(output, f"{tag}other-tab", scale))
        if gone is not None:
            fail(f"{output}: the web tab's page is still drawn with another tab chosen ({gone})")
        web = web_tab()
        if not web or not choose(node, web):
            fail(f"{output}: a click on the web tab in the strip did not choose it again")
        else:
            time.sleep(1.5)
            back = bounding(shoot(output, f"{tag}web-tab-again", scale))
            if not near(back, want, scale):
                fail(f"{output}: the page did not come back to its hole ({back})")

    for name, trigger in LAYERS:
        button = box(trigger)
        if not isinstance(button, dict):
            fail(f"{output}: no button for {name}")
            continue
        click(node, button["x"] + button["width"] / 2, button["y"] + button["height"] / 2)
        time.sleep(1.0)
        layer = run(
            "(() => { const all = [...document.querySelectorAll('[role=\"menu\"]')]"
            ".map((one) => one.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);"
            " const r = all[all.length - 1];"
            " return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()"
        )
        slug = name.replace(" ", "-").replace("'", "")
        if not isinstance(layer, dict):
            shoot(output, f"{tag}missed-{slug}", scale)
            fail(f"{output}: {name} did not open for a click on its button")
        else:
            began = time.monotonic()
            while True:
                shot = shoot(output, f"{tag}{slug}", scale)
                covered = share(shot, on_screen(layer, 4))
                under = share(shot, want)
                least = 0.8 * left_of(want, on_screen(layer))
                if (covered <= 0.05 and under >= least) or time.monotonic() - began > 3:
                    break
                time.sleep(0.25)
            print(
                f"{output}: {name} at {layer}: the page is over {covered:.0%} of it,"
                f" and shows in {under:.0%} of its hole, of {least / 0.8:.0%} it could"
                f" ({time.monotonic() - began + 1:.1f} s after the click)"
            )
            if covered > 0.05:
                fail(f"{output}: the page is drawn over {name} ({covered:.0%})")
            if under < least:
                fail(
                    f"{output}: under {name} the page is gone ({under:.0%} of its hole,"
                    f" where {least / 0.8:.0%} is not under the layer)"
                )
        run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        time.sleep(1.0)
        after = shoot(output, f"{tag}after-{slug}", scale)
        back = bounding(after)
        if not near(back, want, scale):
            fail(f"{output}: the page did not come back whole after {name} ({back})")
        if strip_area and inked and ink(after, strip_area) < inked * 0.3:
            fail(f"{output}: after {name} the window's own page is not drawn: no tab strip")

    run(
        "(async () => { const path = await nib.workspace.noteFrom('# A toast over a page\\n');"
        " if (path) await nib.workspace.remove(path, false); return path })()"
    )
    card = None
    for _ in range(20):
        time.sleep(0.25)
        card = box("[data-notices] > .toast")
        if isinstance(card, dict) and card.get("height", 0) > 0:
            break
    if not isinstance(card, dict) or card.get("height", 0) <= 0:
        fail(f"{output}: the Undo toast did not come up")
    else:
        time.sleep(0.8)
        card = box("[data-notices] > .toast") or card
        under_card = hole()
        shot = shoot(output, f"{tag}toast", scale)
        covered = share(shot, on_screen(card, 4))
        under = share(shot, want)
        print(
            f"{output}: the Undo toast at {card}: the page is over {covered:.0%} of it,"
            f" shows in {under:.0%} of its hole, and the hole is {under_card}"
        )
        if under_card and abs(under_card["height"] - pane["height"]) > 1:
            fail(
                f"{output}: the toast took a band of the pane: the page's hole went from"
                f" {pane['height']:.0f} to {under_card['height']:.0f} tall"
            )
        if covered > 0.05:
            fail(f"{output}: the page is drawn over the Undo toast ({covered:.0%})")
        if under < 0.5:
            fail(f"{output}: under the Undo toast the page is gone ({under:.0%} of its hole)")
        for _ in range(60):
            gone = box("[data-notices] > .toast")
            if not isinstance(gone, dict) or gone.get("height", 0) <= 0:
                break
            time.sleep(0.25)
        time.sleep(1.0)
        back = bounding(shoot(output, f"{tag}after-toast", scale))
        if not near(back, want, scale):
            fail(f"{output}: the page did not come back whole after the Undo toast ({back})")

def loads():
    try:
        return (OUT / "site.log").read_text().count('"GET / ')
    except OSError:
        return 0

def reloads(output):
    if not (OUT / "pointer.log").read_text().count("and a keyboard"):
        print("no keyboard to press with: the reloads are not driven here")
        return
    node = window_node()
    pane = hole()
    if not node or not pane:
        fail(f"{output}: no page to reload")
        return
    click(node, pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2)
    time.sleep(1.0)
    for times, (held, code, name) in enumerate(
        [("ctrl", 19, "Ctrl+R"), ("ctrl", 19, "Ctrl+R"), ("ctrl", 19, "Ctrl+R"), ("", 63, "F5")],
        start=1,
    ):
        before = loads()
        with open(POINTER, "w") as pointer:
            pointer.write(f"key {held} {code}\n")
        for _ in range(20):
            time.sleep(0.25)
            if loads() > before:
                break
        if loads() > before:
            print(f"{output}: {name} in the page reloads it ({times})")
        else:
            fail(f"{output}: {name} pressed in the page did not reload it (press {times})")

settled()
if COLD:
    look(where_now(), moved=False)
else:
    outputs = [one["name"] for one in sway("-t", "get_outputs")]
    for output in outputs:
        look(output)
    reloads(where_now())

    subprocess.run(["swaymsg", f"[pid={APP}] floating enable, resize set 900 650"], check=False)
    time.sleep(2.5)
    look(outputs[1], tag="smaller-")

name = f"drive-cold-{os.environ.get('COLD_RUN', '1')}.json" if COLD else "drive.json"
(OUT / name).write_text(json.dumps({"failures": failures}, indent=2))
sys.exit(1 if failures else 0)
