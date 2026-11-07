from __future__ import annotations

import base64
import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

CANVAS_CAMERA = "() => { const c = window.ordenApp.workspace.active?.camera; return c ? { x: c.x, y: c.y } : null }"
PAGES_CAMERA = "() => { const c = window.ordenApp.pages.current?.store.camera; return c ? { x: c.x, y: c.y } : null }"
MENU = "() => document.querySelectorAll('[role=menu] [role=menuitem]').length"

TOOLS = ["v", "d", "e"]


def right_drag(page: Page, x: float, y: float, dx: float, dy: float) -> None:
    page.mouse.move(x, y)
    page.mouse.down(button="right")
    for step in range(1, 11):
        page.mouse.move(x + dx * step / 10, y + dy * step / 10)
        page.wait_for_timeout(12)
    page.mouse.up(button="right")
    page.wait_for_timeout(300)


def right_click(page: Page, x: float, y: float) -> None:
    page.mouse.move(x, y)
    page.mouse.down(button="right")
    page.mouse.move(x + 1, y + 1)
    page.mouse.up(button="right")
    page.wait_for_timeout(300)


def checked(page: Page, where: str, camera: str, x: float, y: float) -> None:
    for turn, key in enumerate(TOOLS):
        way = 1 if turn % 2 else -1
        page.keyboard.press("Escape")
        page.mouse.click(x, y + 200)
        page.keyboard.press(key)
        page.wait_for_timeout(150)
        before = page.evaluate(camera)
        right_drag(page, x, y, 140 * way, 90 * way)
        after = page.evaluate(camera)
        menus = page.evaluate(MENU)
        moved = ((before["x"] - after["x"]) * way, (before["y"] - after["y"]) * way)
        say(f"[{where} {key}] a right drag of {140 * way}, {90 * way} moved the view by {moved[0]:.0f}, {moved[1]:.0f}; menu rows {menus}")
        if moved[0] < 0 or moved[1] < 0 or moved[0] + moved[1] < 40:
            wrong(f"[{where} {key}] holding the right button and moving did not pan: {before} -> {after}")
        if menus:
            wrong(f"[{where} {key}] a right drag left a menu open")
            page.keyboard.press("Escape")

        before = page.evaluate(camera)
        right_click(page, x, y)
        menus = page.evaluate(MENU)
        if not menus:
            wrong(f"[{where} {key}] a right click opened no menu")
        if page.evaluate(camera) != before:
            wrong(f"[{where} {key}] a right click moved the view")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    shot(page, where)


def paper() -> bytes:
    stream = b"BT /F1 24 Tf 60 700 Td (Right) Tj ET"
    objects = {
        1: b"<</Type/Catalog/Pages 2 0 R>>",
        2: b"<</Type/Pages/Kids[4 0 R]/Count 1>>",
        3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        4: b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 3 0 R>>>>/Contents 5 0 R>>",
        5: b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream",
    }
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    table = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n"
    for number in range(1, 6):
        out += b"%010d 00000 n \n" % places[number]
    out += b"trailer<</Root 1 0 R/Size 6>>\nstartxref\n%d\n%%%%EOF\n" % table
    return bytes(out)


SEED = """
async ({ path, data }) => {
  const open = indexedDB.open('orden')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const made = Date.now()
  await new Promise((resolve, reject) => {
    const write = db.transaction(['assets', 'stats'], 'readwrite')
    write.objectStore('assets').put({ path, type: 'application/pdf', data, modified: made })
    write.objectStore('stats').put({ path, modified: made, created: made })
    write.oncomplete = () => resolve()
    write.onerror = () => reject(write.error)
  })
  await window.ordenApp.workspace.loadTree()
}
"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    card = {"id": "c", "type": "text", "text": "a card", "x": 0, "y": 0, "width": 240, "height": 120}
    page.evaluate(
        "async ([path, text]) => { const ws = window.ordenApp.workspace;"
        " await window.ordenApp.tasks().then((t) => t.writeFile(path, text));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        [f"{root}/Board.canvas", json.dumps({"nodes": [card], "edges": []})],
    )
    wait_for(page, "!!document.querySelector('.canvas') && !!document.querySelector('.cluster')", "the canvas")
    page.wait_for_timeout(500)
    box = page.locator(".canvas").first.bounding_box()
    assert box
    checked(page, "canvas", CANVAS_CAMERA, box["x"] + box["width"] / 3, box["y"] + box["height"] / 3)

    page.evaluate(SEED, {"path": f"{root}/Right.pdf", "data": base64.b64encode(paper()).decode("ascii")})
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 1)", f"{root}/Right.pdf")
    wait_for(page, "window.ordenApp.pages.current?.store.count === 1", "the page note")
    page.evaluate("() => window.ordenApp.pages.current.store.zoomTo(2)")
    page.wait_for_timeout(500)
    box = page.locator(".pages").first.bounding_box()
    assert box
    checked(page, "page note", PAGES_CAMERA, box["x"] + box["width"] / 2, box["y"] + box["height"] / 3)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "holding the right mouse button and moving pans a canvas and a page note, with any tool"))
