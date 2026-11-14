from __future__ import annotations

import base64
import os

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PAGES = int(os.environ.get("ORDEN_SCROLL_PAGES", "120"))
LINES = 70
FRAMES = int(os.environ.get("ORDEN_SCROLL_FRAMES", "360"))
RATIO = 12.0
THROTTLE = float(os.environ.get("ORDEN_SCROLL_THROTTLE", "4"))

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

SCROLL = """
async ([frames, step]) => {
  const host = document.querySelector('.pages')
  const box = host.getBoundingClientRect()
  const store = window.ordenApp.pages.current.store
  const from = store.camera.y
  const gaps = []
  let built = 0
  const watching = new MutationObserver((changes) => {
    for (const change of changes) if (change.target.classList?.contains('words')) built += change.addedNodes.length
  })
  watching.observe(host, { childList: true, subtree: true })
  await new Promise((done) => {
    let last = 0
    let count = 0
    const frame = (now) => {
      if (last) gaps.push(now - last)
      last = now
      host.dispatchEvent(new WheelEvent('wheel', {
        deltaY: step, deltaMode: 0, bubbles: true, cancelable: true,
        clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
      }))
      if (++count < frames) requestAnimationFrame(frame)
      else done()
    }
    requestAnimationFrame(frame)
  })
  watching.disconnect()
  const sorted = [...gaps].sort((a, b) => a - b)
  const total = gaps.reduce((sum, one) => sum + one, 0)
  return {
    mean: total / gaps.length,
    p95: sorted[Math.floor(sorted.length * 0.95)],
    long: gaps.filter((one) => one > 50).length,
    moved: store.camera.y - from,
    built,
  }
}
"""

HIDDEN = "() => { const style = document.createElement('style'); style.id = 'no-words'; style.textContent = '.pages .sheet .words { display: none !important }'; document.head.append(style) }"
SHOWN = "() => document.getElementById('no-words')?.remove()"


def paper() -> bytes:
    w, h = 595, 842
    words = "the kestrel hangs above the field while the river turns slowly under a grey and patient sky"
    fonts = 3
    objects: dict[int, bytes] = {
        1: b"<</Type/Catalog/Pages 2 0 R>>",
        fonts: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    }
    kids = []
    for at in range(PAGES):
        page, content = 4 + at * 2, 5 + at * 2
        kids.append(f"{page} 0 R")
        lines = [f"BT /F1 7 Tf 36 {h - 40 - row * 11} Td (P{at + 1} L{row + 1}: {words}) Tj ET" for row in range(LINES)]
        stream = "\n".join(lines).encode("latin-1")
        objects[page] = f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 {fonts} 0 R>>>>/Contents {content} 0 R>>".encode("latin-1")
        objects[content] = b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream"
    objects[2] = f"<</Type/Pages/Kids[{' '.join(kids)}]/Count {PAGES}>>".encode("latin-1")
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    table = len(out)
    size = max(objects) + 1
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        out += b"%010d 00000 n \n" % places[number]
    out += b"trailer<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n" % (size, table)
    return bytes(out)


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1100, "height": 800}, device_scale_factor=1)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Long.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper()).decode("ascii")}):
        wrong("the PDF never reached the space")
        return
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 1)", pdf)
    wait_for(page, f"window.ordenApp.pages.current?.store.count === {PAGES}", "the page note", 60)
    if not os.environ.get("ORDEN_SCROLL_BEFORE"):
        wait_for(page, "document.querySelectorAll('.pages .sheet .words span').length >= 60", "the first page's words", 30)
    page.wait_for_timeout(1500)

    cdp = context.new_cdp_session(page)
    if cdp:
        cdp.send("Performance.enable")
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})

    def busy() -> float:
        if not cdp:
            return 0.0
        metrics = {one["name"]: one["value"] for one in cdp.send("Performance.getMetrics")["metrics"]}
        return metrics.get("TaskDuration", 0.0) * 1000

    runs = []
    for label, hide, step in (("words", False, 40), ("no words", True, 40), ("words", False, -40), ("no words", True, -40)):
        page.evaluate(HIDDEN if hide else SHOWN)
        page.wait_for_timeout(800)
        before = busy()
        got = page.evaluate(SCROLL, [FRAMES, step])
        got["busy"] = (busy() - before) / FRAMES
        say(f"{label}, {step:+d}px a frame: busy {got['busy']:.1f} ms a frame, mean gap {got['mean']:.1f} ms, p95 {got['p95']:.1f} ms, {got['long']} frames over 50 ms, moved {got['moved']:.0f}, {got['built']} word nodes added")
        runs.append((label, got))
    page.evaluate(SHOWN)

    built = [got["built"] for _, got in runs]
    if any(built):
        wrong(f"words were laid out for pages while they scrolled past: {built} nodes")
    on = [got for label, got in runs if label == "words"]
    off = [got for label, got in runs if label == "no words"]
    if any(abs(got["moved"]) < 200 for got in on + off):
        wrong(f"the wheel did not move the page note: {[got['moved'] for got in on + off]}")
    mean_on = sum(got["mean"] for got in on) / len(on)
    mean_off = sum(got["mean"] for got in off) / len(off)
    say(f"scrolling with words costs {mean_on / mean_off:.2f}x a frame of scrolling without them")
    if mean_on > mean_off * RATIO:
        wrong(f"a frame of scrolling takes {mean_on:.1f} ms with a PDF's words and {mean_off:.1f} ms without them")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a long PDF in a page note scrolls as smoothly with its words as without them"))
