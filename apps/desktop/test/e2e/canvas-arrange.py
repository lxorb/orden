from __future__ import annotations

import sys

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin

def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)

PREPARE = """
// What is handed to the print engine, kept where the drive can read it: printing goes
// through a frame's `srcdoc`, and the dialog it opens is not something a drive sees.
(() => {
  const own = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true,
    get() { return own.get.call(this) },
    set(value) { window.__printed = value; own.set.call(this, value) },
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

def opened(page: Page, label: str, tablet: bool = False) -> None:
    wait_for(page, "!!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    if tablet:
        page.evaluate(AS_TABLET)

    opened_it = "window.nibApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({opened_it})"):
            break
    else:
        raise SystemExit(f"[{label}] no canvas ever opened")

    page.wait_for_selector(".canvas", timeout=15000)
    page.wait_for_timeout(400)

def plane(page: Page) -> dict:
    box = page.locator(".canvas").first.bounding_box()
    assert box
    return box

def canvas_of(page: Page) -> dict:
    return page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc)")

def written(page: Page, holds: str, patience: int = 8000) -> None:
    try:
        page.wait_for_function(
            "() => { const doc = window.nibApp.workspace.active?.doc;"
            " if (!doc) return false;"
            " let plane; try { plane = JSON.parse(doc) } catch { return false }"
            f" return {holds} }}",
            timeout=patience,
        )
    except Exception:  # noqa: BLE001 - the check after this says what was missing
        pass

def cursor_of(page: Page) -> str:
    return page.evaluate("() => getComputedStyle(document.querySelector('.canvas')).cursor")

def tool(page: Page, key: str) -> None:
    page.keyboard.press("Escape")
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    page.keyboard.press(key)
    page.wait_for_timeout(120)

def pen_stroke(
    page: Page,
    cdp,
    points: list[tuple[float, float]],
    buttons: int = 1,
    kind: str = "pen",
    halfway: int | None = None,
) -> None:

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

    held = buttons
    turn = len(points) // 2
    for at, (x, y) in enumerate(points[1:], start=1):
        if halfway is not None and at == turn:
            held = halfway
        send("mouseMoved", x, y, 0.7, held)
        page.wait_for_timeout(8)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, held)
    page.wait_for_timeout(250)

def open_panel(page: Page, opener, inside: str) -> None:
    for _try in range(3):
        if page.locator(inside).count() > 0:
            return

        opener.click()
        page.wait_for_timeout(250)

    if page.locator(inside).count() < 1:
        fail(f"the panel holding {inside} never opened")

def shut_panels(page: Page) -> None:
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

def check_cursors(page: Page) -> None:
    say("--- what the pointer says ---")

    tool(page, "v")
    if cursor_of(page) != "default":
        fail(f"the arrow does not wear the default cursor ({cursor_of(page)})")

    tool(page, "h")
    if cursor_of(page) != "grab":
        fail(f"the hand does not wear a grab ({cursor_of(page)})")

    tool(page, "r")
    if cursor_of(page) != "crosshair":
        fail(f"a put-down tool does not wear a crosshair ({cursor_of(page)})")

    tool(page, "d")
    drawn = cursor_of(page)
    if "svg" not in drawn:
        fail(f"the pen does not wear a drawn nib ({drawn})")
    else:
        say("the pen wears a nib drawn in its own colour")

    tool(page, "e")
    narrow = cursor_of(page)
    if "svg" not in narrow:
        fail(f"the eraser does not wear a drawn ring ({narrow})")

    eraser = page.locator('.cluster button[aria-label="Erase"]').first
    open_panel(page, eraser, 'button[aria-label="Erase everything drawn"]')
    width = page.locator('.panel input[aria-label="Width"]').first
    width.fill("40")
    width.dispatch_event("input")
    page.wait_for_timeout(250)
    shot(page, "canvas-eraser-panel")

    shut_panels(page)
    wide = cursor_of(page)
    if wide == narrow:
        fail("the eraser's ring does not follow the width dial")
    else:
        say("the eraser's ring is redrawn when the width dial moves")

    open_panel(page, eraser, 'button[aria-label="Erase everything drawn"]')
    width = page.locator('.panel input[aria-label="Width"]').first
    width.fill("10")
    width.dispatch_event("input")
    page.wait_for_timeout(150)
    shut_panels(page)

    tool(page, "v")
    shot(page, "canvas-cursor-arrow")

def check_pattern(page: Page) -> None:
    say("--- the background pattern ---")

    for name, scale in (("in", 2.0), ("one", 1.0), ("out", 0.2), ("far", 0.03)):
        page.evaluate(
            "(scale) => { const tab = window.nibApp.workspace.active;"
            " tab.camera = { ...(tab.camera ?? { x: 0, y: 0 }), scale } }",
            scale,
        )
        page.wait_for_timeout(250)

        layers = page.locator(".canvas .dots").count()
        if layers < 1:
            fail(f"no pattern at all at a zoom of {scale}")
        else:
            steps = page.evaluate(
                "() => [...document.querySelectorAll('.canvas .dots')]"
                ".map((one) => Math.round(parseFloat(getComputedStyle(one)"
                ".getPropertyValue('--dot-step'))))"
            )
            say(f"at {scale}x the pattern is {layers} layer(s), {steps}px apart")
            if min(steps) < 4:
                fail(f"the pattern is a wash at a zoom of {scale} ({steps}px apart)")

        shot(page, f"canvas-pattern-{name}")

    page.evaluate(
        "() => { const tab = window.nibApp.workspace.active;"
        " tab.camera = { x: 0, y: 0, scale: 1 } }"
    )
    page.wait_for_timeout(200)

def check_pull(page: Page) -> None:
    say("--- what is drawn while it is dragged out ---")

    box = plane(page)
    for name, key, selector in (
        ("arrow", "a", ".canvas svg.drawing path"),
        ("elbow", "b", ".canvas svg.drawing path"),
        ("diamond", "m", ".canvas svg.drawing path"),
        ("rectangle", "r", ".canvas .band.pulling"),
        ("card", "c", ".canvas .band.pulling"),
        ("frame", "f", ".canvas .band.pulling"),
    ):
        tool(page, key)
        page.mouse.move(box["x"] + 200, box["y"] + 200)
        page.mouse.down()
        page.mouse.move(box["x"] + 420, box["y"] + 340, steps=8)
        page.wait_for_timeout(150)

        drawn = page.locator(selector).count()
        if drawn < 1:
            fail(f"a {name} being dragged out is not drawn until it is let go")
        else:
            say(f"a {name} is drawn while it is being dragged out")

        shot(page, f"canvas-pulling-{name}")
        page.mouse.up()
        page.wait_for_timeout(250)
        page.keyboard.press("Delete")
        page.wait_for_timeout(150)

    tool(page, "v")

def check_connector(page: Page) -> None:
    say("--- connectors ---")

    three_cards(page)

    one = page.locator('.canvas .node[data-id="aa"]').first.bounding_box()
    two = page.locator('.canvas .node[data-id="bb"]').first.bounding_box()
    assert one and two

    tool(page, "a")
    page.mouse.move(one["x"] + one["width"] / 2, one["y"] + one["height"] / 2)
    page.mouse.down()
    page.mouse.move(two["x"] + two["width"] / 2, two["y"] + two["height"] / 2, steps=12)
    page.wait_for_timeout(200)

    if page.locator(".canvas .port.aiming").count() < 1:
        fail("the anchor an arrow will attach to is not shown while it is dragged")
    else:
        say("the anchor an arrow will attach to is shown before it is let go")

    shot(page, "canvas-connector-aiming")
    page.mouse.up()
    written(page, "plane.edges.length >= 1")

    edges = canvas_of(page).get("edges", [])
    if len(edges) != 1:
        fail(f"an arrow dragged between two cards did not become a connector ({edges})")
    else:
        say("an arrow dragged from one card to another became a connector")
        shot(page, "canvas-connector-made")

    tool(page, "v")

def check_shape_text(page: Page) -> None:
    say("--- words inside a shape ---")

    fresh(page)
    page.evaluate(
        """() => {
          const tab = window.nibApp.workspace.active
          tab.note.replace(JSON.stringify({
            nodes: [],
            edges: [],
            nib: { version: 1, shapes: [
              { id: 'dd', shape: 'rhombus', x: -120, y: -80, width: 240, height: 160,
                text: 'Ready?' },
              { id: 'ee', shape: 'triangle', x: 200, y: -80, width: 200, height: 160 },
            ] },
          }, null, '\\t') + '\\n')
        }"""
    )
    page.wait_for_timeout(600)

    said = page.locator(".canvas .node.shape .card").first
    if said.count() < 1 or "Ready?" not in said.inner_text():
        fail("a shape does not show the words inside it")
    else:
        say("a shape shows the words inside it")

    shot(page, "canvas-shape-words")

    tool(page, "v")
    empty = page.locator('.canvas .node[data-id="ee"]').first.bounding_box()
    assert empty
    page.mouse.click(empty["x"] + empty["width"] * 0.25, empty["y"] + empty["height"] - 2)
    page.wait_for_timeout(250)

    if page.locator(".canvas .node.shape.picked").count() < 1:
        fail("a press on a shape's own line does not pick it")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)

    if page.locator(".canvas .node.shape .editor").count() < 1:
        fail("Enter does not open the words inside a shape")
    else:
        say("Enter opens the words inside a shape")
        shot(page, "canvas-shape-writing")

    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

def check_more_menu(page: Page) -> None:
    say("--- the rest of what can be done ---")

    three_cards(page)
    page.locator(".canvas").first.click(position={"x": 20, "y": 20})
    page.keyboard.press("Control+a")
    page.wait_for_timeout(300)

    more = page.locator('.over button[aria-label="More"]').first
    if more.count() < 1:
        fail("the bar over what is picked offers no menu")
        return

    more.click()
    page.wait_for_timeout(400)

    rows = menu_rows(page)
    for unwanted in ("Card", "Note", "Picture", "Link", "Frame"):
        if unwanted in rows:
            fail(f"the selection bar's menu offers {unwanted}, which puts something new down")
    if page.locator("[role=menu] [role=menuitem][disabled]").count():
        fail("the selection bar's menu has greyed rows rather than leaving them out")
    if "Group" not in rows or "Arrange" not in rows:
        fail(f"the selection bar's menu has no Group or no Arrange ({rows})")
    shot(page, "canvas-more-menu")

    page.locator("[role=menu] [role=menuitem]", has_text="Arrange").first.click()
    page.wait_for_timeout(400)
    rows = menu_rows(page)
    for wanted in ("Align left", "Spread across", "Bring to front"):
        if wanted not in rows:
            fail(f"Arrange does not offer {wanted} ({rows})")
    say("the selection bar's menu offers Group and Arrange, and Arrange the rest")
    shot(page, "canvas-more-arrange")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    page.keyboard.press("Escape")
    page.locator(".canvas").first.click(position={"x": 20, "y": 20})
    page.locator(".canvas").first.click(position={"x": 60, "y": 60}, button="right")
    page.wait_for_timeout(400)
    rows = menu_rows(page)
    if page.locator("[role=menu] [role=menuitem][disabled]").count():
        fail("the plane's menu has greyed rows rather than leaving them out")
    for wanted in ("Card", "Frame", "Fit the canvas", "Export as PDF"):
        if wanted not in rows:
            fail(f"the plane's menu on nothing has no {wanted} ({rows})")
    for unwanted in ("Duplicate", "Delete", "Arrange"):
        if unwanted in rows:
            fail(f"the plane's menu on nothing offers {unwanted}")
    fits = page.evaluate(
        "() => { const m = document.querySelector('[role=menu]').getBoundingClientRect();"
        " return m.bottom <= innerHeight && m.top >= 0 }"
    )
    if not fits:
        fail("the plane's menu on nothing does not fit the window")
    say(f"the plane's menu on nothing is {len(rows)} rows, all of them live")
    shot(page, "canvas-menu-bare")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

def check_print(page: Page) -> None:
    say("--- printing ---")

    three_cards(page)
    page.evaluate("() => { window.__printed = null }")
    page.locator(".canvas").first.click(position={"x": 20, "y": 20})
    page.keyboard.press("Control+p")
    try:
        page.wait_for_function("() => !!window.__printed", timeout=30000)
    except Exception:  # noqa: BLE001 - said below
        fail("Ctrl+P on a canvas handed nothing to the print engine")
        return
    sheet = page.evaluate("() => window.__printed")
    if "<svg" not in sheet or "one" not in sheet or "@page" not in sheet:
        fail("printing a canvas handed over something that is not its sheet")
    else:
        say("printing a canvas hands the print engine the sheet its PDF is made from")

def menu_rows(page: Page) -> list[str]:
    rows = page.locator("[role=menu] [role=menuitem]")
    return [rows.nth(one).inner_text().strip() for one in range(rows.count())]

PICKED_SPILL = """
() => {
  const plane = document.querySelector('.canvas').getBoundingClientRect()
  const over = [...document.querySelectorAll('.over .bar, .over .panel')]
  const spill = over.map((one) => {
    const box = one.getBoundingClientRect()
    return Math.max(plane.left - box.left, box.right - plane.right, 0)
  })
  const dots = [...document.querySelectorAll('.over .panel button')]
    .map((one) => one.getBoundingClientRect().width)
  return {
    spill: Math.round(Math.max(0, ...spill)),
    dots: dots.length ? Math.round(Math.min(...dots)) : 0,
    widest: Math.round(Math.max(0, ...dots)),
  }
}
"""

def check_picked_inside(page: Page) -> None:
    say("--- the bar over what is picked, against an edge ---")

    for side, push in (("left", 520), ("right", -520)):
        fresh(page)
        page.evaluate(
            """() => window.nibApp.workspace.active.note.replace(JSON.stringify({
              nodes: [{ id: 'aa', type: 'text', x: 0, y: 0, width: 70, height: 60, text: 'edge' }],
              edges: [],
            }, null, '\\t') + '\\n')"""
        )
        page.wait_for_timeout(600)
        box = plane(page)
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.wheel(push, 0)
        page.wait_for_timeout(400)
        page.locator(".canvas .node", has_text="edge").first.click()
        page.wait_for_timeout(300)
        page.locator('.over button[aria-label="Colour"]').first.click()
        page.wait_for_timeout(400)
        got = page.evaluate(PICKED_SPILL)
        if got["spill"] > 0:
            fail(f"against the {side} edge the bar over the pick hangs {got['spill']}px off the plane")
        elif got["dots"] < got["widest"] or got["dots"] < 20:
            fail(f"against the {side} edge the colours are squeezed ({got})")
        else:
            say(f"against the {side} edge the bar and its colours stay on the plane, whole")
        shot(page, f"canvas-picked-{side}-edge")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

def check_lasso_held(page: Page) -> None:
    say("--- the lasso, held on its key ---")

    fresh(page)
    box = plane(page)
    tool(page, "d")
    x0, y0 = box["x"] + box["width"] / 2 - 120, box["y"] + box["height"] / 2
    page.mouse.move(x0, y0)
    page.mouse.down()
    for step in range(1, 20):
        page.mouse.move(x0 + step * 12, y0 + (step % 4) * 8)
    page.mouse.up()
    page.wait_for_timeout(300)

    page.keyboard.down("q")
    page.wait_for_timeout(100)
    held = cursor_of(page)
    pressed = page.evaluate(
        "() => document.querySelector('.cluster .bar button[aria-pressed=true]')?.getAttribute('aria-label')"
    )
    page.mouse.move(x0 - 30, y0 - 30)
    page.mouse.down()
    for x, y in ((x0 + 260, y0 - 30), (x0 + 260, y0 + 60), (x0 - 30, y0 + 60), (x0 - 30, y0 - 30)):
        page.mouse.move(x, y, steps=6)
    page.mouse.up()
    page.keyboard.up("q")
    page.wait_for_timeout(300)

    back = page.evaluate(
        "() => document.querySelector('.cluster .bar button[aria-pressed=true]')?.getAttribute('aria-label')"
    )
    caught = page.evaluate("() => [...document.querySelectorAll('.over button')].length")
    say(f"held: cursor {held}, in hand {pressed}; let go: in hand {back}, bar over the pick {caught}")
    if held != "crosshair" or pressed != "Lasso":
        fail(f"the lasso's key held did not put the lasso in hand ({pressed}, cursor {held})")
    if back != "Pen":
        fail(f"letting the lasso's key go did not give the pen back ({back})")
    if not caught:
        fail("what the held lasso caught was not left caught")
    shot(page, "canvas-lasso-held")
    page.keyboard.press("Escape")

def check_broken_picture(page: Page) -> None:
    say("--- a picture that is not there ---")

    fresh(page)
    page.evaluate(
        """() => {
          const tab = window.nibApp.workspace.active
          tab.note.replace(JSON.stringify({
            nodes: [
              { id: 'ff', type: 'file', x: -120, y: -80, width: 240, height: 160,
                file: 'gone/nowhere.png' },
            ],
            edges: [],
          }, null, '\\t') + '\\n')
        }"""
    )
    page.wait_for_timeout(900)

    if page.locator(".canvas .node .missing").count() < 1:
        fail("a picture the space no longer holds shows no placeholder")
    else:
        say("a picture the space no longer holds shows a calm placeholder")

    shot(page, "canvas-picture-gone")

def fresh(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.createCanvas()")
    page.wait_for_timeout(800)
    page.wait_for_selector(".canvas", timeout=15000)

def three_cards(page: Page) -> None:
    fresh(page)
    page.evaluate(
        """() => {
          const tab = window.nibApp.workspace.active
          tab.note.replace(JSON.stringify({
            nodes: [
              { id: 'aa', type: 'text', x: -300, y: -60, width: 200, height: 80, text: 'one' },
              { id: 'bb', type: 'text', x: 120, y: -60, width: 200, height: 80, text: 'two' },
              { id: 'cc', type: 'text', x: -60, y: 200, width: 200, height: 80, text: 'three' },
            ],
            edges: [],
          }, null, '\\t') + '\\n')
        }"""
    )
    page.wait_for_timeout(600)

def check_arranging(page: Page) -> None:
    say("--- arranging ---")

    box = plane(page)
    tool(page, "v")
    three_cards(page)

    page.keyboard.press("Control+a")
    page.wait_for_timeout(300)
    grouped = page.locator('.over button[aria-label="Group"]')
    if grouped.count() < 1:
        fail("the bar over several things picked does not offer to group them")
    else:
        grouped.first.click()
        written(page, "plane.nodes.some((one) => one.type === 'group')")
        frames = [one for one in canvas_of(page)["nodes"] if one["type"] == "group"]
        if len(frames) != 1:
            fail(f"grouping several things did not make one frame ({len(frames)})")
        else:
            say("several things picked were made one frame from the selection bar")
        shot(page, "canvas-grouped")

        ungrouped = page.locator('.over button[aria-label="Ungroup"]')
        if ungrouped.count() < 1:
            fail("the bar over a frame does not offer to take it apart")
        else:
            ungrouped.first.click()
            written(page, "!plane.nodes.some((one) => one.type === 'group')")
            left = canvas_of(page)["nodes"]
            if any(one["type"] == "group" for one in left):
                fail("ungrouping left the frame behind")
            elif len(left) != 3:
                fail(f"ungrouping did not leave what the frame held ({len(left)})")
            else:
                say("a frame taken apart left everything it held where it was")

    three_cards(page)
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    card = page.locator('.canvas .node[data-id="aa"]').first.bounding_box()
    assert card
    page.keyboard.down("Alt")
    page.mouse.move(card["x"] + card["width"] / 2, card["y"] + card["height"] / 2)
    page.mouse.down()
    page.mouse.move(card["x"] + card["width"] / 2, card["y"] + card["height"] / 2 + 220, steps=10)
    page.wait_for_timeout(150)
    page.mouse.up()
    page.keyboard.up("Alt")
    settled(page)

    after = canvas_of(page)["nodes"]
    if len(after) != 4:
        fail(f"alt on a drag did not leave a copy behind ({len(after)} cards)")
    else:
        say("alt on a drag left a copy where the drag began")
    shot(page, "canvas-alt-drag")

    page.keyboard.press("Control+z")
    written(page, "plane.nodes.length === 3")
    if len(canvas_of(page)["nodes"]) != 3:
        fail("one undo did not take back both the copy and the drag that made it")
    else:
        say("one undo takes back both the copy and the drag")

    three_cards(page)
    picked = page.locator('.canvas .node[data-id="bb"]').first.bounding_box()
    assert picked
    page.mouse.click(picked["x"] + picked["width"] / 2, picked["y"] + picked["height"] / 2)
    page.wait_for_timeout(250)
    was = next(one for one in canvas_of(page)["nodes"] if one["id"] == "bb")
    handle = page.locator(".canvas .handle").nth(4).bounding_box()
    if handle:
        page.keyboard.down("Shift")
        page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2)
        page.mouse.down()
        page.mouse.move(
            handle["x"] + handle["width"] / 2 + 200,
            handle["y"] + handle["height"] / 2,
            steps=10,
        )
        page.wait_for_timeout(150)
        shot(page, "canvas-resize-aspect")
        page.mouse.up()
        page.keyboard.up("Shift")
        written(
            page,
            f"plane.nodes.some((one) => one.id === 'bb' && one.width !== {was['width']})",
        )

        now = next(one for one in canvas_of(page)["nodes"] if one["id"] == "bb")
        before = was["width"] / was["height"]
        after_ratio = now["width"] / now["height"]
        if abs(before - after_ratio) > 0.15:
            fail(f"a resize held with Shift did not keep the shape ({before} to {after_ratio})")
        elif now["width"] == was["width"]:
            fail("a resize held with Shift changed nothing at all")
        else:
            say("a resize held with Shift kept the shape of the box")

    page.keyboard.press("Escape")

def check_picture(page: Page) -> None:
    say("--- a picture ---")

    asked: list[str] = []
    page.on("filechooser", lambda chooser: asked.append(chooser.element.get_attribute("accept")))

    tool(page, "i")
    page.locator(".canvas").first.click(position={"x": 400, "y": 300})
    page.wait_for_timeout(700)

    if not asked:
        fail("the picture tool never asked for a picture")
    elif "image/" not in (asked[0] or ""):
        fail(f"the picture picker does not ask for pictures ({asked[0]})")
    else:
        say(f"the picture tool opens the system's own picker, asking for {asked[0]}")

    page.keyboard.press("Escape")
    tool(page, "v")

def check_panel_shuts(page: Page) -> None:
    say("--- popovers ---")

    box = plane(page)
    open_panel(page, page.locator(".cluster button.pen").first, 'input[aria-label="Opacity"]')
    shot(page, "canvas-pen-panel")

    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + 120)
    page.wait_for_timeout(300)

    if page.locator('input[aria-label="Opacity"]').count() > 0:
        fail("the pen panel does not shut when the plane is tapped")
    else:
        say("the pen panel shuts when the plane is tapped")

    page.locator('.cluster button[aria-label="Add"]').first.click()
    page.wait_for_timeout(200)
    if page.locator('.panel button[aria-label="Picture"]').count() < 1:
        fail("the put-down grid has no Picture in it")
    else:
        say("the put-down grid offers a Note and a Picture as two things")
    shot(page, "canvas-put-grid")

    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + 120)
    page.wait_for_timeout(300)
    if page.locator(".panel").count() > 0:
        fail("the put-down grid does not shut when the plane is tapped")
    else:
        say("the put-down grid shuts when the plane is tapped")

def check_bar_docks(page: Page) -> None:
    say("--- where the bar sits ---")

    grip = page.locator('[aria-label="Move the bar"]').first
    if grip.count() < 1:
        say("note: the bar shows no grip on this device, so there is nothing to drag")
        return

    window = page.evaluate("() => ({ w: window.innerWidth, h: window.innerHeight })")
    corners = {
        "left": (20, window["h"] / 2),
        "top": (window["w"] / 2, 20),
        "right": (window["w"] - 20, window["h"] / 2),
        "bottom": (window["w"] / 2, window["h"] - 20),
    }

    for edge, (x, y) in corners.items():
        here = page.locator('[aria-label="Move the bar"]').first.bounding_box()
        assert here
        page.mouse.move(here["x"] + here["width"] / 2, here["y"] + here["height"] / 2)
        page.mouse.down()
        page.mouse.move((here["x"] + x) / 2, (here["y"] + y) / 2, steps=6)
        page.wait_for_timeout(120)
        if edge == "left":
            shot(page, "canvas-bar-carried")
        page.mouse.move(x, y, steps=8)
        page.wait_for_timeout(120)
        page.mouse.up()
        page.wait_for_timeout(500)

        held = page.evaluate("() => JSON.parse(localStorage.getItem('nib:pens') ?? '{}').dock")
        if held != edge:
            fail(f"the bar let go by the {edge} edge went to {held}")
        else:
            say(f"the bar let go by the {edge} edge sprang to it")

        standing = page.locator(".cluster.standing").count() > 0
        if standing != (edge in ("left", "right")):
            fail(f"the bar at the {edge} edge is {'standing' if standing else 'lying'}")

        shot(page, f"canvas-bar-{edge}")

def wipe(page: Page) -> None:
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    page.keyboard.press("Escape")
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(400)

def settled(page: Page) -> None:
    page.wait_for_timeout(1600)

def check_pen_button(page: Page, cdp, tablet: bool = False) -> None:
    say("--- the pen's own button ---")

    box = plane(page)
    line = [
        (box["x"] + box["width"] / 2 - 160 + step * 14, box["y"] + box["height"] / 2 - 40)
        for step in range(24)
    ]

    def ink() -> list:
        return canvas_of(page).get("nib", {}).get("ink", [])

    wipe(page)
    tool(page, "d")

    pen_stroke(page, cdp, line)
    settled(page)
    drawn = ink()
    if len(drawn) != 1:
        fail(f"a pen with no button held did not draw one stroke ({len(drawn)})")
    else:
        say("a plain pen stroke landed")
    shot(page, "canvas-pen-stroke")

    pen_stroke(page, cdp, line, buttons=2)
    settled(page)
    if ink():
        fail("a pen holding its button reported as the right one did not rub out")
    else:
        say("a pen holding its button reported as the right one rubbed out")

    wipe(page)
    tool(page, "d")
    pen_stroke(page, cdp, line, buttons=1, halfway=2)
    settled(page)
    if ink():
        fail("a button pressed halfway through a line neither wrote nor rubbed out")
    else:
        say("a button pressed halfway through a line turns that stroke into a rub")

    if tablet:
        tool(page, "d")
        pen_stroke(page, cdp, line)
        settled(page)
        pen_stroke(page, cdp, line, buttons=2, kind="mouse")
        settled(page)
        if ink():
            fail("a mouse holding button two on a tablet with a pen did not rub out")
        else:
            say("a stylus that reports itself as a mouse still rubs out on a tablet")

    say(f"the pointer record says: {page.locator('[data-pointer]').first.inner_text()}")
    shot(page, "canvas-pen-rubbed")

    if page.locator(".menu-sheet, [role='menu']").count() > 0:
        fail("the menu opened under the pen's own button")

def check_sharp_stroke(page: Page, cdp) -> None:
    say("--- a stroke that turns sharply ---")

    box = plane(page)
    tool(page, "d")
    page.evaluate(
        "() => { const tab = window.nibApp.workspace.active;"
        " tab.note.replace('{\\n\\t\"nodes\": [],\\n\\t\"edges\": []\\n}\\n') }"
    )
    page.wait_for_timeout(400)

    zigzag = []
    for step in range(30):
        zigzag.append(
            (
                box["x"] + 160 + step * 18,
                box["y"] + 260 + (60 if step % 2 else -60),
            )
        )

    pen_stroke(page, cdp, zigzag)
    written(page, "(plane.nib?.ink ?? []).length > 0")
    shot(page, "canvas-sharp-stroke")

    drawn = canvas_of(page).get("nib", {}).get("ink", [])
    if not drawn:
        fail("a stroke that turns sharply left nothing on the plane")
    else:
        say("a stroke that turns sharply landed whole")

def check_pen_colours(page: Page, theme: str) -> None:
    open_panel(page, page.locator(".cluster button.pen").first, 'input[aria-label="Opacity"]')

    dot = page.locator('.panel button[aria-label="The ink of the page"]').first
    if dot.count() < 1:
        fail("the pen's colours do not name the ink of the page")
    else:
        shown = page.evaluate(
            "(el) => getComputedStyle(el, '::after').backgroundColor",
            dot.element_handle(),
        )
        say(f"[{theme}] the page's own ink shows as {shown}")

    shot(page, f"canvas-pen-colours-{theme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

def drive_tablet(browser) -> None:
    say("=== tablet ===")
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        has_touch=True,
        device_scale_factor=1,
    )
    context.add_init_script(PREPARE + "\nlocalStorage.setItem('nib:pen-seen', 'yes');")
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[tablet] page error: {error}"))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "tablet", tablet=True)

        tool(page, "e")
        if cursor_of(page) not in ("auto", "default"):
            fail(f"a touch screen was given a drawn cursor ({cursor_of(page)})")
        else:
            say("a touch screen is given no drawn cursor, as it should be")

        tool(page, "v")
        shot(page, "canvas-tablet-bar")

        wipe(page)
        tool(page, "d")
        line = [
            (
                plane(page)["x"] + 240 + step * 16,
                plane(page)["y"] + 300 + (step % 3) * 12,
            )
            for step in range(20)
        ]
        pen_stroke(page, cdp, line)
        settled(page)

        tool(page, "e")
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mousePressed",
                "x": line[8][0],
                "y": line[8][1],
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0.5,
            },
        )
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseMoved",
                "x": line[9][0],
                "y": line[9][1],
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0.5,
            },
        )
        page.wait_for_timeout(200)

        if page.locator(".canvas .rubbing").count() < 1:
            fail("the eraser shows no ring on a screen that has no cursor")
        else:
            say("the eraser draws its ring on the page, under the nib")
        shot(page, "canvas-tablet-rubbing")

        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseReleased",
                "x": line[9][0],
                "y": line[9][1],
                "button": "left",
                "buttons": 0,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0,
            },
        )
        page.wait_for_timeout(200)

        check_pen_button(page, cdp, tablet=True)
        check_bar_docks(page)
    finally:
        context.close()

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
    page.on(
        "console",
        lambda one: fail(f"[{theme}] console error: {one.text}")
        if one.type == "error" and "404" not in one.text
        else None,
    )

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, theme)

        if page.locator(ZOOM_ON_BAR).count():
            fail(f"[{theme}] the bar still has its zoom buttons")
        check_cursors(page)
        check_pattern(page)
        check_panel_shuts(page)
        check_pen_colours(page, theme)
        check_pull(page)
        check_connector(page)
        check_shape_text(page)
        check_arranging(page)
        check_more_menu(page)
        check_picked_inside(page)
        check_lasso_held(page)
        check_picture(page)
        check_broken_picture(page)
        check_sharp_stroke(page, cdp)
        check_pen_button(page, cdp)
        if theme == "light":
            check_bar_docks(page)
            check_print(page)
    finally:
        context.close()

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

BAR_SEEN = """
() => {
  const row = document.querySelector('.cluster .scroller')
  const box = row.getBoundingClientRect()
  const seen = [...row.querySelectorAll('button')]
    .filter((one) => { const at = one.getBoundingClientRect(); return at.left >= box.left - 1 && at.right <= box.right + 1 })
    .map((one) => one.getAttribute('aria-label'))
  return { seen, start: row.classList.contains('fade-start'), end: row.classList.contains('fade-end') }
}
"""

ZOOM_ON_BAR = (
    ".cluster button[aria-label='Zoom in'], .cluster button[aria-label='Zoom out'],"
    " .cluster button[aria-label='Zoom'], .cluster button[aria-label='Show the whole canvas']"
)

def drive_phone(browser, theme: str) -> None:
    say(f"=== phone, {theme} ===")
    context = browser.new_context(
        viewport={"width": 412, "height": 900},
        color_scheme=theme,
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[phone] page error: {error}"))

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        wait_for(page, "!!window.nibApp", "[phone] the app to start")
        wait_for(page, "window.nibApp.workspace.spaces.length > 0", "[phone] a space to exist")
        page.evaluate(AS_PHONE)
        opened(page, "phone")
        page.wait_for_timeout(400)

        if page.locator(ZOOM_ON_BAR).count():
            fail(f"[phone/{theme}] the bar still has its zoom buttons")
        first = page.evaluate(BAR_SEEN)
        say(f"[phone/{theme}] on screen: {first['seen']}")
        if "Undo" not in first["seen"][:3] or "Redo" not in first["seen"][:3]:
            fail(f"[phone/{theme}] Undo and Redo are not first on a phone's bar ({first['seen']})")
        if first["start"] or not first["end"]:
            fail(f"[phone/{theme}] the bar at its start fades the wrong ends ({first})")
        shot(page, f"canvas-phone-bar-{theme}")

        page.evaluate("() => { const row = document.querySelector('.cluster .scroller'); row.scrollLeft = row.scrollWidth }")
        page.wait_for_timeout(300)
        last = page.evaluate(BAR_SEEN)
        if not last["start"] or last["end"]:
            fail(f"[phone/{theme}] the bar at its end fades the wrong ends ({last})")
        else:
            say(f"[phone/{theme}] Undo and Redo first, and the bar fades where there is more")
        shot(page, f"canvas-phone-bar-end-{theme}")
    finally:
        context.close()

CARD_AT = """
(words) => {
  const card = [...document.querySelectorAll('.canvas .node')].find((one) => one.textContent.includes(words))
  const box = card?.getBoundingClientRect()
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
}
"""

TO_SCREEN = """
(point) => {
  const camera = window.nibApp.workspace.active.camera
  const rect = document.querySelector('.canvas').getBoundingClientRect()
  const turn = camera.turn ?? 0
  const dx = (point.x - camera.x) * camera.scale
  const dy = (point.y - camera.y) * camera.scale
  return {
    x: rect.left + rect.width / 2 + dx * Math.cos(turn) - dy * Math.sin(turn),
    y: rect.top + rect.height / 2 + dx * Math.sin(turn) + dy * Math.cos(turn),
  }
}
"""

def two_fingers(cdp, middle: tuple[float, float], degrees: float, steps: int = 12) -> None:
    import math

    def at(angle: float) -> list[dict]:
        dx, dy = 80 * math.cos(angle), 80 * math.sin(angle)
        return [
            {"x": middle[0] - dx, "y": middle[1] - dy, "id": 1},
            {"x": middle[0] + dx, "y": middle[1] + dy, "id": 2},
        ]

    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": at(0)})
    for step in range(1, steps + 1):
        angle = math.radians(degrees * step / steps)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": at(angle)})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

def drive_turning(browser) -> None:
    say("=== turning ===")
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        has_touch=True,
        device_scale_factor=1,
    )
    context.add_init_script(PREPARE + "\nlocalStorage.setItem('nib:pen-seen', 'yes');")
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[turning] page error: {error}"))
    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    turn = "() => window.nibApp.workspace.active.camera?.turn ?? 0"
    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "turning")
        tool(page, "v")
        three_cards(page)
        box = plane(page)
        middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

        page.evaluate("() => window.nibApp.modes.setCanvasTurns(false)")
        two_fingers(cdp, middle, 40)
        page.wait_for_timeout(300)
        if abs(page.evaluate(turn)) > 1e-6:
            fail(f"two fingers turned the canvas with the setting off ({page.evaluate(turn)})")
        else:
            say("with the setting off, two fingers turned do not turn the canvas")

        page.evaluate("() => window.nibApp.modes.setCanvasTurns(true)")
        two_fingers(cdp, middle, 40)
        page.wait_for_timeout(400)
        got = page.evaluate(turn)
        say(f"with the setting on, the canvas turned by {math_degrees(got):.1f} degrees")
        if not 0.4 < got < 0.75:
            fail(f"two fingers turned forty degrees turned the canvas by {got} radians")
        shot(page, "canvas-turned")

        two = page.evaluate(CARD_AT, "two")
        page.mouse.click(two["x"], two["y"])
        page.wait_for_timeout(200)
        page.keyboard.press("Delete")
        written(page, "!plane.nodes.some((n) => n.id === 'bb')")
        if any(node["id"] == "bb" for node in canvas_of(page)["nodes"]):
            fail("a click on a card in a turned view did not land on that card")
        else:
            say("a click on a card in a turned view lands on it")

        one = page.evaluate(CARD_AT, "one")
        page.mouse.move(one["x"], one["y"])
        page.mouse.down()
        page.mouse.move(one["x"] + 60, one["y"], steps=6)
        page.mouse.move(one["x"] + 120, one["y"], steps=6)
        page.mouse.up()
        page.wait_for_timeout(400)
        moved = page.evaluate(CARD_AT, "one")
        shift = (moved["x"] - one["x"], moved["y"] - one["y"])
        if abs(shift[0] - 120) > 20 or abs(shift[1]) > 20:
            fail(f"a card dragged 120px right in a turned view went {shift} on screen")
        else:
            say("a card dragged across a turned view goes where the hand went")

        page.keyboard.press("Escape")
        page.wait_for_timeout(1600)
        aa = next(node for node in canvas_of(page)["nodes"] if node["id"] == "aa")
        start = page.evaluate(
            TO_SCREEN, {"x": aa["x"] + aa["width"] + 2, "y": aa["y"] + aa["height"] / 2}
        )
        end = page.evaluate(CARD_AT, "three")
        page.mouse.move(start["x"] - 20, start["y"])
        page.mouse.move(start["x"], start["y"], steps=3)
        page.wait_for_timeout(200)
        page.mouse.down()
        page.mouse.move(start["x"] + 15, start["y"] + 15, steps=4)
        page.mouse.move(end["x"], end["y"], steps=12)
        page.mouse.up()
        written(page, "plane.edges.some((e) => e.fromNode === 'aa' && e.toNode === 'cc')")
        if not any(e["fromNode"] == "aa" and e["toNode"] == "cc" for e in canvas_of(page)["edges"]):
            fail("a connector dragged between two cards in a turned view joined nothing")
        else:
            say("a connector dragged between two cards in a turned view joins them")

        tool(page, "d")
        x0, y0 = box["x"] + 160, box["y"] + box["height"] - 220
        page.mouse.move(x0, y0)
        page.mouse.down()
        for step in range(1, 16):
            page.mouse.move(x0 + step * 10, y0 + (step % 3) * 8)
        page.mouse.up()
        page.wait_for_timeout(300)
        page.keyboard.down("q")
        page.mouse.move(x0 - 30, y0 - 30)
        page.mouse.down()
        for x, y in ((x0 + 190, y0 - 30), (x0 + 190, y0 + 50), (x0 - 30, y0 + 50), (x0 - 30, y0 - 30)):
            page.mouse.move(x, y, steps=5)
        page.mouse.up()
        page.keyboard.up("q")
        page.wait_for_timeout(300)
        if not page.evaluate("() => document.querySelectorAll('.over button').length"):
            fail("the lasso in a turned view caught nothing of what was drawn under it")
        else:
            say("the lasso in a turned view catches what was drawn under it")
        shot(page, "canvas-turned-ink")
        page.keyboard.press("Escape")
        tool(page, "v")

        page.locator(".canvas").first.click(position={"x": 20, "y": 20})
        page.keyboard.press("Control+Alt+r")
        page.wait_for_timeout(300)
        if abs(page.evaluate(turn)) > 1e-6:
            fail(f"Ctrl+Alt+R did not stand the canvas upright ({page.evaluate(turn)})")
        else:
            say("Ctrl+Alt+R stands the canvas upright")
        shot(page, "canvas-upright-again")
        page.evaluate("() => window.nibApp.modes.setCanvasTurns(false)")
    finally:
        context.close()

def math_degrees(radians: float) -> float:
    import math

    return math.degrees(radians)

def main() -> int:
    with DRIVE.session() as browser:
        for theme in ("light", "dark"):
            drive(browser, theme)
        drive_tablet(browser)
        for theme in ("light", "dark"):
            drive_phone(browser, theme)
        drive_turning(browser)

    return DRIVE.verdict("everything the drive checked was right")

if __name__ == "__main__":
    sys.exit(main())
