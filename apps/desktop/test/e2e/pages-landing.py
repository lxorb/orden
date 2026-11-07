from __future__ import annotations

import base64

from playwright.sync_api import Browser

from harness import Drive

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

def paper(count: int) -> bytes:
    w, h = 595, 842
    objects: dict[int, bytes] = {3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"}
    kids = []
    for at in range(count):
        number = 4 + at * 2
        stream = f"BT /F1 28 Tf 56 {h - 60} Td (Page {at + 1}) Tj ET".encode("latin-1")
        objects[number] = f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents {number + 1} 0 R>>".encode("latin-1")
        objects[number + 1] = b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream"
        kids.append(f"{number} 0 R")
    objects[1] = b"<</Type/Catalog/Pages 2 0 R>>"
    objects[2] = f"<</Type/Pages/Kids[{' '.join(kids)}]/Count {count}>>".encode("latin-1")
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    size = max(objects) + 1
    table = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        out += b"%010d 00000 n \n" % places[number]
    out += b"trailer<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n" % (size, table)
    return bytes(out)


SHOWING = "() => window.ordenApp.pages.current?.store.showing ?? null"


def landed(page, want: int, what: str) -> None:
    if not DRIVE.wait_for(page, f"({SHOWING})() === {want}", what, patience=15):
        say(f"  it shows page {page.evaluate(SHOWING)}")


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1100, "height": 800})
    page = context.new_page()
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Forty.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper(40)).decode("ascii")}):
        wrong("the PDF never reached the space")
        return

    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 25)", pdf)
    wait_for(page, "window.ordenApp.pages.current?.store.count === 40", "the page note")
    landed(page, 25, "a PDF opened at page 25 to show page 25")

    page.evaluate("() => window.ordenApp.workspace.openPdf(window.ordenApp.workspace.active.path, 7)")
    landed(page, 7, "the open page note asked for page 7 to show it")

    readme = page.evaluate("() => window.ordenApp.workspace.files.find((one) => one.path.endsWith('.md'))?.path")
    page.evaluate("(path) => window.ordenApp.workspace.openEntry(path, { activate: true })", readme)
    page.wait_for_timeout(800)
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 33)", f"{root}/Forty.pages")
    landed(page, 33, "the PDF asked for page 33 from another tab to show it")
    say(f"the page note shows page {page.evaluate(SHOWING)}")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a PDF opened at a page shows that page"))
