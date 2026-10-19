"""The canvas's pen panel, and its colours, closed by a press beside them (#382).

Emil: "clicking on a position horizontally next to pen settings will not close it, even
though the click was outside the visible frame. only vertically will close it." The pens
and their panel sit in a strip the width of the pane, and a press beside the panel landed
in the strip: held by the popup, and taken from the plane under it. See `holds` in
overlays.ts and `.cluster` in CanvasBar.svelte.

What it checks, on the built web app, with the bar along the bottom and along a side:

    the pen's panel and the colours, opened, and pressed beside - level with the panel,
      past its end along the strip the bar lies in - close
    a stroke drawn beside the bar, level with it, is drawn: the strip takes nothing
    pressed on the panel itself, it stays

    python apps/desktop/test/e2e/pen-panel.py
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PANEL = ".cluster .panel"
BOARD = {"nodes": [], "edges": []}


def box(page: Page, selector: str) -> dict:
    found = page.locator(selector).first.bounding_box()
    if found is None:
        raise SystemExit(f"nothing on screen for {selector}")
    return found


def shown(page: Page) -> bool:
    return bool(page.evaluate(f"() => !!document.querySelector('{PANEL}') && window.nibApp.overlays.depth > 0"))


def ink(page: Page, x: float, y: float) -> bytes:
    """The plane where a stroke beside the bar goes, as a picture."""
    return page.screenshot(clip={"x": x - 4, "y": y - 12, "width": 64, "height": 28})


def beside(page: Page, of: dict, along: str = "x") -> tuple[float, float]:
    """Level with `of` and past its end along the strip the bar lies in, inside the
    plane: past its side for a bar along the bottom, past its foot for one on its end."""
    plane = box(page, ".canvas")
    if along == "y":
        x = of["x"] + of["width"] / 2
        below = of["y"] + of["height"] + 90
        return x, below if below < plane["y"] + plane["height"] - 30 else of["y"] - 90
    y = of["y"] + of["height"] / 2
    right = of["x"] + of["width"] + 90
    x = right if right < plane["x"] + plane["width"] - 30 else of["x"] - 90
    return x, y


def pen_panel(page: Page) -> None:
    pen = page.locator(".cluster button.pen").first
    pen.click()
    page.wait_for_timeout(200)
    if not shown(page):
        pen.click()
    page.wait_for_timeout(300)


def colours(page: Page) -> None:
    page.locator(".cluster button.swatch").first.click()
    page.wait_for_timeout(300)


def check(page: Page, label: str, along: str = "x") -> None:
    for name, opening in (("the pen's panel", pen_panel), ("the colours", colours)):
        opening(page)
        if not shown(page):
            wrong(f"[{label}] {name} did not open")
            continue
        panel = box(page, PANEL)
        page.mouse.click(panel["x"] + 12, panel["y"] + 12)
        page.wait_for_timeout(200)
        if not shown(page):
            wrong(f"[{label}] a press on {name} itself closed it")
            opening(page)
        x, y = beside(page, box(page, PANEL), along)
        shot(page, f"{label}-{name.split()[-1].strip('.')}-open")
        page.mouse.click(x, y)
        page.wait_for_timeout(300)
        if shown(page):
            wrong(f"[{label}] a press beside {name}, level with it, left it open")
            page.keyboard.press("Escape")
        else:
            say(f"ok   [{label}] a press beside {name} closes it")

    # A stroke beside the bar, level with it: the plane's, not the strip's.
    # Another pen than the one in hand: taken up, with no panel.
    page.locator(".cluster button.pen").nth(1).click()
    page.wait_for_timeout(200)
    x, y = beside(page, box(page, ".cluster .bar"), along)
    before = ink(page, x, y)
    page.mouse.move(x, y)
    page.mouse.down()
    for step in range(1, 9):
        page.mouse.move(x + step * 6, y + (step % 3) * 4)
    page.mouse.up()
    page.wait_for_timeout(400)
    if ink(page, x, y) == before:
        wrong(f"[{label}] a stroke beside the bar was not drawn")
    else:
        say(f"ok   [{label}] a stroke beside the bar is drawn")
    page.locator('.cluster button[aria-label="Undo"]').first.click()
    page.wait_for_timeout(300)


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    wait_for(page, "typeof window.nibApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    page.evaluate(
        "async ([path, text]) => { const ws = window.nibApp.workspace;"
        " await window.nibApp.tasks().then((t) => t.writeFile(path, text));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        [f"{root}/Board.canvas", json.dumps(BOARD)],
    )
    wait_for(page, "!!document.querySelector('.cluster button.pen')", "the canvas bar")
    DRIVE.settled(page)
    page.wait_for_timeout(500)
    check(page, "bottom")

    # Along a side, standing on its end, where a tablet's wrist puts it: what the bar
    # keeps of itself says so, and the app is opened again on the board.
    page.evaluate(
        "() => { const held = JSON.parse(localStorage.getItem('nib:pens') ?? '{}');"
        " localStorage.setItem('nib:pens', JSON.stringify({ ...held, dock: 'left' })) }"
    )
    page.reload()
    DRIVE.open(page)
    wait_for(page, "typeof window.nibApp.tasks === 'function'", "the app's handles again")
    page.evaluate(
        "async (path) => { const ws = window.nibApp.workspace; await ws.loadTree();"
        " await ws.openEntry(path, { activate: true }) }",
        f"{root}/Board.canvas",
    )
    wait_for(page, "!!document.querySelector('.cluster.left button.pen')", "the bar along the left")
    DRIVE.settled(page)
    page.wait_for_timeout(500)
    check(page, "left", "y")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a press beside the pens' panels closes them, and a stroke beside the bar is drawn"))
