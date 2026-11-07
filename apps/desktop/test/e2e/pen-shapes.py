from __future__ import annotations

import sys
import time

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin

def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)

AGENTS = {
    "pencil": (
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
        " (KHTML, like Gecko) Version/18.0 Safari/604.1"
    ),
    "surface": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/140.0.0.0 Safari/537.36"
    ),
    "wacom": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/140.0.0.0 Safari/537.36"
    ),
    "usi": (
        "Mozilla/5.0 (X11; CrOS aarch64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/140.0.0.0 Safari/537.36"
    ),
}

NO_COALESCING = """
delete PointerEvent.prototype.getCoalescedEvents;
delete PointerEvent.prototype.getPredictedEvents;
"""

AS_TABLET = """
() => {
  const app = window.ordenApp;
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
    wait_for(page, "!!window.ordenApp", f"[{label}] the app to start")
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    if tablet:
        page.evaluate(AS_TABLET)

    opened_it = "window.ordenApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createCanvas()")
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

def ink_of(page: Page) -> list[dict]:
    return page.evaluate("() => JSON.parse(window.ordenApp.workspace.active.doc).orden?.ink ?? []")

def points_of(stroke: dict) -> list[dict]:
    flat = stroke["points"]

    return [
        {
            "x": flat[at],
            "y": flat[at + 1],
            "pressure": flat[at + 2],
            "tiltX": flat[at + 3],
            "tiltY": flat[at + 4],
            "t": flat[at + 5],
        }
        for at in range(0, len(flat) - 5, 6)
    ]

def camera_of(page: Page) -> dict:
    return page.evaluate(
        "() => ({ x: 0, y: 0, scale: 1, ...(window.ordenApp.workspace.active.camera ?? {}) })"
    )

def profile_of(page: Page) -> str:
    said = page.locator("[data-pointer]").first.inner_text()
    return said.split("//")[0].strip()

def tool(page: Page, key: str) -> None:
    page.keyboard.press("Escape")
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    page.keyboard.press(key)
    page.wait_for_timeout(120)

ERASE_ALL = 'button[aria-label="Erase everything drawn"]'

def wipe(page: Page) -> None:
    page.keyboard.press("Escape")
    eraser = page.locator('.cluster button[aria-label="Erase"]').first

    for _try in range(3):
        if page.locator(ERASE_ALL).count() > 0:
            break
        eraser.click()
        page.wait_for_timeout(250)

    page.locator(ERASE_ALL).first.click()
    page.keyboard.press("Escape")

    until = time.monotonic() + 6
    while time.monotonic() < until:
        if not ink_of(page):
            return
        page.wait_for_timeout(100)

    fail("the plane would not empty")

def settled(page: Page) -> None:
    page.wait_for_timeout(1600)

def span_of(stroke: dict) -> float:
    xs = [point["x"] for point in points_of(stroke)]

    return max(xs) - min(xs)

def line(page: Page, steps: int = 24, span: float = 240, down: float = 60) -> list[tuple[float, float]]:
    box = plane(page)
    x = box["x"] + box["width"] / 2 - span / 2
    y = box["y"] + box["height"] / 2 - down

    return [(x + span * at / (steps - 1), y + (at % 4) * 12) for at in range(steps)]

def pressed(buttons: int) -> str:
    if buttons & 2:
        return "right"
    if buttons & 4:
        return "middle"

    return "left" if buttons else "none"

def pen_stroke(
    page: Page,
    cdp,
    points: list[tuple[float, float]],
    buttons: int = 1,
    halfway: int | None = None,
    pressure: float | None = None,
    tilt: tuple[float, float] = (0, 0),
    kind: str = "pen",
    pause: int = 8,
) -> None:

    def send(what: str, x: float, y: float, force: float, held: int, changed: str = "") -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": what,
                "x": x,
                "y": y,
                "button": changed or pressed(held),
                "buttons": held,
                "clickCount": 1,
                "pointerType": kind,
                "force": force,
                "tiltX": tilt[0],
                "tiltY": tilt[1],
            },
        )

    first = points[0]
    send("mousePressed", first[0], first[1], pressure if pressure is not None else 0.4, buttons)

    held = buttons
    turn = len(points) // 2
    for at, (x, y) in enumerate(points[1:], start=1):
        if halfway is not None and at == turn:
            held = halfway
        share = at / (len(points) - 1)
        force = pressure if pressure is not None else 0.35 + 0.6 * (1 - abs(0.5 - share) * 2)
        send("mouseMoved", x, y, force, held)
        page.wait_for_timeout(pause)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, 0, pressed(held))
    page.wait_for_timeout(250)

def hover(page: Page, cdp, points: list[tuple[float, float]], buttons: int = 0) -> None:
    for x, y in points:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseMoved",
                "x": x,
                "y": y,
                "button": "none",
                "buttons": buttons,
                "pointerType": "pen",
                "force": 0,
                "tiltX": 0,
                "tiltY": 0,
            },
        )
        page.wait_for_timeout(16)

RAW = """
([kind, points, over]) => {
  const host = document.querySelector('.canvas');
  const rect = host.getBoundingClientRect();

  for (const [at, point] of points.entries()) {
    const what = at === 0 ? 'pointerdown' : at === points.length - 1 ? 'pointerup' : 'pointermove';
    host.dispatchEvent(
      new PointerEvent(what, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'pen',
        isPrimary: true,
        clientX: rect.left + point[0],
        clientY: rect.top + point[1],
        ...over,
        ...(what === 'pointerup' ? { button: 0, buttons: 0, pressure: 0 } : {}),
      }),
    );
  }

  return kind;
}
"""

def raw_stroke(page: Page, points: list[tuple[float, float]], over: dict, what: str) -> None:
    inside = plane(page)
    page.evaluate(
        RAW,
        [what, [(x - inside["x"], y - inside["y"]) for x, y in points], over],
    )
    page.wait_for_timeout(250)

def context_for(browser, shape: str, tablet: bool):
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        user_agent=AGENTS[shape],
        color_scheme="dark",
        has_touch=tablet,
        is_mobile=False,
        device_scale_factor=1,
    )
    if shape == "pencil":
        context.add_init_script(NO_COALESCING)

    return context

def drive_pencil(browser) -> None:
    say("--- an Apple Pencil on an iPad ---")

    context = context_for(browser, "pencil", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[pencil] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "pencil", tablet=True)
        tool(page, "d")

        pen_stroke(page, cdp, line(page, steps=9, span=300), pause=24)
        settled(page)

        drawn = ink_of(page)
        said = profile_of(page)
        say(f"the profile says: {said}")

        if "apple g0.8" not in said:
            fail(f"an iPad's pen is not read as a Pencil with its own gain ({said})")
        if "plain unguessed" not in said:
            fail(f"a browser with neither call is not read as having neither ({said})")
        if len(drawn) != 1:
            fail(f"a Pencil with no coalescing did not draw one stroke ({len(drawn)})")
        else:
            say(f"a coarse Pencil stroke landed, {len(points_of(drawn[0]))} samples long")
        shot(page, "pen-shape-pencil-stroke")

        wipe(page)
        tool(page, "d")
        raw_stroke(
            page,
            line(page, steps=8, span=260),
            {
                "button": 0,
                "buttons": 1,
                "pressure": 0.55,
                "tiltX": 0,
                "tiltY": 0,
                "altitudeAngle": 0.7853981633974483,
                "azimuthAngle": 0,
            },
            "a Pencil leaning halfway over",
        )
        settled(page)

        leaning = ink_of(page)
        if len(leaning) != 1:
            fail(f"a Pencil reporting its lean as two angles did not draw ({len(leaning)})")
        else:
            tilts = {point["tiltX"] for point in points_of(leaning[0])}
            if tilts != {45}:
                fail(f"an altitude of a quarter turn did not land as 45 degrees of tilt ({tilts})")
            else:
                say("a lean reported as an altitude and an azimuth landed as tilt")

        said = profile_of(page)
        if "spherical" not in said:
            fail(f"a lean reported in radians is not read as the spherical pair ({said})")
        else:
            say(f"the profile says: {said}")
        shot(page, "pen-shape-pencil-lean")

        check_hover(page, cdp, "pencil")

        tool(page, "d")
        was = len(ink_of(page))
        pen_stroke(page, cdp, line(page, steps=12, span=200, down=-140))
        settled(page)
        tool(page, "e")
        pen_stroke(page, cdp, line(page, steps=12, span=200, down=-140))
        settled(page)

        if len(ink_of(page)) != was:
            fail("the eraser off the bar rubbed nothing out for a pen with no button")
        else:
            say("the eraser off the bar rubs out, which is a Pencil's only way to")
        shot(page, "pen-shape-pencil-erased")
    finally:
        context.close()

def check_hover(page: Page, cdp, label: str) -> None:
    wipe(page)
    tool(page, "d")
    box = plane(page)

    pen_stroke(page, cdp, line(page, steps=14, span=200))
    settled(page)
    clean = ink_of(page)
    if len(clean) != 1:
        fail(f"[{label}] the stroke to compare a hover against never landed")
        return

    wipe(page)
    tool(page, "d")

    hover(
        page,
        cdp,
        [
            (box["x"] + 40, box["y"] + 40),
            (box["x"] + 120, box["y"] + box["height"] - 80),
            (box["x"] + box["width"] - 60, box["y"] + 60),
        ],
    )

    if ink_of(page):
        fail(f"[{label}] a hovering pen drew on the plane")
    else:
        say(f"[{label}] a hovering pen leaves nothing")

    pen_stroke(page, cdp, line(page, steps=14, span=200))
    settled(page)
    after = ink_of(page)

    if len(after) != 1:
        fail(f"[{label}] the stroke after a hover did not land ({len(after)})")
    elif span_of(after[0]) > span_of(clean[0]) * 1.4:
        fail(
            f"[{label}] the stroke after a hover took a phantom line with it"
            f" ({span_of(after[0]):.0f} against {span_of(clean[0]):.0f})"
        )
    else:
        say(f"[{label}] a stroke after a hover begins where the nib landed")

    shot(page, f"pen-shape-{label}-after-hover")

def drive_surface(browser) -> None:
    say("--- a Surface Pen on Windows ---")

    context = context_for(browser, "surface", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[surface] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "surface")
        tool(page, "d")

        pen_stroke(page, cdp, line(page), tilt=(-24, 8))
        settled(page)

        said = profile_of(page)
        say(f"the profile says: {said}")
        if "windows g1" not in said:
            fail(f"a pen on Windows is not read as one ({said})")
        if "coalesced predicted" not in said:
            fail(f"Chromium's two calls are not seen where they are there ({said})")
        if "tilt" not in said:
            fail(f"a pen leaning in degrees is not read as leaning in degrees ({said})")

        drawn = ink_of(page)
        if len(drawn) != 1:
            fail(f"a Surface Pen did not draw one stroke ({len(drawn)})")
        else:
            say("a Surface Pen stroke landed")
        shot(page, "pen-shape-surface-stroke")

        wipe(page)
        tool(page, "d")
        pen_stroke(page, cdp, line(page), buttons=1, halfway=3)
        settled(page)
        if ink_of(page):
            fail("a barrel button pressed halfway through a line did not rub out")
        else:
            say("a barrel button pressed halfway through a line rubs out")

        wipe(page)
        tool(page, "d")
        was = len(ink_of(page))
        pen_stroke(page, cdp, line(page, down=-140))
        settled(page)
        if len(ink_of(page)) == was:
            fail("nothing to rub out with the eraser end")

        raw_stroke(
            page,
            line(page, down=-140),
            {"button": 5, "buttons": 32, "pressure": 0.5, "tiltX": 0, "tiltY": 0},
            "the eraser end",
        )
        settled(page)
        if len(ink_of(page)) != was:
            fail("a pen turned over onto its eraser end did not rub out")
        else:
            say("a pen turned over onto its eraser end rubs out")
        shot(page, "pen-shape-surface-erased")

        wipe(page)
        tool(page, "d")
        points = line(page, steps=10, span=160)
        pen_stroke(page, cdp, points[:5])
        page.wait_for_timeout(900)
        if page.locator(".menu-sheet, [role='menu']").count() > 0:
            fail("a menu opened under a nib held still")
        else:
            say("a nib held still opens no menu")

        hover(page, cdp, [(points[0][0] + 30, points[0][1] + 30)], buttons=2)
        page.wait_for_timeout(400)
        if page.locator(".menu-sheet, [role='menu']").count() > 0:
            fail("a menu opened under a hovering pen holding its barrel button")
        else:
            say("a barrel button held over the glass opens no menu")

        check_hover(page, cdp, "surface")
    finally:
        context.close()

def drive_wacom(browser) -> None:
    say("--- a Wacom on a desktop ---")

    context = context_for(browser, "wacom", tablet=False)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[wacom] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "wacom")

        check_hover(page, cdp, "wacom")

        tool(page, "d")
        before = camera_of(page)
        box = plane(page)
        pen_stroke(
            page,
            cdp,
            [
                (box["x"] + box["width"] / 2 + step * 8, box["y"] + box["height"] / 2)
                for step in range(14)
            ],
            buttons=4,
        )
        page.wait_for_timeout(300)
        after = camera_of(page)

        if abs(after["x"] - before["x"]) < 10:
            fail(f"the middle button did not pan the plane ({before} to {after})")
        else:
            say("the middle button pans the plane with a pen in hand")
        shot(page, "pen-shape-wacom-panned")

        wipe(page)
        tool(page, "d")
        pen_stroke(page, cdp, line(page))
        settled(page)
        if not ink_of(page):
            fail("nothing to rub out with a right-clicking pen")

        pen_stroke(page, cdp, line(page), buttons=2)
        settled(page)
        if ink_of(page):
            fail("a pen reported as right-clicking did not rub out")
        else:
            say("a pen whose button the driver mapped to the right one rubs out")
    finally:
        context.close()

def drive_usi(browser) -> None:
    say("--- a USI pen on a Chromebook ---")

    context = context_for(browser, "usi", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[usi] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "usi")
        tool(page, "d")

        pen_stroke(page, cdp, line(page, steps=30, span=280), pressure=0.03)
        settled(page)

        said = profile_of(page)
        say(f"the profile says: {said}")
        if "chromeos" not in said:
            fail(f"a Chromebook's pen is not read as one ({said})")
        if "flat" not in said:
            fail(f"a pressure that never changes is still being believed ({said})")

        drawn = ink_of(page)
        if len(drawn) != 1:
            fail(f"a USI pen did not draw one stroke ({len(drawn)})")
        else:
            felt = {point["pressure"] for point in points_of(drawn[0])}
            if felt == {0.03}:
                fail("a pen's fixed sliver of pressure was drawn as pressure")
            else:
                say(f"a fixed sliver of pressure is ignored, and the ink is drawn at {felt}")
        shot(page, "pen-shape-usi-stroke")
    finally:
        context.close()

def drive_finger(browser) -> None:
    say("--- a finger, on glass a pen has been on ---")

    context = context_for(browser, "surface", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[finger] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "finger", tablet=True)
        tool(page, "d")

        pen_stroke(page, cdp, line(page, steps=14, span=200))
        settled(page)
        drawn = len(ink_of(page))
        if drawn != 1:
            fail(f"the pen that has to be seen first did not draw ({drawn})")

        before = camera_of(page)
        box = plane(page)
        page.touchscreen.tap(box["x"] + 60, box["y"] + 60)
        cdp.send(
            "Input.dispatchTouchEvent",
            {
                "type": "touchStart",
                "touchPoints": [{"x": box["x"] + 200, "y": box["y"] + 200}],
            },
        )
        for step in range(1, 12):
            cdp.send(
                "Input.dispatchTouchEvent",
                {
                    "type": "touchMove",
                    "touchPoints": [{"x": box["x"] + 200 + step * 14, "y": box["y"] + 200}],
                },
            )
            page.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(400)

        after = camera_of(page)
        if len(ink_of(page)) != drawn:
            fail("a finger drew on glass that has had a pen on it")
        elif abs(after["x"] - before["x"]) < 10:
            fail(f"a finger did not move the page with an ink tool in hand ({before} to {after})")
        else:
            say("a finger moves the page and leaves no mark, with a pen in the bar")
        shot(page, "pen-shape-finger-panned")
    finally:
        context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive_pencil(browser)
        drive_surface(browser)
        drive_wacom(browser)
        drive_usi(browser)
        drive_finger(browser)

    return DRIVE.verdict("every pen the drive could emulate behaves")

if __name__ == "__main__":
    sys.exit(main())
