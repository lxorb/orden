from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import MOD, Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SHELF = """filters: 'file.inFolder("Reading")'
views:
  - type: table
    name: Everything
    order: [file.name, note.status]
"""

LIBRARY = "# Library\n\n![[Shelf.base]]\n\nAfter the shelf.\n"
DUNE = "---\nstatus: reading\n---\n# Dune\n"

WRITE = """async ([files]) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

IN_TREE = """() => {
  const names = []
  const walk = (entry) => { for (const one of entry?.children ?? []) { names.push(one.name); walk(one) } }
  walk(window.ordenApp.workspace.shownTree)
  return names.includes('Shelf.base')
}"""

ON_DISK = """async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  return await ws.noteText(`${root}/Shelf.base`)
}"""

OPEN = """() => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  return window.tasks.openBaseFile(`${root}/Shelf.base`) ? 'opened' : 'refused'
}"""

BASE_TABS = "() => window.ordenApp.workspace.tabs.filter((one) => one.kind === 'view' && /\\.base$/.test(one.path ?? '')).length"

BLOCK = "() => !!document.querySelector('.base-block')"

ROWS = """() => [...document.querySelectorAll('.palette .orden-row')].map((one) =>
  one.textContent.replace(/\\s+/g, ' ').trim())"""


def commands(page: Page, typed: str) -> list[str]:
    page.keyboard.press(f"{MOD}+Shift+p")
    wait_for(page, "() => !!document.querySelector('.palette input')", "the command palette")
    page.keyboard.type(typed)
    page.wait_for_timeout(400)
    rows: list[str] = page.evaluate(ROWS)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    return rows


def switch(page: Page, on: bool) -> None:
    page.evaluate("() => window.ordenApp.settings.show('general')")
    row = page.locator(".orden-setting", has_text="Databases").first
    row.wait_for()
    row.scroll_into_view_if_needed()
    knob = row.locator("[role=switch]")
    if (knob.get_attribute("aria-checked") == "true") == on:
        wrong(f"the switch is already {'on' if on else 'off'}")
    knob.click()
    page.wait_for_timeout(400)
    if (knob.get_attribute("aria-checked") == "true") != on:
        wrong("the switch did not move")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def off(page: Page, when: str) -> None:
    if page.evaluate(IN_TREE):
        wrong(f"[{when}] Shelf.base is in the file tree while databases are off")
    if page.evaluate(OPEN) != "refused":
        wrong(f"[{when}] a .base file opened while databases are off")
    if page.evaluate(BASE_TABS):
        wrong(f"[{when}] a database tab is open while databases are off")
    DRIVE.open_note(page, "Library")
    page.wait_for_timeout(800)
    if page.evaluate(BLOCK):
        wrong(f"[{when}] the embedded database shows in the note while databases are off")
    rows = commands(page, "new database")
    if any("New database" in one for one in rows):
        wrong(f"[{when}] the palette offers New database while databases are off: {rows[:3]}")
    say(f"[{when}] nothing of databases shows; palette: {rows[:2]}")


def on(page: Page) -> None:
    wait_for(page, IN_TREE, "Shelf.base back in the file tree")
    DRIVE.open_note(page, "Library")
    wait_for(page, BLOCK, "the embedded database in the note")
    wait_for(
        page,
        "() => document.querySelector('.base-block')?.textContent.includes('Dune')",
        "Dune as a row of the embedded database",
    )
    rows = commands(page, "new database")
    if not any("New database" in one for one in rows):
        wrong(f"the palette does not offer New database once databases are on: {rows[:3]}")
    if page.evaluate(OPEN) != "opened":
        wrong("Shelf.base does not open once databases are on")
    wait_for(
        page,
        "() => [...document.querySelectorAll('.view-tab .line')].some((one) => one.textContent.includes('Dune'))",
        "Dune in the Shelf.base tab",
    )
    quiet(page)
    DRIVE.shot(page, "on")
    say("databases on: in the tree, embedded, in the palette and opened")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.ordenApp.tasks() }")
    page.evaluate(WRITE, [[["Reading/Dune.md", DUNE], ["Library.md", LIBRARY], ["Shelf.base", SHELF]]])
    wait_for(page, "() => window.tasks.rows.of().some((one) => one.path === 'Reading/Dune.md')", "the seeded rows")

    if page.evaluate("() => JSON.parse(localStorage.getItem('orden:hidden-kinds') ?? '[]')").count("shown-bases"):
        wrong("databases start on")
    off(page, "first run")
    quiet(page)
    DRIVE.shot(page, "off")

    switch(page, True)
    on(page)

    switch(page, False)
    wait_for(page, f"() => ({BASE_TABS})() === 0", "the database tab closed when turned off")
    off(page, "turned off")
    kept = page.evaluate(ON_DISK)
    if kept != SHELF:
        wrong(f"Shelf.base changed on disk while off: {json.dumps(kept)}")

    page.reload()
    wait_for(page, "window.ordenApp?.tasks", "the app after a reload")
    page.evaluate("async () => { window.tasks = await window.ordenApp.tasks() }")
    wait_for(
        page,
        "() => window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Library'))",
        "the notes after a reload",
    )
    wait_for(
        page,
        """() => {
          const ws = window.ordenApp.workspace
          const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
          return window.ordenApp.links.targetOf(`${root}/Library.md`, { kind: 'wikilink', target: 'Shelf.base' }) !== null
        }""",
        "the link index after a reload",
    )
    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          for (const tab of ws.tabs.filter((one) => one.kind === 'note')) await ws.closeAsking(tab.id)
        }"""
    )
    off(page, "after a reload")

    switch(page, True)
    on(page)
    if page.evaluate(ON_DISK) != SHELF:
        wrong("Shelf.base came back changed")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "databases stay out of sight until turned on, and come back whole"))
