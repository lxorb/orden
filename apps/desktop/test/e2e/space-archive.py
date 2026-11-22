import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
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
SHEET = "[role=region][aria-label=Settings]"
IN_SWITCHER = "() => !!document.querySelector('.orden-layer.spaces [data-archived-spaces]')"
ARCHIVED_ROWS = f"""() => [...document.querySelectorAll('{SHEET} [data-archived-spaces] .row .name')]
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
PALETTE_ROWS = "() => [...document.querySelectorAll('.palette ul li')].map((one) => one.textContent.trim())"
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
def palette(page: Page, typed: str) -> None:
    page.keyboard.press("Control+Shift+P")
    wait_for(page, "() => !!document.querySelector('.palette input')", "the palette")
    page.keyboard.type(typed)
    page.wait_for_timeout(500)
def section(page: Page) -> list[str]:
    if page.locator(".orden-layer.spaces").count():
        closed(page)
    page.evaluate("() => window.ordenApp.settings.show('archived')")
    wait_for(page, f"!!document.querySelector('{SHEET}')", "Settings")
    wait_for(page, f"document.querySelector('{SHEET} [data-archived-spaces]')", "Settings' Archived spaces")
    page.wait_for_timeout(300)
    archived = page.evaluate(ARCHIVED_ROWS)
    say(f"Settings' Archived spaces: {archived}")
    return archived
def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820}, color_scheme="light", reduced_motion="reduce"
    )
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
    rows = page.evaluate(SWITCHER_ROWS)
    say(f"the switcher: {rows}")
    shot(page, "01-archived")
    if "Old" in rows:
        wrong("Old is still among the spaces")
    if page.evaluate(IN_SWITCHER):
        wrong("the switcher still lists the archived spaces")
    if "Old" in page.locator(".orden-layer.spaces").inner_text():
        wrong("the switcher still names Old")
    closed(page)
    page.keyboard.press("Control+Space")
    wait_for(page, "document.querySelector('.picker[data-spaces-open]')", "Ctrl+Space")
    picker = page.evaluate(PICKER_ROWS)
    say(f"Ctrl+Space: {picker}")
    if "Old" in picker:
        wrong("Ctrl+Space still offers Old")
    page.keyboard.press("Escape")
    palette(page, "space")
    offered = page.evaluate(PALETTE_ROWS)
    say(f"the palette on space: {offered}")
    if not [one for one in offered if "Space: Work" in one]:
        wrong(f"the palette does not offer the space Work: {offered}")
    if [one for one in offered if "Old" in one]:
        wrong(f"the palette still offers Old: {offered}")
    page.keyboard.press("Escape")
    hits = page.evaluate(FOUND)
    say(f"the search for Old's word: {hits} hits")
    if hits:
        wrong(f"the search found {hits} of Old's words")
    if page.evaluate("() => window.ordenApp.workspace.spaces.some((one) => one.name === 'Old')") is not True:
        wrong("Old is gone from the spaces themselves")
    archived = section(page)
    shot(page, "02-section")
    if archived != ["Old"]:
        wrong(f"Settings' Archived spaces holds {archived}, not Old")
    page.locator(f"{SHEET} [data-archived-spaces] .row", has_text="Old").get_by_role("button", name="Unarchive").click()
    wait_for(page, f"!document.querySelector('{SHEET} [data-archived-spaces]')", "Old to leave Archived spaces")
    page.evaluate("() => (window.ordenApp.settings.open = false)")
    switcher(page)
    rows = page.evaluate(SWITCHER_ROWS)
    say(f"the switcher again: {rows}")
    shot(page, "03-back")
    if rows[-1:] != ["Old"]:
        wrong(f"Old did not come back where it was: {rows}")
    page.locator(".orden-layer.spaces > .line", has_text="Old").first.locator(".orden-row").click()
    wait_for(page, f"({HERE})() === 'Old'", "Old open again")
    hits = page.evaluate(FOUND)
    say(f"the search in Old again: {hits} hits")
    if not hits:
        wrong("the search does not find Old's words once it is back")
    notes = page.evaluate("() => window.ordenApp.workspace.notes.map((one) => one.name)")
    say(f"Old's notes: {json.dumps(notes)}")
    if "Trip.md" not in notes:
        wrong("Old's note is not where it was")
    switcher(page)
    page.locator(".orden-layer.spaces > .line").filter(has_text="Old").locator(".more").click()
    wait_for(page, "document.querySelector('[role=menu].menu')", "Old's menu again")
    page.locator(".menu [role=menuitem]", has_text="Archive").first.click()
    wait_for(page, f"({HERE})() !== 'Old'", "the window to leave Old again")
    if section(page) != ["Old"]:
        wrong("Old archived again is not in Settings' Archived spaces")
    page.locator(f"{SHEET} [data-archived-spaces] .row", has_text="Old").get_by_role("button", name="Delete").click()
    wait_for(page, "document.querySelector('[role=dialog] .orden-button')", "the question before deleting Old")
    asked = page.locator("[role=dialog]").last.inner_text()
    say(f"asked: {asked!r}")
    if "Delete Old?" not in asked:
        wrong(f"deleting Old asks {asked!r}, not the space's own question")
    page.locator("[role=dialog] .orden-button", has_text="Delete").last.click()
    wait_for(
        page,
        "() => !window.ordenApp.workspace.spaces.some((one) => one.name === 'Old')",
        "Old deleted",
    )
    wait_for(page, f"!document.querySelector('{SHEET} [data-archived-spaces]')", "Archived spaces empty")
    shot(page, "04-deleted")
    if page.evaluate("() => window.ordenApp.workspace.archivedSpaces.roots.length"):
        wrong("Old's archive mark outlived the space")
    page.evaluate("() => (window.ordenApp.settings.open = false)")
    switcher(page)
    rows = page.evaluate(SWITCHER_ROWS)
    say(f"the switcher after the delete: {rows}")
    if "Old" in rows:
        wrong("Old is still in the switcher after it was deleted")
    closed(page)
    context.close()
def main() -> int:
    return DRIVE.run(drive, "a whole space is put away out of every list into Settings, and comes back or goes")
raise SystemExit(main())
