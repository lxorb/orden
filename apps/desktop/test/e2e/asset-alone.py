import base64
import json
from playwright.sync_api import Browser, Error as PlaywrightError
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
SCRIPT = "document.title = 'ran ' + localStorage.length"
FILES = {
    "/Shared/assets/drawing.svg": ("", f'<svg xmlns="http://www.w3.org/2000/svg"><script>{SCRIPT}</script><rect width="9" height="9"/></svg>'),
    "/Shared/assets/page.html": ("text/html", f"<!doctype html><title>page</title><script>{SCRIPT}</script>"),
    "/Shared/assets/page": ("text/html", f"<!doctype html><title>page</title><script>{SCRIPT}</script>"),
}
PUT = """
async (rows) => {
  const db = await new Promise((done, failed) => {
    const asked = indexedDB.open('orden')
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error)
  })
  await new Promise((done, failed) => {
    const change = db.transaction('assets', 'readwrite')
    for (const row of rows) change.objectStore('assets').put(row)
    change.oncomplete = done
    change.onerror = () => failed(change.error)
  })
  new BroadcastChannel('orden:assets').postMessage({ written: rows.map((row) => row.path), gone: [] })
}
"""
def drive(browser: Browser) -> None:
    context = browser.new_context(service_workers="block")
    page = context.new_page()
    DRIVE.open(page)
    wait_for(page, "window.ordenApp && window.ordenApp.workspace.active", "the app")
    page.evaluate("() => localStorage.setItem('orden:drive-secret', 'kept')")
    page.evaluate(
        PUT,
        [{"path": path, "type": kind, "data": base64.b64encode(body.encode()).decode(), "modified": 1} for path, (kind, body) in FILES.items()],
    )
    for path in FILES:
        wait_for(page, f"window.ordenApp.assetUrl({json.dumps(path)}).startsWith('blob:')", f"{path} to be held")
    shown = page.evaluate("async () => { const pic = new Image(); pic.src = window.ordenApp.assetUrl('/Shared/assets/drawing.svg'); await pic.decode(); return pic.naturalWidth > 0 }")
    if not shown:
        wrong("the drawing no longer shows as a picture in the app")
    for path in FILES:
        kind = page.evaluate("(path) => fetch(window.ordenApp.assetUrl(path)).then((answer) => answer.headers.get('content-type'))", path)
        say(f"{path} is held as {kind!r}")
        if not path.endswith(".svg") and kind != "application/octet-stream":
            wrong(f"{path} is held as {kind!r}, which a browser opens as a page of the app")
        with context.expect_page() as opening:
            page.evaluate("(path) => { window.open(window.ordenApp.assetUrl(path)) }", path)
        alone = opening.value
        try:
            alone.wait_for_timeout(800)
            title = alone.title()
        except PlaywrightError:
            say(f"{path} opened on its own: the browser kept it as a download and showed no page")
            continue
        say(f"{path} opened on its own: {alone.url!r}, title {title!r}")
        if path.endswith(".svg") and not alone.url.startswith("blob:"):
            wrong(f"{path} opened on its own went to {alone.url!r}, so nothing was tried")
        if title.startswith("ran"):
            wrong(f"{path} opened on its own ran its script as the app, which read the app's storage")
        alone.close()
    context.close()
raise SystemExit(DRIVE.run(drive))
