from __future__ import annotations

import base64

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

def paper_bytes(sizes: list[tuple[float, float]]) -> str:
    objects: list[str] = []
    kids = " ".join(f"{3 + at * 2} 0 R" for at in range(len(sizes)))
    objects.append("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj")
    objects.append(f"2 0 obj<</Type/Pages/Kids[{kids}]/Count {len(sizes)}>>endobj")

    for at, (wide, tall) in enumerate(sizes):
        page = 3 + at * 2
        stream = f"0 0 0 rg 40 40 {wide - 80:.0f} {tall - 80:.0f} re f"
        objects.append(
            f"{page} 0 obj<</Type/Page/Parent 2 0 R"
            f"/MediaBox[0 0 {wide:.2f} {tall:.2f}]/Contents {page + 1} 0 R>>endobj"
        )
        objects.append(f"{page + 1} 0 obj<</Length {len(stream)}>>stream\n{stream}\nendstream\nendobj")

    body = "\n".join(
        ["%PDF-1.4", *objects, f"trailer<</Root 1 0 R/Size {2 + len(sizes) * 2 + 1}>>", "%%EOF"]
    )
    return base64.b64encode(body.encode("latin-1")).decode("ascii")

PAPER = paper_bytes([(595.28, 841.89), (612.0, 792.0)])

IMPORT = """
async ({ base64, name }) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  // The store alone, without the sheet: a sheet that mounts mid-read can be closed by
  // the focus moving, and a sheet closed while reading starts over.
  const importing = window.ordenApp.importing
  importing.root = window.ordenApp.workspace.activeSpace.root
  await importing.take([new File([bytes], name, { type: 'application/pdf' })])
  if (importing.format !== 'pdf-pages') return { format: importing.format, error: importing.error }

  await importing.run()
  await window.ordenApp.workspace.loadTree()
  return { format: importing.format, error: importing.error, folder: importing.folder }
}
"""

SEED_PDF = """
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

LISTED = """
(under) => window.ordenApp.workspace.files
  .map((one) => one.path)
  .filter((path) => !under || path.includes('/' + under + '/'))
  .map((path) => path.split('/').pop())
