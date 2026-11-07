from __future__ import annotations

import sys

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin

NAVIGATOR = "aside:not(.right) .navigator"

def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)

FORGIVEN = ("frame-ancestors",)

def complain(label: str, message) -> None:
    if message.type != "error":
        return
    if any(one in message.text for one in FORGIVEN):
        return

    fail(f"[{label}] console error: {message.text}")

PREPARE = """
// What is handed to the print engine, kept where the drive can read it: printing goes
// through a frame's `srcdoc`, and the dialog it opens is not something a drive sees.
(() => {
  const own = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true,
    get() { return own.get.call(this) },
    set(value) {
      window.__printed = value;
      window.__drawn = null;
      const frame = this;
      frame.addEventListener('load', () => {
        window.__drawn = [...frame.contentDocument.images].map((one) => ({
          src: one.src.slice(0, 5),
          shown: one.complete && one.naturalWidth > 0,
        }));
      }, { once: true });
      own.set.call(this, value);
    },
  });
})();
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

NO_PEN_YET = """
try { localStorage.setItem('orden:pen-seen', 'no') } catch {}
try { localStorage.setItem('orden:finger-draws', 'no') } catch {}
"""

def opened(page: Page, label: str, device: str | None = None) -> None:
    wait_for(page, "!!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    if device == "tablet":
        page.evaluate(AS_TABLET)
    elif device == "phone":
        page.evaluate(AS_PHONE)

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

def surface(page: Page) -> dict:
    box = page.locator(".pages").first.bounding_box()
    assert box
    return box

def settled(page: Page) -> None:
    page.evaluate("() => window.nibApp.pages.current?.store.part()")
    page.wait_for_timeout(250)

def file_of(page: Page) -> dict:
    settled(page)
    return page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc)")

def pages_of(page: Page) -> list[dict]:
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
    return page.evaluate("() => window.nibApp.workspace.panel")

def store_call(page: Page, call: str) -> None:
    page.evaluate(f"() => {{ const s = window.nibApp.pages.current.store; {call} }}")
    page.wait_for_timeout(350)

def tool(page: Page, key: str) -> None:
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

    scale = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    box = surface(page)
    wanted = (box["width"] - 56) / 794
    if abs(scale - wanted) > 0.02:
        fail(f"[{label}] the view opened at {scale:.3f} rather than fitted ({wanted:.3f})")

    if page.locator(".pages .sheet").count() != 1:
        fail(f"[{label}] one page, {page.locator('.pages .sheet').count()} sheets drawn")

    shot(page, f"{label}-one-page")

def check_refits(page: Page, label: str) -> None:
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

    across = narrowed["widest"] * narrowed["scale"]
    if across > narrowed["width"]:
        fail(
            f"[{label}] the page is {across:.0f}px across a {narrowed['width']:.0f}px pane "
            f"after the sidebar opened (was {was:.3f}, now {narrowed['scale']:.3f})"
        )

    shot(page, f"{label}-refitted")

    store_call(page, "s.zoomBy(2)")
    theirs = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    page.wait_for_timeout(800)

    still = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    if abs(still - theirs) > 0.001:
        fail(f"[{label}] a zoom the reader chose was taken away by a resize ({theirs} -> {still})")

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

def check_lasso(page: Page, cdp, label: str) -> None:
    say("--- the lasso, and what the bar offers ---")

    if page.locator(".cluster .bar button[aria-label='Add']").count():
        fail(f"[{label}] a page note's bar offers Add, and nothing on paper answers to it")
    if page.locator(".cluster .bar button[aria-label^='Zoom']").count():
        fail(f"[{label}] a page note's bar still has its zoom buttons")

    tool(page, "d")
    box = surface(page)
    x0, y0 = box["x"] + box["width"] / 2 - 120, box["y"] + 320
    stroke(page, cdp, [(x0 + n * 12, y0 + (n % 4) * 9) for n in range(22)])
    drawn = page.evaluate(
        "() => { const ink = window.nibApp.pages.current.store.canvas.ink;"
        " return ink[ink.length - 1].id }"
    )
    first = (
        "(id) => { const store = window.nibApp.pages.current.store;"
        " const one = store.canvas.ink.find((s) => s.id === id);"
        " return { x: one.points[0].x, y: one.points[0].y, scale: store.camera.scale } }"
    )
    was = page.evaluate(first, drawn)

    tool(page, "q")
    page.mouse.move(x0 - 30, y0 - 30)
    page.mouse.down()
    for x, y in ((x0 + 300, y0 - 30), (x0 + 300, y0 + 70), (x0 - 30, y0 + 70), (x0 - 30, y0 - 30)):
        page.mouse.move(x, y, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)

    page.mouse.move(x0 + 120, y0 + 15)
    page.mouse.down()
    page.mouse.move(x0 + 220, y0 + 115, steps=10)
    page.mouse.up()
    page.wait_for_timeout(400)

    now = page.evaluate(first, drawn)
    wanted = 100 / was["scale"]
    moved = (now["x"] - was["x"], now["y"] - was["y"])
    if abs(moved[0] - wanted) > 4 or abs(moved[1] - wanted) > 4:
        fail(f"[{label}] lassoed ink did not follow the drag (moved {moved}, not {wanted:.0f})")
    else:
        say(f"[{label}] the lassoed ink moved by {tuple(round(v) for v in moved)}")
    shot(page, f"{label}-lasso-moved")

    bar = page.evaluate("() => [...document.querySelectorAll('.over button')].map((b) => b.getAttribute('aria-label'))")
    for wanted in ("Colour", "Duplicate", "Delete", "More"):
        if wanted not in bar:
            fail(f"[{label}] the bar over lassoed ink has no {wanted} ({bar})")
    shot(page, f"{label}-lasso-bar")
    picked = "() => window.nibApp.pages.current.store.picked.slice()"
    if "Colour" in bar:
        page.locator(".over button[aria-label='Colour']").first.click()
        page.wait_for_timeout(300)
        page.locator(".over button[aria-label='Colour 1']").first.click()
        page.wait_for_timeout(300)
        colour = page.evaluate(
            "(id) => window.nibApp.pages.current.store.canvas.ink.find((s) => s.id === id)?.color", drawn
        )
        if colour != "1":
            fail(f"[{label}] Colour 1 on the bar left the lassoed ink {colour}")
    count = ink_count(page)
    if "Duplicate" in bar:
        page.locator(".over button[aria-label='Duplicate']").first.click()
        page.wait_for_timeout(300)
        if ink_count(page) != count + 1:
            fail(f"[{label}] Duplicate on the bar made {ink_count(page) - count} strokes, not one")
    if "Delete" in bar:
        page.locator(".over button[aria-label='Delete']").first.click()
        page.wait_for_timeout(300)
        if ink_count(page) != count or page.evaluate(picked):
            fail(f"[{label}] Delete on the bar did not take the copy away")
    say(f"[{label}] the bar over lassoed ink colours, copies and deletes it")
    page.evaluate("(id) => window.nibApp.pages.current.store.pick(id)", drawn)
    page.locator(".pages").first.focus()
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)

    page.mouse.click(x0 + 300, y0 + 260, button="right")
    page.wait_for_timeout(400)
    rows = [one.strip() for one in page.locator("[role=menu] [role=menuitem]").all_inner_texts()]
    for wanted in ("Add a page after this", "Fit width", "Fit page", "100%", "Export as PDF", "Print"):
        if wanted not in rows:
            fail(f"[{label}] a right click on the paper has no {wanted} ({rows})")
    if page.locator("[role=menu] [role=menuitem][disabled]").count():
        fail(f"[{label}] a right click on the paper has greyed rows")
    shot(page, f"{label}-paper-menu")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    tool(page, "v")

def check_print(page: Page, label: str) -> None:
    say("--- printing ---")

    count = len(pages_of(page))
    page.evaluate("() => { window.__printed = null }")
    box = surface(page)
    page.mouse.click(box["x"] + 30, box["y"] + 30)
    page.keyboard.press("Control+p")
    try:
        page.wait_for_function("() => !!window.__printed", timeout=30000)
    except Exception:  # noqa: BLE001 - said below
        fail(f"[{label}] Ctrl+P on a page note handed nothing to the print engine")
        return
    sheets = page.evaluate("() => (window.__printed.match(/<img /g) || []).length")
    if sheets != count:
        fail(f"[{label}] printing handed over {sheets} sheets for {count} pages")
    else:
        say(f"[{label}] printing hands the print engine all {count} pages")
    try:
        page.wait_for_function("() => !!window.__drawn", timeout=30000)
    except Exception:  # noqa: BLE001 - said below
        fail(f"[{label}] the print frame never finished loading")
        return
    drawn = page.evaluate("() => window.__drawn")
    size = page.evaluate("() => window.__printed.length")
    if not all(one["shown"] for one in drawn) or any(one["src"] != "blob:" for one in drawn):
        fail(f"[{label}] the printed sheets are not all pictures linked in and shown: {drawn}")
    elif size > 2000 * max(1, count):
        fail(f"[{label}] the print page carries its pictures inline: {size} characters")
    else:
        say(f"[{label}] every printed sheet is a linked picture that shows ({size} characters)")

def check_lasso_held(page: Page, cdp, label: str) -> None:
    say("--- the lasso, held on its key ---")

    tool(page, "d")
    box = surface(page)
    x0, y0 = box["x"] + box["width"] / 2 - 120, box["y"] + 420
    stroke(page, cdp, [(x0 + n * 12, y0 + (n % 4) * 9) for n in range(22)])
    drawn = page.evaluate(
        "() => { const ink = window.nibApp.pages.current.store.canvas.ink; return ink[ink.length - 1].id }"
    )

    page.keyboard.down("q")
    page.wait_for_timeout(100)
    held = page.evaluate("() => getComputedStyle(document.querySelector('.pages')).cursor")
    page.mouse.move(x0 - 30, y0 - 30)
    page.mouse.down()
    for x, y in ((x0 + 300, y0 - 30), (x0 + 300, y0 + 70), (x0 - 30, y0 + 70), (x0 - 30, y0 - 30)):
        page.mouse.move(x, y, steps=6)
    page.mouse.up()
    page.keyboard.up("q")
    page.wait_for_timeout(300)

    picked = page.evaluate("() => window.nibApp.pages.current.store.picked.slice()")
    back = page.evaluate(
        "() => document.querySelector('.cluster .bar button[aria-pressed=true]')?.getAttribute('aria-label')"
    )
    say(f"[{label}] held: in hand {back} again after, picked {len(picked)}")
    page.evaluate("() => { window.nibApp.viewport.device = 'desktop' }")
    page.keyboard.down("q")
    page.wait_for_timeout(400)
    mouse = page.evaluate("() => getComputedStyle(document.querySelector('.pages')).cursor")
    page.keyboard.up("q")
    page.evaluate("() => { window.nibApp.viewport.device = 'tablet' }")
    page.wait_for_timeout(100)
    if held not in ("auto", "default") or mouse != "crosshair":
        fail(f"[{label}] the held lasso's cursor is {mouse} with a mouse, {held} on glass")
    if back != "Pen":
        fail(f"[{label}] letting the lasso's key go did not give the pen back ({back})")
    if drawn not in picked:
        fail(f"[{label}] what the held lasso caught was not left caught ({picked})")
    shot(page, f"{label}-lasso-held")

    page.locator(".pages").first.focus()
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)
    tool(page, "v")

def check_upright(page: Page, cdp, label: str) -> None:
    import math

    say("--- paper stays upright ---")
    page.evaluate("() => window.nibApp.modes.setCanvasTurns(true)")
    box = surface(page)
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

    def at(angle: float) -> list[dict]:
        dx, dy = 80 * math.cos(angle), 80 * math.sin(angle)
        return [
            {"x": middle[0] - dx, "y": middle[1] - dy, "id": 1},
            {"x": middle[0] + dx, "y": middle[1] + dy, "id": 2},
        ]

    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": at(0)})
    for step in range(1, 13):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": at(math.radians(40 * step / 12))})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(300)
    turn = page.evaluate("() => window.nibApp.pages.current.store.camera.turn ?? 0")
    page.evaluate("() => window.nibApp.modes.setCanvasTurns(false)")
    if turn:
        fail(f"[{label}] two fingers turned a page note by {turn}")
    else:
        say(f"[{label}] two fingers turning the paper leave it upright")
    store_call(page, "s.fitAgain()")

def check_gutter(page: Page, cdp, label: str) -> None:
    say("--- the gutter ---")

    pages = pages_of(page)
    if len(pages) < 2:
        say("only one page: the gutter check needs two, skipped")
        return

    middle_of_gutter = pages[0]["height"] + 20
    store_call(page, f"s.camera = s.held({{ ...s.camera, y: {middle_of_gutter} }})")

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
    say("--- two hands and a pen ---")

    seen = page.evaluate("() => window.nibApp.canvasHand?.penSeen ?? null")
    if seen is None:
        say("the hand store is not reachable from the page; checking through the surface")

    tool(page, "d")
    box = surface(page)
    middle = box["x"] + box["width"] / 2

    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle - 60 + n * 8, box["y"] + 420) for n in range(12)],
        kind="touch",
    )
    if ink_count(page) != before:
        fail(f"[{label}] a finger drew on glass that has had a pen on it")

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

    if ink_count(page) > was + 1:
        fail(f"[{label}] a palm left a mark while the nib was down")

    shot(page, f"{label}-palm")

def check_finger_draws(browser, label: str) -> None:
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
    say("--- adding, reordering, deleting ---")

    was = len(pages_of(page))

    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(700)

    add = page.locator(f"{NAVIGATOR} .add")
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

    if pages[1]["y"] != pages[0]["height"] + 40:
        fail(f"[{label}] the second page sits at y={pages[1]['y']}, not one gutter down")

    thumbs = page.locator(f"{NAVIGATOR} .page").count()
    if thumbs != len(pages):
        fail(f"[{label}] {len(pages)} pages, {thumbs} thumbnails")

    shot(page, f"{label}-navigator")

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

    rows = page.locator(f"{NAVIGATOR} .page")
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

    order = [one["id"] for one in pages_of(page)]
    rows.nth(0).evaluate(
        """(row) => {
          const carried = new DataTransfer()
          carried.setData('application/nib-page', '1')
          carried.setData('text/nib-page', JSON.stringify({ note: '/elsewhere/Other.pages', page: 'p1' }))
          carried.setData('text/nib-from-another-window', 'text/nib-page')
          const box = row.getBoundingClientRect()
          const at = { bubbles: true, cancelable: true, dataTransfer: carried, clientX: box.left + 4, clientY: box.top + 2 }
          row.dispatchEvent(new DragEvent('dragover', at))
          row.dispatchEvent(new DragEvent('drop', at))
        }"""
    )
    page.wait_for_timeout(400)
    if [one["id"] for one in pages_of(page)] != order:
        fail(f"[{label}] a page dragged in from another window's list moved one of this note's pages")

def check_papers(page: Page, label: str) -> None:
    say("--- the three papers ---")

    page.evaluate("async () => window.nibApp.workspace.createPages(undefined, 'Papers.pages')")
    page.wait_for_timeout(900)
    page.wait_for_selector(".pages", timeout=15000)

    held = pages_of(page)
    if not held:
        fail(f"[{label}] no page note opened for the paper check")
        return

    first = held[0]

    for paper, width in (("letter", 816), ("long", 794), ("a4", 794)):
        rows = paper_menu(page, 0)
        if not rows:
            fail(f"[{label}] the page menu has no rows at all")
            return

        wanted = {"letter": "Letter", "long": "Long page", "a4": "A4"}[paper]
        if wanted not in rows:
            fail(f"[{label}] the page menu offers no {wanted!r} row: {rows}")
            return

        pressed = press_menu(page, wanted)
        if not pressed:
            fail(f"[{label}] the {wanted!r} row could not be pressed")
            return

        held = pages_of(page)[0]
        if held["paper"] != paper:
            fail(f"[{label}] a page asked for {paper} says {held['paper']}")
        if held["width"] != width:
            fail(f"[{label}] a {paper} page is {held['width']} wide rather than {width}")
        say(f"[{label}] {wanted}: {held['width']}x{held['height']}, called {held['paper']}")

        again = paper_menu(page, 0, disabled=True)
        if wanted not in again:
            fail(f"[{label}] the {wanted!r} row is offered again on a page that is {paper}")

    if first["id"] != pages_of(page)[0]["id"]:
        fail(f"[{label}] changing the paper made a different page")

    shot(page, f"{label}-papers")

    made = page.evaluate(
        """async (paper) => {
          const app = window.nibApp
          app.modes.setPagesPaper(paper)
          await app.workspace.createPages(undefined, 'On Letter.pages')
          await new Promise((resolve) => setTimeout(resolve, 700))
          const store = app.pages.current?.store
          const first = store?.pages[0]
          return first ? { paper: first.paper, width: first.width, kept: app.modes.pagesPaper } : null
        }""",
        "letter",
    )
    if not made:
        fail(f"[{label}] no page note was made for the default-paper check")
    else:
        if made["kept"] != "letter":
            fail(f"[{label}] the setting did not keep Letter: {made}")
        if made["paper"] != "letter" or made["width"] != 816:
            fail(f"[{label}] a new page note ignored the setting: {made}")
        else:
            say(f"[{label}] a new page note on the chosen paper: {made}")

    shot(page, f"{label}-new-on-letter")
    page.evaluate("() => window.nibApp.modes.setPagesPaper('a4')")

def paper_menu(page: Page, at: int, disabled: bool = False) -> list[str]:
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(500)

    thumb = page.locator(f"{NAVIGATOR} .page").nth(at)
    if thumb.count() < 1:
        return []

    thumb.click(button="right")
    page.wait_for_timeout(350)

    which = "[role=menuitem][disabled]" if disabled else "[role=menuitem]:not([disabled])"
    rows = page.locator(f"[role=menu] {which}")
    out = [rows.nth(one).inner_text().strip() for one in range(rows.count())]
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    return out

def press_menu(page: Page, label: str) -> bool:
    thumb = page.locator(f"{NAVIGATOR} .page").first
    thumb.click(button="right")
    page.wait_for_timeout(350)

    row = page.locator("[role=menu] [role=menuitem]", has_text=label).first
    if row.count() < 1:
        page.keyboard.press("Escape")
        return False

    row.click()
    page.wait_for_timeout(450)
    return True

def check_counter(page: Page, label: str) -> None:
    say("--- the page counter ---")

    count = len(pages_of(page))
    store_call(page, "s.turnTo(1)")

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

def check_turn_while_drawing(page: Page, cdp, label: str) -> None:
    say("--- a page turned with the pen down ---")

    held = pages_of(page)
    if len(held) < 2:
        fail(f"[{label}] fewer than two pages to turn between with the pen down")
        return

    store_call(page, "s.turnTo(1)")
    page.wait_for_timeout(300)
    tool(page, "d")
    box = surface(page)
    x0, y0 = box["x"] + box["width"] / 2 - 100, box["y"] + 240
    before = ink_count(page)

    def send(what: str, x: float, y: float, held_down: int) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {"type": what, "x": x, "y": y, "button": "left", "buttons": held_down, "clickCount": 1,
             "pointerType": "pen", "force": 0.6, "tiltX": 0, "tiltY": 0},
        )

    send("mousePressed", x0, y0, 1)
    for n in range(1, 8):
        send("mouseMoved", x0 + n * 10, y0, 1)
        page.wait_for_timeout(8)
    page.evaluate(
        "() => document.querySelector('.pages').dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }))"
    )
    page.wait_for_timeout(200)
    for n in range(8, 16):
        send("mouseMoved", x0 + n * 10, y0 + 30, 1)
        page.wait_for_timeout(8)
    send("mouseReleased", x0 + 160, y0 + 30, 0)
    page.wait_for_timeout(300)

    first = held[0]
    ys = page.evaluate(
        "(count) => window.nibApp.pages.current.store.canvas.ink.slice(count).flatMap((one) => one.points.map((p) => p.y))",
        before,
    )
    if not ys:
        fail(f"[{label}] the pen drew nothing before the page was turned")
    elif max(ys) > first["y"] + first["height"]:
        fail(
            f"[{label}] a page turned with the pen down drew a line onto the next page"
            f" (down to y={max(ys):.0f}, the first page ends at {first['y'] + first['height']:.0f})"
        )
    shot(page, f"{label}-turned-while-drawing")

def check_long_page(page: Page, label: str) -> None:
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
    say("--- the same file as a canvas ---")

    held = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { nodes: s.canvas.nodes.length, ink: s.canvas.ink.length, pages: s.pages.length }
        }"""
    )

    settled(page)
    before = file_of(page)

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

