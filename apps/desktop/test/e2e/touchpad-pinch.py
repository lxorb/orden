"""A trackpad's pinch zooms a canvas and a page note with the fingers (#410).

Chromium and WebView2 send a two-finger pinch as Ctrl and the wheel, in small steps that
are a hundred times the log of how far the fingers moved apart; read as a wheel's notches,
a pinch to twice the span zoomed an eighth, which under a hand is nothing happening. WebKit
on a Mac sends the same pinch as `gesturestart`, `gesturechange` and `gestureend`, which
nothing listened for. On both surfaces this pinches with the trackpad Chromium itself
synthesises (`Input.synthesizePinchGesture` from a touchpad), sends the Ctrl-wheel steps
of a pinch and WebKit's gestures by hand, and turns the wheel a notch with Ctrl held, and
holds each to the zoom it should be, about the point between the fingers, with the
window's own zoom - its page scale, its pixel ratio and the app's text size - untouched.

    python apps/desktop/test/e2e/touchpad-pinch.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import math

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

HINTS = "try { localStorage.setItem('nib:hints', JSON.stringify(['graph', 'palette'])) } catch {}"
NOTCH = 1.2

WINDOW = (
    "() => ({ ratio: window.devicePixelRatio, page: window.visualViewport.scale,"
    " text: getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim() })"
)

SURFACES = {
    "canvas": {
        "make": "() => window.nibApp.workspace.createCanvas()",
        "element": '[role="application"][aria-roledescription]',
        "scale": "() => window.nibApp.workspace.active?.camera?.scale ?? 1",
        "camera": "() => window.nibApp.workspace.active?.camera ?? { x: 0, y: 0, scale: 1 }",
    },
    "page note": {
        "make": "() => window.nibApp.workspace.createPages()",
        "element": ".pages",
        "scale": "() => window.nibApp.pages.current.store.camera.scale",
        "camera": "() => window.nibApp.pages.current.store.camera",
    },
}

# The Ctrl-wheel steps of a pinch to `span` times the fingers' distance, as Chromium
# sends them, dispatched on what is under the point.
STEPS = """
([x, y, span, steps]) => {
  const at = document.elementFromPoint(x, y)
  for (let i = 0; i < steps; i += 1) {
    at.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
      clientX: x, clientY: y, deltaY: -100 * Math.log(span) / steps, deltaMode: 0 }))
  }
}
"""

# WebKit's pinch on a Mac, to `span`.
GESTURE = """
([x, y, span]) => {
  const at = document.elementFromPoint(x, y)
  const send = (type, scale) => at.dispatchEvent(Object.assign(
    new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y }))
  send('gesturestart', 1)
  for (let i = 1; i <= 8; i += 1) send('gesturechange', Math.pow(span, i / 8))
  send('gestureend', span)
}
"""


def near(got: float, want: float, slack: float) -> bool:
    return abs(math.log(got / want)) <= math.log(1 + slack)


def one(page: Page, cdp, name: str, how: dict) -> None:
    page.evaluate(how["make"])
    page.wait_for_selector(how["element"], timeout=20000)
    page.wait_for_timeout(1200)
    box = page.locator(how["element"]).first.bounding_box()
    assert box
    x, y = box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.45
    window = page.evaluate(WINDOW)

    def scale() -> float:
        return float(page.evaluate(how["scale"]))

    def step(what: str, want: float, slack: float, act) -> None:
        was = scale()
        act()
        page.wait_for_timeout(600)
        got = scale() / was
        say(f"[{name}] {what}: x{got:.3f} (wanted x{want:.3f})")
        if not near(got, want, slack):
            wrong(f"[{name}] {what} zoomed x{got:.3f}, not x{want:.3f}")

    def ctrl_notch() -> None:
        page.mouse.move(x, y)
        page.keyboard.down("Control")
        page.mouse.wheel(0, -100)
        page.keyboard.up("Control")

    step("a wheel's notch with Ctrl", NOTCH, 0.02, ctrl_notch)
    step(
        "the trackpad's pinch to twice the span",
        2.0,
        0.2,
        lambda: cdp.send(
            "Input.synthesizePinchGesture",
            {"x": x, "y": y, "scaleFactor": 2.0, "gestureSourceType": "mouse"},
        ),
    )
    step("a pinch's Ctrl-wheel steps out to half", 0.5, 0.02, lambda: page.evaluate(STEPS, [x, y, 0.5, 12]))

    # About the point between the fingers: what was under it is under it still.
    pane = page.locator(how["element"]).first.bounding_box()
    assert pane
    sx, sy = x - pane["x"] - pane["width"] / 2, y - pane["y"] - pane["height"] / 2
    before = page.evaluate(how["camera"])
    step("WebKit's pinch to one and a half", 1.5, 0.02, lambda: page.evaluate(GESTURE, [x, y, 1.5]))
    after = page.evaluate(how["camera"])
    if name == "canvas":
        under = (sx / before["scale"] + before["x"], sy / before["scale"] + before["y"])
        still = (sx / after["scale"] + after["x"], sy / after["scale"] + after["y"])
        if abs(under[0] - still[0]) > 1 or abs(under[1] - still[1]) > 1:
            wrong(f"[{name}] the pinch moved what was between the fingers: {under} -> {still}")

    if page.evaluate(WINDOW) != window:
        wrong(f"[{name}] the window's own zoom changed: {window} -> {page.evaluate(WINDOW)}")
    DRIVE.shot(page, name.replace(" ", "-"))


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 800})
    page = context.new_page()
    page.add_init_script(HINTS)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        cdp = context.new_cdp_session(page)
        for name, how in SURFACES.items():
            one(page, cdp, name, how)
    finally:
        context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a trackpad's pinch zooms a canvas and a page note with the fingers"))
