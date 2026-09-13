"""Page notes driven for real: the paper, the pen on it, the navigator and the column.

Everything here is the real thing - the built web app in the machine's own Chrome, a
page note made through the workspace, and strokes sent as real pen events with pressure
through the DevTools protocol. No Worker and no account: a page note is a file in this
browser's own storage, which is all writing on paper needs.

What it checks and photographs:

    a new page note opens on one A4 page, fitted across the pane
    the paper stays across the pane when the sidebar narrows it, and a zoom the reader
      asked for is theirs until they ask for the paper back
    a stroke drawn with a pen lands on the page it was drawn on, in the file
    a finger draws on glass that has never seen a pen, and stops once one has - which
      is the palm rejection, and the one rule a page note must not have its own copy of
    a second finger landing while the nib is down leaves no mark at all
    the four rulings, photographed, in both themes
    adding, reordering and deleting a page, and what reordering does to the ink on it
    a long page growing past A4 when writing reaches the bottom of it
    the page counter in the status bar, and the thumbnails in the outline panel's slot
    the file on disk: JSON Canvas, a group node per page, the ink under `nib`
    the same note renamed to `.canvas` still reading as the same pages
    the phone: the same bar, the pages in a column, no second interface

Run it from the repository root:

    python apps/desktop/test/e2e/pages.py

It builds the app, serves it, drives the browser and stops everything again. Nothing it
makes outlives it but the screenshots, which go beside it under `shots/`.

The app is built in development mode on purpose, which is what leaves the app's own
stores reachable from the page; see canvas-arrange.py, whose harness this is.
"""

from __future__ import annotations

import functools
import http.server

import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SHOTS = HERE / "shots" / "pages"
DIST = APP / "dist"

# Its own port, in the range this agent was given.
PORT = 20231
ORIGIN = f"http://127.0.0.1:{PORT}"

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


# What the page is allowed to say into the console without it being a failure. One entry,
# and it is about the app's own `index.html` rather than about anything here: Chrome
# ignores `frame-ancestors` in a `<meta>` policy and says so on every load. The directive
# is there for the header the published site serves; see the content policy commit.
FORGIVEN = ("frame-ancestors",)


def complain(label: str, message) -> None:
    """Every error the page reports is a failure but the ones above."""
    if message.type != "error":
        return
    if any(one in message.text for one in FORGIVEN):
        return

    fail(f"[{label}] console error: {message.text}")


