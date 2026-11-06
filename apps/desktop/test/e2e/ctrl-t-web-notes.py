from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

FILES = {
    "Svelte docs.url": "[InternetShortcut]\nURL=https://svelte.dev/docs/kit\n",
    "Moodle.url": "[InternetShortcut]\nURL=https://moodle-app2.let.ethz.ch/my/\n",
    "Plan.md": "# Plan\n\nNothing to do with the web.\n",
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
  await ws.loadTree()
  return ws.files.map((one) => one.name)
}
"""

STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    tabs: ws.tabs.length,
    active: ws.active?.path?.split('/').pop() ?? null,
    newTab: !!ws.active && ws.isNewTab(ws.active),
  }
}
"""

SPY = """
() => {
  const ws = window.nibApp.workspace
  window.__asked = []
  ws.chosenOn = (id) => window.__asked.push(`chosen on ${id}`)
  ws.openEntry = (path) => { window.__asked.push(path); return Promise.resolve() }
}
"""

ROWS = """
() => [...document.querySelectorAll('[role="option"]')].map((one) => ({
  words: one.querySelector('.words')?.textContent.trim().replace(/\\s+/g, ' '),
  badge: one.querySelector('.badge')?.textContent ?? null,
  marked: [...one.querySelectorAll('.matched')].map((hit) => hit.textContent).join(''),
}))
"""

def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)

def new_tab(page: Page) -> None:
    page.keyboard.press("Control+KeyT")
    wait_for(page, f"({STATE})().newTab", "a new tab")
    page.wait_for_timeout(300)

def typed(page: Page, letters: str) -> list[dict]:
    page.keyboard.type(letters, delay=20)
    page.wait_for_timeout(300)
    return page.evaluate(ROWS)

def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, color_scheme=scheme, viewport={"width": 1180, "height": 760})
    DRIVE.open(page)
    say(f"[{scheme}] the space holds {page.evaluate(SEED, FILES)}")
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    page.wait_for_timeout(800)

    new_tab(page)
    rows = typed(page, "svel")
    say(f"[{scheme}] 'svel' -> {rows}")
    first = rows[0] if rows else {}
    check(f"[{scheme}] a web note is found by its name", "Svelte docs" in (first.get("words") or ""))
    check(f"[{scheme}] and marked as saved", first.get("badge") == "Saved")
    check(f"[{scheme}] with the letters typed drawn stronger", first.get("marked") == "Svel")
    shot(page, f"{scheme}-by-name")

    page.keyboard.press("Control+KeyA")
    rows = typed(page, "ethz modle")
    say(f"[{scheme}] 'ethz modle' -> {rows}")
    check(
        f"[{scheme}] and by its address, with a slip",
        bool(rows) and "Moodle" in (rows[0].get("words") or ""),
    )
    shot(page, f"{scheme}-by-address")

    page.evaluate(SPY)
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    wait_for(page, "window.__asked.length >= 2", "the field to ask for the note")
    asked = page.evaluate("() => window.__asked")
    say(f"[{scheme}] Enter asked: {asked}")
    check(
        f"[{scheme}] Enter opens the note in the new tab's place",
        asked[0].startswith("chosen on ") and asked[1].endswith("/Moodle.url"),
    )
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser, "light")
        drive(browser, "dark")

    return DRIVE.verdict("Ctrl+T finds the space's web notes and opens them")

if __name__ == "__main__":
    raise SystemExit(main())
