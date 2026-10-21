#!/usr/bin/env python3
"""Orden's popups chosen from with a pointer, the way a hand does, over a web tab's page.
#661: on Linux a press in a popup - a space in the space switcher - sometimes did not
choose it, and the popup closed as though the press had been outside it.

Run with Orden up on a web tab, its endpoint open to `eval` (as scripts/wayland-launch.sh
and scripts/x11-launch.sh leave it with POPUP=1), under one of two desktops:

  sway   the compositor's own pointer (scripts/wayland-pointer.py's FIFO in <out>), and
         sway's tree for where the window is.
  x11    xdotool's pointer on the X server, and the window as the X server has it.

    python3 scripts/popup-drive.py <sway|x11> <out folder> <app pid> [rounds]

Each round: the space switcher opened and another space chosen from it, and the first
chosen back; the web tab's menu opened, the pointer rested over the live page beside it,
and Zoom in and 100% pressed, each of which keeps the menu open and says the new size;
and once a canvas is open, its pens' panel opened and another kind of pen pressed in it.
Every press has to do what it says and leave the popup as it should be; a miss is a
picture in <out> and a line in <out>/popups.json, and the run fails.
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
        subprocess.run(["grim", str(OUT / f"popup-{name}.png")], check=False)

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
        subprocess.run(["import", "-window", "root", str(OUT / f"popup-{name}.png")], check=False)


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


HEARD = (
    "(() => { if (window.__popupHeard) return true; window.__popupHeard = [];"
    " const say = (what) => { window.__popupHeard.push(Math.round(performance.now()) + ' ' + what);"
    " if (window.__popupHeard.length > 40) window.__popupHeard.shift() };"
    " addEventListener('blur', (e) => { if (!(e.target instanceof Node)) say('window blur') }, true);"
    " addEventListener('focus', (e) => { if (!(e.target instanceof Node)) say('window focus') }, true);"
    " addEventListener('pointerdown', (e) => say('pointerdown on ' + (e.target.className || e.target.tagName)"
    " + ' at ' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true);"
    " addEventListener('click', (e) => say('click on ' + (e.target.className || e.target.tagName)), true);"
    " return true })()"
)


def fail(what, name):
    print(f"::error::{DESK}: {what}")
    print(f"{DESK}: the page heard: {run('window.__popupHeard')}")
    failures.append(what)
    shoot(name)


def over_the_page():
    """The pointer rested over the middle of the web tab's page, wherever it is."""
    pane = run(
        "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
        ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
    )
    if isinstance(pane, dict):
        move(*at(pane))
        time.sleep(0.5)
    return isinstance(pane, dict)


ACTIVE = "nib.workspace.activeSpace && nib.workspace.activeSpace.name"
SWITCHER = '[data-space-drop="switcher"]'
SPACES = "[data-spaces-open]"


def choose_space(name, round_):
    """The space called `name` chosen from the switcher, as a hand would."""
    button = box(SWITCHER)
    if not isinstance(button, dict):
        fail(f"round {round_}: no space switcher to open", f"{round_}-switcher")
        return
    on_top = run(
        f"(() => {{ const b = document.querySelector('{SWITCHER}').getBoundingClientRect();"
        " const on = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);"
        f" return !!on && !!on.closest('{SWITCHER}') }})()"
    )
    if not on_top:
        fail(f"round {round_}: the space switcher is not in sight: the sidebar is shut", f"{round_}-switcher-hidden")
        return
    press(button)
    if not until(f"!!document.querySelector('{SPACES}')"):
        fail(f"round {round_}: the space switcher did not open", f"{round_}-switcher-shut")
        return
    # Over the page and back, which is where a pointer goes on its way to a row.
    over_the_page()
    row = box(f"{SPACES} [role=menuitem] .nib-row-label", name)
    if not isinstance(row, dict):
        fail(f"round {round_}: no row for the space {name}", f"{round_}-switcher-row")
        return
    # What is on top where the row is, as the page has it: the row, or something drawn
    # over it that a press there would land on instead.
    under = run(
        f"(() => {{ const r = [...document.querySelectorAll('{SPACES} [role=menuitem] .nib-row-label')]"
        f".find((o) => o.textContent.trim() === {json.dumps(name)}); if (!r) return null;"
        " const b = r.getBoundingClientRect(); const on = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);"
        " if (!on) return 'nothing'; if (on.closest('[data-spaces-open]')) return 'the row';"
        " const card = on.closest('.nib-bubble, .nib-layer'); const one = card || on;"
        " return (one.getAttribute('class') || one.tagName) + ': ' + one.textContent.trim().slice(0, 60) })()"
    )
    press(row)
    if until(f"({ACTIVE}) === {json.dumps(name)}"):
        done.append(f"round {round_}: {name} chosen from the space switcher")
        until(f"!document.querySelector('{SPACES}')", 2)
    else:
        open_ = run(f"!!document.querySelector('{SPACES}')")
        fail(
            f"round {round_}: a press on {name} in the space switcher did not choose it"
            f" (the switcher is {'still open' if open_ else 'closed'}; on top where the row is: {under})",
            f"{round_}-switcher-missed",
        )


