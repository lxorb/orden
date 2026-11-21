import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
MARKS = {
    "chat": ".ask.wide",
    "canvas": ".canvas.orden-host",
    "note": '.editor[data-region="editor"]',
}
ARRANGE = """async () => {
  const ws = window.ordenApp.workspace
  const here = ws.activeSpace
  await ws.noteFrom('# Plan\\n\\nWhat we are doing.\\n', here.root)
  const other = await ws.addSpace('Other')
  await ws.noteFrom('# Food\\n\\nWhat to buy.\\n', other.root)
  await ws.showSpace(here.id)
  await ws.loadTree()
  for (const tab of [...ws.tabs]) ws.close(tab.id, false)
  await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Plan')).path, { activate: true })
  const note = ws.active.id
  await ws.newCanvas()
  const canvas = ws.active.id
  const chat = ws.openChat()
  await ws.showSpace(other.id)
  await ws.loadTree()
  await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Food')).path, { activate: true })
  const food = ws.active.id
  return { here: here.id, other: other.id, note, canvas, chat, food }
}"""
SEEN = """(marks) => {
  const ws = window.ordenApp.workspace
  const card = document.querySelector(`[data-pane="${ws.panes.focusedId}"] .card`)
  if (!card) return []
  return Object.entries(marks)
    .filter(([, mark]) => [...card.querySelectorAll(mark)].some((one) => one.checkVisibility()))
    .map(([kind]) => kind)
}"""
def shows(page: Page, want: str, what: str) -> None:
    seen = []
    for _ in range(40):
        seen = page.evaluate(SEEN, MARKS)
        if seen == [want]:
            say(f"[{what}] the pane shows the {want}")
            return
        page.wait_for_timeout(100)
    wrong(f"[{what}] the {want} is in front but the pane shows {seen}")
    DRIVE.shot(page, f"wrong-{what.replace(' ', '-')}")
def drive(browser: Browser) -> None:
    page: Page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    ids = page.evaluate(ARRANGE)
    say(f"made {json.dumps(ids)}")
    for turn in range(4):
        page.evaluate(f"() => window.ordenApp.workspace.showSpace({json.dumps(ids['here'])})")
        page.wait_for_timeout(400)
        page.evaluate(f"() => window.ordenApp.workspace.showSpace({json.dumps(ids['other'])})")
        page.wait_for_timeout(400)
    page.evaluate(f"() => window.ordenApp.workspace.activate({json.dumps(ids['chat'])})")
    wait_for(page, f"window.ordenApp.workspace.active?.id === {json.dumps(ids['chat'])}", "the chat in front, from the other space")
    shows(page, "chat", "the chat reached from the other space")
    page.locator(f'button.pick[data-tab="{ids["canvas"]}"]').first.click()
    wait_for(page, f"window.ordenApp.workspace.active?.id === {json.dumps(ids['canvas'])}", "the canvas picked")
    shows(page, "canvas", "the canvas tab clicked")
    page.locator(f'button.pick[data-tab="{ids["note"]}"]').first.click()
    shows(page, "note", "the note tab clicked")
    page.locator(f'button.pick[data-tab="{ids["chat"]}"]').first.click()
    shows(page, "chat", "the chat tab clicked")
    for turn in range(3):
        page.evaluate(f"() => window.ordenApp.workspace.showSpace({json.dumps(ids['other'])})")
        page.wait_for_timeout(300)
        page.evaluate(f"() => window.ordenApp.workspace.showSpace({json.dumps(ids['here'])})")
        page.wait_for_timeout(300)
        page.locator(f'button.pick[data-tab="{ids["canvas"]}"]').first.click()
        shows(page, "canvas", f"the canvas after space switch {turn}")
        page.locator(f'button.pick[data-tab="{ids["chat"]}"]').first.click()
        shows(page, "chat", f"the chat after space switch {turn}")
    by_overview(page, ids)
def through_overview(page: Page, label: str) -> None:
    page.keyboard.press("Alt")
    page.wait_for_timeout(60)
    page.keyboard.press("Alt")
    wait_for(page, "document.documentElement.hasAttribute('data-overview')", "the overview")
    page.wait_for_timeout(900)
    names = page.evaluate("() => [...document.querySelectorAll('.canvas .window')].map((one) => one.getAttribute('aria-label'))")
    say(f"the overview shows {names}")
    tile = page.locator(f'.canvas .window[aria-label="{label}"]').first
    if tile.count() == 0:
        wrong(f"no window called {label!r} in the overview: {names}")
        page.keyboard.press("Escape")
        return
    tile.click()
    wait_for(page, "!document.documentElement.hasAttribute('data-overview')", "the overview gone")
    page.wait_for_timeout(600)
def by_overview(page: Page, ids: dict) -> None:
    names = page.evaluate(f"() => {{ const ws = window.ordenApp.workspace; return Object.fromEntries({json.dumps(list(ids.items()))}.filter(([k]) => !['here', 'other'].includes(k)).map(([k, id]) => [k, ws.tabs.find((one) => one.id === id)?.shown])) }}")
    say(f"names {names}")
    for turn in range(4):
        through_overview(page, names["food"])
        through_overview(page, names["note"])
    through_overview(page, names["food"])
    through_overview(page, names["chat"])
    shows(page, "chat", "the chat reached through the overview")
    page.locator(f'button.pick[data-tab="{ids["canvas"]}"]').first.click()
    wait_for(page, f"window.ordenApp.workspace.active?.id === {json.dumps(ids['canvas'])}", "the canvas picked")
    shows(page, "canvas", "the canvas tab clicked after the overview")
    page.locator(f'button.pick[data-tab="{ids["note"]}"]').first.click()
    shows(page, "note", "the note tab clicked after the overview")
raise SystemExit(DRIVE.run(drive, "a pane shows the tab in front after its space was left and come back to"))