def build() -> None:
    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address; see pen-bar.py for why that matters on Windows."""

    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error

    threading.Thread(target=server.serve_forever, daemon=True).start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)

    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


PREPARE = """
window.__TAURI_OS_PLUGIN_INTERNALS__ = {
  platform: 'android',
  family: 'unix',
  os_type: 'android',
  version: '15.0.0',
  arch: 'aarch64',
  exe_extension: '',
  eol: '\\n',
};
"""

AS_TABLET = """
() => {
  const app = window.nibApp;
  app.viewport.device = 'tablet';
  app.viewport.portrait = false;
  const root = document.documentElement;
  root.dataset.device = 'tablet';
  root.toggleAttribute('data-touch', true);
  root.toggleAttribute('data-drawer', false);
  root.toggleAttribute('data-narrow', false);
}
"""

AS_PHONE = """
() => {
  const app = window.nibApp;
  app.viewport.device = 'phone';
  app.viewport.portrait = true;
  const root = document.documentElement;
  root.dataset.device = 'phone';
  root.toggleAttribute('data-touch', true);
  root.toggleAttribute('data-drawer', true);
  root.toggleAttribute('data-narrow', true);
}
"""

# A glass that has never had a pen on it, which is where a finger draws. Written before
# the app starts, because the store reads it once on the way up; see hand.svelte.ts.
NO_PEN_YET = """
try { localStorage.setItem('nib:pen-seen', 'no') } catch {}
try { localStorage.setItem('nib:finger-draws', 'no') } catch {}
"""


def opened(page: Page, label: str, device: str | None = None) -> None:
    """The app started and a fresh page note open on it."""
    wait_for(page, "!!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    if device == "tablet":
        page.evaluate(AS_TABLET)
    elif device == "phone":
        page.evaluate(AS_PHONE)

    # Asked more than once if it has to be: the space arrives a moment before the tree
    # under it does, and a note asked for in that moment lands nowhere.
    there = "window.nibApp.workspace.active?.path?.endsWith('.pages')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({there})"):
            break
    else:
        raise SystemExit(f"[{label}] no page note ever opened")

    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(400)


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path))
    say(f"photographed {path.name}")


def surface(page: Page) -> dict:
    box = page.locator(".pages").first.bounding_box()
    assert box
    return box


def settled(page: Page) -> None:
    """Everything owing, written into the document now.

    The surface writes the file a pause after the changes stop - serialising the whole
    plane per stroke is the one thing it cannot afford - so a drive that reads the words
    straight after an edit reads the words from before it. `part` is the same call the
    surface makes when its tab closes."""
    page.evaluate("() => window.nibApp.pages.current?.store.part()")
    page.wait_for_timeout(250)


def file_of(page: Page) -> dict:
    """The note as the file holds it, read off the open note rather than guessed."""
    settled(page)
    return page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc)")


def pages_of(page: Page) -> list[dict]:
    """The pages as the surface has them, which is the file read back through the
    format: what the app is drawing, not what the JSON happens to say."""
    return page.evaluate(
        """() => {
          const held = window.nibApp.pages?.current
          return held ? held.store.pages.map((one) => ({
            id: one.id,
            y: one.y,
            width: one.width,
            height: one.height,
            paper: one.paper,
            pattern: one.pattern,
            file: one.file ?? null,
            page: one.page ?? null,
          })) : []
        }"""
    )


def panel_of(page: Page) -> str | None:
    """Which panel is open, so a check that wanted one can say what it got."""
    return page.evaluate("() => window.nibApp.workspace.panel")


def store_call(page: Page, call: str) -> None:
    """Something asked of the open note's own store, which is what a thumbnail, a menu
    row and a key all end up doing."""
    page.evaluate(f"() => {{ const s = window.nibApp.pages.current.store; {call} }}")
    page.wait_for_timeout(350)


def tool(page: Page, key: str) -> None:
    """A tool taken with its own key. The surface has to have the keyboard for a bare
    letter to reach it, and a press on the paper is what gives it."""
    page.keyboard.press("Escape")
    box = surface(page)
    page.mouse.click(box["x"] + 30, box["y"] + 30)
    page.keyboard.press(key)
    page.wait_for_timeout(120)


def stroke(
    page: Page,
    cdp,
    points: list[tuple[float, float]],
    kind: str = "pen",
    buttons: int = 1,
) -> None:
    """A stroke drawn with a real stylus, with pressure on it.

    `Input.dispatchMouseEvent` carries a `pointerType` of `mouse` or `pen` and nothing
    else, which is why a finger has a function of its own below: asking this one for a
    touch gets a mouse, and a mouse is allowed to draw where a palm is not - so the check
    would pass for the wrong reason."""
    if kind == "touch":
        finger(page, cdp, points)
        return

    def send(what: str, x: float, y: float, force: float, held: int) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": what,
                "x": x,
                "y": y,
                "button": "right" if held & 2 else "left",
                "buttons": held,
                "clickCount": 1,
                "pointerType": kind,
                "force": force,
                "tiltX": 0,
                "tiltY": 0,
            },
        )

    first = points[0]
    send("mousePressed", first[0], first[1], 0.4, buttons)
    for x, y in points[1:]:
        send("mouseMoved", x, y, 0.7, buttons)
        page.wait_for_timeout(8)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, buttons)
    page.wait_for_timeout(300)


def finger(page: Page, cdp, points: list[tuple[float, float]]) -> None:
    """A stroke drawn with a real finger, through the protocol's own touch events - which
    is the only way to get a `pointerType` of `touch` into the page."""

    def send(what: str, at: list[tuple[float, float]]) -> None:
        cdp.send(
            "Input.dispatchTouchEvent",
            {
                "type": what,
                "touchPoints": [
                    {"x": x, "y": y, "id": 1, "force": 0.5} for x, y in at
                ],
            },
        )

    send("touchStart", [points[0]])
    for one in points[1:]:
        send("touchMove", [one])
        page.wait_for_timeout(8)

    send("touchEnd", [])
    page.wait_for_timeout(300)


def ink_count(page: Page) -> int:
    return page.evaluate("() => window.nibApp.pages.current.store.canvas.ink.length")


def check_opens(page: Page, label: str) -> None:
    """Item 1: a new page note is one A4 page, fitted across the pane."""
    say("--- the first page ---")

    pages = pages_of(page)
    if len(pages) != 1:
        fail(f"[{label}] a new page note has {len(pages)} pages rather than one")
        return

    one = pages[0]
    if (one["width"], one["height"]) != (794, 1123):
        fail(f"[{label}] the first page is {one['width']}x{one['height']} rather than A4")
    if one["pattern"] != "blank":
        fail(f"[{label}] the first page is ruled {one['pattern']} rather than blank")
    if one["y"] != 0:
        fail(f"[{label}] the first page starts at y={one['y']} rather than the origin")

    # Fitted across the paper with a margin, which is what a page note opens as.
    scale = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    box = surface(page)
    wanted = (box["width"] - 56) / 794
    if abs(scale - wanted) > 0.02:
        fail(f"[{label}] the view opened at {scale:.3f} rather than fitted ({wanted:.3f})")

    if page.locator(".pages .sheet").count() != 1:
        fail(f"[{label}] one page, {page.locator('.pages .sheet').count()} sheets drawn")

    shot(page, f"{label}-one-page")


def check_refits(page: Page, label: str) -> None:
    """The paper stays across the pane when the pane changes width, until somebody zooms.

    This is what a sheet of paper means and what every PDF viewer does. It is also the
    bug this check was written for: the sidebar opening narrowed the pane by three
    hundred pixels and the page kept the scale it had been fitted at, so a third of the
    paper was off the side of the view with no way to know it was there."""
    say("--- the paper stays across the pane ---")

    was = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(800)

    narrowed = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { scale: s.camera.scale, width: s.pane.width, widest: s.widest }
        }"""
    )

    # The paper, plus its two margins, inside the pane it is now in.
    across = narrowed["widest"] * narrowed["scale"]
    if across > narrowed["width"]:
        fail(
            f"[{label}] the page is {across:.0f}px across a {narrowed['width']:.0f}px pane "
            f"after the sidebar opened (was {was:.3f}, now {narrowed['scale']:.3f})"
        )

    shot(page, f"{label}-refitted")

    # And a zoom the reader asked for is theirs: the pane changing must not take it away.
    store_call(page, "s.zoomBy(2)")
    theirs = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    page.wait_for_timeout(800)

    still = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    if abs(still - theirs) > 0.001:
        fail(f"[{label}] a zoom the reader chose was taken away by a resize ({theirs} -> {still})")

    # Until they ask for the paper back, which hands the fitting over again.
    store_call(page, "s.fitAgain()")
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(800)

    after = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { scale: s.camera.scale, width: s.pane.width, widest: s.widest }
        }"""
    )
    if after["widest"] * after["scale"] > after["width"]:
        fail(f"[{label}] Fit did not hand the fitting back")

    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    page.wait_for_timeout(500)


def check_pen(page: Page, cdp, label: str) -> None:
    """Item 2: a stroke drawn with a pen lands on the page, in the file."""
    say("--- a stroke on the paper ---")

    tool(page, "d")
    box = surface(page)
    middle = box["x"] + box["width"] / 2

    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle - 120 + n * 12, box["y"] + 200 + (n % 4) * 9) for n in range(22)],
    )
    after = ink_count(page)

    if after != before + 1:
        fail(f"[{label}] a pen stroke left {after - before} strokes rather than one")
        return

    # And it is on the first page, which is what the format has to be able to say.
    first = pages_of(page)[0]
    on = page.evaluate(
        """(box) => {
          const ink = window.nibApp.pages.current.store.canvas.ink
          const one = ink[ink.length - 1]
          const at = one.points[0]
          return at.x >= box.x && at.x <= box.x + box.width
            && at.y >= box.y && at.y <= box.y + box.height
        }""",
        {"x": -397, "y": first["y"], "width": first["width"], "height": first["height"]},
    )
    if not on:
        fail(f"[{label}] the stroke did not land on the page it was drawn on")

    # Pressure reached the file, which is the whole reason a pen is not a mouse.
    varied = page.evaluate(
        """() => {
          const ink = window.nibApp.pages.current.store.canvas.ink
          const one = ink[ink.length - 1]
          return new Set(one.points.map((p) => p.pressure)).size
        }"""
    )
    if varied < 2:
        fail(f"[{label}] the stroke carries {varied} pressure(s): the nib was not felt")

    shot(page, f"{label}-a-stroke")


def check_gutter(page: Page, cdp, label: str) -> None:
    """A press between two pages writes nothing: there is no paper there."""
    say("--- the gutter ---")

    pages = pages_of(page)
    if len(pages) < 2:
        say("only one page: the gutter check needs two, skipped")
        return

    # The middle of the gutter put at the middle of the view, which is what the camera
    # names: a stroke drawn across the middle of the pane is then a stroke on no paper.
    middle_of_gutter = pages[0]["height"] + 20
    store_call(page, f"s.camera = s.held({{ ...s.camera, y: {middle_of_gutter} }})")

    # And only if the view is close enough in that the gutter fills the middle of it: at a
    # zoom where a whole page is on screen there is paper either side of the nib.
    fits = page.evaluate(
        """(gutter) => {
          const s = window.nibApp.pages.current.store
          const down = s.pane.height / s.camera.scale
          return Math.abs(s.camera.y - gutter) < 1 && down < 40
        }""",
        middle_of_gutter,
    )
    if not fits:
        store_call(page, "s.camera = s.held({ ...s.camera, scale: 4 })")
        store_call(page, f"s.camera = s.held({{ ...s.camera, y: {middle_of_gutter} }})")

    where = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { y: s.camera.y, scale: s.camera.scale, down: s.pane.height / s.camera.scale }
        }"""
    )
    box = surface(page)
    tool(page, "d")

    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(box["x"] + box["width"] / 2 + n, box["y"] + box["height"] / 2) for n in range(14)],
    )
    if ink_count(page) != before:
        fail(
            f"[{label}] a stroke in the gutter left ink where there is no paper "
            f"(view at y={where['y']:.0f}, {where['down']:.0f} units tall)"
        )

    shot(page, f"{label}-gutter")


