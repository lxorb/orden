import json
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, Playwright
from harness import TYPES, Drive, Files

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
OLD = os.environ.get("ORDEN_OLD_DIST", "")
STATE = {"old": True}
PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
NOTE = "# Kept through the change\n\n![](assets/kept.png)\n"
def former(handler: Files) -> bool:
    if not STATE["old"]:
        return False
    asked = handler.path.split("?")[0].split("#")[0].lstrip("/")
    file = Path(OLD) / (asked or "index.html")
    if not file.is_file():
        return handler.reply("not in the former build", "text/plain; charset=utf-8", 404)
    return handler.reply(file.read_bytes(), TYPES.get(file.suffix, "application/octet-stream"))
WORKERS = "async () => (await navigator.serviceWorker.getRegistrations()).map((one) => one.active?.scriptURL ?? 'installing')"
CACHES = "async () => (await caches.keys()).filter((name) => name === 'orden-pages' || name.startsWith('orden-code-'))"
PUT = """
async (row) => {
  const db = await new Promise((done, failed) => {
    const asked = indexedDB.open('orden')
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error)
  })
  await new Promise((done, failed) => {
    const change = db.transaction('assets', 'readwrite')
    change.objectStore('assets').put(row)
    change.oncomplete = done
    change.onerror = () => failed(change.error)
  })
  db.close()
}
"""
KEPT = """
async (path) => {
  const db = await new Promise((done, failed) => {
    const asked = indexedDB.open('orden')
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error)
  })
  const row = await new Promise((done, failed) => {
    const asked = db.transaction('assets', 'readonly').objectStore('assets').get(path)
    asked.onsuccess = () => done(asked.result ?? null)
    asked.onerror = () => failed(asked.error)
  })
  db.close()
  return row ? row.data : null
}
"""
DRAWN = """
() => {
  const image = document.querySelector('.cm-content img.orden-image')
  return image ? { src: image.src, complete: image.complete, width: image.naturalWidth } : null
}
"""
def until(page: Page, script: str, wanted: Callable[[Any], bool], seconds: float) -> Any:
    found = page.evaluate(script)
    for _ in range(int(seconds * 4)):
        if wanted(found):
            break
        page.wait_for_timeout(250)
        found = page.evaluate(script)
    return found
def drive(play: Playwright) -> None:
    with tempfile.TemporaryDirectory() as profile:
        context = DRIVE.persistent(play, Path(profile), viewport={"width": 1180, "height": 820}, color_scheme="light")
        try:
            page = context.pages[0] if context.pages else context.new_page()
            DRIVE.open(page)
            wait_for(page, "navigator.serviceWorker.controller", "the former worker to take the page over")
            kept = until(page, CACHES, lambda names: "orden-pages" in names and len(names) > 1, 30)
            say(f"the former build: workers {json.dumps(page.evaluate(WORKERS))}, caches {json.dumps(kept)}")
            if "orden-pages" not in kept or len(kept) < 2:
                raise SystemExit(f"the former worker never kept the app, so there is nothing to retire: {kept}")
            root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
            picture = f"{root.rstrip('/')}/assets/kept.png"
            page.evaluate(PUT, {"path": picture, "type": "image/png", "data": PIXEL, "modified": 1})
            DRIVE.seed(page, NOTE)
            DRIVE.settled(page)
            STATE["old"] = False
            say("the server now answers with this build")
            page.reload(wait_until="domcontentloaded")
            DRIVE.ready(page)
            held = until(page, WORKERS, lambda workers: not workers, 30)
            if held:
                wrong(f"the former worker is still registered: {json.dumps(held)}")
            left = until(page, CACHES, lambda names: not names, 10)
            if left:
                wrong(f"what the former worker kept is still there: {json.dumps(left)}")
            page.reload(wait_until="domcontentloaded")
            DRIVE.ready(page)
            if page.evaluate("() => navigator.serviceWorker.controller !== null"):
                wrong("a worker still stands in front of the page after a second load")
            if page.evaluate("() => typeof window.ordenApp.assetUrl !== 'function'"):
                wrong("the page is still the former app")
            say(f"after the change: workers {json.dumps(page.evaluate(WORKERS))}, caches {json.dumps(page.evaluate(CACHES))}")
            if page.evaluate(KEPT, picture) != PIXEL:
                wrong("the attachment is no longer in the browser's store")
            DRIVE.open_note(page, "Kept through")
            doc = page.evaluate("() => window.ordenApp.workspace.active.doc")
            if "assets/kept.png" not in doc:
                wrong(f"the note did not come through: {doc!r}")
            drawn = until(page, DRAWN, lambda image: bool(image and image["src"] and image["complete"]), 15)
            say(f"the attachment in the note: {json.dumps(drawn)}")
            if not drawn or not drawn["src"].startswith("blob:") or not drawn["complete"] or drawn["width"] < 1:
                wrong(f"the attachment does not show from a blob: {drawn}")
            context.set_offline(True)
            try:
                page.reload(wait_until="domcontentloaded", timeout=15000)
                if page.evaluate("() => !!document.querySelector('#app')"):
                    wrong("with no network the browser still serves a kept copy of the app")
            except PlaywrightError as error:
                say(f"with no network the page does not load: {str(error).splitlines()[0]}")
            context.set_offline(False)
        finally:
            context.close()
def main() -> int:
    if not OLD:
        say("SKIPPED: set ORDEN_OLD_DIST to a drive build of a release that still registered the service worker")
        return 0
    if not (Path(OLD) / "sw.js").is_file() or "caches.open" not in (Path(OLD) / "sw.js").read_text(encoding="utf-8"):
        raise SystemExit(f"{OLD} is not a build whose sw.js keeps the app")
    DRIVE.answers(former)
    with DRIVE.session(playwright=True) as play:
        drive(play)
    return DRIVE.verdict("a browser that installed the former app drops its worker and caches, and keeps its notes and files")
raise SystemExit(main())
