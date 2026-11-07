from __future__ import annotations

import sys

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

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
localStorage.setItem('orden:pen-seen', 'yes');
localStorage.setItem('orden:finger-draws', 'yes');
"""

COLOUR_ROWS = """
() => {
  const row = document.querySelector('.colours');
  if (!row) return { none: true };

  const dots = [...row.children].map((one) => {
    const box = one.getBoundingClientRect();
    const ink = getComputedStyle(one, '::after');
    return {
      name: one.getAttribute('aria-label') ?? one.title ?? '?',
      top: Math.round(box.top),
      cell: Math.round(box.width * 10) / 10,
      wide: Math.round(parseFloat(ink.width) * 10) / 10,
      tall: Math.round(parseFloat(ink.height) * 10) / 10,
    };
  });

  const tops = [...new Set(dots.map((one) => one.top))];
  const panel = row.parentElement.getBoundingClientRect();

  return {
    none: false,
    dots: dots.length,
    first: dots.slice(0, 8),
    rows: tops.map((top) => dots.filter((one) => one.top === top).length),
    panel: Math.round(panel.width),
    over: Math.round(row.getBoundingClientRect().right - panel.right),
  };
}
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

AS_PHONE = """
() => {
  const app = window.ordenApp;
  app.viewport.device = 'phone';
  const root = document.documentElement;
  root.dataset.device = 'phone';
  root.toggleAttribute('data-touch', true);
  root.toggleAttribute('data-drawer', true);
  root.toggleAttribute('data-narrow', false);
}
"""

def opened(page: Page, label: str, device: str) -> None:
    wait_for(page, "!!window.ordenApp", f"[{label}] the app to start")
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    page.evaluate(AS_TABLET if device == "tablet" else AS_PHONE)

    opened_it = "window.ordenApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({opened_it})"):
            break
    else:
        raise SystemExit(f"[{label}] no canvas ever opened")
    page.wait_for_selector('[aria-label="Move the bar"]', timeout=15000)
    page.wait_for_timeout(400)

def pen_at(page: Page, index: int):
    return page.locator(".cluster button.pen").nth(index)

def kept_pens(page: Page) -> list[str]:
    return page.evaluate(
        "() => JSON.parse(localStorage.getItem('orden:pens')).pens.map((one) => one.tool)"
    )

def drag(page: Page, one, onto) -> None:
    here = one.bounding_box()
    there = onto.bounding_box()
    assert here and there

    page.mouse.move(here["x"] + here["width"] / 2, here["y"] + here["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(600)
    page.mouse.move(there["x"] + there["width"] / 2, there["y"] + there["height"] / 2, steps=10)
    page.wait_for_timeout(150)
    page.mouse.up()
    page.wait_for_timeout(250)

def stroke(page, cdp, points: list[tuple[float, float]]) -> None:

    def send(kind: str, x: float, y: float, force: float, buttons: int) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": kind,
                "x": x,
                "y": y,
                "button": "left",
                "buttons": buttons,
                "clickCount": 1,
                "pointerType": "pen",
                "force": force,
                "tiltX": 0,
                "tiltY": 0,
            },
        )

    first = points[0]
    send("mousePressed", first[0], first[1], 0.4, 1)
    for at, (x, y) in enumerate(points[1:], start=1):
        share = at / (len(points) - 1)
        send("mouseMoved", x, y, 0.35 + 0.6 * (1 - abs(0.5 - share) * 2), 1)
        page.wait_for_timeout(8)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, 0)
    page.wait_for_timeout(250)

INK = "() => JSON.parse(window.ordenApp.workspace.active.note.latest).orden?.ink ?? []"

def ink_of(page: Page) -> list[dict]:
    try:
        wait_for(page, f"({INK})().length > 0", "the stroke to reach the note", 10)
    except SystemExit:
        pass
    return page.evaluate(INK)