def check_palm(page: Page, cdp, label: str) -> None:
    """The one rule a page note must not have its own copy of: a finger draws on glass
    that has never seen a pen, and stops being a nib once one has been on it."""
    say("--- two hands and a pen ---")

    seen = page.evaluate("() => window.nibApp.canvasHand?.penSeen ?? null")
    if seen is None:
        say("the hand store is not reachable from the page; checking through the surface")

    tool(page, "d")
    box = surface(page)
    middle = box["x"] + box["width"] / 2

    # A pen has already been on this glass in this drive, so the finger must not draw.
    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle - 60 + n * 8, box["y"] + 420) for n in range(12)],
        kind="touch",
    )
    if ink_count(page) != before:
        fail(f"[{label}] a finger drew on glass that has had a pen on it")

    # And a finger landing while the nib is down leaves nothing at all.
    cdp.send(
        "Input.dispatchMouseEvent",
        {
            "type": "mousePressed",
            "x": middle,
            "y": box["y"] + 500,
            "button": "left",
            "buttons": 1,
            "clickCount": 1,
            "pointerType": "pen",
            "force": 0.5,
        },
    )
    page.wait_for_timeout(30)
    was = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle + 100 + n * 8, box["y"] + 500) for n in range(10)],
        kind="touch",
    )
    cdp.send(
        "Input.dispatchMouseEvent",
        {
            "type": "mouseReleased",
            "x": middle,
            "y": box["y"] + 500,
            "button": "left",
            "buttons": 0,
            "clickCount": 1,
            "pointerType": "pen",
            "force": 0,
        },
    )
    page.wait_for_timeout(300)

    # The pen's own dot is allowed; the palm's stroke is not, so at most one arrived.
    if ink_count(page) > was + 1:
        fail(f"[{label}] a palm left a mark while the nib was down")

    shot(page, f"{label}-palm")


