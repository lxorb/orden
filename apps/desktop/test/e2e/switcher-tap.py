"""The space switcher opened and closed by its own button, by finger and by mouse (#411).

Emil: "when I press on the space select on mobile then it won't close, even tho it already
is open." The list lays a catch over the window to take the press past it; a tap's way
down closed the list and took the catch with it, and the click the tap went on to make
landed on the button under the finger and opened it again. See `clicked` in overlays.ts.

What it checks, on the built web app in Chromium:

    on a phone (its drawer) and a tablet, by finger: a tap opens the list, a second tap on
      the button closes it, and a tap past it closes it too
    on a desktop, by mouse: the same, as it always was

    python apps/desktop/test/e2e/switcher-tap.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
TABLET = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

BUTTON = '[data-space-drop="switcher"]'
EXPANDED = f"document.querySelector('{BUTTON}')?.getAttribute('aria-expanded') === 'true'"
LIST = "!!document.querySelector('[data-spaces-open]')"


def is_open(page: Page) -> bool:
    return bool(page.evaluate(f"() => {EXPANDED} && {LIST}"))


def press(page: Page, x: float, y: float, touch: bool) -> None:
    """A finger's tap, or a mouse's click, where a reader would put it: at a point, not
    at an element, so whatever is over the button there is what is pressed."""
    if touch:
        page.touchscreen.tap(x, y)
    else:
        page.mouse.click(x, y)
    DRIVE.settled(page)
    page.wait_for_timeout(300)


def check(browser: Browser, label: str, touch: bool, **options: object) -> None:
    page = DRIVE.page(browser, **options)
    DRIVE.open(page)
    # Somewhere to switch to, so the list has rows.
    page.evaluate("async () => { await window.nibApp.workspace.createSpace?.('Second') }")
    page.evaluate("() => { window.nibApp.workspace.panel = 'tree' }")
    wait_for(page, f"document.querySelector('{BUTTON}')", f"[{label}] the switcher")
    DRIVE.settled(page)
    box = page.locator(BUTTON).first.bounding_box()
    assert box is not None
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    press(page, x, y, touch)
    if not is_open(page):
        wrong(f"[{label}] the first press did not open the list")
    shot(page, f"{label}-open")

    press(page, x, y, touch)
    if is_open(page):
        wrong(f"[{label}] a second press on the button did not close the list")
    else:
        say(f"ok   [{label}] the button closes what it opened")

    press(page, x, y, touch)
    if not is_open(page):
        wrong(f"[{label}] a third press did not open it again")
    # Past it: well below the list, in the panel.
    size = page.viewport_size or {"width": 800, "height": 800}
    press(page, x, size["height"] - 40, touch)
    if is_open(page):
        wrong(f"[{label}] a press past the list did not close it")
    else:
        say(f"ok   [{label}] a press past it closes it")
    page.close()


def drive(browser: Browser) -> None:
    check(
        browser,
        "phone",
        True,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE,
        has_touch=True,
        is_mobile=True,
    )
    check(
        browser,
        "tablet",
        True,
        viewport={"width": 1280, "height": 800},
        user_agent=TABLET,
        has_touch=True,
        is_mobile=True,
    )
    check(browser, "desktop", False, viewport={"width": 1280, "height": 820})


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the switcher's button opens and closes it, by finger and by mouse"))
