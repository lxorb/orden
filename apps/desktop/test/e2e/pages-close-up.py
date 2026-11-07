from __future__ import annotations

import base64

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async ({ path, data }) => {
  const open = indexedDB.open('nib')
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
  await window.nibApp.workspace.loadTree()
  return window.nibApp.workspace.files.some((one) => one.path === path)
}
"""

SHOWN = """
() => {
  const sheet = document.querySelector('.pages .sheet')
  const close = sheet?.querySelector('canvas.close.there')
  const box = close?.getBoundingClientRect()
  return close && box
    ? { pixels: close.width, shown: box.width * devicePixelRatio, wide: box.width, tall: box.height }
    : null
}
"""

ZOOM = "(scale) => { const store = window.nibApp.pages.current.store; store.camera = { ...store.camera, scale } }"

PAN = "(by) => { const store = window.nibApp.pages.current.store; store.camera = { ...store.camera, x: store.camera.x + by, y: store.camera.y + by } }"


def paper() -> bytes:
    w, h = 595, 842
    lines = [f"BT /F1 9 Tf 40 {h - 60 - row * 12} Td (Line {row + 1}: the kestrel hangs above the field.) Tj ET" for row in range(60)]
    stream = "\n".join(lines).encode("latin-1")
    objects = {
        1: b"<</Type/Catalog/Pages 2 0 R>>",
        2: b"<</Type/Pages/Kids[4 0 R]/Count 1>>",
        3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        4: f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents 5 0 R>>".encode("latin-1"),
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


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 412, "height": 860}, device_scale_factor=3)
    page = context.new_page()
    DRIVE.open(page)
    wait_for(page, "typeof window.nibApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Close.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper()).decode("ascii")}):
        wrong("the PDF never reached the space")
        return
    page.evaluate("(path) => window.nibApp.workspace.openPdf(path, 1)", pdf)
    wait_for(page, "window.nibApp.pages.current?.store.count === 1", "the page note")
    page.wait_for_timeout(1500)

    page.evaluate(ZOOM, 4)
    wait_for(page, f"({SHOWN.strip()})() !== null", "a close-up of the page at 400%", patience=15)
    page.wait_for_timeout(500)
    seen = page.evaluate(SHOWN)
    stretch = seen["shown"] / seen["pixels"]
    say(f"at 400% on a screen of 3 device pixels a point, the close-up is {seen['pixels']} pixels wide, shown at {seen['shown']:.0f}: {stretch:.2f}x")
    if stretch > 1.15:
        wrong(f"the close-up is stretched {stretch:.2f}x")
    if seen["wide"] > 412 * 1.5 or seen["tall"] > 860 * 1.5:
        wrong(f"the close-up covers {seen['wide']:.0f}x{seen['tall']:.0f}, far more than the screen")
    shot(page, "close-up")

    page.evaluate(PAN, 60)
    page.wait_for_timeout(1500)
    moved = page.evaluate(SHOWN)
    if moved is None:
        wrong("after a pan, the close-up is gone")

    page.evaluate("() => window.nibApp.pages.current.store.fitAgain()")
    page.wait_for_timeout(1500)
    if page.evaluate(SHOWN) is not None:
        wrong("fitted again, the page still holds a close-up it does not need")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a page note zoomed in on a dense screen is drawn sharp where it is seen"))
