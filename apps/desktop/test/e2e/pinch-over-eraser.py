from __future__ import annotations

import base64

from playwright.sync_api import Browser

from harness import Drive

NEEDS = ("chromium",)

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

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
  return window.ordenApp.workspace.files.some((one) => one.path === path)
}
"""

INK = """
() => {
  const store = window.ordenApp.pages.current.store
  const page = store.pages[0]
  const ink = []
  for (let i = 0; i < 12; i++) {
    const x = page.x + 60 + i * 30
    const points = []
    for (let k = 0; k < 30; k++) points.push({ x, y: page.y + 150 + k * 6, pressure: 0.5, tiltX: 0, tiltY: 0, t: k * 8 })
    ink.push({ id: 'v' + i, tool: 'pen', color: '#222', size: 3, points })
  }
  store.edit({ ...store.canvas, ink })
  store.camera = { x: 0, y: 360, scale: 1 }
}
"""

INKED = "() => { const ink = window.ordenApp.pages.current.store.canvas.ink; return [ink.length, ink.reduce((sum, one) => sum + one.points.length, 0)] }"

AT = """
() => {
  const store = window.ordenApp.pages.current.store
  const page = store.pages[0]
  const host = document.querySelector('.pages').getBoundingClientRect()
  const c = store.camera
  return [host.left + host.width / 2 + (page.x + 60 - c.x) * c.scale, host.top + host.height / 2 + (page.y + 240 - c.y) * c.scale]
}
"""


def paper() -> bytes:
    w, h = 595, 842
    objects: dict[int, bytes] = {3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"}
    pages = [10, 12]
    for at, number in enumerate(pages):
        stream = f"BT /F1 28 Tf 56 {h - 60} Td (Page {at + 1}) Tj ET".encode("latin-1")
        objects[number] = f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents {number + 1} 0 R>>".encode("latin-1")
        objects[number + 1] = b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream"
    objects[1] = b"<</Type/Catalog/Pages 2 0 R>>"
    objects[2] = f"<</Type/Pages/Kids[{' '.join(f'{one} 0 R' for one in pages)}]/Count {len(pages)}>>".encode("latin-1")
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    size = max(objects) + 1
    table = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        out += (b"%010d 00000 n \n" % places[number]) if number in places else b"0000000000 65535 f \n"
    out += b"trailer<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n" % (size, table)
    return bytes(out)


def touch(cdp, kind: str, points: list[tuple[float, float]]) -> None:
    cdp.send(
        "Input.dispatchTouchEvent",
        {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i, "radiusX": 6, "radiusY": 6, "force": 0.5} for i, (x, y) in enumerate(points)]},
    )


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1100, "height": 820}, has_touch=True)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Ink.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper()).decode("ascii")}):
        wrong("the PDF never reached the space")
        return
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 1)", pdf)
    wait_for(page, "window.ordenApp.pages.current?.store.count === 2", "the page note", patience=60)
    page.wait_for_timeout(800)
    page.evaluate(INK)
    page.wait_for_timeout(300)
    cdp = context.new_cdp_session(page)
    page.locator(".pages").first.focus()
    page.keyboard.press("e")
    before = page.evaluate(INKED)
    x, y = page.evaluate(AT)

    touch(cdp, "touchStart", [(x, y)])
    touch(cdp, "touchStart", [(x, y), (x + 220, y + 40)])
    for k in range(1, 10):
        touch(cdp, "touchMove", [(x - k * 4, y - k * 2), (x + 220 + k * 4, y + 40 + k * 2)])
        page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(500)

    after = page.evaluate(INKED)
    scale = page.evaluate("() => window.ordenApp.pages.current.store.camera.scale")
    if abs(scale - 1) < 0.05:
        wrong(f"the two fingers did not zoom: {scale}")
    if after != before:
        wrong(f"two fingers that zoomed rubbed out ink under the first: {before} -> {after}")
    else:
        say(f"ok   the pinch zoomed to {scale:.2f} and left the ink as it was {after}")

    page.evaluate("() => { window.ordenApp.pages.current.store.camera = { x: 0, y: 360, scale: 1 } }")
    page.wait_for_timeout(300)
    x, y = page.evaluate(AT)
    touch(cdp, "touchStart", [(x - 30, y)])
    for k in range(1, 20):
        touch(cdp, "touchMove", [(x - 30 + k * 20, y)])
        page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(500)
    rubbed = page.evaluate(INKED)
    if rubbed[1] >= before[1]:
        wrong(f"one finger with the eraser rubbed out nothing: {before} -> {rubbed}")
    else:
        say(f"ok   one finger rubs out: {before} -> {rubbed}")
    shot(page, "pinched")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "two fingers over the eraser zoom and leave the ink, one finger rubs out"))
