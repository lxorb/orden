"""A canvas back at 100%, and a pen fine enough when zoomed in (#369).

Emil: "canvas is missing a button to reset magnification to 100%" and "at higher
magnifications the pencils are not small enough in their thickness". The bar keeps no zoom
buttons (#401); at the end of it, a small reading of the zoom stands while the plane is at
anything but 100%, and pressed puts it back. Zoomed in, a pen writes as wide as it shows on
the screen.

    python apps/desktop/test/e2e/canvas-zoom.py
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

ACTUAL = '.cluster button.actual'
SCALE = "() => window.nibApp.workspace.active?.camera?.scale ?? null"


def reading(page: Page) -> str | None:
    found = page.locator(ACTUAL)
    return found.first.inner_text().strip() if found.count() else None


def wheel_in(page: Page, times: int) -> None:
    box = page.locator(".canvas").first.bounding_box()
    assert box
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.keyboard.down("Control")
    for _ in range(times):
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(60)
    page.keyboard.up("Control")
    page.wait_for_timeout(400)


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    wait_for(page, "typeof window.nibApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    path = f"{root}/Board.canvas"
    page.evaluate(
        "async ([path, text]) => { const ws = window.nibApp.workspace;"
        " await window.nibApp.tasks().then((t) => t.writeFile(path, text));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        [path, json.dumps({"nodes": [], "edges": []})],
    )
    wait_for(page, "!!document.querySelector('.canvas') && !!document.querySelector('.cluster')", "the canvas")
    page.wait_for_timeout(600)

    # At the actual size, nothing of the zoom on the bar.
    if abs((page.evaluate(SCALE) or 1) - 1) < 0.005 and reading(page) is not None:
        wrong(f"[100%] the bar reads the zoom at the actual size: {reading(page)}")

    wheel_in(page, 6)
    scale = page.evaluate(SCALE)
    said = reading(page)
    if not said or said != f"{round(scale * 100)}%":
        wrong(f"[zoomed] the bar does not read the zoom: {said!r} at {scale}")
    else:
        say(f"ok   [zoomed] the bar reads {said}")
    shot(page, "zoomed")
    page.locator(ACTUAL).first.click()
    page.wait_for_timeout(400)
    if abs(page.evaluate(SCALE) - 1) > 0.001 or reading(page) is not None:
        wrong(f"[back] pressing it did not put the plane at 100%: {page.evaluate(SCALE)}, {reading(page)!r}")
    else:
        say("ok   [back] pressed, the plane is at 100% and the reading is gone")

    # Zoomed in four times over, a pen writes as fine as it shows.
    page.evaluate(
        "() => { const tab = window.nibApp.workspace.active; tab.camera = { ...tab.camera, scale: 4 } }"
    )
    page.wait_for_timeout(300)
    page.locator(".cluster button.pen").first.click()
    page.wait_for_timeout(200)
    box = page.locator(".canvas").first.bounding_box()
    assert box
    x, y = box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.4
    page.mouse.move(x, y)
    page.mouse.down()
    for step in range(1, 12):
        page.mouse.move(x + step * 8, y + (step % 3) * 3)
    page.mouse.up()
    page.wait_for_timeout(2500)
    written = page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc)")
    ink = written.get("nib", {}).get("ink", [])
    if not ink:
        wrong(f"[pen] no stroke was written: {json.dumps(written)[:200]}")
    else:
        # The first pen as it comes, three units wide: three pixels at 100%.
        pen = 3
        drawn = ink[-1].get("size")
        say(f"[pen] a pen of {pen} wrote a stroke {drawn} wide at 400%")
        if not drawn or abs(drawn - round(pen / 4, 2)) > 0.011:
            wrong(f"[pen] at 400% the stroke is {drawn} wide, not the pen's {pen} on the screen")
        else:
            say("ok   [pen] zoomed in, the stroke is as wide as it shows")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the plane goes back to 100% from the bar, and a pen is fine when zoomed in"))
