import itertools
import json
import random
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
MARKS = {
    "terminal": ".terminal",
    "web": ".web",
    "todos": "[data-todos-board]",
    "settings": '[role="region"][aria-label="Settings"]',
    "canvas": ".canvas.orden-host",
    "pages": ".pages",
    "note": '.editor[data-region="editor"]',
}
OPEN = """async () => {
  const app = window.ordenApp
  const ws = app.workspace
  const root = ws.activeSpace.root
  const ids = {}
  for (const name of ['Kestrel', 'Merlin']) {
    await ws.noteFrom(`# ${name}\\n\\nA ${name} hangs on the wind.\\n`, root)
    await ws.loadTree()
    await ws.openEntry(ws.notes.find((one) => one.name.startsWith(name)).path, { activate: true })
    ids[name] = ws.active.id
  }
  await ws.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'front' }), 'Shell', null, true)
  ids.terminal = ws.active.id
  ws.openPage('http://127.0.0.1:9/')
  ids.web = ws.active.id
  await (await app.tasks()).openTodos()
  ids.todos = ws.active.id
  await ws.newCanvas()
  ids.canvas = ws.active.id
  await ws.createPages(undefined, 'Front.pages')
  ids.pages = ws.active.id
  app.settings.show('general')
  ids.settings = ws.active.id
  return ids
}"""
SEEN = """(marks) => {
  const ws = window.ordenApp.workspace
  const pane = document.querySelector(`[data-pane="${ws.panes.focusedId}"] .card`)
  if (!pane) return { at: null, shown: [] }
  const box = pane.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  const kindOf = (node) => {
    for (const [kind, mark] of Object.entries(marks)) if (node?.closest(mark)) return kind
    return null
  }
  const shown = Object.entries(marks)
    .filter(([, mark]) => [...pane.querySelectorAll(mark)].some((one) => one.checkVisibility()))
    .map(([kind]) => kind)
  return { at: kindOf(hit), shown, front: ws.active?.id ?? null }
}"""
def kind_of(name: str) -> str:
    return "note" if name in ("Kestrel", "Merlin") else name
EVERY = """(marks) => {
  const ws = window.ordenApp.workspace
  return ws.panes.all.map((pane) => {
    const card = document.querySelector(`[data-pane="${pane.id}"] .card`)
    const tab = ws.showing(pane.id)
    const shown = card
      ? Object.entries(marks)
          .filter(([, mark]) => [...card.querySelectorAll(mark)].some((one) => one.checkVisibility()))
          .map(([kind]) => kind)
      : []
    return { pane: pane.id, kind: tab?.kind ?? null, todos: !!tab && tab.kind === 'view' && tab.path === null, shown }
  })
}"""
STEPS = [
    "() => { const ws = window.ordenApp.workspace; const all = ws.tabsIn(ws.panes.focusedId); const one = all[Math.floor(Math.random() * all.length)]; if (one) ws.activate(one.id) }",
    "() => { const ws = window.ordenApp.workspace; const one = ws.notes[Math.floor(Math.random() * ws.notes.length)]; if (one) return ws.openEntry(one.path, { activate: true }) }",
    "() => window.ordenApp.workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'f' + Math.random() }), 'Shell', null, true)",
    "() => { window.ordenApp.workspace.openPage('http://127.0.0.1:9/' + Math.floor(Math.random() * 9)) }",
    "() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())",
    "() => { const ws = window.ordenApp.workspace; const all = ws.tabsIn(ws.panes.focusedId); if (all.length > 2) ws.close(all[Math.floor(Math.random() * all.length)].id, false) }",
    "() => { const ws = window.ordenApp.workspace; if (ws.panes.all.length < 3) ws.split(Math.random() < 0.5 ? 'row' : 'column') }",
    "() => { const ws = window.ordenApp.workspace; const all = ws.panes.all; ws.focusPane(all[Math.floor(Math.random() * all.length)].id) }",
    "() => { const ws = window.ordenApp.workspace; const all = ws.panes.all; const tab = ws.active; const to = all.find((one) => one.id !== ws.panes.focusedId); if (tab && to && ws.tabsIn(tab.paneId).length > 1) ws.moveTab(tab.id, to.id) }",
    "() => { const ws = window.ordenApp.workspace; if (Math.random() < 0.3) ws.collapsePanes() }",
    "() => window.ordenApp.settings.show('general')",
]
def every(page: Page, step: int, what: str) -> bool:
    for _ in range(30):
        bad = [one for one in page.evaluate(EVERY, MARKS) if not fits(one)]
        if not bad:
            return True
        page.wait_for_timeout(100)
    wrong(f"[fuzz {step}: {what[:60]}] {bad}")
    DRIVE.shot(page, f"fuzz-{step}")
    return False
