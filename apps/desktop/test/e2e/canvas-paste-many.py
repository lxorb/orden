from __future__ import annotations

import base64
import json
import struct
import zlib

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WRITE = """async ([name, text]) => {
  const ws = window.ordenApp.workspace
  const path = `${ws.activeSpace.root.replace(/\\/+$/, '')}/${name}`
  await window.ordenApp.tasks().then((tasks) => tasks.writeFile(path, text))
  await ws.loadTree()
  await ws.openEntry(path, { activate: true })
  return path
}"""



def png(width: int, height: int, rgb: tuple[int, int, int]) -> str:
    raw = zlib.compress((b"\x00" + bytes(rgb) * width) * height)

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return base64.b64encode(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")).decode()


PICTURES = [png(40 + at, 30, (60 * at, 120, 200 - 50 * at)) for at in range(3)]

PASTE = """(pictures) => {
  const carried = new DataTransfer()
  pictures.forEach((data, at) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    carried.items.add(new File([bytes], `picture ${at}.png`, { type: 'image/png' }))
  })
  const plane = document.querySelector('.canvas')
  plane.focus()
  plane.dispatchEvent(new ClipboardEvent('paste', { clipboardData: carried, bubbles: true, cancelable: true }))
}"""

LOADED = "[...document.querySelectorAll('.canvas img.picture')].filter((one) => one.complete && one.naturalWidth > 0).length"


def drive(browser: Browser) -> None:
    context = DRIVE.context(browser, viewport={"width": 1200, "height": 800}, service_workers="allow")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    page.evaluate(WRITE, ["Pictures.canvas", json.dumps({"nodes": [], "edges": []})])
    wait_for(page, "!!document.querySelector('.canvas')", "the canvas")
    page.wait_for_timeout(600)

    page.evaluate(PASTE, PICTURES)
    try:
        wait_for(page, f"{LOADED} === 3", "three pictures", 20)
        say("ok   three pictures pasted at once are three cards")
    except SystemExit:
        wrong(f"three pictures pasted at once became {page.evaluate(LOADED)} card(s)")
    shot(page, "pasted-three")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "pictures pasted together onto a canvas each become a card"))
