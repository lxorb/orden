import base64
import json
import os
import struct
import zlib
from playwright.sync_api import Browser, Page, Route
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
ORIGIN = harness.worker_origin()
def png(width: int, height: int) -> bytes:
    raw = b"".join(b"\x00" + os.urandom(width * 3) for _ in range(height))
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(raw, 1)) + chunk(b"IEND", b"")
SEED = """async () => { const ws = window.ordenApp.workspace
  await ws.noteFrom('# Pictures\\n\\nHere:\\n\\n', ws.activeSpace.root); await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Pictures'))
  await ws.openEntry(found.path, { activate: true }) }"""
GIVE = """([data, name, type, how, selector]) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const carried = new DataTransfer()
  carried.items.add(new File([bytes], name, { type }))
  const target = [...document.querySelectorAll(selector)].find((one) => one.getClientRects().length > 0)
  target.focus()
  const box = target.getBoundingClientRect()
  window.__given = performance.now()
  target.dispatchEvent(how === 'drop'
    ? new DragEvent('drop', { dataTransfer: carried, bubbles: true, cancelable: true, clientX: box.left + 20, clientY: box.top + 10 })
    : new ClipboardEvent('paste', { clipboardData: carried, bubbles: true, cancelable: true }))
}"""
DRAWN = """(selector) => [...document.querySelectorAll(selector)].filter((one) => one.complete && one.naturalWidth > 1
  && !one.src.startsWith('data:')).map((one) => one.src.slice(0, 5))"""
class Held:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.routes: list[Route] = []
        self.finished: list[str] = []
        self.failing = False
        page.on("requestfinished", lambda request: self.heard(request.url))
        page.route("**/v1/blobs/**", self.hold)
        page.route("**/i/**", self.hold)
    def heard(self, url: str) -> None:
        if "/v1/blobs/" in url or "/i/" in url:
            self.finished.append(url)
    def hold(self, route: Route) -> None:
        if self.failing:
            route.fulfill(status=503, body="{}", content_type="application/json")
        else:
            self.routes.append(route)
    def release(self) -> None:
        self.page.unroute("**/v1/blobs/**")
        self.page.unroute("**/i/**")
        for route in self.routes:
            try:
                route.continue_()
            except Exception:
                pass
        self.routes = []
