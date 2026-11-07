from __future__ import annotations

import base64

from playwright.sync_api import Browser

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
    const asked = indexedDB.open('nib')
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error)
  })
  await new Promise((done, failed) => {
    const change = db.transaction('assets', 'readwrite')
    for (const row of rows) change.objectStore('assets').put(row)
    change.oncomplete = done
    change.onerror = () => failed(change.error)
  })
}
"""

def drive(browser: Browser) -> None:
    context = browser.new_context(service_workers="allow")
    page = context.new_page()
    DRIVE.open(page)
    wait_for(page, "window.nibApp && window.nibApp.workspace.active", "the app")
    wait_for(page, "navigator.serviceWorker.controller", "the asset worker")
    page.evaluate("() => localStorage.setItem('nib:drive-secret', 'kept')")
    page.evaluate(
        PUT,
        [{"path": path, "type": kind, "data": base64.b64encode(body.encode()).decode(), "modified": 1} for path, (kind, body) in FILES.items()],
    )

    shown = page.evaluate("async () => { const pic = new Image(); pic.src = '/asset/Shared/assets/drawing.svg'; await pic.decode(); return pic.naturalWidth > 0 }")
    if not shown:
        wrong("the drawing no longer shows as a picture in the app")

    for path in FILES:
        alone = context.new_page()
        alone.goto(f"{DRIVE.origin}/asset{path}")
        alone.wait_for_timeout(800)
        title = alone.title()
        say(f"{path} opened on its own: title {title!r}")
        if title.startswith("ran"):
            wrong(f"{path} opened on its own ran its script as the app, which read the app's storage")
        alone.close()
    context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
