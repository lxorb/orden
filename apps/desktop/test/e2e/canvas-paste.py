"""A picture pasted onto a canvas is the picture (#364).

David, on a Mac: "cant paste image on canvas" - the card came up saying "Nothing here".
Signed in, a pasted picture is kept by the account and the card names its address; the
card joined that address to the space's folder and asked for a file that was nowhere.
See `fileUrl` in canvas/render.ts.

Against the real Worker, on the built web app: a PNG pasted onto a canvas - signed in,
and on a device that is not - comes up as a picture that has loaded, and is still one
after the canvas is opened again. And a card the web app wrote before the fix, naming the
account's picture as `i/<hash>.png`, is loaded from the account by somebody signed in.

    python apps/desktop/test/e2e/canvas-paste.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
import zlib

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()
PATIENCE = 60


def png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A picture of one colour, as a PNG's bytes."""
    row = b"\x00" + bytes(rgb) * width
    raw = zlib.compress(row * height)

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


PICTURE = base64.b64encode(png(64, 48, (220, 40, 120))).decode()

#: A paste of a PNG on the plane, as the system's clipboard hands one over.
PASTE = """(data) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'image.png', { type: 'image/png' })
  const carried = new DataTransfer()
  carried.items.add(file)
  const plane = document.querySelector('.canvas')
  plane.focus()
  plane.dispatchEvent(new ClipboardEvent('paste', { clipboardData: carried, bubbles: true, cancelable: true }))
}"""

#: The pictures on the plane: whether each has loaded, and what it names.
PICTURES = """() => [...document.querySelectorAll('.canvas img.picture')].map((one) =>
  ({ loaded: one.complete && one.naturalWidth > 0, src: one.getAttribute('src') }))"""


def wait(page: Page, script: str, what: str) -> object:
    for _ in range(PATIENCE * 4):
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(250)
    raise SystemExit(f"gave up waiting for {what}")


def board(page: Page, label: str) -> str:
    wait(page, "() => !!window.nibApp?.workspace?.activeSpace && typeof window.nibApp.tasks === 'function'", f"[{label}] the app")
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    path = f"{root}/Board.canvas"
    page.evaluate(
        "async (path) => { const ws = window.nibApp.workspace;"
        " await window.nibApp.tasks().then((t) => t.writeFile(path, JSON.stringify({ nodes: [], edges: [] })));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        path,
    )
    wait(page, "() => !!document.querySelector('.canvas')", f"[{label}] the canvas")
    page.wait_for_timeout(600)
    return path


def pasted(page: Page, label: str, path: str) -> None:
    page.evaluate(PASTE, PICTURE)
    try:
        wait(page, f"() => ({PICTURES})().some((one) => one.loaded)", f"[{label}] the picture to load")
    except SystemExit:
        said = page.evaluate(PICTURES)
        missing = page.evaluate("() => document.querySelectorAll('.canvas .missing').length")
        wrong(f"[{label}] the pasted picture did not load: {said}, {missing} card(s) saying Nothing here")
        shot(page, f"{label}-pasted")
        return
    shot(page, f"{label}-pasted")
    said = page.evaluate(PICTURES)
    say(f"ok   [{label}] the pasted picture loaded: {said[0]['src'][:80]}")

    # And it is still the picture once the canvas is opened again.
    page.reload(wait_until="domcontentloaded")
    wait(page, "() => !!window.nibApp?.workspace?.activeSpace", f"[{label}] the app again")
    page.evaluate("async (path) => { await window.nibApp.workspace.openEntry(path, { activate: true }) }", path)
    try:
        wait(page, f"() => ({PICTURES})().some((one) => one.loaded)", f"[{label}] the picture after a reload")
        say(f"ok   [{label}] and after the canvas is opened again")
    except SystemExit:
        wrong(f"[{label}] after a reload the picture did not load: {page.evaluate(PICTURES)}")


#: The picture's hash, which is the name the account keeps it under.
HASH = hashlib.sha256(base64.b64decode(PICTURE)).hexdigest()


def written_before(page: Page, label: str, signed: bool) -> None:
    """A card the web app wrote before #364: the account's picture as a path in the
    space. Signed in, it is loaded from the account; signed out, it is still nothing."""
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    path = f"{root}/Before.canvas"
    card = {"id": "old", "type": "file", "file": f"i/{HASH}.png", "x": 0, "y": 0, "width": 320, "height": 224}
    page.evaluate(
        "async ([path, text]) => { const ws = window.nibApp.workspace;"
        " await window.nibApp.tasks().then((t) => t.writeFile(path, text));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        [path, json.dumps({"nodes": [card], "edges": []})],
    )
    wait(page, "() => !!document.querySelector('.canvas [data-id=\"old\"]')", f"[{label}] the old card")
    if signed:
        try:
            wait(page, f"() => ({PICTURES})().some((one) => one.loaded)", f"[{label}] the old card's picture")
            say(f"ok   [{label}] a card written before #364 is loaded from the account")
        except SystemExit:
            wrong(f"[{label}] a card written before #364 did not load: {page.evaluate(PICTURES)}")
    else:
        page.wait_for_timeout(1500)
        if page.evaluate(f"() => ({PICTURES})().some((one) => one.loaded)"):
            wrong(f"[{label}] a card written before #364 loaded with nobody signed in")
        else:
            say(f"ok   [{label}] a card written before #364 is nothing, with nobody signed in")


def drive(browser: Browser, token: str) -> None:
    for label, signed in (("signed in", True), ("signed out", False)):
        context = browser.new_context(viewport={"width": 1280, "height": 820})
        if signed:
            context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
        page = context.new_page()
        page.on("pageerror", lambda error, label=label: wrong(f"[{label}] page error: {error}"))
        page.goto(ORIGIN, wait_until="domcontentloaded")
        path = board(page, label)
        pasted(page, label, path)
        written_before(page, label, signed)
        context.close()


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account("paster@example.com")
        drive(browser, token)
    return DRIVE.verdict("a picture pasted onto a canvas is the picture, signed in and not")


if __name__ == "__main__":
    raise SystemExit(main())