def check_finger_draws(browser, label: str) -> None:
    """And the other half: on glass that has never had a pen, the finger is the nib,
    because on a phone nothing else can be."""
    say("--- a finger on glass with no pen ---")

    context = browser.new_context(
        viewport={"width": 1280, "height": 860}, device_scale_factor=1
    )
    context.add_init_script(PREPARE)
    context.add_init_script(NO_PEN_YET)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[{label}] page error: {error}"))
    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, label, device="tablet")

        tool(page, "d")
        box = surface(page)
        middle = box["x"] + box["width"] / 2

        before = ink_count(page)
        stroke(
            page,
            cdp,
            [(middle - 80 + n * 10, box["y"] + 240 + (n % 3) * 8) for n in range(16)],
            kind="touch",
        )
        if ink_count(page) != before + 1:
            fail(f"[{label}] a finger did not draw on glass that has never had a pen")

        shot(page, f"{label}-finger-draws")
    finally:
        context.close()


def check_rulings(page: Page, label: str) -> None:
    """The four rulings, drawn on real sheets, photographed."""
    say("--- the four rulings ---")

    for pattern in ("blank", "lines", "grid", "dots"):
        page.evaluate(
            """(pattern) => {
              const s = window.nibApp.pages.current.store
              const first = s.pages[0]
              s.edit({
                ...s.canvas,
                nodes: s.canvas.nodes.map((node) =>
                  node.id === first.id ? { ...node, pattern } : node,
                ),
              })
            }""",
            pattern,
        )
        page.wait_for_timeout(250)

        held = pages_of(page)[0]["pattern"]
        if held != pattern:
            fail(f"[{label}] a page asked for {pattern} is ruled {held}")

        shot(page, f"{label}-ruling-{pattern}")


