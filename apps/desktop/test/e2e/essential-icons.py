from __future__ import annotations

import json
import sys

from playwright.sync_api import Browser, Page

from harness import Drive, harmless

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PATIENCE = 40

FAVICON = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E"
    "%3Crect width='16' height='16' rx='3' fill='%23ff3e00'/%3E%3C/svg%3E"
)

FILES = {
    "Plan.md": "# Plan\n\nWhat we are doing.\n",
    "Svelte docs.url": f"[InternetShortcut]\nURL=https://svelte.dev/\nOrden-Icon={FAVICON}\n",
    "Paper.pdf": "%PDF-1.4\n%%EOF\n",
    "Board.canvas": '{"nodes":[],"edges":[]}',
    "Reading/Chapter.md": "# Chapter\n\nreading\n",
}

SEED = """
async (files) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/\\/+$/, '')
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('orden')
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
  await ws.loadTree()
  for (const name of ['Plan.md', 'Svelte docs.url', 'Paper.pdf', 'Board.canvas']) {
    ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: `${root}/${name}`, is_dir: false }))
  }
  ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: `${root}/Reading`, is_dir: true }))
  return ws.bookmarks.list.map((one) => `${one.kind}:${one.path}`)
}
"""

FACES = """
() => Object.fromEntries([
  ...[...document.querySelectorAll('.tiles .tile')].map((tile) => [
    tile.getAttribute('aria-label'),
    tile.querySelector('.orden-tile-letter')
      ? 'letter'
      : tile.querySelector('img')
        ? 'picture'
        : tile.querySelector('.orden-tile-face svg')?.innerHTML.length ?? 'none',
  ]),
  ...[...document.querySelectorAll('.bookmarks .row')].map((row) => [
    row.querySelector('.orden-row-label')?.textContent,
    row.querySelector('.mark img')
      ? 'picture'
      : row.querySelector('.mark svg')?.innerHTML.length ?? 'none',
  ]),
])
"""

KEPT = """
(name) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/\\/+$/, '')
  const path = `${root}/${name}`
  return {
    meta: ws.itemMeta.of(path)?.icon ?? null,
    mapped: ws.folderIcons.iconOf(path),
  }
}
"""

TEXT = """
async (name) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/\\/+$/, '')
  return await ws.noteText(`${root}/${name}`)
}
"""

RELOADING: set[Page] = set()


def page_error(page: Page, error: Exception) -> None:
    said = str(error)
    if page in RELOADING and ("Importing a module script failed" in said or "access control checks" in said):
        say(f"(a reload cancelled a load: {said})")
        return
    if harmless(error):
        return
    wrong(f"page error: {error}")


def fresh(browser: Browser) -> Page:
    page = DRIVE.page(browser, errors=False, viewport={"width": 1280, "height": 820}, device_scale_factor=2)
    page.on("pageerror", lambda error: page_error(page, error))
    DRIVE.open(page)
    say(f"kept: {page.evaluate(SEED, FILES)}")
    RELOADING.add(page)
    try:
        page.reload(wait_until="domcontentloaded")
        DRIVE.ready(page)
    finally:
        RELOADING.discard(page)
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    wait_for(page, "document.querySelectorAll('.tiles .tile').length === 4", "the four tiles")
    wait_for(page, "document.querySelectorAll('.bookmarks .row').length === 1", "the folder row")
    page.wait_for_timeout(500)
    return page


def sidebar(page: Page, name: str) -> None:
    box = page.locator("aside").first.bounding_box()
    if box:
        shot(page, name, clip={"x": 0, "y": 0, "width": box["width"] + 1, "height": 260})


def target(page: Page, name: str):
    if name == "Reading":
        return page.locator(".bookmarks .row", has_text="Reading").first
    return page.locator(f'.tiles .tile[aria-label="{name}"]').first


def menu_of(page: Page, name: str) -> list[str]:
    target(page, name).click(button="right")
    page.locator(".menu [role=menuitem]").first.wait_for(state="visible", timeout=PATIENCE * 1000)
    return page.locator(".menu [role=menuitem]").all_inner_texts()


def press(page: Page, name: str, label: str) -> bool:
    said = [one.strip() for one in menu_of(page, name)]
    if label not in said:
        wrong(f"{name}'s menu has no {label}: {said}")
        page.keyboard.press("Escape")
        return False
    page.locator(".menu [role=menuitem]", has_text=label).first.click()
    return True


def pick(page: Page, words: str) -> None:
    page.locator(".sheet input.orden-field").wait_for(state="visible", timeout=PATIENCE * 1000)
    page.locator(".sheet input.orden-field").fill(words)
    cell = page.locator(f'.sheet button[aria-label="{words}"]:has(svg)').first
    cell.wait_for(state="visible", timeout=PATIENCE * 1000)
    cell.click()
    page.locator(".sheet").wait_for(state="hidden", timeout=PATIENCE * 1000)


def drive(browser: Browser) -> None:
    page = fresh(browser)
    before = page.evaluate(FACES)
    say(f"before: {json.dumps(before)}")
    if before.get("Plan") != "letter":
        wrong(f"Plan does not start on its letter: {before.get('Plan')}")
    if before.get("Svelte docs") != "picture":
        wrong(f"the web essential does not start on its site icon: {before.get('Svelte docs')}")
    sidebar(page, "01-before")

    resets = {"Svelte docs": "Reset to site icon"}
    for name in ("Plan", "Svelte docs", "Paper.pdf", "Board", "Reading"):
        if not press(page, name, "Choose an icon"):
            continue
        pick(page, "rocket")
        page.wait_for_timeout(400)
        worn = page.evaluate(FACES)
        say(f"{name} chose rocket: {worn.get(name)}")
        if worn.get(name) == before.get(name) or worn.get(name) in ("letter", "picture", "none"):
            wrong(f"{name} does not wear the chosen icon: {worn.get(name)}")
        sidebar(page, f"02-{name.replace(' ', '-').replace('.', '-').lower()}-chosen")

    plan = page.evaluate(KEPT, "Plan.md")
    if plan["meta"] != "rocket":
        wrong(f"the note's icon is not kept in its synced meta: {plan}")
    if "rocket" not in (page.evaluate(TEXT, "Svelte docs.url") or ""):
        wrong("the web essential's icon is not written into its shortcut")
    paper = page.evaluate(KEPT, "Paper.pdf")
    if paper["mapped"] != "rocket":
        wrong(f"the paper's icon is not kept in the space's synced icons: {paper}")
    reading = page.evaluate(KEPT, "Reading")
    if reading["mapped"] != "rocket":
        wrong(f"the folder's icon is not kept in the space's synced icons: {reading}")

    for name in ("Plan", "Svelte docs", "Paper.pdf", "Board", "Reading"):
        if press(page, name, resets.get(name, "Remove icon")):
            page.wait_for_timeout(400)
    after = page.evaluate(FACES)
    say(f"after: {json.dumps(after)}")
    for name in ("Plan", "Svelte docs", "Paper.pdf", "Board", "Reading"):
        if after.get(name) != before.get(name):
            wrong(f"{name} did not go back to its own face: {after.get(name)} != {before.get(name)}")
    sidebar(page, "03-reset")

    still = [one.strip() for one in menu_of(page, "Plan")]
    page.keyboard.press("Escape")
    if "Remove icon" in still:
        wrong("Plan still offers to remove an icon it no longer wears")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)
    return DRIVE.verdict("every kind of essential chooses, wears and puts down an icon")


if __name__ == "__main__":
    raise SystemExit(main())