def photograph(browser, theme: str, device: str, failures: list[str]) -> None:
    label = f"{device}/{theme}"
    say(f"--- {label} ---")

    tablet = device == "tablet"
    size = {"width": 1180, "height": 820} if tablet else {"width": 412, "height": 900}
    context = browser.new_context(
        viewport=size,
        user_agent=TABLET_AGENT if tablet else PHONE_AGENT,
        color_scheme=theme,
        has_touch=True,
        is_mobile=True,
        device_scale_factor=2,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, label, device)

        pen_at(page, 0).click()
        page.wait_for_timeout(350)
        shot(page, f"pen-bar-{device}-{theme}")

        pen_at(page, 0).click()
        page.wait_for_selector('input[aria-label="Opacity"]', timeout=5000)
        page.wait_for_timeout(300)
        shot(page, f"pen-settings-{device}-{theme}")

        rows = page.evaluate(COLOUR_ROWS)
        say(f"[{label}] the colours: {rows}")
        if rows["none"]:
            failures.append(f"{label}: the pen's popover has no row of colours")
        else:
            eight = rows["first"]
            if len(eight) < 8:
                failures.append(f"{label}: the row holds {len(eight)} dots rather than eight")
            elif len({one['top'] for one in eight}) != 1:
                failures.append(
                    f"{label}: the eight colours are not one row"
                    f" ({rows['rows']} per row, panel {rows['panel']}px)"
                )
            else:
                say(f"[{label}] eight colours on one row of {rows['panel']}px")

            if rows["over"] > 0:
                failures.append(f"{label}: the row runs {rows['over']}px past its panel")

            for one in eight:
                if abs(one["wide"] - one["tall"]) > 0.6:
                    failures.append(
                        f"{label}: the {one['name']!r} dot is {one['wide']}x{one['tall']}"
                        " rather than round"
                    )
                elif one["wide"] < 20:
                    failures.append(
                        f"{label}: the {one['name']!r} dot is down to {one['wide']}px"
                    )

        page.locator('[aria-label="Colour 4"]').first.click()
        opacity = page.locator('input[aria-label="Opacity"]')
        opacity.fill("0.2")
        opacity.dispatch_event("input")
        width = page.locator('input[aria-label="Width"]').first
        width.fill("9")
        width.dispatch_event("input")
        page.wait_for_timeout(300)
        shot(page, f"pen-settings-set-{device}-{theme}")

        set_to = page.evaluate("() => window.ordenApp && localStorage.getItem('orden:pens')")
        if '"opacity":0.2' not in (set_to or ""):
            failures.append(f"{label}: the pen did not remember its alpha ({set_to})")

        page.keyboard.press("Escape")
        opacity.wait_for(state="detached", timeout=5000)

        middle = (size["width"] / 2, size["height"] / 2 - 60)
        stroke(
            page,
            cdp,
            [(middle[0] - 150 + step * 12, middle[1] + (step % 4) * 14) for step in range(26)],
        )

        drawn = ink_of(page)
        if not drawn:
            failures.append(f"{label}: the pen left nothing on the plane")
        elif drawn[0].get("opacity") != 0.2:
            failures.append(f"{label}: the stroke did not carry the alpha ({drawn[0]})")
        else:
            say(f"[{label}] the stroke landed at {drawn[0]['opacity']} of its colour")

        page.wait_for_timeout(200)
        shot(page, f"pen-stroke-faint-{device}-{theme}")

        eraser = page.locator('.cluster button[aria-label="Erase"]')
        eraser.click()
        page.wait_for_timeout(200)
        eraser.click()
        page.wait_for_selector('button[aria-label="Erase everything drawn"]', timeout=5000)
        page.wait_for_timeout(300)
        shot(page, f"eraser-settings-{device}-{theme}")

        page.keyboard.press("Escape")
        page.locator(".canvas").first.click(position={"x": 40, "y": 40})
        page.locator('[aria-label="Move the bar"]').click()
        page.wait_for_selector('button[aria-label="The pens"]', timeout=5000)
        page.wait_for_timeout(350)
        shot(page, f"pen-bar-folded-{device}-{theme}")

        page.locator('button[aria-label="The pens"]').click()
        page.wait_for_timeout(350)

        was = kept_pens(page)
        drag(page, pen_at(page, 0), pen_at(page, 2))
        now = kept_pens(page)
        if now != was:
            failures.append(f"{label}: dragging a pen rearranged the row ({was} to {now})")
        elif len(now) != 3:
            failures.append(f"{label}: the row holds {len(now)} pens rather than three: {now}")
        else:
            say(f"[{label}] the three slots stayed as they were: {now}")

        grip = page.locator('[aria-label="Move the bar"]')
        box = grip.bounding_box()
        assert box
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2, 90, steps=12)
        page.mouse.up()
        page.wait_for_timeout(400)

        docked = page.evaluate("() => JSON.parse(localStorage.getItem('orden:pens')).dock")
        if docked != "top":
            failures.append(f"{label}: the bar dragged upwards did not dock to the top ({docked})")

        pen_at(page, 0).click()
        page.wait_for_timeout(400)
        shot(page, f"pen-bar-docked-top-{device}-{theme}")

        page.reload(wait_until="domcontentloaded")
        opened(page, label, device)
        if page.evaluate("() => JSON.parse(localStorage.getItem('orden:pens')).dock") != "top":
            failures.append(f"{label}: the bar did not come back against the top edge")

        kept = page.evaluate(
            "() => JSON.parse(localStorage.getItem('orden:pens'))"
            "  .pens.find((one) => one.tool === 'pen')"
        )
        if kept.get("opacity") != 0.2 or kept.get("size") != 9 or kept.get("colour") != "4":
            failures.append(f"{label}: the pen was not the one it was left as ({kept})")
        else:
            say(f"[{label}] the pen came back set the way it was left")
    finally:
        context.close()

def main() -> int:
    with DRIVE.session() as browser:
        for device in ("tablet", "phone"):
            for theme in ("light", "dark"):
                photograph(browser, theme, device, DRIVE.failures)

    return DRIVE.verdict(f"all of it held. the pictures are under {SHOTS}")

if __name__ == "__main__":
    sys.exit(main())
