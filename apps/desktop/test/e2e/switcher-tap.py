"""The space switcher opened and closed by its own button, by finger and by mouse (#411).

Emil: "when I press on the space select on mobile then it won't close, even tho it already
is open." The list lays a catch over the window to take the press past it; a tap's way
down closed the list and took the catch with it, and the click the tap went on to make
landed on the button under the finger and opened it again. See `clicked` in overlays.ts.

What it checks, on the built web app in Chromium:

    on a phone (its drawer) and a tablet, by finger: a tap opens the list, a second tap on
      the button closes it, and a tap past it closes it too - and does nothing else: a
      row of the file list under that tap is not opened, as a mouse's press past it
      never opened one
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


#: The middle of a row of the file list below the open list, or null.
ROW_BELOW = """() => {
  const list = document.querySelector('[data-spaces-open]')?.getBoundingClientRect()
  if (!list) return null
  for (const row of document.querySelectorAll('.row[data-path]')) {
    const box = row.getBoundingClientRect()
    if (box.top > list.bottom + 8 && box.bottom < innerHeight - 8 && box.width > 0) {
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
  }
  return null
}"""


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
    # Somewhere to switch to, so the list has two rows: the space made, and the one the
    # app opened in, which is the one in front again.
    page.evaluate(
        "async () => { const ws = window.nibApp.workspace; const first = ws.activeSpaceId;"
        " await ws.addSpace('Second'); if (ws.activeSpaceId !== first) await ws.showSpace(first) }"
    )
    DRIVE.seed(page, *[f"# Row {n}\n\nA note.\n" for n in range(1, 13)])
    page.evaluate("() => { window.nibApp.workspace.panel = 'tree' }")
    wait_for(page, f"document.querySelector('{BUTTON}')", f"[{label}] the switcher")
    DRIVE.settled(page)
    box = page.locator(BUTTON).first.bounding_box()
    assert box is not None
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    press(page, x, y, touch)
    if not is_open(page):
        wrong(f"[{label}] the first press did not open the list")
    rows = page.evaluate("() => document.querySelectorAll('[data-spaces-open] [data-space-drop]').length")
    if rows < 2:
        wrong(f"[{label}] the list has {rows} spaces in it, not two")
    shot(page, f"{label}-open")

    press(page, x, y, touch)
    if is_open(page):
        wrong(f"[{label}] a second press on the button did not close the list")
    else:
        say(f"ok   [{label}] the button closes what it opened")

    press(page, x, y, touch)
    if not is_open(page):
        wrong(f"[{label}] a third press did not open it again")
    # Past it: on a row of the file list below the list, where there is one, else well
    # below the list in the panel.
    size = page.viewport_size or {"width": 800, "height": 800}
    row = page.evaluate(ROW_BELOW)
    at = (row["x"], row["y"]) if row else (x, size["height"] - 40)
    before = page.evaluate("() => window.nibApp.workspace.active?.path ?? null")
    press(page, at[0], at[1], touch)
    if is_open(page):
        wrong(f"[{label}] a press past the list did not close it")
    else:
        say(f"ok   [{label}] a press past it closes it")
    after = page.evaluate("() => window.nibApp.workspace.active?.path ?? null")
    if row and after != before:
        wrong(f"[{label}] the press past the list opened the row under it: {after}")
    elif row:
        say(f"ok   [{label}] and the row of the file list under it was not opened")
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
