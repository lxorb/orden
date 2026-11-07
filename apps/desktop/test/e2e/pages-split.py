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


STATE = """
() => ({
  active: window.ordenApp.workspace.active?.kind ?? null,
  navigator: !!document.querySelector('.navigator'),
  headings: [...(document.querySelector('.heading')?.closest('ul')?.querySelectorAll('.heading .orden-row-label') ?? [])].map((one) => one.textContent.trim()),
  counter: document.querySelector('footer .page')?.textContent?.trim() ?? null,
})
"""


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1400, "height": 820})
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    page.evaluate(SEED, {"path": f"{root}/Six.pdf", "data": base64.b64encode(paper(6)).decode("ascii")})
    page.evaluate(
        "async (path) => { await window.ordenApp.tasks().then((t) => t.writeFile(path, '# Alpha\\n\\ntext\\n\\n## Beta\\n'));"
        " await window.ordenApp.workspace.loadTree() }",
        f"{root}/Heads.md",
    )
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 1)", f"{root}/Six.pdf")
    wait_for(page, "window.ordenApp.pages.current?.store.count === 6", "the page note")
    page.evaluate("() => { window.ordenApp.workspace.panel = 'outline' }")

    page.evaluate("() => window.ordenApp.workspace.split('row')")
    wait_for(page, "document.querySelectorAll('.pages').length === 2", "the page note in two panes")
    page.evaluate("(path) => window.ordenApp.workspace.openEntry(path, { activate: true })", f"{root}/Heads.md")
    page.wait_for_timeout(800)
    state = page.evaluate(STATE)
    if state["navigator"] or state["counter"] or state["headings"] != ["Alpha", "Beta"]:
        wrong(f"[note] beside a page note, the note in front does not fill the Outline and the bar: {state}")
    else:
        say(f"ok   [note] the note in front fills the Outline and the bar: {state}")

    page.locator(".pages").first.click(position={"x": 200, "y": 300})
    if DRIVE.waited(page, f"(() => {{ const seen = ({STATE})(); return seen.navigator && seen.counter === '1 / 6' }})()", "the page note left in front to fill the Outline and the bar", patience=10):
        say(f"ok   [pages] the page note left in front fills them again: {page.evaluate(STATE)}")
    else:
        say(f"  it shows {page.evaluate(STATE)}")
        shot(page, "lost")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the Outline and the bar follow the tab in front, beside a page note"))