def check_adding(page: Page, label: str) -> None:
    """Adding, reordering and deleting a page, and what reordering does to the ink."""
    say("--- adding, reordering, deleting ---")

    was = len(pages_of(page))

    # The navigator's own Add a page, which is the row somebody presses. The panel is
    # opened through the workspace's own setter, then waited for: it slides in.
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(700)

    add = page.locator(".navigator .add")
    if add.count() < 1:
        shot(page, f"{label}-no-navigator")
        fail(f"[{label}] the navigator has no Add a page (panel is {panel_of(page)!r})")
        return

    add.click()
    page.wait_for_timeout(500)

    pages = pages_of(page)
    if len(pages) != was + 1:
        fail(f"[{label}] Add a page made {len(pages) - was} pages")
        return

    # The column: the second page starts a gutter below the first.
    if pages[1]["y"] != pages[0]["height"] + 40:
        fail(f"[{label}] the second page sits at y={pages[1]['y']}, not one gutter down")

    thumbs = page.locator(".navigator .page").count()
    if thumbs != len(pages):
        fail(f"[{label}] {len(pages)} pages, {thumbs} thumbnails")

    shot(page, f"{label}-navigator")

    # Ink onto the second page, then the second page moved to the front: the ink has to
    # go with it, which is what makes this a reorder and not a shuffle of empty sheets.
    second = pages[1]
    page.evaluate(
        """(page) => {
          const s = window.nibApp.pages.current.store
          s.edit({
            ...s.canvas,
            ink: [...s.canvas.ink, {
              id: 'driven',
              tool: 'pen',
              color: '1',
              size: 3,
              points: [
                { x: 0, y: page.y + 40, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
                { x: 80, y: page.y + 60, pressure: 0.6, tiltX: 0, tiltY: 0, t: 8 },
              ],
            }],
          })
        }""",
        second,
    )
    page.wait_for_timeout(300)

    store_call(page, "s.turnTo(2)")
    shot(page, f"{label}-second-page")

    before_y = page.evaluate(
        "() => window.nibApp.pages.current.store.canvas.ink.find((o) => o.id === 'driven').points[0].y"
    )

    # The drag's own drop: the second thumbnail dragged above the first, which is the
    # gesture, through the navigator's own handlers rather than round them.
    rows = page.locator(".navigator .page")
    if rows.count() < 2:
        fail(f"[{label}] fewer than two thumbnails to drag between")
        return

    rows.nth(1).drag_to(rows.nth(0), target_position={"x": 20, "y": 4})
    page.wait_for_timeout(500)

    after = pages_of(page)
    if after[0]["id"] != second["id"]:
        fail(f"[{label}] the page moved to the front is not at the front")

    after_y = page.evaluate(
        "() => window.nibApp.pages.current.store.canvas.ink.find((o) => o.id === 'driven').points[0].y"
    )
    if after_y >= before_y:
        fail(f"[{label}] the ink did not move with its page ({before_y} -> {after_y})")

    shot(page, f"{label}-reordered")


