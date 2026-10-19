"""Where a page note and a canvas were left, kept (#421).

Emil: "zoom + scroll not saved for page notes". A page note zoomed in and scrolled down
the paper - and a canvas panned and zoomed - comes back where it was left: after another
tab and back, after its tab is closed and it is opened again, and after the app is
started again (a reload of the page, which is a quit as far as the page knows).

    python apps/desktop/test/e2e/page-view.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

#: The camera of the surface in front: a page note's, or a canvas's.
CAMERA = """() => {
  const tab = window.nibApp.workspace.active
  return tab?.camera ? { ...tab.camera } : null
}"""


def camera(page: Page) -> dict | None:
    return page.evaluate(CAMERA)


def near(one: dict | None, other: dict | None) -> bool:
    if not one or not other:
        return False
    return all(abs(one[k] - other[k]) <= max(2, abs(other[k]) * 0.02) for k in ("x", "y", "scale"))


def open_path(page: Page, path: str) -> None:
    page.evaluate("async (path) => { await window.nibApp.workspace.openEntry(path, { activate: true }) }", path)
    page.wait_for_timeout(900)


def moved(page: Page, surface: str) -> dict:
    """Zoomed in with Ctrl and the wheel, and scrolled down, over the middle of it."""
    box = page.locator(surface).first.bounding_box()
    assert box
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.keyboard.down("Control")
    for _ in range(4):
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(80)
    page.keyboard.up("Control")
    for _ in range(5):
        page.mouse.wheel(0, 240)
        page.wait_for_timeout(80)
    page.wait_for_timeout(600)
    left = camera(page)
    assert left
    return left


def check(page: Page, label: str, path: str, surface: str, other: str) -> None:
    left = moved(page, surface)
    say(f"[{label}] left at {left}")

    open_path(page, other)
    open_path(page, path)
    if near(camera(page), left):
        say(f"ok   [{label}] another tab and back: where it was")
    else:
        wrong(f"[{label}] another tab and back: {camera(page)}, left at {left}")

    tab = page.evaluate("() => window.nibApp.workspace.active.id")
    page.evaluate("async (id) => { await window.nibApp.workspace.close(id, false) }", tab)
    page.wait_for_timeout(400)
    open_path(page, path)
    if near(camera(page), left):
        say(f"ok   [{label}] closed and opened again: where it was")
    else:
        wrong(f"[{label}] closed and opened again: {camera(page)}, left at {left}")

    page.reload()
    DRIVE.open(page)
    open_path(page, path)
    page.wait_for_timeout(600)
    if near(camera(page), left):
        say(f"ok   [{label}] the app started again: where it was")
    else:
        wrong(f"[{label}] the app started again: {camera(page)}, left at {left}")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Other\n\nAnother note.\n")
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    other = f"{root}/Other.md"

    for _ in range(4):
        page.evaluate("() => window.nibApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate("() => !!window.nibApp.workspace.active?.path?.endsWith('.pages')"):
            break
    wait_for(page, "!!document.querySelector('.pages')", "the page note")
    page.wait_for_timeout(600)
    pages = page.evaluate("() => window.nibApp.workspace.active.path")
    check(page, "page note", pages, ".pages", other)

    # Scrolled and not zoomed: the paper stays fitted across the pane, and the place
    # down it is kept.
    page.evaluate("() => window.nibApp.pages.current?.store.fitAgain()")
    page.wait_for_timeout(300)
    box = page.locator(".pages").first.bounding_box()
    assert box
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    for _ in range(4):
        page.mouse.wheel(0, 200)
        page.wait_for_timeout(80)
    page.wait_for_timeout(500)
    left = camera(page)
    open_path(page, other)
    open_path(page, pages)
    back = camera(page)
    page.reload()
    DRIVE.open(page)
    open_path(page, pages)
    page.wait_for_timeout(600)
    again = camera(page)
    if near(back, left) and near(again, left):
        say(f"ok   [page note] scrolled, not zoomed: kept, back and after a restart ({left})")
    else:
        wrong(f"[page note] scrolled, not zoomed: left at {left}, back {back}, restarted {again}")

    page.evaluate("async () => { const ws = window.nibApp.workspace; await ws.createCanvas(ws.activeSpace.root, 'Board.canvas') }")
    wait_for(page, "!!document.querySelector('.canvas')", "the canvas")
    page.wait_for_timeout(600)
    board = page.evaluate("() => window.nibApp.workspace.active.path")
    check(page, "canvas", board, ".canvas", other)
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a page note and a canvas come back where they were left"))
