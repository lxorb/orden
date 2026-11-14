from __future__ import annotations

import base64
import os

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

MOD = "Control"

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

HITS = """
() => [...document.querySelectorAll('.pages .sheet .hit')].map((one) => {
  const box = one.getBoundingClientRect()
  return { current: one.classList.contains('current'), x: box.x, y: box.y, width: box.width, height: box.height }
})
"""

LINES = [
    "The first worked exam-",
    "ple shows the method.",
    "A second line of plain words.",
    "Here the example sits whole.",
]


def paper() -> bytes:
    w, h = 595, 842
    rows = [f"BT /F1 14 Tf 60 {h - 80 - row * 22} Td ({text}) Tj ET" for row, text in enumerate(LINES)]
    stream = "\n".join(rows).encode("latin-1")
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


def opened(context) -> Page | None:
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Worked.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper()).decode("ascii")}):
        wrong("the PDF never reached the space")
        return None
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 1)", pdf)
    wait_for(page, "window.ordenApp.pages.current?.store.count === 1", "the page note")
    wait_for(page, "document.querySelectorAll('.pages .sheet .words span').length >= 4", "the page's words", 20)
    return page


def typed(page: Page, term: str) -> None:
    field = page.locator(".pages .find input")
    field.fill(term)
    page.wait_for_timeout(400)


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1100, "height": 800}, device_scale_factor=1)
    page = opened(context)
    if not page:
        return

    page.locator(".pages").first.click(position={"x": 20, "y": 20})
    page.keyboard.press(f"{MOD}+f")
    page.wait_for_selector(".pages .find input", timeout=5000)

    typed(page, "example")
    count = page.locator(".pages .find .count").inner_text()
    hits = page.evaluate(HITS)
    say(f"'example': the bar counts {count!r}, the page shows {len(hits)} marks")
    if count != "1/2":
        wrong(f"'example' broken over two lines as 'exam-' / 'ple' and once whole should count 1/2, the bar says {count!r}")
    tops = sorted({round(one["y"]) for one in hits})
    if len(tops) < 3:
        wrong(f"the broken 'exam-' / 'ple' and the whole 'example' should mark three lines, marks sit on {tops}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    current = [one for one in page.evaluate(HITS) if one["current"]]
    say(f"after Enter: {len(current)} marks shown as the current one")
    if len(current) != 2:
        wrong(f"the current hit 'exam-' / 'ple' should mark two pieces, {len(current)} are marked")
    shot(page, "broken-word-found")

    typed(page, "exam")
    count = page.locator(".pages .find .count").inner_text()
    left = [one for one in page.evaluate(HITS) if one["current"]]
    say(f"'exam' after picking a hit: the bar counts {count!r}, {len(left)} marks shown as current")
    if left:
        wrong(f"a changed word left {len(left)} marks shown as the current one, though nothing was picked since")
    if not count.startswith("1/"):
        wrong(f"a changed word should start the count over, the bar says {count!r}")
    shot(page, "changed-word")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a page note's find meets a PDF word broken over a line end, and a changed word marks nothing as current"))