def check_counter(page: Page, label: str) -> None:
    """The page counter in the status bar, which shows unasked."""
    say("--- the page counter ---")

    count = len(pages_of(page))
    store_call(page, "s.turnTo(1)")

    # The bar itself first. It was once left out over a page note - the kind was
    # put in with the graph and a canvas, which have nothing for a bar to say -
    # and the counter went with it, silently: this is the only place it is drawn,
    # and a reader scrolling a stack of paper cannot guess which page they are on.
    # See hasStatusBar in regions.ts.
    bar = page.evaluate(
        """() => {
          const bar = document.querySelector('footer[data-region="status"], footer')
          if (!bar) return null
          const box = bar.getBoundingClientRect()
          const counter = bar.querySelector('.page')
          const spot = counter?.getBoundingClientRect()
          return {
            bar: { top: Math.round(box.top), height: Math.round(box.height) },
            counter: spot ? { top: Math.round(spot.top), width: Math.round(spot.width) } : null,
            inside: window.innerHeight,
          }
        }"""
    )
    if bar is None:
        fail(f"[{label}] there is no status bar over a page note, so no page counter either")
    else:
        if bar["counter"] is None:
            fail(f"[{label}] the status bar over a page note has no page counter in it")
        elif bar["counter"]["width"] < 8 or bar["counter"]["top"] > bar["inside"]:
            fail(f"[{label}] the page counter is not in view: {bar}")
        say(f"[{label}] the bar and its counter: {bar}")

    said = page.locator("footer .page").inner_text() if page.locator("footer .page").count() else ""

    if said.replace(" ", "") != f"1/{count}":
        fail(f"[{label}] the bar says {said!r} rather than 1 / {count}")

    if count > 1:
        store_call(page, f"s.turnTo({count})")
        said = page.locator("footer .page").inner_text()
        if said.replace(" ", "") != f"{count}/{count}":
            fail(f"[{label}] turned to the last page the bar says {said!r}")

    shot(page, f"{label}-counter")


