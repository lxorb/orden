from __future__ import annotations

import base64
import os

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
ORIGIN = DRIVE.origin

PAGES = int(os.environ.get("ORDEN_PDF_PAGES") or 1000)

TURNED = 600

AGAIN = 300

LONG = 100

REFERENCE = 45.8

SETTLE = 4000

BENCH = """
() => {
  const started = performance.now()
  const words = /(\\w+)@(\\w+)\\.(\\w+)/g
  let kept = 0
  for (let at = 0; at < 200000; at++) {
    const text = 'note-' + at + ' to someone@example.org about ' + (at % 97)
    words.lastIndex = 0
    const found = words.exec(text)
    kept += text.length + (found ? found[2].length : 0)
  }
  return kept > 0 ? performance.now() - started : -1
}
"""

OBSERVE = """
window.__longTasks = []
new PerformanceObserver((list) => {
  for (const one of list.getEntries()) {
    window.__longTasks.push({ start: one.startTime, duration: one.duration })
  }
}).observe({ type: 'longtask', buffered: true })
"""

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

SHEETS = """
() => [...document.querySelectorAll('.pages')]
  .filter((one) => one.checkVisibility())
  .flatMap((one) => [...one.querySelectorAll('.sheet')])
"""

DRAWN = f"""
(count, number) => window.ordenApp.pages.current?.store.count === count &&
  ({SHEETS.strip()})().some(
    (one) => one.querySelector('.number')?.textContent === String(number) &&
      one.querySelector('canvas.there'),
  )
"""

OPEN = f"""
async ({{ path, count, patience }}) => {{
  const started = performance.now()
  const drawn = {DRAWN.strip()}
  void window.ordenApp.workspace.openPdf(path, 1)
  let shown = null
  const landed = () => window.ordenApp.pages.current?.store.showing || 1
  while (!drawn(count, landed())) {{
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (shown === null && window.ordenApp.pages.current?.store.count === count) {{
      shown = performance.now() - started
    }}
    if (performance.now() - started > patience) return {{ started, shown, first: null }}
  }}
  return {{ started, shown: shown ?? performance.now() - started, first: performance.now() - started }}
}}
"""

TO_END = f"""
async ({{ count, patience }}) => {{
  const started = performance.now()
  const drawn = {DRAWN.strip()}
  const sheets = {SHEETS.strip()}
  const store = window.ordenApp.pages.current?.store
  if (!store) return {{ started, last: null, mounted: 0 }}
  store.turnTo(count)
  while (!drawn(count, count)) {{
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (performance.now() - started > patience) return {{ started, last: null, mounted: sheets().length }}
  }}
  return {{ started, last: performance.now() - started, mounted: sheets().length }}
}}
"""

def paper(count: int) -> bytes:
    objects: dict[int, bytes] = {}
    font = 3
    objects[font] = b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"
    kids: list[str] = []
    for at in range(count):
        page = 4 + at * 2
        lines = [
            f"BT /F1 11 Tf 56 {780 - row * 16} Td (Page {at + 1}, line {row + 1}: the kestrel hangs"
            f" above the field and the wind keeps on.) Tj ET"
            for row in range(40)
        ]
        stream = "\n".join([f"BT /F1 28 Tf 56 800 Td (Page {at + 1}) Tj ET", *lines]).encode("latin-1")
        objects[page] = (
            f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]"
            f"/Resources<</Font<</F1 {font} 0 R>>>>/Contents {page + 1} 0 R>>"
        ).encode("latin-1")
        objects[page + 1] = b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream"
        kids.append(f"{page} 0 R")
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

THUMBNAILS = """
() => {
  const list = [...document.querySelectorAll('.navigator')].find((one) => one.checkVisibility())
  const rows = list ? [...list.querySelectorAll('.page')] : []
  const last = rows.at(-1)
  const canvas = last?.querySelector('canvas')
  return {
    count: rows.length,
    last: last ? Number(last.querySelector('.number')?.textContent) : null,
    drawn: !!canvas && canvas.width !== 300,
  }
}
"""

HOLD_FIRST = """
() => {
  const list = [...document.querySelectorAll('.navigator')].find((one) => one.checkVisibility())
  const first = list?.querySelector('.page')
  first?.focus()
  return document.activeElement === first
}
"""

HELD = """
() => {
  const list = [...document.querySelectorAll('.navigator')].find((one) => one.checkVisibility())
  const now = document.activeElement
  return {
    inside: !!list?.contains(now),
    number: now instanceof HTMLElement ? Number(now.querySelector('.number')?.textContent) : null,
  }
}
"""

LIST_TO_END = """
() => {
  const list = [...document.querySelectorAll('.navigator')].find((one) => one.checkVisibility())
  for (let box = list?.parentElement; box; box = box.parentElement) {
    const flow = getComputedStyle(box).overflowY
    if (flow === 'auto' || flow === 'scroll') {
      box.scrollTop = box.scrollHeight
      return
    }
  }
}
"""

def long_in(tasks: list[dict[str, float]], start: float, end: float, line: float) -> list[dict[str, float]]:
    return [one for one in tasks if start <= one["start"] < end and one["duration"] > line]

def told(what: str, long: list[dict[str, float]]) -> None:
    for one in long:
        say(f"  {what}: a long task at {one['start']:.0f} ms, {one['duration']:.0f} ms")