def paper_bytes(sizes: list[tuple[float, float]]) -> str:
    import base64

    objects: list[str] = []
    kids = " ".join(f"{3 + at * 2} 0 R" for at in range(len(sizes)))
    objects.append("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj")
    objects.append(f"2 0 obj<</Type/Pages/Kids[{kids}]/Count {len(sizes)}>>endobj")

    for at, (wide, tall) in enumerate(sizes):
        page = 3 + at * 2
        stream = f"0 0 0 rg 40 40 {wide - 80:.0f} {tall - 80:.0f} re f"
        objects.append(
            f"{page} 0 obj<</Type/Page/Parent 2 0 R"
            f"/MediaBox[0 0 {wide:.2f} {tall:.2f}]/Contents {page + 1} 0 R>>endobj"
        )
        objects.append(f"{page + 1} 0 obj<</Length {len(stream)}>>stream\n{stream}\nendstream\nendobj")

    body = "\n".join(
        ["%PDF-1.4", *objects, f"trailer<</Root 1 0 R/Size {2 + len(sizes) * 2 + 1}>>", "%%EOF"]
    )

    return base64.b64encode(body.encode("latin-1")).decode("ascii")

IMPORT_PAPER = """
async ({ base64, name }) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  const importing = window.nibApp.importing
  importing.show()
  importing.root = window.nibApp.workspace.activeSpace.root
  await importing.take([new File([bytes], name, { type: 'application/pdf' })])

  const format = importing.format
  const said = importing.error
  if (format !== 'pdf-pages') return { format, error: said }

  await importing.run()
  importing.close()
  await window.nibApp.workspace.loadTree()

  return { format, error: importing.error, stage: importing.stage, folder: importing.folder }
}
"""