def fits(one: dict) -> bool:
    kind = "todos" if one["todos"] else one["kind"]
    if kind is None:
        return one["shown"] == []
    if kind == "settings":
        return one["shown"] == ["settings"]
    if kind not in MARKS:
        return all(mark not in one["shown"] for mark in ("note", "terminal", "web"))
    return one["shown"] == [kind]
def settle(page: Page, name: str, how: str) -> None:
    want = kind_of(name)
    seen = {}
    for _ in range(40):
        seen = page.evaluate(SEEN, MARKS)
        if seen["at"] == want and seen["shown"] == [want]:
            return
        page.wait_for_timeout(100)
    wrong(f"[{how}] {name} is in front but the pane shows {seen.get('shown')}, with {seen.get('at')} at its middle")
    DRIVE.shot(page, f"wrong-{how}-{name}")
def drive(browser: Browser) -> None:
    page: Page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    page.route("http://127.0.0.1:9/**", lambda route: route.fulfill(body="<p>page</p>", content_type="text/html"))
    ids = page.evaluate(OPEN)
    say(f"tabs {json.dumps(ids)}")
    names = list(ids)
    order = [one for pair in itertools.permutations(names, 2) for one in pair]
    for name in order:
        page.evaluate(f"window.ordenApp.workspace.activate({json.dumps(ids[name])})")
        wait_for(page, f"window.ordenApp.workspace.active?.id === {json.dumps(ids[name])}", f"{name} in front")
        settle(page, name, "activate")
    for name in order[:30]:
        page.locator(f'button.pick[data-tab="{ids[name]}"]').first.click()
        wait_for(page, f"window.ordenApp.workspace.active?.id === {json.dumps(ids[name])}", f"{name} clicked")
        settle(page, name, "click")
    page.evaluate(f"window.ordenApp.workspace.activate({json.dumps(ids['terminal'])})")
    settle(page, "terminal", "todos over a terminal")
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    settle(page, "todos", "todos over a terminal")
    page.evaluate(f"window.ordenApp.workspace.activate({json.dumps(ids['terminal'])})")
    settle(page, "terminal", "close the terminal")
    page.evaluate(f"window.ordenApp.workspace.close({json.dumps(ids['terminal'])}, false)")
    page.wait_for_timeout(600)
    front = page.evaluate("() => window.ordenApp.workspace.active")
    left = [name for name, one in ids.items() if one == front["id"]] if front else []
    if left:
        settle(page, left[0], "close the terminal")
    page.evaluate(f"window.ordenApp.workspace.activate({json.dumps(ids['web'])})")
    settle(page, "web", "close the web tab")
    page.evaluate(f"window.ordenApp.workspace.close({json.dumps(ids['web'])}, false)")
    page.wait_for_timeout(600)
    front = page.evaluate("() => window.ordenApp.workspace.active")
    left = [name for name, one in ids.items() if one == front["id"]] if front else []
    if left:
        settle(page, left[0], "close the web tab")
    luck = random.Random(2373)
    for step in range(200):
        what = luck.choice(STEPS)
        page.evaluate(f"() => Promise.resolve(({what})()).catch((error) => String(error))")
        page.wait_for_timeout(150)
        if not every(page, step, what):
            break
raise SystemExit(DRIVE.run(drive, "a pane shows the tab in front, whatever kind it was switched from"))
