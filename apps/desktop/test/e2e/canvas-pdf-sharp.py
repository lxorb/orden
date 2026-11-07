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

def paper(count: int = 1) -> bytes:
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


SHARPNESS = """
() => {
  const card = document.querySelector('.node[data-id="p"] .pdf')
  if (!card) return null
  const shown = [...card.querySelectorAll('canvas')].filter(
    (one) => !one.classList.contains('close') || one.classList.contains('there'),
  )
  const sharpest = shown.at(-1)
  if (!sharpest || (sharpest.width === 300 && sharpest.height === 150)) return null
  const box = sharpest.getBoundingClientRect()
  return {
    close: sharpest.classList.contains('close'),
    ratio: sharpest.width / (box.width * devicePixelRatio),
    pixels: sharpest.width,
    across: Math.round(box.width * devicePixelRatio),
  }
}
"""


def looked(page, scale: float, what: str) -> None:
    page.evaluate(
        "(scale) => { const tab = window.nibApp.workspace.active;"
        " tab.camera = { x: 150, y: 120, scale } }",
        scale,
    )
    sharp = f"(() => {{ const seen = ({SHARPNESS})(); return !!seen && seen.ratio > 0.95 }})()"
    if waited(page, sharp, what, patience=10):
        say(f"ok   {what}: {page.evaluate(SHARPNESS)}")
    else:
        say(f"  it shows {page.evaluate(SHARPNESS)}")
        shot(page, f"blurry-{scale}")


def drive(browser: Browser) -> None:
    for dpr in (1, 2):
        context = browser.new_context(viewport={"width": 1100, "height": 800}, device_scale_factor=dpr)
        page = context.new_page()
        page.on("pageerror", lambda error: wrong(f"page error: {error}"))
        DRIVE.open(page)
        wait_for(page, "typeof window.nibApp.tasks === 'function'", "the app's handles")
        root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
        if not page.evaluate(SEED, {"path": f"{root}/Paper.pdf", "data": base64.b64encode(paper()).decode("ascii")}):
            wrong("the PDF never reached the space")
            return
        board = {"nodes": [{"id": "p", "type": "file", "file": "Paper.pdf", "x": 0, "y": 0, "width": 300, "height": 420}], "edges": []}
        page.evaluate(
            "async ([path, text]) => { const ws = window.nibApp.workspace;"
            " await window.nibApp.tasks().then((t) => t.writeFile(path, text));"
            " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
            [f"{root}/Board.canvas", json.dumps(board)],
        )
        wait_for(page, f"!!({SHARPNESS})()", "the PDF card drawn")
        for scale in (1, 4, 8, 20):
            looked(page, scale, f"[x{dpr}] the PDF card at {scale * 100}% as sharp as the screen")
        looked(page, 1, f"[x{dpr}] the PDF card back at 100% as sharp as the screen")
        context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a PDF card is as sharp as the screen at any zoom"))