MENU = '[role="menu"]'


def zoom_in_the_menu(round_):
    """The web tab's menu: Zoom in and 100% pressed, the pointer over the page between."""
    button = box('.webbar button[aria-haspopup="menu"]')
    if not isinstance(button, dict):
        fail(f"round {round_}: no button for the web tab's menu", f"{round_}-menu")
        return
    press(button)
    if not until(f"!!document.querySelector('{MENU}')"):
        fail(f"round {round_}: the web tab's menu did not open", f"{round_}-menu-shut")
        return
    for label, size in (("Zoom in", None), ("the size", "100%")):
        over_the_page()
        if not run(f"!!document.querySelector('{MENU}')"):
            fail(f"round {round_}: the web tab's menu closed with the pointer over the page", f"{round_}-menu-left")
            return
        if size:
            # The row that says the size, whatever it says now: a press on it is 100%.
            row = run(
                f"(() => {{ const one = [...document.querySelectorAll('{MENU} [role=menuitem]')]"
                ".find((item) => /^\\d+%$/.test(item.textContent.trim()));"
                " if (!one) return null; const r = one.getBoundingClientRect();"
                " return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
            )
        else:
            row = box(f"{MENU} [role=menuitem]", label)
        if not isinstance(row, dict):
            fail(f"round {round_}: no {label} in the web tab's menu", f"{round_}-menu-row")
            return
        before = run(f"[...document.querySelectorAll('{MENU} [role=menuitem]')].map((one) => one.textContent.trim()).find((one) => /^\\d+%$/.test(one))")
        press(row)
        want = size or "not " + str(before)
        said = until(
            f"(() => {{ const m = document.querySelector('{MENU}'); if (!m) return null;"
            f" const s = [...m.querySelectorAll('[role=menuitem]')].map((one) => one.textContent.trim()).find((one) => /^\\d+%$/.test(one));"
            f" return {json.dumps(size)} ? (s === {json.dumps(size)} ? s : null) : (s && s !== {json.dumps(before)} ? s : null) }})()"
        )
        if said:
            done.append(f"round {round_}: {label} pressed in the web tab's menu, which says {said}")
        else:
            open_ = run(f"!!document.querySelector('{MENU}')")
            fail(
                f"round {round_}: {label} pressed in the web tab's menu did not take ({want};"
                f" the menu is {'still open' if open_ else 'closed'})",
                f"{round_}-menu-missed",
            )
            return
    run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    until(f"!document.querySelector('{MENU}')", 2)


PANEL = ".cluster .panel"


