
from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

def strokes(page: Page) -> list[list[float]]:
    return page.evaluate(
        """async () => {
          await window.ordenApp.workspace.writeNow()
          const words = window.ordenApp.workspace.active.note.latest
          return (JSON.parse(words).orden?.ink ?? []).map((one) => one.points)
        }"""
    )

def pass_over(page: Page, kind: str, maker: str = "createCanvas") -> None:
    say(f"a {kind} pass across the middle of a line, on a {maker}, cuts a hole in it")
    page.evaluate(
        "async ([maker, name]) => { const ws = window.ordenApp.workspace; await ws[maker](ws.activeSpace.root, name) }",
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
    page.mouse.move(*end, steps=100 if kind == "slow" else 1)
    page.mouse.up()
    page.keyboard.press("v")

    left = strokes(page)
    say(f"  {[len(one) // 6 for one in left]} points in each stroke left")
    if len(left) != 2:
        wrong(f"a {kind} pass left {len(left)} strokes, not the two ends")
        return
    gap = left[1][0] - left[0][-6]
    say(f"  a hole {gap:.0f} wide")
    if gap < 10:
        wrong(f"a {kind} pass left no hole: {left[0][-6]} to {left[1][0]}")

    page.keyboard.press("Control+z")
    DRIVE.wait_for(
        page,
        """async () => {
          await window.ordenApp.workspace.writeNow()
          return (JSON.parse(window.ordenApp.workspace.active.note.latest).orden?.ink ?? []).length === 1
        }""",
        "the line whole again after one undo",
    )

def scrolled_under(page: Page) -> None:
    say("a page scrolled under a held eraser cuts nothing it did not touch")
    page.evaluate("async () => { const ws = window.ordenApp.workspace; await ws.createPages(ws.activeSpace.root, 'scrolled') }")
    page.wait_for_selector(".pages, .canvas")
    box = page.locator(".pages, .canvas").first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + 200

    page.keyboard.press("d")
    page.mouse.move(x - 100, y + 200)
    page.mouse.down()
    page.mouse.move(x + 100, y + 200, steps=8)
    page.mouse.up()

    page.keyboard.press("e")
    page.mouse.move(x, y - 60)
    page.mouse.down()
    page.mouse.wheel(0, 500)
    page.evaluate("() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))")
    page.mouse.move(x + 1, y - 60)
    page.mouse.up()
    page.keyboard.press("v")

    left = strokes(page)
    say(f"  {len(left)} strokes")
    if len(left) != 1:
        wrong(f"a held eraser cut {len(left)} pieces out of ink it never touched")

def whole_stroke(page: Page, maker: str) -> None:
    say(f"the eraser held with Shift on a {maker} takes the whole stroke it touches")
    page.evaluate(
        "async ([maker, name]) => { const ws = window.ordenApp.workspace; await ws[maker](ws.activeSpace.root, name) }",
        [maker, f"whole-{maker}"],
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
    page.keyboard.down("Shift")
    page.mouse.move(x + 100, y + 30)
    page.mouse.down()
    page.mouse.move(x + 101, y + 31)
    page.mouse.up()
    page.keyboard.up("Shift")
    page.keyboard.press("v")

    left = strokes(page)
    say(f"  {len(left)} strokes left")
    if left:
        wrong(f"the whole-stroke eraser on a {maker} left {len(left)} pieces of the stroke")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    pass_over(page, "slow")
    pass_over(page, "quick")
    pass_over(page, "slow", "createPages")
    pass_over(page, "quick", "createPages")
    scrolled_under(page)
    whole_stroke(page, "createCanvas")
    whole_stroke(page, "createPages")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