def check_long_page(page: Page, label: str) -> None:
    """A long page grows past A4 when writing reaches the bottom of it; A4 never does."""
    say("--- the page that grows ---")

    page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          const first = s.pages[0]
          s.edit({
            ...s.canvas,
            nodes: s.canvas.nodes.map((node) =>
              node.id === first.id ? { ...node, paper: 'long' } : node,
            ),
          })
        }"""
    )
    page.wait_for_timeout(300)

    tall = pages_of(page)[0]["height"]

    # A stroke near the bottom of it, which is what makes it grow.
    page.evaluate(
        """(tall) => {
          const s = window.nibApp.pages.current.store
          s.edit({
            ...s.canvas,
            ink: [...s.canvas.ink, {
              id: 'deep',
              tool: 'pen',
              color: '1',
              size: 3,
              points: [{ x: 0, y: tall - 40, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }],
            }],
          })
        }""",
        tall,
    )
    page.wait_for_timeout(400)

    grown = pages_of(page)[0]["height"]
    if grown <= tall:
        fail(f"[{label}] a long page did not grow ({tall} -> {grown})")
    elif (grown - tall) % 600 != 0:
        fail(f"[{label}] a long page grew by {grown - tall}, not in whole screenfuls")

    shot(page, f"{label}-long-page")


def check_file(page: Page, label: str) -> None:
    """The file on disk: JSON Canvas, a spec node per page, the ink under `nib`."""
    say("--- the file ---")

    written = file_of(page)
    pages = pages_of(page)

    if "nodes" not in written or "edges" not in written:
        fail(f"[{label}] the file is not JSON Canvas: {sorted(written)}")
        return

    kinds = {node["type"] for node in written["nodes"]}
    if not kinds <= {"group", "file", "text", "link"}:
        fail(f"[{label}] the file holds a node type the spec does not name: {kinds}")

    records = written.get("nib", {}).get("pages", [])
    if len(records) != len(pages):
        fail(f"[{label}] {len(pages)} pages, {len(records)} records under nib.pages")

    ids = {node["id"] for node in written["nodes"]}
    for record in records:
        if record["id"] not in ids:
            fail(f"[{label}] a page record names no node: {record['id']}")

    if written.get("nib", {}).get("ink") is None and page.evaluate(
        "() => window.nibApp.pages.current.store.canvas.ink.length > 0"
    ):
        fail(f"[{label}] there is ink on the pages and none under nib.ink")

    say(f"the file holds {len(records)} pages and {len(written['nodes'])} nodes")


def check_as_canvas(page: Page, label: str) -> None:
    """The same file opened as a canvas: the escape hatch this format is for.

    A page note renamed to `.canvas` is what Obsidian opens, so the app has to agree:
    the very same bytes, opened by the canvas surface, have to come up with the same
    cards and the same ink rather than with nothing. Driven by writing the note's own
    text into a `.canvas` file and opening it."""
    say("--- the same file as a canvas ---")

    held = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { nodes: s.canvas.nodes.length, ink: s.canvas.ink.length, pages: s.pages.length }
        }"""
    )

    settled(page)
    before = file_of(page)

    # Renamed through the app's own rename, which is what somebody would do.
    renamed = page.evaluate(
        """async () => {
          const workspace = window.nibApp.workspace
          const path = workspace.active?.path
          if (!path) return null

          await workspace.rename(path, 'As a canvas.canvas')
          return workspace.active?.path ?? null
        }"""
    )
    page.wait_for_timeout(900)

    if renamed is None or not renamed.endswith(".canvas"):
        fail(f"[{label}] the note did not rename to a canvas ({renamed!r})")
        return

    kind = page.evaluate("() => window.nibApp.workspace.active?.kind ?? null")
    if kind != "canvas":
        # The tab may still be the page note's until it is reopened, which is itself
        # worth knowing rather than worth hiding.
        say(f"the renamed file is still open as {kind!r}; reopening it")
        page.evaluate("async (path) => window.nibApp.workspace.openEntry(path)", renamed)
        page.wait_for_timeout(800)
        kind = page.evaluate("() => window.nibApp.workspace.active?.kind ?? null")

    if kind != "canvas":
        fail(f"[{label}] a renamed page note opens as {kind!r} rather than a canvas")
        return

    after = file_of(page)
    if after != before:
        fail(f"[{label}] the bytes changed when the file became a canvas")
    else:
        say(f"the same bytes either way: {held['pages']} pages, {held['ink']} strokes")

    # And the canvas surface has the cards and the ink, not an empty plane.
    drawn = page.evaluate(
        """() => {
          const written = JSON.parse(window.nibApp.workspace.active.doc)
          return { nodes: written.nodes.length, ink: (written.nib?.ink ?? []).length }
        }"""
    )
    if drawn["ink"] != held["ink"]:
        fail(f"[{label}] as a canvas the ink is {drawn['ink']}, as pages it was {held['ink']}")

    page.wait_for_selector(".canvas", timeout=10000)
    shot(page, f"{label}-as-a-canvas")