def pens(round_):
    """The canvas's pens' panel opened from the pen in hand, and another kind pressed in it."""
    pen = box(".cluster button.pen")
    if not isinstance(pen, dict):
        fail(f"round {round_}: no pen on the canvas's bar", f"{round_}-pens")
        return
    for _ in range(2):
        press(pen)
        if until(f"!!document.querySelector('{PANEL}')", 1.5):
            break
    if not run(f"!!document.querySelector('{PANEL}')"):
        fail(f"round {round_}: the pens' panel did not open", f"{round_}-pens-shut")
        return
    kind = run(
        f"(() => {{ const one = [...document.querySelectorAll('{PANEL} .kinds button')].find((b) => b.getAttribute('aria-pressed') !== 'true');"
        " if (!one) return null; const r = one.getBoundingClientRect();"
        " return { x: r.x, y: r.y, width: r.width, height: r.height, name: one.getAttribute('aria-label') } })()"
    )
    if not isinstance(kind, dict):
        fail(f"round {round_}: no other kind of pen in the panel", f"{round_}-pens-kind")
        return
    press(kind)
    name = json.dumps(kind["name"])
    if until(
        f"!!document.querySelector('{PANEL}') && [...document.querySelectorAll('{PANEL} .kinds button')]"
        f".some((b) => b.getAttribute('aria-label') === {name} && b.getAttribute('aria-pressed') === 'true')"
    ):
        done.append(f"round {round_}: {kind['name']} pressed in the pens' panel")
    else:
        open_ = run(f"!!document.querySelector('{PANEL}')")
        fail(
            f"round {round_}: {kind['name']} pressed in the pens' panel did not take"
            f" (the panel is {'still open' if open_ else 'closed'})",
            f"{round_}-pens-missed",
        )
    run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    until(f"!document.querySelector('{PANEL}')", 2)


VISIBLE = "nib.pages.each().some(([, page]) => page.sent && page.sent.visible)"
WEB_TAB = (
    "(() => { const one = [...document.querySelectorAll('.tab .pick[data-tab]')]"
    ".find((tab) => nib.pages.each().some(([id]) => id === tab.dataset.tab));"
    " if (!one) return null; const r = one.getBoundingClientRect();"
    " return { x: r.x, y: r.y, width: r.width, height: r.height } })()"
)


def web_tab_in_front():
    """The web tab chosen in the strip, as a reader would: a launch opens on what it
    opens on - the read-me of a first run - and the web tab waits beside it."""
    for _ in range(30):
        if run(VISIBLE):
            return True
        tab = run(WEB_TAB)
        if isinstance(tab, dict):
            press(tab)
        time.sleep(1)
    return bool(run(VISIBLE))


# A web tab's page in the pane, and a second space to choose.
if not web_tab_in_front():
    raise SystemExit(f"::error::{DESK}: no web tab's page in sight to put popups over")
first = run(ACTIVE)
if (run("nib.workspace.spaces.length") or 0) < 2:
    run("nib.workspace.addSpace('Second space')")
    time.sleep(1.5)
    if run(ACTIVE) != first:
        run(f"(async () => {{ const one = nib.workspace.spaces.find((s) => s.name === {json.dumps(first)}); if (one) await nib.workspace.selectSpace(one.id) }})()")
        time.sleep(1.5)
other = run(f"nib.workspace.spaces.map((s) => s.name).find((name) => name !== {json.dumps(first)})")
print(f"{DESK}: spaces {first!r} and {other!r}, the page's ratio {ratio()}")

run(HEARD)
for round_ in range(1, ROUNDS + 1):
    if first and other:
        choose_space(other, round_)
        choose_space(first, round_)
    time.sleep(0.5)
    web_tab_in_front()
    zoom_in_the_menu(round_)
    time.sleep(0.5)

# The canvas last: it takes the pane from the web tab.
run("nib.workspace.newCanvas()")
if until("!!document.querySelector('.cluster button.pen')", 10):
    for round_ in range(1, ROUNDS + 1):
        pens(round_)
else:
    fail("no canvas came up for its pens", "canvas")

for line in done:
    print(f"{DESK}: {line}")
(OUT / "popups.json").write_text(json.dumps({"done": done, "failures": failures}, indent=2))
print(f"{DESK}: {len(done)} presses in popups took, {len(failures)} did not")
sys.exit(1 if failures else 0)
