from __future__ import annotations

import base64
import json

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for, waited = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for, DRIVE.waited

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


HEADINGS = [("Intro", 1, 0), ("Methods", 2, 0), ("Data", 3, 1)]


def paper() -> bytes:
    w, h = 595, 842
    count = 3
    objects: dict[int, bytes] = {3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"}
    pages = [10 + at * 2 for at in range(count)]
    for at, number in enumerate(pages):
        stream = f"BT /F1 28 Tf 56 {h - 60} Td (Page {at + 1}) Tj ET".encode("latin-1")
        objects[number] = f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents {number + 1} 0 R>>".encode("latin-1")
        objects[number + 1] = b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream"
    objects[4] = b"<</Type/Outlines/First 5 0 R/Last 6 0 R/Count 3>>"
    objects[5] = f"<</Title(Intro)/Parent 4 0 R/Next 6 0 R/Dest[{pages[0]} 0 R/Fit]>>".encode("latin-1")
    objects[6] = f"<</Title(Methods)/Parent 4 0 R/Prev 5 0 R/First 7 0 R/Last 7 0 R/Count 1/Dest[{pages[1]} 0 R/Fit]>>".encode("latin-1")
    objects[7] = f"<</Title(Data)/Parent 6 0 R/Dest[{pages[2]} 0 R/Fit]>>".encode("latin-1")
    objects[1] = b"<</Type/Catalog/Pages 2 0 R/Outlines 4 0 R>>"
    objects[2] = f"<</Type/Pages/Kids[{' '.join(f'{one} 0 R' for one in pages)}]/Count {count}>>".encode("latin-1")
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


MARKS = {
    "version": 1,
    "highlights": [
        {"id": "m1", "page": 1, "text": "Page 1", "quads": [[50, 815, 250, 815, 250, 775, 50, 775]], "colour": 0, "created": 1},
        {"id": "m2", "page": 3, "text": "Page 3", "quads": [[50, 815, 250, 815, 250, 775, 50, 775]], "colour": 1, "created": 2},
    ],
}

SHOWING = "() => window.nibApp.pages.current?.store.showing ?? null"

ROWS = "() => [...(document.querySelector('.navigator')?.querySelectorAll('.contents .row .orden-row-label') ?? [])].map((one) => one.textContent.trim())"

MARKED = """
() => {
  const sheet = document.querySelector('.sheet')
  const mark = sheet?.querySelector('.mark')
  if (!sheet || !mark) return null
  const page = sheet.getBoundingClientRect()
  const box = mark.getBoundingClientRect()
  return {
    left: (box.left - page.left) / page.width,
    top: (box.top - page.top) / page.height,
    width: box.width / page.width,
    height: box.height / page.height,
  }
}
"""


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1200, "height": 820})
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.nibApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Paper.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper()).decode("ascii")}):
        wrong("the PDF never reached the space")
        return
    page.evaluate(
        "async ([path, text]) => { await window.nibApp.tasks().then((t) => t.writeFile(path, text)) }",
        [f"{pdf}.highlights.json", json.dumps(MARKS)],
    )

    page.evaluate("(path) => window.nibApp.workspace.openPdf(path, 1)", pdf)
    wait_for(page, "window.nibApp.pages.current?.store.count === 3", "the page note")
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")

    want = [title for title, _, _ in HEADINGS]
    if waited(page, f"JSON.stringify(({ROWS})()) === {json.dumps(json.dumps(want, separators=(',', ':')))}", "the PDF's contents beside its pages", patience=15):
        say(f"ok   the outline lists {page.evaluate(ROWS)}")
    else:
        say(f"  it lists {page.evaluate(ROWS)}, the store holds {page.evaluate('() => window.nibApp.pages.current?.store.outline.length')} rows, panel {page.evaluate('() => window.nibApp.workspace.panel')}")
        shot(page, "no-contents")

    page.locator(".navigator .contents .row", has_text="Data").first.click()
    if waited(page, f"({SHOWING})() === 3", "pressing Data to turn to page 3", patience=10):
        say("ok   Data turns to page 3")
    else:
        say(f"  it shows page {page.evaluate(SHOWING)}")

    page.evaluate("() => window.nibApp.pages.current.store.turnTo(1)")
    if waited(page, f"!!({MARKED})()", "the PDF's highlight on page 1", patience=15):
        box = page.evaluate(MARKED)
        say(f"ok   the highlight shows at {box}")
        if not (0.05 < box["left"] < 0.12 and 0.0 < box["top"] < 0.06 and 0.3 < box["width"] < 0.36):
            wrong(f"the highlight is not where the PDF says: {box}")
    else:
        shot(page, "no-mark")

    page.evaluate("() => { window.nibApp.pages.current.store.readOnly = true }")
    page.wait_for_timeout(300)
    nav = page.locator(".navigator").first
    nav.locator(".page").first.click(button="right")
    page.wait_for_timeout(300)
    offered = page.evaluate("() => ({ add: !!document.querySelector('.navigator .add'), menu: [...document.querySelectorAll('[role=menu] [role=menuitem]')].map((one) => one.textContent.trim()) })")
    if offered["add"] or offered["menu"]:
        wrong(f"[read-only] the page thumbnails still offer edits that do nothing: {offered}")
    else:
        say("ok   [read-only] the page thumbnails offer no edits")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a PDF's contents and highlights show beside and on its pages"))