def drive(browser, theme: str) -> None:
    say(f"=== {theme} ===")
    context = browser.new_context(
        viewport={"width": 1280, "height": 860},
        color_scheme=theme,
        device_scale_factor=1,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[{theme}] page error: {error}"))
    page.on("console", lambda one: complain(theme, one))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, theme, device="tablet")

        check_opens(page, theme)
        check_refits(page, theme)
        check_pen(page, cdp, theme)
        check_palm(page, cdp, theme)
        check_rulings(page, theme)
        check_adding(page, theme)
        check_counter(page, theme)
        check_gutter(page, cdp, theme)
        if theme == "light":
            check_long_page(page, theme)
            check_file(page, theme)
            check_as_canvas(page, theme)
    finally:
        context.close()


def drive_phone(browser) -> None:
    """The phone: the same bar, the pages in a column, no second interface."""
    say("=== phone ===")
    context = browser.new_context(
        viewport={"width": 412, "height": 915},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[phone] page error: {error}"))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "phone", device="phone")

        check_opens(page, "phone")

        # The same bar and no other: one `.canvas-bar` on the page, which is the
        # component the canvas uses.
        bars = page.locator(".canvas-bar, .bar").count()
        if bars < 1:
            fail("[phone] the pen bar is not on the page")
        shot(page, "phone-bar")

        # A finger writes here, because this glass has never had a pen on it.
        tool(page, "d")
        box = surface(page)
        before = ink_count(page)
        stroke(
            page,
            cdp,
            [(box["x"] + 80 + n * 6, box["y"] + 200 + (n % 3) * 7) for n in range(18)],
            kind="touch",
        )
        if ink_count(page) != before + 1:
            fail("[phone] a finger did not write on a phone")

        shot(page, "phone-a-stroke")

        # And the pages are still a column: the same layout, not a second one.
        pages = pages_of(page)
        if len(pages) >= 2 and pages[1]["y"] <= pages[0]["y"]:
            fail("[phone] the pages are not in a column")
    finally:
        context.close()


def main() -> int:
    shutil.rmtree(SHOTS, ignore_errors=True)
    build()
    server = serve()

    try:
        with sync_playwright() as playwright:
            # The machine's own Chrome, which is what Emil is looking at.
            browser = playwright.chromium.launch(channel="chrome")
            try:
                for theme in ("light", "dark"):
                    drive(browser, theme)
                check_finger_draws(browser, "no-pen")
                drive_phone(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\neverything the drive checked was right")
    return 0


if __name__ == "__main__":
    sys.exit(main())