DARK_ON_SHEETS = """
() => {
  const out = []
  for (const sheet of document.querySelectorAll('.sheet canvas')) {
    const context = sheet.getContext('2d', { willReadFrequently: true })
    if (!context || !sheet.width || !sheet.height) {
      out.push({ width: sheet.width, height: sheet.height, dark: 0 })
      continue
    }

    const data = context.getImageData(0, 0, sheet.width, sheet.height).data
    let dark = 0
    // Every fortieth pixel, which is thousands of them on a page and quick enough to
    // ask for on every sheet in the note.
    for (let at = 0; at < data.length; at += 160) {
      if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
    }

    out.push({ width: sheet.width, height: sheet.height, dark })
  }
  return out
}
"""

DARK_ON_THUMBS = """
() => {
  const out = []
  for (const thumb of document.querySelectorAll('.navigator .page canvas')) {
    const context = thumb.getContext('2d', { willReadFrequently: true })
    if (!context || !thumb.width || !thumb.height) continue

    const data = context.getImageData(0, 0, thumb.width, thumb.height).data
    let dark = 0
    for (let at = 0; at < data.length; at += 40) {
      if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
    }

    out.push({ width: thumb.width, height: thumb.height, dark })
  }
  return out
}
"""

def check_paper(page: Page, label: str) -> None:
    say("--- a paper imported as pages ---")

    made = page.evaluate(
        IMPORT_PAPER,
        {"base64": paper_bytes([(595.28, 841.89), (612.0, 792.0)]), "name": "Lecture 4.pdf"},
    )
    if made.get("format") != "pdf-pages":
        fail(f"[{label}] the import read the paper as {made.get('format')!r}: {made.get('error')!r}")
        return

    say(f"[{label}] imported into a folder of its own: {made.get('folder')!r}")

    opened_note = page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.files.find((one) => one.name === 'Lecture 4.pages')
          if (!note) return null
          await ws.openEntry(note.path, { activate: true })
          return note.path
        }"""
    )
    if not opened_note:
        fail(f"[{label}] the import wrote no page note for the paper")
        return

    beside = page.evaluate(
        "() => window.nibApp.workspace.files.filter((one) => one.name.startsWith('Lecture 4')).map((one) => one.name)"
    )
    if beside != ["Lecture 4.pages"]:
        fail(f"[{label}] the import shows {beside} in the list rather than the page note alone")

    say(f"[{label}] the note the import made: {opened_note}")
    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(3500)

    held = pages_of(page)
    if len(held) != 2:
        fail(f"[{label}] the paper became {len(held)} pages rather than two")
        return

    if [one["paper"] for one in held] != ["a4", "letter"]:
        fail(f"[{label}] the pages call themselves {[one['paper'] for one in held]}")
    if (held[0]["width"], held[0]["height"]) != (794, 1123):
        fail(f"[{label}] the A4 page is {held[0]['width']}x{held[0]['height']}")
    if (held[1]["width"], held[1]["height"]) != (816, 1056):
        fail(f"[{label}] the Letter page is {held[1]['width']}x{held[1]['height']}")

    sheets = page.evaluate(DARK_ON_SHEETS)
    say(f"[{label}] the sheets: {sheets}")
    if len(sheets) != 2:
        fail(f"[{label}] {len(sheets)} sheets draw a paper rather than two")
    for at, one in enumerate(sheets):
        if one["dark"] < 100:
            fail(f"[{label}] page {at + 1} drew nothing: {one}")

    shot(page, f"{label}-paper")

    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(3000)
    thumbs = page.evaluate(DARK_ON_THUMBS)
    say(f"[{label}] the thumbnails: {thumbs}")
    if not thumbs:
        fail(f"[{label}] the outline panel drew no thumbnails at all")
    elif not any(one["dark"] >= 20 for one in thumbs):
        fail(f"[{label}] no thumbnail has any of the paper on it: {thumbs}")

    shot(page, f"{label}-paper-thumbnails")

    page.evaluate(
        """async (paper) => {
          const open = indexedDB.open('nib')
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result)
            open.onerror = () => reject(open.error)
          })
          await new Promise((resolve, reject) => {
            const write = db.transaction(['assets', 'stats'], 'readwrite')
            write.objectStore('assets').delete(paper)
            write.objectStore('stats').delete(paper)
            write.oncomplete = () => resolve()
            write.onerror = () => reject(write.error)
          })
          const store = window.nibApp.pages.current.store
          const first = store.pages[0]
          store.edit({
            ...store.canvas,
            nodes: store.canvas.nodes.map((node) =>
              node.id === first.id ? { ...node, file: 'Nowhere at all.pdf' } : node,
            ),
          })
        }""",
        f"{opened_note}.pdf",
    )
    page.wait_for_timeout(1500)

    said = page.locator(".sheet .missing").count()
    if said < 1:
        fail(f"[{label}] a page whose paper is not there says nothing about it")
    else:
        say(f"[{label}] {said} sheet(s) say the paper could not be read")

    shot(page, f"{label}-paper-missing")

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
        check_lasso(page, cdp, theme)
        check_lasso_held(page, cdp, theme)
        check_upright(page, cdp, theme)
        check_palm(page, cdp, theme)
        check_rulings(page, theme)
        check_adding(page, theme)
        check_counter(page, theme)
        check_turn_while_drawing(page, cdp, theme)
        check_gutter(page, cdp, theme)
        if theme == "light":
            check_long_page(page, theme)
            check_file(page, theme)
            check_as_canvas(page, theme)
            check_papers(page, theme)
        check_paper(page, theme)
        if theme == "light":
            check_print(page, theme)
    finally:
        context.close()

def drive_phone(browser) -> None:
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

        bars = page.locator(".canvas-bar, .bar").count()
        if bars < 1:
            fail("[phone] the pen bar is not on the page")
        shot(page, "phone-bar")

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

        tool(page, "v")
        hold = (box["x"] + box["width"] / 2, box["y"] + 420)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": hold[0], "y": hold[1], "id": 1}]})
        page.wait_for_timeout(900)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(500)
        rows = [one.strip() for one in page.locator("[role=menu] [role=menuitem]").all_inner_texts()]
        if "Fit width" not in rows or "Print" not in rows:
            fail(f"[phone] a finger held on the paper opened no menu ({rows})")
        else:
            say(f"[phone] a finger held on the paper opens its menu: {rows}")
        shot(page, "phone-paper-menu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        pages = pages_of(page)
        if len(pages) >= 2 and pages[1]["y"] <= pages[0]["y"]:
            fail("[phone] the pages are not in a column")
    finally:
        context.close()

def main() -> int:
    with DRIVE.session() as browser:
        for theme in ("light", "dark"):
            drive(browser, theme)
        check_finger_draws(browser, "no-pen")
        drive_phone(browser)

    return DRIVE.verdict("everything the drive checked was right")

if __name__ == "__main__":
    sys.exit(main())
