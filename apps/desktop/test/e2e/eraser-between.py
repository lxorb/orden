"""An eraser takes what it passes over, wherever the points of the line happen to be.

A pen line drawn at speed is a few points far apart, and the eraser only took recorded
points: a slow pass straight across the middle of one fell between two and did nothing,
no undo step and no hole. And it was tested only at its own events, so a quick swipe
skipped over a line between two of them. See `erased` and `rubbedPath` in canvas/ink.ts.

    python apps/desktop/test/e2e/eraser-between.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot


def strokes(page: Page) -> list[list[float]]:
    """The plane's ink as its file has it: each stroke, its points flat, six numbers each."""
    return page.evaluate(
        """async () => {
          await window.nibApp.workspace.writeNow()
          const words = window.nibApp.workspace.active.note.latest
          return (JSON.parse(words).nib?.ink ?? []).map((one) => one.points)
        }"""
    )


def pass_over(page: Page, kind: str, maker: str = "createCanvas") -> None:
    say(f"a {kind} pass across the middle of a line, on a {maker}, cuts a hole in it")
    page.evaluate(
        "async ([maker, name]) => { const ws = window.nibApp.workspace; await ws[maker](ws.activeSpace.root, name) }",
        [maker, f"{kind}-{maker}"],
    )
    page.wait_for_selector(".canvas, .pages")
    box = page.locator(".canvas, .pages").first.bounding_box()
    x, y = box["x"] + (300 if maker == "createCanvas" else box["width"] / 2 - 100), box["y"] + 200

    page.keyboard.press("d")
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 200, y + 60, steps=12)
    page.mouse.up()

    page.keyboard.press("e")
    middle_x, middle_y = x + 100, y + 30
    start, end = (middle_x - 60, middle_y - 90), (middle_x + 60, middle_y + 90)
    page.mouse.move(*start)
    page.mouse.down()
    # 100 small moves, or one long one with nothing between its ends.
    page.mouse.move(*end, steps=100 if kind == "slow" else 1)
    page.mouse.up()
    page.keyboard.press("v")

    left = strokes(page)
    say(f"  {[len(one) // 6 for one in left]} points in each stroke left")
    if len(left) != 2:
        wrong(f"a {kind} pass left {len(left)} strokes, not the two ends")
        return
    # In the plane's units, so measured against each other: a hole between the two.
    gap = left[1][0] - left[0][-6]
    say(f"  a hole {gap:.0f} wide")
    if gap < 10:
        wrong(f"a {kind} pass left no hole: {left[0][-6]} to {left[1][0]}")

    page.keyboard.press("Control+z")
    DRIVE.wait_for(
        page,
        """async () => {
          await window.nibApp.workspace.writeNow()
          return (JSON.parse(window.nibApp.workspace.active.note.latest).nib?.ink ?? []).length === 1
        }""",
        "the line whole again after one undo",
    )


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    pass_over(page, "slow")
    pass_over(page, "quick")
    pass_over(page, "slow", "createPages")
    pass_over(page, "quick", "createPages")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