"""

DARK_ON_SHEET = """
(number) => {
  const sheet = [...document.querySelectorAll('.sheet')].find(
    (one) => one.querySelector('.number')?.textContent === String(number),
  )?.querySelector('canvas')
  const context = sheet?.getContext('2d', { willReadFrequently: true })
  if (!sheet || !context || !sheet.width || !sheet.height) return -1
  const data = context.getImageData(0, 0, sheet.width, sheet.height).data
  let dark = 0
  for (let at = 0; at < data.length; at += 160) {
    if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
  }
  return dark
}
"""

def drawn(page: Page, label: str, pages: int) -> None:
    page.wait_for_selector(".pages", timeout=15000)
    DRIVE.waited(page, f"window.ordenApp.pages.current?.store.count === {pages}", f"[{label}] the page note")
    dark: list[int] = []
    for number in range(1, pages + 1):
        page.evaluate("(number) => window.ordenApp.pages.current?.store.turnTo(number)", number)
        DRIVE.waited(
            page,
            f"({DARK_ON_SHEET.strip()})({number}) >= 100",
            f"[{label}] page {number} of the paper to be drawn",
        )
        dark.append(page.evaluate(DARK_ON_SHEET, number))
    page.evaluate("() => window.ordenApp.pages.current?.store.turnTo(1)")
    say(f"[{label}] dark pixels per sheet: {dark}")
    for at, count in enumerate(dark):
        if count < 0:
            wrong(f"[{label}] page {at + 1} is not on the page")
        elif count < 100:
            wrong(f"[{label}] page {at + 1} drew nothing of the paper")

def only_the_note(page: Page, label: str, under: str, note: str) -> None:
    names = page.evaluate(LISTED, under)
    say(f"[{label}] the list: {names}")
    if note not in names:
        wrong(f"[{label}] {note} is not in the list")
    papers = [name for name in names if name.lower().endswith(".pdf")]
    if papers:
        wrong(f"[{label}] the list still shows a PDF beside the note: {papers}")

def imported(page: Page) -> None:
    say("--- a PDF through the Import door ---")
    wait_for(page, "!!window.ordenApp.importing", "the import sheet's store")
    made = page.evaluate(IMPORT, {"base64": PAPER, "name": "Lecture 4.pdf"})
    if made.get("format") != "pdf-pages" or made.get("error"):
        wrong(f"the import read the paper as {made.get('format')!r}: {made.get('error')!r}")
        return

    folder = made.get("folder") or ""
    only_the_note(page, "import", folder, "Lecture 4.pages")

    path = page.evaluate(
        "() => window.ordenApp.workspace.files.find((one) => one.name === 'Lecture 4.pages')?.path ?? null"
    )
    if not path:
        return
    page.evaluate("async (path) => window.ordenApp.workspace.openEntry(path)", path)
    drawn(page, "import", 2)

    files = page.evaluate(
        "() => window.ordenApp.pages.current.store.pages.map((one) => one.file ?? null)"
    )
    if files != ["Lecture 4.pages.pdf", "Lecture 4.pages.pdf"]:
        wrong(f"[import] the pages name {files}")
    shot(page, "01-imported")

def opened_in_place(page: Page) -> str | None:
    say("--- a PDF already in the space, opened ---")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
    pdf = f"{root}/Reading/Optics.pdf"
    if not page.evaluate(SEED_PDF, {"path": pdf, "data": PAPER}):
        wrong("the seeded PDF is not in the list")
        return None
    shot(page, "02-a-pdf-in-the-space")

    page.evaluate("async (path) => window.ordenApp.workspace.openEntry(path)", pdf)
    wait_for(
        page,
        "window.ordenApp.workspace.active?.path?.endsWith('/Reading/Optics.pages')",
        "the PDF to open as its page note",
    )
    only_the_note(page, "in place", "Reading", "Optics.pages")
    drawn(page, "in place", 2)
    shot(page, "03-replaced-by-its-page-note")
    return page.evaluate("() => window.ordenApp.workspace.active.path")

def stroke(page: Page, cdp) -> None:
    page.keyboard.press("Escape")
    box = page.locator(".pages").first.bounding_box()
    assert box
    page.mouse.click(box["x"] + 30, box["y"] + 30)
    page.keyboard.press("d")
    page.wait_for_timeout(150)

    middle = box["x"] + box["width"] / 2
    points = [(middle - 120 + n * 12, box["y"] + 40 + (n % 4) * 9) for n in range(22)]

    def send(what: str, x: float, y: float, force: float) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": what,
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
                "pointerType": "pen",
                "force": force,
            },
        )

    send("mousePressed", *points[0], 0.4)
    for x, y in points[1:]:
        send("mouseMoved", x, y, 0.7)
        page.wait_for_timeout(8)
    send("mouseReleased", *points[-1], 0)
    page.wait_for_timeout(300)

def ink_kept(page: Page, cdp, path: str) -> None:
    say("--- ink on it, kept ---")
    ink = "window.ordenApp.pages.current?.store.canvas.ink.length ?? -1"
    before = page.evaluate(f"() => {ink}")
    stroke(page, cdp)
    if page.evaluate(f"() => {ink}") != before + 1:
        wrong("a pen stroke on the page note left no ink")
        return

    page.evaluate("() => window.ordenApp.pages.current?.store.part()")
    page.wait_for_timeout(600)
    page.evaluate(
        """async (path) => {
          const ws = window.ordenApp.workspace
          for (const tab of ws.tabs.filter((one) => one.path === path)) ws.close(tab.id)
          await ws.openEntry(path)
        }""",
        path,
    )
    wait_for(page, f"{ink} === {before + 1}", "the stroke to be there when the note opens again")
    drawn(page, "opened again", 2)
    shot(page, "04-the-ink-kept")

def exported(page: Page) -> None:
    say("--- Export as PDF ---")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+o")
    page.wait_for_timeout(400)
    page.keyboard.type("> Export as PDF")
    page.wait_for_timeout(700)

    with page.expect_download(timeout=40000) as caught:
        page.keyboard.press("Enter")

    where = DRIVE.shots / "exported.pdf"
    caught.value.save_as(str(where))
    body = where.read_bytes()
    say(f"the export is {len(body)} bytes")
    if not body.startswith(b"%PDF"):
        wrong("Export as PDF handed back something that is not a PDF")
        return

    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
    back = f"{root}/Exported.pdf"
    page.evaluate(SEED_PDF, {"path": back, "data": base64.b64encode(body).decode("ascii")})
    page.evaluate("async (path) => window.ordenApp.workspace.openEntry(path)", back)
    wait_for(
        page,
        "window.ordenApp.workspace.active?.path?.endsWith('/Exported.pages')",
        "the exported PDF to open as a page note",
    )
    drawn(page, "exported", 2)

    inked = page.evaluate(
        """() => {
          const sheet = document.querySelector('.sheet canvas')
          const context = sheet?.getContext('2d', { willReadFrequently: true })
          if (!sheet || !context) return -1
          const band = Math.floor(sheet.height * 0.04)
          const data = context.getImageData(0, 0, sheet.width, band).data
          let dark = 0
          for (let at = 0; at < data.length; at += 4) {
            if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
          }
          return dark
        }"""
    )
    say(f"[exported] dark pixels in the margin of the first page: {inked}")
    if inked <= 0:
        wrong("the exported PDF has no ink on it")
    shot(page, "05-the-export-read-back")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    cdp = page.context.new_cdp_session(page)
    DRIVE.open(page)

    imported(page)
    path = opened_in_place(page)
    if path:
        ink_kept(page, cdp, path)
        exported(page)

if __name__ == "__main__":
    raise SystemExit(
        DRIVE.run(drive, "a PDF is one page note, drawn, written on, kept and exported")
    )
