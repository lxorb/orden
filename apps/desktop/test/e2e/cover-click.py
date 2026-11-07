from __future__ import annotations

import json
import struct
import zlib

from playwright.sync_api import Browser, Page, Route

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LATE = "/late-cover.png"

def picture(width: int, height: int) -> bytes:
    rows = b"".join(
        b"\x00" + (b"\x2a\x6f\xb0" if y < height // 2 else b"\xe0\x8a\x3c") * width
        for y in range(height)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")

PICTURE = picture(1200, 600)

class Held:

    def __init__(self) -> None:
        self.waiting: list[Route] = []
        self.free = False

    def asked(self, route: Route) -> None:
        if self.free:
            route.fulfill(body=PICTURE, content_type="image/png")
        else:
            self.waiting.append(route)

    def let_go(self) -> None:
        self.free = True
        for route in self.waiting:
            route.fulfill(body=PICTURE, content_type="image/png")
        self.waiting.clear()

WORDS = [f"marker{n:02d}" for n in range(1, 41)]

NOTE = (
    "---\ntitle: Banner\ncover: {origin}" + LATE + "\ntags: [kestrel]\n---\n\n# Banner\n\n"
    + "\n\n".join(f"Paragraph {n} carries {word} among plain words." for n, word in enumerate(WORDS, 1))
    + "\n"
)

WHERE = """
(word) => {
  const scroller = window.orden.scrollDOM
  const content = window.orden.contentDOM
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf(word)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + word.length)
    const box = range.getBoundingClientRect()
    const shown = scroller.getBoundingClientRect()
    if (box.top < shown.top || box.bottom > shown.bottom) return null
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
  }
  return null
}
"""

CARET = """
(word) => {
  const view = window.orden
  const from = view.state.doc.toString().indexOf(word)
  return { head: view.state.selection.main.head, from, to: from + word.length }
}
"""

AGREES = """
(word) => {
  const view = window.orden
  const at = view.state.doc.toString().indexOf(word)
  const found = view.domAtPos(at).node
  const line = (found.nodeType === Node.TEXT_NODE ? found.parentElement : found).closest('.cm-line')
  if (!line) return false
  return Math.abs(view.lineBlockAt(at).top + view.documentTop - line.getBoundingClientRect().top) < 1
}
"""

AWAY = """
(word) => {
  const view = window.orden
  const line = view.state.doc.lineAt(view.state.doc.toString().indexOf(word))
  view.dispatch({ selection: { anchor: line.to } })
}
"""

SCROLL = """
(top) => new Promise((done) => {
  window.orden.scrollDOM.scrollTop = top
  requestAnimationFrame(() => requestAnimationFrame(() => done(window.orden.scrollDOM.scrollTop)))
})
"""

def away(page: Page, word: str) -> None:
    page.evaluate(AWAY, word)
    DRIVE.settled(page)

def click(page: Page, word: str, where: str, name: str = "middle", share: float = 0.5) -> None:
    box = page.evaluate(WHERE, word)
    if box is None:
        wrong(f"[{where}] {word} is not on the screen to click")
        return
    page.mouse.click((box["left"] + box["right"]) / 2, box["top"] + (box["bottom"] - box["top"]) * share)
    DRIVE.settled(page)
    caret = page.evaluate(CARET, word)
    if not caret["from"] <= caret["head"] <= caret["to"]:
        line = page.evaluate("(at) => window.orden.state.doc.lineAt(at).text", caret["head"])
        wrong(
            f"[{where}] a click on the {name} of {word} put the caret at {caret['head']},"
            f" not in {caret['from']}-{caret['to']}: on {line!r}"
        )

def agrees(page: Page, word: str, where: str) -> None:
    DRIVE.waited(
        page,
        f"({AGREES})({json.dumps(word)})",
        f"[{where}] the editor to know where {word}'s line is",
        patience=5,
    )

def click_word(page: Page, word: str, where: str) -> None:
    for name, share in (("middle", 0.5), ("top", 0.2), ("bottom", 0.8)):
        away(page, word)
        click(page, word, where, name, share)

def click_round(page: Page, where: str, words: list[str]) -> None:
    for word in words:
        click_word(page, word, where)
    DRIVE.shot(page, where)

def picture_in(page: Page) -> bool:
    return bool(
        page.evaluate(
            "() => { const one = document.querySelector('#write .orden-cover img');"
            " return !!one && one.complete && one.naturalWidth > 0 }"
        )
    )

def band(page: Page) -> int:
    return round(page.evaluate("() => document.querySelector('#write .orden-cover').getBoundingClientRect().height"))

def scrolled_round(page: Page, where: str) -> None:
    page.evaluate(SCROLL, 900)
    shown = [word for word in WORDS if page.evaluate(WHERE, word) is not None]
    if not shown:
        wrong(f"[{where}] no word is on the screen after scrolling")
        return
    click_round(page, where, [shown[0], shown[len(shown) // 2], shown[-1]])
    page.evaluate(SCROLL, 0)

def drive(browser: Browser) -> None:
    page = DRIVE.page(
        browser, viewport={"width": 1180, "height": 1000}, reduced_motion="reduce", service_workers="block"
    )
    DRIVE.open(page)
    held = Held()
    page.route(f"**{LATE}", held.asked)
    page.evaluate("() => document.documentElement.style.setProperty('--cover-height', 'auto')")
    DRIVE.seed(page, NOTE.format(origin=DRIVE.origin))
    DRIVE.open_note(page, "Banner")
    wait_for(page, "document.querySelector('#write .orden-cover img')", "the cover")

    near = WORDS[:4]

    if picture_in(page):
        wrong("the picture arrived before the drive let it go")
    click_round(page, "01-before-the-picture", near)

    away(page, near[2])
    held.let_go()
    wait_for(
        page,
        "(() => { const one = document.querySelector('#write .orden-cover img');"
        " return !!one && one.complete && one.naturalWidth > 0 })()",
        "the cover's picture",
    )
    DRIVE.settled(page)
    say(f"the band, its picture in: {band(page)} pixels")
    agrees(page, near[2], "02-after-the-picture")
    click(page, near[2], "02-first-click-after-the-picture")
    click_round(page, "02-after-the-picture", near)

    away(page, near[1])
    page.evaluate("() => document.documentElement.style.removeProperty('--cover-height')")
    DRIVE.settled(page)
    say(f"the band, its own height: {band(page)} pixels")
    agrees(page, near[1], "03-band-height")
    click(page, near[1], "03-first-click-at-the-band-height")
    click_round(page, "03-band-height", near)
    scrolled_round(page, "04-scrolled")

    page.evaluate("() => window.ordenApp.modes.setZoom(1.5)")
    DRIVE.settled(page)
    click_round(page, "07-text-larger", near[:2])
    scrolled_round(page, "08-text-larger-scrolled")
    page.evaluate("() => window.ordenApp.modes.resetZoom()")

    page.set_viewport_size({"width": 560, "height": 1000})
    DRIVE.settled(page)
    say(f"the band, narrow: {band(page)} pixels")
    click_round(page, "09-narrow", near)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every click in a note with a cover lands in the word clicked"))
