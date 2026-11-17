from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

HINTS_SEEN = "try { localStorage.setItem('orden:hints', JSON.stringify(['sign-in', 'graph', 'palette'])) } catch {}"

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const at = new Date()
  const two = (v) => String(v).padStart(2, '0')
  const today = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  await ws.addSpace('Work')
  await ws.noteFrom('# Plan\\n\\nThe plan.\\n', ws.activeSpace.root)
  await ws.addSpace('Old')
  await ws.noteFrom('# Trip\\n\\nThe mountains, and a lighthouse.\\n', ws.activeSpace.root)
  await ws.loadTree()
  if (ws.panel !== 'tree') ws.showPanel('tree')
  return ws.spaces.map((one) => one.name)
}
"""

HERE = "() => window.ordenApp.workspace.activeSpace?.name ?? null"

SWITCHER_ROWS = """() => [...document.querySelectorAll('.orden-layer.spaces > .line .orden-row-label')]
  .map((one) => one.textContent.trim())"""

ARCHIVED_ROWS = """() => [...document.querySelectorAll('[data-archived-spaces] .orden-row-label')]
  .map((one) => one.textContent.trim())"""

PICKER_ROWS = """() => [...document.querySelectorAll('.picker .orden-row-label')]
  .map((one) => one.textContent.trim())"""

FOUND = """async () => {
  const { search, workspace } = window.ordenApp
  workspace.showPanel('search')
  search.ask('lighthouse')
  await new Promise((done) => setTimeout(done, 900))
  const hits = search.hits.length
  workspace.showPanel('tree')
  return hits
}"""

PALETTE = """() => window.ordenApp.workspace.shownSpaces.map((one) => one.name)"""

def switcher(page: Page) -> None:
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    page.wait_for_timeout(200)
    if not page.locator(".orden-layer.spaces").count():
        page.locator("aside button.name").first.click()
    wait_for(page, "document.querySelector('.orden-layer.spaces')", "the list of spaces")
    page.wait_for_timeout(300)

def closed(page: Page) -> None:
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.orden-layer.spaces')", "the list of spaces closed")

def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820}, color_scheme="light", reduced_motion="reduce"
    )
    context.add_init_script(HINTS_SEEN)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    say(f"the spaces: {page.evaluate(SEED)}")
    if page.evaluate(HERE) != "Old":
        wrong(f"the drive is in {page.evaluate(HERE)!r}, not Old")

    switcher(page)
    page.locator(".orden-layer.spaces > .line").filter(has_text="Old").locator(".more").click()
    wait_for(page, "document.querySelector('[role=menu].menu')", "Old's menu")
    entries = page.locator(".menu [role=menuitem] .orden-row-label").all_inner_texts()
    say(f"Old's menu: {entries}")
    if "Archive" not in entries:
        wrong("Old's menu does not offer Archive")
    page.locator(".menu [role=menuitem]", has_text="Archive").first.click()
    wait_for(page, f"({HERE})() !== 'Old'", "the window to leave Old")
    say(f"the window went to {page.evaluate(HERE)!r}")

    switcher(page)
    rows, archived = page.evaluate(SWITCHER_ROWS), page.evaluate(ARCHIVED_ROWS)
    say(f"the switcher: {rows}, archived {archived}")
    shot(page, "01-archived")
    if "Old" in rows:
        wrong("Old is still among the spaces")
    if archived != ["Old"]:
        wrong(f"the switcher's Archived holds {archived}, not Old")
    closed(page)

    page.keyboard.press("Control+Space")
    wait_for(page, "document.querySelector('.picker[data-spaces-open]')", "Ctrl+Space")
    picker = page.evaluate(PICKER_ROWS)
    say(f"Ctrl+Space: {picker}")
    if "Old" in picker:
        wrong("Ctrl+Space still offers Old")
    page.keyboard.press("Escape")
    if "Old" in page.evaluate(PALETTE):
        wrong("the lists of spaces still hold Old")

    hits = page.evaluate(FOUND)
    say(f"the search for Old's word: {hits} hits")
    if hits:
        wrong(f"the search found {hits} of Old's words")
    if page.evaluate("() => window.ordenApp.workspace.spaces.some((one) => one.name === 'Old')") is not True:
        wrong("Old is gone from the spaces themselves")

    switcher(page)
    page.locator("[data-archived-spaces] .orden-row", has_text="Old").first.click()
    wait_for(page, f"({HERE})() === 'Old'", "Old open again")
    switcher(page)
    rows, archived = page.evaluate(SWITCHER_ROWS), page.evaluate(ARCHIVED_ROWS)
    say(f"the switcher again: {rows}, archived {archived}")
    shot(page, "02-back")
    if rows[-1:] != ["Old"] or archived:
        wrong(f"Old did not come back where it was: {rows}, archived {archived}")
    closed(page)
    hits = page.evaluate(FOUND)
    say(f"the search in Old again: {hits} hits")
    if not hits:
        wrong("the search does not find Old's words once it is back")
    notes = page.evaluate("() => window.ordenApp.workspace.notes.map((one) => one.name)")
    say(f"Old's notes: {json.dumps(notes)}")
    if "Trip.md" not in notes:
        wrong("Old's note is not where it was")

    context.close()

def main() -> int:
    return DRIVE.run(drive, "a whole space is put away out of every list, and comes back")

if __name__ == "__main__":
    raise SystemExit(main())
