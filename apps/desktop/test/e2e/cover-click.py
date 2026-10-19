"""A click in a note with a cover puts the caret where the click was.

Reported of a note with a banner at the top: *"ist meine cursor click position etwas
nach unten geoffsetted"* - every click landed a little below where it was made.

The cause was a gap CodeMirror could not see. It finds the line under a click from
the heights it measured, and it measures a block by its box; the band's room below
it was a margin, which is outside the box, so every line under the cover sat a
margin lower on the screen than CodeMirror had it, and a click on a word was taken
for the empty line under it. See cover.ts in the editor.

So: one note with a cover whose picture is held back until the drive lets it go,
and words to click all down it. Each click goes to the middle of a word, and near
its top and its bottom, and the caret has to land inside that word:

  * before the picture has arrived, and after it has, with the band drawn as tall
    as its picture the way a theme may draw it - so the picture arriving moves
    every line under it, with nothing in the document changing;
  * with the band back at the height every note has;
  * near the top of the note and far down it, scrolled;
  * with the properties drawn as rows under the cover, and hidden;
  * with the text a size larger, and in a narrow window where the band is shorter.

Run it from the repository root:

    python apps/desktop/test/e2e/cover-click.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/cover-click/`.
"""

from __future__ import annotations

import json
import struct
import zlib

from playwright.sync_api import Browser, Page, Route

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

#: The picture's address on the drive's own origin, which the app's policy lets a
#: picture come from.
LATE = "/late-cover.png"


def picture(width: int, height: int) -> bytes:
    """A PNG of two colours, top half and bottom half, built by hand so nothing here
    depends on a file in the repository."""
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
    """The cover's picture, held back until the drive lets it go: the editor has drawn
    and measured the note long before it arrives, which is what a large picture on a
    slow disk or a slow connection does. Every ask for it waits, however many times
    the band is drawn meanwhile, and is answered together on `let_go`."""

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


#: Every word the drive clicks, one per paragraph, each written once in the note.
WORDS = [f"marker{n:02d}" for n in range(1, 41)]

NOTE = (
    "---\ntitle: Banner\ncover: {origin}" + LATE + "\ntags: [kestrel]\n---\n\n# Banner\n\n"
    + "\n\n".join(f"Paragraph {n} carries {word} among plain words." for n, word in enumerate(WORDS, 1))
    + "\n"
)