def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(viewport={"width": 1180, "height": 820})
        context.add_init_script(OBSERVE)
        page: Page = context.new_page()
        page.goto(ORIGIN, wait_until="domcontentloaded")
        wait_for(page, "window.ordenApp?.workspace?.activeSpace", "a space")
        wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")

        made = paper(PAGES)
        root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
        path = f"{root}/Thick.pdf"
        thin = f"{root}/Thin.pdf"
        for one, body in ((thin, paper(2)), (path, made)):
            if not page.evaluate(SEED, {"path": one, "data": base64.b64encode(body).decode("ascii")}):
                say(f"FAILED: {one} never reached the space")
                return 1
        say(f"a PDF of {PAGES} pages, {len(made) / 1024 / 1024:.1f} MB, is in the space")

        warm = page.evaluate(OPEN, {"path": thin, "count": 2, "patience": 60000})
        if warm["first"] is None:
            say("FAILED: a PDF of two pages never showed its first")
            return 1
        say(f"a PDF of two pages showed its first after {warm['first']:.0f} ms, the code it needs now loaded")
        page.wait_for_timeout(1500)
        bench = min(page.evaluate(BENCH) for _ in range(7))
        scale = max(1, bench / REFERENCE)
        line = LONG * scale
        turned_in, again_in = TURNED * scale, AGAIN * scale
        say(
            f"the fixed work took {bench:.1f} ms against {REFERENCE:.1f} on the reference machine, so a long task"
            f" is one over {line:.0f} ms, and the first page is due in {turned_in:.0f} ms when the PDF"
            f" turns into its page note and in {again_in:.0f} ms when that note opens again"
        )

        opened = page.evaluate(OPEN, {"path": path, "count": PAGES, "patience": 60000})
        page.wait_for_timeout(SETTLE)
        ended = page.evaluate(TO_END, {"count": PAGES, "patience": 30000})
        page.wait_for_timeout(1000)
        mounted = page.evaluate(f"() => ({SHEETS.strip()})().length")

        closing = page.evaluate("() => performance.now()")
        page.evaluate("() => window.ordenApp.workspace.closeActive()")
        page.wait_for_timeout(1500)
        reopened = page.evaluate(OPEN, {"path": f"{root}/Thick.pages", "count": PAGES, "patience": 60000})
        page.wait_for_timeout(SETTLE)
        tasks = page.evaluate("() => window.__longTasks")

        page.evaluate("() => { window.ordenApp.workspace.panel = 'outline' }")
        page.wait_for_timeout(SETTLE)
        listed = page.evaluate(THUMBNAILS)
        holding = page.evaluate(HOLD_FIRST)
        page.evaluate(LIST_TO_END)
        page.wait_for_timeout(SETTLE)
        bottom = page.evaluate(THUMBNAILS)
        kept = page.evaluate(HELD)
        page.keyboard.press("Enter")
        page.wait_for_timeout(SETTLE)
        turned = page.evaluate("() => window.ordenApp.pages.current?.store.showing ?? null")
        context.close()

    failed = False

    def timed(what: str, said: dict[str, float | None], budget: float) -> None:
        nonlocal failed
        first = said["first"]
        if first is None:
            say(f"FAILED: {what}, the page it landed on was never drawn")
            failed = True
            return
        say(f"{what}: the pages showed after {said['shown']:.0f} ms, the page it landed on drawn after {first:.0f} ms")
        if first > budget:
            say(f"FAILED: {what}, the page it landed on took longer than {budget:.0f} ms")
            failed = True

    def held(what: str, start: float, end: float) -> None:
        nonlocal failed
        long = long_in(tasks, start, end, line)
        told(what, long)
        if long:
            say(f"FAILED: {len(long)} long tasks {what}")
            failed = True

    timed("turned into its page note", opened, turned_in)
    held("while the PDF opened and settled", opened["started"], ended["started"])

    if ended["last"] is None:
        say(f"FAILED: the last page was never drawn, {ended['mounted']} sheets were on the page")
        failed = True
    else:
        say(f"the last page drawn {ended['last']:.0f} ms after the turn to it")
    held("on the way to the last page", ended["started"], closing)

    say(f"{mounted} of {PAGES} sheets are in the document")
    if mounted > 40:
        say("FAILED: the sheets out of sight are still in the document")
        failed = True

    timed("its page note opened again", reopened, again_in)
    held("while the page note opened again", reopened["started"], float("inf"))

    say(f"the page list holds {listed['count']} thumbnails, and {bottom['count']} scrolled to its end, the last page {bottom['last']}")
    if listed["count"] > 40 or bottom["count"] > 40:
        say("FAILED: the page list holds thumbnails far out of sight")
        failed = True
    say(f"the first thumbnail held the focus: {holding}; scrolled away, the focus is on page {kept['number']}, and Enter turned to page {turned}")
    if not holding or not kept["inside"] or kept["number"] != 1 or turned != 1:
        say("FAILED: the thumbnail with the focus lost it once the page list scrolled it away")
        failed = True
    if bottom["last"] != PAGES or not bottom["drawn"]:
        say("FAILED: the end of the page list does not show the last page drawn")
        failed = True

    return 1 if failed else 0

if __name__ == "__main__":
    raise SystemExit(main())
