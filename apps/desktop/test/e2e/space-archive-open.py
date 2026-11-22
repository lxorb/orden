import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
SEED = """
async () => {
  const ws = window.ordenApp.workspace
  for (const [space, note] of [['Work', 'Plan'], ['Home', 'Chores'], ['Spare', 'Box'], ['Old', 'Trip']]) {
    await ws.addSpace(space)
    await ws.noteFrom(`# ${note}\\n\\nThe ${note.toLowerCase()}, and a lighthouse.\\n`, ws.activeSpace.root)
    await ws.loadTree()
    await ws.openEntry(ws.notes.find((one) => one.name.startsWith(note)).path, { activate: true })
  }
  await ws.showSpace(ws.spaces.find((one) => one.name === 'Work').id)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  return ws.spaces.map((one) => one.name)
}
"""
STATE = """() => {
  const ws = window.ordenApp.workspace
  return { space: ws.activeSpace?.name ?? null, shown: ws.shownSpaces.map((one) => one.name),
    here: ws.tabs.filter((one) => ws.panes.at(one.paneId)).map((one) => one.name),
    notes: ws.notes.map((one) => one.name) }
}"""
HERE = "() => window.ordenApp.workspace.activeSpace?.name ?? null"
ARCHIVE = "(name) => { const ws = window.ordenApp.workspace; ws.archivedSpaces.set(ws.spaces.find((one) => one.name === name).root, true) }"
SHOW = "(name) => { const ws = window.ordenApp.workspace; return ws.showSpace(ws.spaces.find((one) => one.name === name).id) }"
REVEAL = """(name) => {
  const ws = window.ordenApp.workspace
  const tab = ws.tabs.find((one) => one.name.startsWith(name))
  if (tab) ws.activeTabId = tab.id
  return !!tab
}"""
SWITCHER_ROWS = """() => [...document.querySelectorAll('.orden-layer.spaces > .line .orden-row-label')]
  .map((one) => one.textContent.trim())"""
SHEET = "[role=region][aria-label=Settings]"
PICKER_ROWS = """() => [...document.querySelectorAll('.picker .orden-row-label')]
  .map((one) => one.textContent.trim())"""
PALETTE_ROWS = "() => [...document.querySelectorAll('.palette ul li')].map((one) => one.textContent.trim())"
def switcher(page: Page) -> list[str]:
    if not page.locator(".orden-layer.spaces").count():
        page.locator("aside button.name").first.click()
    wait_for(page, "document.querySelector('.orden-layer.spaces')", "the list of spaces")
    page.wait_for_timeout(300)
    rows = page.evaluate(SWITCHER_ROWS)
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.orden-layer.spaces')", "the list of spaces closed")
    return rows
def open_from_settings(page: Page, name: str) -> None:
    page.evaluate("() => window.ordenApp.settings.show('archived')")
    wait_for(page, f"document.querySelector('{SHEET} [data-archived-spaces]')", "Settings' Archived spaces")
    page.wait_for_timeout(300)
    text = page.locator(SHEET).inner_text()
    if "stay out of the space switcher" in text:
        wrong("the Archived spaces section still has the hint")
    shot(page, "01-section")
    page.locator(f"{SHEET} [data-archived-spaces] .row", has_text=name).get_by_role("button", name="Open").click()
    wait_for(page, f"({HERE})() === '{name}'", f"{name} open")
    page.wait_for_timeout(500)
    if page.locator(SHEET).count():
        page.evaluate("() => (window.ordenApp.settings.open = false)")
        page.wait_for_timeout(300)
def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, color_scheme="light", reduced_motion="reduce")
    a = context.new_page()
    a.on("pageerror", lambda error: wrong(f"A: {error}"))
    DRIVE.open(a)
    say(f"the spaces: {a.evaluate(SEED)}")
    a.evaluate(ARCHIVE, "Old")
    a.wait_for_timeout(500)
    say(f"Old archived: {json.dumps(a.evaluate(STATE))}")
    open_from_settings(a, "Old")
    state = a.evaluate(STATE)
    say(f"Old opened: {json.dumps(state)}")
    button = a.locator("aside button.name").first.inner_text()
    say(f"the space button: {button!r}")
    shot(a, "02-open")
    if "Old" not in button:
        wrong(f"the space button does not name Old: {button!r}")
    if not any(one.startswith("Trip") for one in state["here"]):
        wrong("Old's tab Trip is not shown")
    if not any(one.startswith("Trip") for one in state["notes"]):
        wrong("Old's notes are not in the sidebar")
    if a.evaluate("() => window.ordenApp.workspace.archivedSpaces.has(window.ordenApp.workspace.activeSpace.root)") is not True:
        wrong("Open unarchived Old")
    b = context.new_page()
    b.on("pageerror", lambda error: wrong(f"B: {error}"))
    b.goto(a.url)
    DRIVE.ready(b)
    b.wait_for_timeout(1000)
    b.evaluate(ARCHIVE, "Spare")
    a.wait_for_timeout(2500)
    state = a.evaluate(STATE)
    say(f"A after B archived Spare: {json.dumps(state)}")
    if state["space"] != "Old":
        wrong(f"A was thrown out of Old when B archived Spare: {state['space']!r}")
    if not a.evaluate(REVEAL, "Trip") or a.evaluate(HERE) != "Old":
        wrong("Old's tab is refused while Old is open")
    a.evaluate(SHOW, "Work")
    wait_for(a, f"({HERE})() === 'Work'", "Work open")
    a.wait_for_timeout(500)
    rows = switcher(a)
    say(f"the switcher after leaving Old: {rows}")
    shot(a, "03-left")
    if "Old" in rows:
        wrong("Old is listed again after switching away")
    a.keyboard.press("Control+Space")
    wait_for(a, "document.querySelector('.picker[data-spaces-open]')", "Ctrl+Space")
    picker = a.evaluate(PICKER_ROWS)
    say(f"Ctrl+Space: {picker}")
    if "Old" in picker:
        wrong("Ctrl+Space offers Old after switching away")
    a.keyboard.press("Escape")
    a.keyboard.press("Control+Shift+P")
    wait_for(a, "() => !!document.querySelector('.palette input')", "the palette")
    a.keyboard.type("Trip")
    a.wait_for_timeout(600)
    offered = a.evaluate(PALETTE_ROWS)
    say(f"the palette on Trip: {offered}")
    a.keyboard.press("Escape")
    a.evaluate(REVEAL, "Trip")
    a.wait_for_timeout(600)
    if a.evaluate(HERE) != "Work":
        wrong(f"revealing Old's tab after leaving it opened {a.evaluate(HERE)!r}")
    open_from_settings(a, "Old")
    a.reload()
    DRIVE.ready(a)
    a.wait_for_timeout(1500)
    state = a.evaluate(STATE)
    say(f"A reloaded while Old was open: {json.dumps(state)}")
    if state["space"] == "Old" and "Old" not in state["shown"]:
        wrong("the reload left A in Old without listing it")
    if state["space"] != "Old" and any(one.startswith("Trip") for one in state["here"]):
        wrong(f"the reload put A in {state['space']} but still shows Old's tab Trip")
    a.evaluate(SHOW, "Home")
    wait_for(a, f"({HERE})() === 'Home'", "Home open")
    b.evaluate(ARCHIVE, "Home")
    wait_for(a, f"({HERE})() !== 'Home'", "A to leave Home when B archives it", 10)
    say(f"A after B archived Home: {a.evaluate(HERE)!r}")
    context.close()
def main() -> int:
    return DRIVE.run(drive, "an archived space opened from Settings is shown until the window leaves it")
raise SystemExit(main())
