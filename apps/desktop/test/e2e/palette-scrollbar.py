"""The palette shows a scrollbar only where there is something to scroll to (#775).

A reader on a NixOS laptop: *"There is scrollbar even though there is nothing to scroll
through"*, over the palette as Ctrl+O opens it. Its list is capped at 46vh, and a window
whose cap fell a few pixels short of the list - its own padding, a pixel of a row - wore
the platform's bar the whole length of the list, over nothing left to scroll.

The window is sized here so that the list runs past its cap by its padding and a pixel,
then by more than a row: the first has no bar on a hover, the second has one, and the
platform's is never there at all.

Run it from the repository root:

    python apps/desktop/test/e2e/palette-scrollbar.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

STATE = """() => {
  const list = document.querySelector('.palette ul')
  const bar = document.querySelector('.palette .nib-scrollbar')
  return list && {
    over: list.scrollHeight - list.clientHeight,
    own: list.classList.contains('nib-scrolls'),
    needed: !!bar?.classList.contains('is-needed'),
    lit: !!bar?.classList.contains('is-lit'),
  }
}"""


def opened(page: Page, keys: str, height: int) -> dict:
    page.set_viewport_size({"width": 1600, "height": height})
    page.wait_for_timeout(200)
    page.keyboard.press(keys)
    wait_for(page, "() => !!document.querySelector('.palette ul li')", "the palette's list")
    box = page.locator(".palette ul").bounding_box()
    if box:
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(300)
    return page.evaluate(STATE)


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1600, "height": 1100}, color_scheme="dark")
    DRIVE.open(page)
    page.wait_for_timeout(1000)

    # How tall the list is when it fits, which says where its cap has to fall.
    full = opened(page, "Control+o", 1300)
    tall = page.evaluate("() => document.querySelector('.palette ul').scrollHeight")
    page.keyboard.press("Escape")
    say(f"the list as Ctrl+O opens it: {tall}px, {full}")

    for height in range(1120, 1150):
        state = opened(page, "Control+o", height)
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        if not state["own"]:
            wrong(f"{height}px: the list wears the platform's bar")
        if 0 < state["over"] <= 5 and state["needed"]:
            wrong(f"{height}px: a bar over {state['over']}px of padding, nothing to scroll to")
            DRIVE.shot(page, f"sliver-{height}")
        if state["over"] > 28 and not state["needed"]:
            wrong(f"{height}px: no bar over {state['over']}px to scroll")
        say(f"{height}px: {state}")

    # Every command at once, which runs well past the cap.
    commands = opened(page, "Control+Shift+P", 900)
    say(f"every command: {commands}")
    if not (commands["needed"] and commands["lit"]):
        wrong(f"no bar over the list of every command: {commands}")
    DRIVE.shot(page, "commands")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the palette's bar is there only over something to scroll to"))
