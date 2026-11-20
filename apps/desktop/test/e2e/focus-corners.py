from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
STEPS = 160
NOTE = "# Corners\n\nSome words and a list:\n\n- one\n- [ ] two\n"
RING = """() => {
  const on = document.activeElement
  if (!on || on === document.body || !on.matches(':focus-visible')) return null
  const own = getComputedStyle(on)
  if (own.outlineStyle === 'none' || parseFloat(own.outlineWidth) === 0) return null
  const name = (one) => one.tagName.toLowerCase() + [...one.classList].filter((c) => !c.startsWith('svelte-')).map((c) => '.' + c).join('')
  const round = (one) => parseFloat(getComputedStyle(one).borderTopLeftRadius)
  const box = on.getBoundingClientRect()
  const snug = (one) => { const its = one.getBoundingClientRect(); return its.width - box.width <= 2 && its.height - box.height <= 2 }
  let holder = on.parentElement
  while (holder && round(holder) < 4 && snug(holder)) holder = holder.parentElement
  const rounded = !!holder && round(holder) >= 4
  return {
    name: name(on),
    square: rounded && round(on) < 2,
    within: rounded ? `${name(holder)}, ${getComputedStyle(holder).borderTopLeftRadius} round` : '',
  }
}"""
def sweep(page: Page, where: str, square: dict[str, str]) -> int:
    seen = set()
    for _ in range(STEPS):
        page.keyboard.press("Tab")
        ring = page.evaluate(RING)
        if not ring:
            continue
        seen.add(ring["name"])
        if ring["square"] and ring["name"] not in square:
            square[ring["name"]] = f"{where}: {ring['name']} draws a square ring inside {ring['within']}"
            DRIVE.shot(page, f"square-{len(square)}")
    say(f"{where}: {len(seen)} rings")
    return len(seen)
def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.evaluate(
        "async (note) => { const ws = window.ordenApp.workspace; await ws.noteFrom(note, ws.activeSpace.root); await ws.loadTree();"
        " const found = ws.notes.find((one) => one.name.startsWith('Corners')); await ws.openEntry(found.path, { activate: true }) }",
        NOTE,
    )
    page.evaluate("() => window.ordenApp.workspace.showPanel('tasks')")
    field = page.locator("[data-todos-panel] [data-todos-add]")
    field.wait_for(timeout=20_000)
    for title in ("Buy bread", "Call the bank"):
        field.fill(title)
        field.press("Enter")
    page.wait_for_timeout(500)
    field.focus()
    square: dict[str, str] = {}
    rings = sweep(page, "the Todos panel", square)
    for pane in ("general", "appearance", "editor", "account"):
        page.evaluate("(pane) => window.ordenApp.settings.show(pane)", pane)
        page.wait_for_timeout(500)
        rings += sweep(page, f"Settings {pane}", square)
    if rings < 40:
        wrong(f"only {rings} focus rings were reached, too few to say anything")
    for said in square.values():
        wrong(said)
    context.close()
raise SystemExit(DRIVE.run(drive))
