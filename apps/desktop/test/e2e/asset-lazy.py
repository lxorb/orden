import base64
import json
import struct
import zlib
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
def png(width: int, height: int, colour: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    rows = b"".join(b"\x00" + bytes(colour) * width for _ in range(height))
    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
FIRST = png(220, 150, (40, 90, 200))
SECOND = png(90, 60, (200, 60, 40))
FILLER = base64.b64encode(bytes(range(256)) * 80).decode()
COUNTED = """
(() => {
  const seen = { rows: 0, bytes: 0, urls: 0 }
  window.__assets = seen
  const tally = (value) => {
    if (value && typeof value.data === 'string') {
      seen.rows += 1
      seen.bytes += value.data.length
    }
  }
  for (const name of ['get', 'getAll', 'openCursor']) {
    const real = IDBObjectStore.prototype[name]
    IDBObjectStore.prototype[name] = function (...given) {
      const asked = real.apply(this, given)
      if (this.name === 'assets') {
        asked.addEventListener('success', () => {
          const found = asked.result
          if (Array.isArray(found)) found.forEach(tally)
          else tally(found && 'value' in found && 'continue' in found ? found.value : found)
        })
      }
      return asked
    }
  }
  const make = URL.createObjectURL
  URL.createObjectURL = function (...given) {
    seen.urls += 1
    return make.apply(this, given)
  }
})()
"""
PUT = """
async ([rows, tell]) => {
  const db = await new Promise((done, failed) => {
    const asked = indexedDB.open('orden')
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error)
  })
  await new Promise((done, failed) => {
    const change = db.transaction(['assets', 'stats'], 'readwrite')
    for (const row of rows) {
      change.objectStore('assets').put(row)
      change.objectStore('stats').put({ path: row.path, modified: row.modified, created: row.modified, size: row.data.length })
    }
    change.oncomplete = done
    change.onerror = () => failed(change.error)
  })
  db.close()
  if (tell) new BroadcastChannel('orden:assets').postMessage({ written: rows.map((row) => row.path), gone: [] })
}
"""
DRAWN = """
(selector) => [...document.querySelectorAll(selector)]
  .filter((one) => one.getClientRects().length > 0)
  .map((one) => ({ src: one.src, complete: one.complete, width: one.naturalWidth }))
"""
def row(path: str, body: bytes | str, modified: int = 1) -> dict:
    data = body if isinstance(body, str) else base64.b64encode(body).decode()
    return {"path": path, "type": "", "data": data, "modified": modified}
def loaded_with(browser: Browser, many: int) -> dict:
    context = browser.new_context(service_workers="block", viewport={"width": 1180, "height": 820})
    context.add_init_script(COUNTED)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    asked: list[str] = []
    page.on("request", lambda request: asked.append(request.url) if "/asset/" in request.url else None)
    DRIVE.open(page)
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    rows = [row(f"{root}/assets/shown.png", FIRST)] + [row(f"{root}/assets/more-{at:04}.bin", FILLER) for at in range(many)]
    page.evaluate(PUT, [rows, False])
    DRIVE.seed(page, "# Many beside it\n\n![](assets/shown.png)\n")
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    DRIVE.open_note(page, "Many beside it")
    wait_for(page, "document.querySelector('.cm-content img.orden-image')?.naturalWidth === 220", "the one picture the note shows")
    page.wait_for_timeout(1500)
    seen = page.evaluate("() => window.__assets")
    drawn = page.evaluate(DRAWN, ".cm-content img.orden-image")
    say(f"{many + 1} attachments kept: the page read {json.dumps(seen)} and drew {json.dumps(drawn)}")
    if not drawn or not drawn[0]["src"].startswith("blob:"):
        wrong(f"with {many + 1} attachments the picture is not shown from a blob: {drawn}")
    if asked:
        wrong(f"the page asked the network for a file of the space: {asked[:3]}")
    context.close()
    return seen
def many(browser: Browser) -> None:
    few, lots = loaded_with(browser, 30), loaded_with(browser, 120)
    if few != lots:
        wrong(f"four times the attachments changed what a load reads: {few} against {lots}")
    if lots["rows"] != 1 or lots["urls"] != 1:
        wrong(f"a load that shows one picture read {lots['rows']} attachments and made {lots['urls']} addresses")
def board(root: str, cards: int) -> str:
    nodes = [
        {"id": f"card-{at}", "type": "text", "text": "A card with a picture\n\n![](assets/pic.png)", "x": -520 + at * 260, "y": -200, "width": 240, "height": 220}
        for at in range(cards)
    ]
    nodes.append({"id": "file", "type": "file", "file": "assets/pic.png", "x": -520, "y": 60, "width": 240, "height": 180})
    return json.dumps({"nodes": nodes, "edges": []})
def every(page: Page, selector: str, width: int, count: int, what: str) -> list[dict]:
    ready = f"(() => {{ const all = ({DRAWN})({json.dumps(selector)}); return all.length >= {count} && all.every((one) => one.complete && one.width === {width} && one.src.startsWith('blob:')) }})()"
    if not DRIVE.waited(page, ready, what, 20):
        wrong(f"{what}: {page.evaluate(DRAWN, selector)}")
    return page.evaluate(DRAWN, selector)
def overwritten(browser: Browser) -> None:
    context = browser.new_context(service_workers="block", viewport={"width": 1300, "height": 820})
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    picture = f"{root}/assets/pic.png"
    page.evaluate(PUT, [[row(picture, FIRST)], False])
    open_board = (
        "async ([path, text]) => { const ws = window.ordenApp.workspace;"
        " await window.ordenApp.tasks().then((one) => one.writeFile(path, text));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }"
    )
    page.evaluate(open_board, [f"{root}/Board.canvas", board(root, 1)])
    before = every(page, ".canvas img", 220, 2, "the card and the file node to draw the first picture")
    say(f"before: {json.dumps(before)}")
    old = before[0]["src"]
    page.evaluate(PUT, [[row(picture, SECOND, 2)], True])
    after = every(page, ".canvas img", 90, 2, "the card and the file node to draw the new picture at once")
    say(f"after the overwrite: {json.dumps(after)}")
    if any(one["src"] == old for one in after):
        wrong("something on the board still shows the address the old bytes had")
    gone = page.evaluate("(url) => fetch(url).then(() => false, () => true)", old)
    if not gone:
        wrong("the address of the old bytes still answers, so it was never given up")
    page.evaluate(open_board, [f"{root}/Board.canvas", board(root, 3)])
    again = every(page, ".canvas img", 90, 4, "cards drawn again from kept markup to show the new picture")
    say(f"three cards from the same kept markup: {json.dumps(again)}")
    DRIVE.seed(page, "# Beside the board\n\n![](assets/pic.png)\n")
    DRIVE.open_note(page, "Beside the board")
    every(page, ".cm-content img.orden-image", 90, 1, "the note to draw the new picture")
    named = page.evaluate("() => document.querySelectorAll('img[src^=\"data:image/gif\"][src*=\"#\"]').length")
    if named:
        wrong(f"{named} pictures are still only named, not shown")
    context.close()
def drive(browser: Browser) -> None:
    say("--- many attachments ---")
    many(browser)
    say("--- written over while a card shows it ---")
    overwritten(browser)
raise SystemExit(DRIVE.run(drive, "a load reads only the attachments it shows, and a picture written over shows its new bytes everywhere"))
