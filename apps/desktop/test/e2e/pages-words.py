from __future__ import annotations

import base64
import os

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WEBKIT = os.environ.get("ORDEN_ENGINE", "chromium") == "webkit"
MOD = "Meta" if WEBKIT else "Control"

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

SPAN = """
(text) => {
  const span = [...document.querySelectorAll('.pages .sheet .words span')].find((one) => one.textContent.startsWith(text))
  if (!span) return null
  const box = span.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}
"""

CLOSE = """
() => {
  const close = document.querySelector('.pages .sheet canvas.close.there')
  const box = close?.getBoundingClientRect()
  return close && box ? { pixels: close.width, shown: box.width * devicePixelRatio } : null
}
"""

COPIED = """
() => {
  window.__copied = []
  document.addEventListener('copy', () => window.__copied.push(String(getSelection())), true)
}
"""

INK = "() => window.ordenApp.pages.current.store.canvas.ink.length"

ZOOM = """
([scale]) => {
  const store = window.ordenApp.pages.current.store
  const page = store.pages[0]
  store.camera = store.held({ x: page.x + 100, y: page.y + 78, scale })
}
"""


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


def across(page, box) -> None:
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + 1, y)
    page.mouse.down()
    for step in range(1, 13):
        page.mouse.move(box["x"] + 1 + (box["width"] - 2) * step / 12, y)
    page.mouse.up()


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1100, "height": 800}, device_scale_factor=2)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Words.pdf"
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(paper()).decode("ascii")}):
        wrong("the PDF never reached the space")
        return
    page.evaluate("(path) => window.ordenApp.workspace.openPdf(path, 1)", pdf)
    wait_for(page, "window.ordenApp.pages.current?.store.count === 1", "the page note")
    wait_for(page, "document.querySelectorAll('.pages .sheet .words span').length >= 60", "the page's words", 20)
    page.evaluate(COPIED)

    line = page.evaluate(SPAN, "Line 3:")
    if not line:
        wrong("no words for line 3 on the page")
        return
    across(page, line)
    chosen = page.evaluate("() => String(getSelection())")
    say(f"dragged over line 3: {chosen!r}")
    if "Line 3: the kestrel hangs above the field." not in chosen:
        wrong(f"dragging over a line of the PDF chose {chosen!r}")
    page.keyboard.press(f"{MOD}+c")
    page.wait_for_timeout(200)
    if WEBKIT and not page.evaluate("() => window.__copied.length"):
        page.evaluate("() => document.execCommand('copy')")
    copied = page.evaluate("() => window.__copied")
    if not any("kestrel" in one for one in copied):
        wrong(f"{MOD}+C copied {copied!r}")
    if page.evaluate(INK):
        wrong("choosing words drew ink")
    shot(page, "words-chosen")

    page.locator(".pages").first.focus()
    page.keyboard.press("d")
    line = page.evaluate(SPAN, "Line 6:")
    across(page, line)
    page.wait_for_timeout(300)
    chosen = page.evaluate("() => String(getSelection())")
    if chosen.strip():
        wrong(f"with the pen, a stroke over words chose {chosen!r}")
    if page.evaluate(INK) != 1:
        wrong(f"with the pen, a stroke over words left {page.evaluate(INK)} strokes")
    page.keyboard.press("v")

    page.evaluate("() => window.ordenApp.pages.current.store.zoomTo(3)")
    page.wait_for_timeout(600)
    page.locator(".pages").first.focus()
    page.keyboard.press(f"{MOD}+f")
    wait_for(page, "!!document.querySelector('.pages .find input')", "the find bar", 10)
    page.keyboard.type("line 52:", delay=10)
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    wait_for(page, "!!document.querySelector('.pages .sheet .hit.current')", "the found words marked", 10)
    page.wait_for_timeout(400)
    box = page.evaluate("() => { const b = document.querySelector('.pages .sheet .hit.current').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }")
    count = page.evaluate("() => document.querySelector('.pages .find .count')?.textContent")
    say(f"found 'line 52:' ({count}) at {box}")
    if not (0 <= box["x"] and box["x"] + box["width"] <= 1100 and 0 <= box["y"] and box["y"] + box["height"] <= 800):
        wrong(f"the found words are off the screen: {box}")
    shot(page, "found")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    if page.evaluate("() => !!document.querySelector('.pages .sheet .hit')"):
        wrong("the marks of a closed find stay on the page")

    for scale in (8, 16, 32):
        page.evaluate(ZOOM, [scale])
        wait_for(page, f"({CLOSE.strip()})() !== null", f"a close-up at {scale * 100}%", 15)
        page.wait_for_timeout(600)
        seen = page.evaluate(CLOSE)
        got = page.evaluate("() => window.ordenApp.pages.current.store.camera.scale")
        stretch = seen["shown"] / seen["pixels"]
        say(f"at {got * 100:.0f}%: the close-up is {seen['pixels']} pixels for {seen['shown']:.0f} on screen ({stretch:.2f}x)")
        if got < scale:
            wrong(f"asked for {scale * 100}%, the page note stopped at {got * 100:.0f}%")
        if stretch > 1.15:
            wrong(f"at {got * 100:.0f}% the words are stretched {stretch:.2f}x")
        shot(page, f"zoom-{scale * 100}")

    line = page.evaluate(SPAN, "Line 1:")
    if line:
        across(page, {**line, "x": max(line["x"], 40), "width": min(line["width"], 900)})
        chosen = page.evaluate("() => String(getSelection())")
        say(f"at 3200%, dragged over line 1: {chosen[:40]!r}")
        if not chosen.strip() or chosen not in "Line 1: the kestrel hangs above the field.":
            wrong(f"at 3200% a drag over words chose {chosen!r}")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a PDF's words in a page note can be chosen and copied, and stay sharp at any zoom"))