# Where a word is on the screen, by the text the editor drew for it; null when it is
# not drawn or not inside the part of the note the scroller shows.
WHERE = """
(word) => {
  const scroller = window.nib.scrollDOM
  const content = window.nib.contentDOM
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

# Where the caret is, and where the word is in the document.
CARET = """
(word) => {
  const view = window.nib
  const from = view.state.doc.toString().indexOf(word)
  return { head: view.state.selection.main.head, from, to: from + word.length }
}
"""

# Whether the editor has the word's line where the page drew it: the height it
# measured against the box on the screen, to the pixel. A click asks the editor
# again on the way, but a drop, a hover or a scroll asks what it last measured.
AGREES = """
(word) => {
  const view = window.nib
  const at = view.state.doc.toString().indexOf(word)
  const found = view.domAtPos(at).node
  const line = (found.nodeType === Node.TEXT_NODE ? found.parentElement : found).closest('.cm-line')
  if (!line) return false
  return Math.abs(view.lineBlockAt(at).top + view.documentTop - line.getBoundingClientRect().top) < 1
}
"""

AWAY = """
(word) => {
  const view = window.nib
  const line = view.state.doc.lineAt(view.state.doc.toString().indexOf(word))
  view.dispatch({ selection: { anchor: line.to } })
}
"""

SCROLL = """
(top) => new Promise((done) => {
  window.nib.scrollDOM.scrollTop = top
  requestAnimationFrame(() => requestAnimationFrame(() => done(window.nib.scrollDOM.scrollTop)))
})
"""


def away(page: Page, word: str) -> None:
    """The caret to the end of the word's own line, so a click that changes nothing
    cannot pass, and without moving anything: the start of the note is in the front
    matter, where the rows give way to their YAML, and the note would be laid out
    again between finding the word and clicking it."""
    page.evaluate(AWAY, word)
    DRIVE.settled(page)


def click(page: Page, word: str, where: str, name: str = "middle", share: float = 0.5) -> None:
    """One click on the word, `share` of the way down it, and the caret inside it."""
    box = page.evaluate(WHERE, word)
    if box is None:
        wrong(f"[{where}] {word} is not on the screen to click")
        return
    page.mouse.click((box["left"] + box["right"]) / 2, box["top"] + (box["bottom"] - box["top"]) * share)
    DRIVE.settled(page)
    caret = page.evaluate(CARET, word)
    if not caret["from"] <= caret["head"] <= caret["to"]:
        line = page.evaluate("(at) => window.nib.state.doc.lineAt(at).text", caret["head"])
        wrong(
            f"[{where}] a click on the {name} of {word} put the caret at {caret['head']},"
            f" not in {caret['from']}-{caret['to']}: on {line!r}"
        )


def agrees(page: Page, word: str, where: str) -> None:
    """The editor's heights caught up with the page by themselves, nothing else
    having happened since the band changed."""
    DRIVE.waited(
        page,
        f"({AGREES})({json.dumps(word)})",
        f"[{where}] the editor to know where {word}'s line is",
        patience=5,
    )


def click_word(page: Page, word: str, where: str) -> None:
    """Three clicks on the word - its middle, near its top and near its bottom."""
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
            "() => { const one = document.querySelector('#write .nib-cover img');"
            " return !!one && one.complete && one.naturalWidth > 0 }"
        )
    )


def band(page: Page) -> int:
    return round(page.evaluate("() => document.querySelector('#write .nib-cover').getBoundingClientRect().height"))


def scrolled_round(page: Page, where: str) -> None:
    """Far down the note, with the cover out of sight above."""
    page.evaluate(SCROLL, 900)
    shown = [word for word in WORDS if page.evaluate(WHERE, word) is not None]
    if not shown:
        wrong(f"[{where}] no word is on the screen after scrolling")
        return
    click_round(page, where, [shown[0], shown[len(shown) // 2], shown[-1]])
    page.evaluate(SCROLL, 0)


def drive(browser: Browser) -> None:
    # No service worker, so the picture's request is the page's own and the drive
    # hears it: a worker's own fetches go past a page's routes.
    page = DRIVE.page(
        browser, viewport={"width": 1180, "height": 1000}, reduced_motion="reduce", service_workers="block"
    )
    DRIVE.open(page)
    held = Held()
    page.route(f"**{LATE}", held.asked)
    # The band first drawn the way a theme may draw it, as tall as its picture: so
    # the picture arriving late makes it taller, from nothing to most of the page.
    page.evaluate("() => document.documentElement.style.setProperty('--cover-height', 'auto')")
    DRIVE.seed(page, NOTE.format(origin=DRIVE.origin))
    page.evaluate("() => window.nibApp.modes.setProperties('properties')")
    DRIVE.open_note(page, "Banner")
    wait_for(page, "document.querySelector('#write .nib-cover img')", "the cover")

    near = WORDS[:4]

    if picture_in(page):
        wrong("the picture arrived before the drive let it go")
    click_round(page, "01-before-the-picture", near)

    # The caret put down before the picture arrives, and the first click after it
    # the first thing the editor hears: a transaction in between would have it
    # measure the note again anyway, which is not what a reader's click gets.
    away(page, near[2])
    held.let_go()
    wait_for(
        page,
        "(() => { const one = document.querySelector('#write .nib-cover img');"
        " return !!one && one.complete && one.naturalWidth > 0 })()",
        "the cover's picture",
    )
    DRIVE.settled(page)
    say(f"the band, its picture in: {band(page)} pixels")
    agrees(page, near[2], "02-after-the-picture")
    click(page, near[2], "02-first-click-after-the-picture")
    click_round(page, "02-after-the-picture", near)

    # Back to the band every note has, which is the cover changing height with
    # nothing in the document changing at all.
    away(page, near[1])
    page.evaluate("() => document.documentElement.style.removeProperty('--cover-height')")
    DRIVE.settled(page)
    say(f"the band, its own height: {band(page)} pixels")
    agrees(page, near[1], "03-band-height")
    click(page, near[1], "03-first-click-at-the-band-height")
    click_round(page, "03-band-height", near)
    scrolled_round(page, "04-scrolled")

    page.evaluate("() => window.nibApp.modes.setProperties('hidden')")
    DRIVE.settled(page)
    click_round(page, "05-properties-hidden", near)
    scrolled_round(page, "06-properties-hidden-scrolled")
    page.evaluate("() => window.nibApp.modes.setProperties('properties')")

    page.evaluate("() => window.nibApp.modes.setZoom(1.5)")
    DRIVE.settled(page)
    click_round(page, "07-text-larger", near[:2])
    scrolled_round(page, "08-text-larger-scrolled")
    page.evaluate("() => window.nibApp.modes.resetZoom()")

    page.set_viewport_size({"width": 560, "height": 1000})
    DRIVE.settled(page)
    say(f"the band, narrow: {band(page)} pixels")
    click_round(page, "09-narrow", near)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every click in a note with a cover lands in the word clicked"))