def opened(browser: Browser, token: str | None) -> Page:
    context = browser.new_context(viewport={"width": 1200, "height": 900}, service_workers="block")
    if token:
        context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.ordenApp?.workspace?.activeSpace", "the app")
    page.evaluate(SEED)
    wait_for(page, "window.ordenApp.workspace.active && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(2000)
    page.evaluate("async () => { const ws = window.ordenApp.workspace; const found = ws.notes.find((one) => one.name.startsWith('Pictures')); await ws.openEntry(found.path, { activate: true }) }")
    wait_for(page, "window.ordenApp.workspace.active && document.querySelector('.cm-content')", "the note again")
    page.wait_for_timeout(400)
    return page
def owed(page: Page) -> int:
    return page.evaluate("""() => new Promise((done) => { const asked = indexedDB.open('orden-pictures-owed')
      asked.onupgradeneeded = () => asked.result.createObjectStore('owed', { keyPath: 'hash' })
      asked.onsuccess = () => { const all = asked.result.transaction('owed').objectStore('owed').count()
        all.onsuccess = () => { done(all.result); asked.result.close() }; all.onerror = () => done(-1) }
      asked.onerror = () => done(-1) })""")
def drawn_before_network(page: Page, held: Held, label: str, how: str, selector: str, picture: str) -> None:
    before = len(held.finished)
    page.evaluate(GIVE, [picture, "shot.png", "image/png", how, selector.split(" img")[0]])
    try:
        wait_for(page, f"({DRAWN})({json.dumps(selector)}).some((one) => one === 'blob:')", f"[{label}] the picture", 10)
    except SystemExit:
        wrong(f"[{label}] {how}: the picture was not drawn while its upload had no answer: {page.evaluate(DRAWN, selector)}")
        shot(page, f"{label}-{how}")
        return
    took = page.evaluate("() => Math.round(performance.now() - window.__given)")
    finished = len(held.finished)
    asked = len(held.routes)
    for _ in range(100):
        if held.routes or label != "signed in":
            break
        page.wait_for_timeout(100)
    if finished != before:
        wrong(f"[{label}] {how}: a request finished before the picture was drawn: {held.finished[before:]}")
    elif not held.routes and label == "signed in":
        wrong(f"[{label}] {how}: the picture never started its upload")
    else:
        say(f"ok   [{label}] {how}: drawn from this device in {took} ms, {asked} upload(s) asked by then, none answered")
def canvas(page: Page, held: Held, label: str, picture: str) -> None:
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    page.evaluate(
        "async (path) => { const ws = window.ordenApp.workspace;"
        " await window.ordenApp.tasks().then((t) => t.writeFile(path, JSON.stringify({ nodes: [], edges: [] })));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        f"{root}/Board.canvas",
    )
    wait_for(page, "!![...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length > 0)", f"[{label}] the canvas")
    page.wait_for_timeout(500)
    drawn_before_network(page, held, label, "paste", ".canvas img.picture", picture)
def signed_in(browser: Browser, token: str) -> None:
    page = opened(browser, token)
    held = Held(page)
    drawn_before_network(page, held, "signed in", "paste", ".cm-content img.orden-image", base64.b64encode(png(900, 600)).decode())
    drawn_before_network(page, held, "signed in", "drop", ".cm-content img.orden-image", base64.b64encode(png(300, 200)).decode())
    page.wait_for_timeout(400)
    if owed(page) < 2:
        wrong(f"signed in: the pictures waiting for their upload are not kept on this device ({owed(page)})")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.ordenApp?.workspace?.activeSpace", "the app again")
    page.evaluate("async () => { const ws = window.ordenApp.workspace; const found = ws.notes.find((one) => one.name.startsWith('Pictures')); await ws.openEntry(found.path, { activate: true }) }")
    try:
        wait_for(page, f"({DRAWN})('.cm-content img.orden-image').filter((one) => one === 'blob:').length >= 2", "the pictures after a restart", 20)
        say("ok   signed in: after a restart before the upload, both pictures are drawn from this device")
    except SystemExit:
        wrong(f"signed in: after a restart the pictures were not drawn: {page.evaluate(DRAWN, '.cm-content img.orden-image')}")
        shot(page, "restart")
    held.failing = True
    for route in held.routes:
        try:
            route.fulfill(status=503, body="{}", content_type="application/json")
        except Exception:
            pass
    held.routes = []
    try:
        wait_for(page, "document.querySelectorAll('.cm-content .orden-image-frame.is-owed .orden-image-owed').length >= 1", "the quiet mark", 20)
        broken = page.evaluate("() => document.querySelectorAll('.cm-content .orden-image-frame.is-broken').length")
        if broken:
            wrong(f"signed in: {broken} picture(s) drawn as missing while their upload fails")
        else:
            say("ok   signed in: a failing upload leaves the picture drawn, with a quiet mark")
        shot(page, "owed")
    except SystemExit:
        wrong("signed in: a failing upload shows no mark")
    held.failing = False
    held.release()
    try:
        wait_for(page, "document.querySelectorAll('.cm-content .orden-image-owed').length === 0", "the mark to go", 40)
        page.wait_for_timeout(400)
        left = owed(page)
        if left:
            wrong(f"signed in: {left} picture(s) still owed after the uploads were let through")
        else:
            say("ok   signed in: once the account answers, the uploads land and the mark goes")
    except SystemExit:
        wrong("signed in: the mark stayed after the uploads were let through")
    hashes = page.evaluate("() => [...window.ordenApp.workspace.active.doc.matchAll(/\\/i\\/([0-9a-f]{64})\\.png/g)].map((one) => one[1])")
    for hash in hashes:
        status = page.evaluate("async (hash) => (await fetch(`/i/${hash}.png`)).status", hash)
        if status != 200:
            wrong(f"signed in: the account does not hold {hash[:12]} ({status})")
    if hashes:
        say(f"ok   signed in: the account holds all {len(hashes)} picture(s)")
    held = Held(page)
    canvas(page, held, "signed in", base64.b64encode(png(400, 300)).decode())
    held.release()
    page.context.close()
def signed_out(browser: Browser) -> None:
    page = opened(browser, None)
    held = Held(page)
    drawn_before_network(page, held, "signed out", "paste", ".cm-content img.orden-image", base64.b64encode(png(900, 600)).decode())
    big = base64.b64encode(b"%PDF-1.4\n" + os.urandom(8_000_000)).decode()
    took = page.evaluate(
        """async ([data]) => { const before = window.ordenApp.workspace.active.doc.length
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        const carried = new DataTransfer(); carried.items.add(new File([bytes], 'big.pdf', { type: 'application/pdf' }))
        const target = document.querySelector('.cm-content'); target.focus(); const start = performance.now()
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: carried, bubbles: true, cancelable: true }))
        while (window.ordenApp.workspace.active.doc.length === before && performance.now() - start < 20000) await new Promise((r) => setTimeout(r, 10))
        return Math.round(performance.now() - start) }""",
        [big],
    )
    say(f"     signed out: an 8 MB file is in the note after {took} ms")
    held.release()
    page.context.close()
def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        signed_in(browser, worker.account("pictures@example.com"))
        signed_out(browser)
    return DRIVE.verdict("an inserted picture is drawn before any request answers, and its upload follows")
raise SystemExit(main())
