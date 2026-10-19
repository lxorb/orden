"""A file is in the Essentials or in the file list, never both (#345).

Emil: "Anything added to Essentials should appear only under Essentials, not in the
explorer's file list as well." So a note, a canvas, a page note and a website each go
from the list to a tile when the row's menu keeps them, come back to the list when the
tile's menu lets them go, and the quick open still finds one kept there - only what is
drawn changes. Seen in light and dark.

Serves the built web app and drives it in Chromium. Run it from the repository root:

    python apps/desktop/test/e2e/essentials-tree.py

Screenshots go beside this file under `shots/essentials-tree/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

# One of each kind the file list draws, and one that stays in the list throughout.
FILES = {
    "Plan.md": "# Plan\n\nWhat we are doing.\n",
    "Board.canvas": '{"nodes":[],"edges":[]}',
    "Lecture.pages": '{"nodes":[{"id":"p1","type":"page","x":-397,"y":0,"width":794,"height":1123}],"edges":[]}',
    "Svelte docs.url": "[InternetShortcut]\nURL=https://svelte.dev/\n",
    "Loose.md": "# Loose\n\nNever kept.\n",
}

SEED = """
async (files) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/\\/+$/, '')
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const now = Date.now()
  await new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    for (const [name, content] of Object.entries(files)) {
      const path = `${root}/${name}`
      change.objectStore('files').put({ path, content, modified: now, created: now })
      change.objectStore('stats').put({ path, modified: now, created: now })
    }
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })
  for (const one of [...ws.bookmarks.list]) ws.bookmarks.toggle(one)
  await ws.loadTree()
  if (ws.panel !== 'tree') ws.showPanel('tree')
}
"""

# The names the file list draws, and the names the Essentials' tiles wear.
LISTED = "() => [...document.querySelectorAll('.row[data-path]')].map((row) => row.dataset.path.split('/').pop())"
TILED = "() => [...document.querySelectorAll('.tiles .tile')].map((tile) => tile.getAttribute('aria-label'))"


def press_row(page: Page, label: str) -> bool:
    row = page.locator("[role=menu] [role=menuitem]", has_text=label).first
    if row.count() < 1:
        page.keyboard.press("Escape")
        return False
    row.click()
    page.wait_for_timeout(400)
    return True


def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    page.evaluate(SEED, FILES)
    wait_for(page, f"() => ({LISTED})().includes('Loose.md')", f"[{scheme}] the seeded list")
    page.wait_for_timeout(400)
    say(f"[{scheme}] listed: {page.evaluate(LISTED)}")
    shot(page, f"{scheme}/01-the-list")

    kept = [name for name in FILES if name != "Loose.md"]
    for name in kept:
        page.locator(f".row[data-path$='/{name}']").first.click(button="right")
        page.wait_for_timeout(300)
        if not press_row(page, "Add to Essentials"):
            wrong(f"[{scheme}] the row of {name} has no Add to Essentials")
            continue
        page.wait_for_timeout(300)
        listed = page.evaluate(LISTED)
        if name in listed:
            wrong(f"[{scheme}] {name} is in the Essentials and still in the file list")
        else:
            say(f"[{scheme}] {name} went from the list to the Essentials")
    tiles = page.evaluate(TILED)
    say(f"[{scheme}] tiles: {tiles}")
    if len(tiles) != len(kept):
        wrong(f"[{scheme}] the Essentials hold {tiles}, not the {len(kept)} kept")
    listed = page.evaluate(LISTED)
    if "Loose.md" not in listed or any(name in listed for name in kept):
        wrong(f"[{scheme}] the list holds {listed}: the note never kept, and none kept")
    shot(page, f"{scheme}/02-all-kept")

    # Only what is drawn: the quick open still finds a note kept in the Essentials.
    for _ in range(2):
        page.keyboard.down("Shift")
        page.keyboard.up("Shift")
        page.wait_for_timeout(60)
    page.wait_for_timeout(400)
    page.keyboard.type("Plan", delay=10)
    page.wait_for_timeout(600)
    found = page.evaluate("() => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)")
    if not any("Plan" in one for one in found):
        wrong(f"[{scheme}] the quick open no longer finds a note in the Essentials ({found[:4]})")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # Let go of from the tile, each is back in the list.
    for index in range(len(kept)):
        tile = page.locator(".tiles .tile").first
        name = tile.get_attribute("aria-label")
        tile.click(button="right")
        page.wait_for_timeout(300)
        if not press_row(page, "Remove from Essentials"):
            wrong(f"[{scheme}] the tile of {name} has no Remove from Essentials")
            break
        page.wait_for_timeout(300)
        say(f"[{scheme}] let go of {name}: listed {page.evaluate(LISTED)}")
    listed = page.evaluate(LISTED)
    for name in FILES:
        if name not in listed:
            wrong(f"[{scheme}] {name}, out of the Essentials, is not back in the list ({listed})")
    if page.evaluate(TILED):
        wrong(f"[{scheme}] tiles are left after every one was let go of")
    shot(page, f"{scheme}/03-all-back")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            drive(browser, scheme)
    return DRIVE.verdict("a file is in the Essentials or in the file list, never both")


if __name__ == "__main__":
    raise SystemExit(main())
