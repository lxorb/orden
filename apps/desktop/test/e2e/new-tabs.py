from playwright.sync_api import TimeoutError as PlaywrightTimeout
from harness import Drive, choose_kind

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
failures = DRIVE.failures
SHOTS = DRIVE.shots
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
SEED = """
async () => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.', undefined)
  const first = ws.files.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""
STATE = """
() => {
  const ws = window.ordenApp.workspace
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, path: one.path, shown: one.shown })),
    files: ws.files.map((one) => one.name),
    active: ws.active ? { kind: ws.active.kind, path: ws.active.path } : null,
  }
}
"""
DOTTED = """
() => {
  const id = window.ordenApp.workspace.active?.id
  return !!document.querySelector(`[data-tab="${id}"] .orden-unsaved`)
}
"""
LINE = """
() => {
  const view = window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)
  if (!view) return ''
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.slice(0, 40)
}
"""
FIELD = """
() => {
  const input = document.querySelector('.palette input')
  return input ? { value: input.value, caret: input.selectionStart } : null
}
"""
NEW_TAB = """
() => {
  const ws = window.ordenApp.workspace
  const tab = ws.active
  const pane = document.querySelector(`[data-pane="${ws.panes.focusedId}"]`)
  const here = pane?.querySelector('[data-new-here]')
  const at = document.activeElement
  return {
    newTab: !!tab && ws.isNewTab(tab),
    middle: !!at?.matches('[data-new-here] .hub'),
    picked: !!here?.querySelector('.hub.picked'),
    quarters: here
      ? [...here.querySelectorAll('[data-slot]')].map((one) =>
          [...one.querySelectorAll('[data-kind]')].map((option) => option.getAttribute('aria-label')),
        )
      : [],
    letters: here ? [...here.querySelectorAll('[data-kind]')].map((one) => one.getAttribute('aria-keyshortcuts')) : [],
    menu: !!document.querySelector('.menu'),
  }
}
"""
CALLED = """
() => {
  const id = window.ordenApp.workspace.active?.id
  const label = document.querySelector(`[data-tab="${id}"] .label`)?.textContent.trim()
  return { label, title: document.title.split(' - ')[0] }
}
"""
HERE = """
() => {
  const here = document.querySelector('[data-new-here]')
  const at = document.activeElement
  return {
    kinds: here ? [...here.querySelectorAll('[data-kind]')].map((one) => one.getAttribute('aria-label')) : [],
    middle: !!at?.matches('[data-new-here] .hub'),
    open: here?.querySelector('.quarter.open')?.getAttribute('data-quarter') ?? null,
    picked: here?.querySelector('.option.picked')?.getAttribute('aria-label') ?? null,
    marks: here ? [...here.querySelectorAll('[data-kind]')].map((one) => !!one.querySelector('.glyph')) : [],
  }
}
"""
def settles(page, condition: str, patience: int = 2000) -> bool:
    try:
        page.wait_for_function(condition, timeout=patience)
    except PlaywrightTimeout:
        return False
    return True
def palette(page) -> None:
    say("--- Ctrl+Shift+P ---")
    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field != {"value": ">", "caret": 1}:
        wrong(f"Ctrl+Shift+P did not open the palette on the commands: {field}")
    else:
        say("from a note            -> '>' with the caret after it")
    page.screenshot(path=str(SHOTS / "commands.png"))
    page.keyboard.type("fold")
    page.wait_for_timeout(200)
    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field != {"value": ">fold", "caret": 5}:
        wrong(f"a second press did not put the mark in front, once: {field}")
    else:
        say("pressed again          -> '>fold', the caret at the end")
    page.keyboard.press("Escape")
    if not settles(page, f"() => ({FIELD})() === null"):
        wrong("Escape did not close the palette")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)
    row = page.locator(".orden-row").first
    if row.count():
        row.click()
        page.wait_for_timeout(250)
    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field is None or field["value"] != ">":
        wrong(f"the chord did not answer in the file list: {field}")
    else:
        say("from the file list     -> '>' as well")
    page.keyboard.press("Escape")
    if not settles(page, f"() => ({FIELD})() === null"):
        wrong("Escape did not close the palette over the file list")
def heading_key(page) -> None:
    say("--- the heading key undoes itself ---")
    page.evaluate(
        """() => {
          const view = window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)
          view?.dispatch({ selection: { anchor: 6 } })
          view?.focus()
        }"""
    )
    page.wait_for_timeout(250)
    heading = page.evaluate(LINE)
    page.keyboard.press("Control+Digit1")
    page.wait_for_timeout(300)
    if page.evaluate(LINE).startswith("#"):
        wrong(f"Ctrl+1 on a first-level heading did not make it prose: {page.evaluate(LINE)!r}")
    else:
        say(f"Control+1              -> {page.evaluate(LINE)!r}")
    page.keyboard.press("Control+Digit1")
    page.wait_for_timeout(300)
    if page.evaluate(LINE) != heading:
        wrong(f"Ctrl+1 did not make it a heading again: {page.evaluate(LINE)!r}")
    else:
        say(f"Control+1 again        -> {page.evaluate(LINE)!r}")
QUARTERS = [
    ["New note", "New canvas", "New page note"],
    ["New AI chat"],
    ["Online terminal"],
    ["New web note", "Pass"],
]
def chooser(page) -> None:
    say("--- Ctrl+T ---")
    before = len(page.evaluate(STATE)["tabs"])
    page.keyboard.press("Control+KeyT")
    if not settles(page, f"() => ({NEW_TAB})().quarters.length > 0"):
        wrong(f"Ctrl+T drew no sun under its address field: {page.evaluate(NEW_TAB)}")
    new = page.evaluate(NEW_TAB)
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or not new["newTab"]:
        wrong(f"Ctrl+T did not make a new tab: {state['active']}")
    else:
        say("Control+T              -> a new tab")
    if not settles(page, f"() => ({NEW_TAB})().middle") or not page.evaluate(NEW_TAB)["picked"]:
        wrong(f"the new tab's middle did not take the keyboard: {page.evaluate(NEW_TAB)}")
    else:
        say("the keyboard           -> on the middle of the sun, picked")
    if new["quarters"] != QUARTERS:
        wrong(f"the kinds are not in their quarters: {new['quarters']}")
    else:
        say(f"the quarters           -> {new['quarters']}")
    if new["letters"] != ["N", "C", "P", "Q", "O", "W", "K"]:
        wrong(f"the options do not wear their letters: {new['letters']}")
    settles(page, f"() => ({CALLED})().title === 'New tab'")
    called = page.evaluate(CALLED)
    if called != {"label": "New tab", "title": "New tab"}:
        wrong(f"the new tab is not called New tab: {called}")
    else:
        say("its name               -> New tab, in the strip and on the window")
    page.screenshot(path=str(SHOTS / "new-tab.png"))
    page.keyboard.press("KeyC")
    if not settles(page, "() => window.ordenApp.workspace.active?.kind === 'canvas'", 4000):
        wrong(f"C on a new tab made no plane: {page.evaluate(STATE)['active']}")
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or any(one["kind"] == "web" for one in state["tabs"]):
        wrong(f"the plane did not take the new tab's place: {state['tabs']}")
    else:
        say("C                      -> a plane, where the new tab was")
    say("--- the plus ---")
    before = len(page.evaluate(STATE)["tabs"])
    page.locator(".strip button.new").first.click()
    if not settles(page, f"() => ({NEW_TAB})().quarters.length > 0"):
        wrong("the plus made no new tab")
    new = page.evaluate(NEW_TAB)
    if new["menu"]:
        wrong("the plus still hangs a menu")
    if not new["newTab"] or len(page.evaluate(STATE)["tabs"]) != before + 1:
        wrong(f"the plus did not make a new tab: {page.evaluate(STATE)['active']}")
    else:
        say("the plus               -> a new tab, no menu")
    if not settles(page, f"() => ({NEW_TAB})().middle"):
        wrong("the plus kept the keyboard from the new tab's middle")
    choose_kind(page, "web")
    settles(page, f"() => window.ordenApp.workspace.active?.kind === 'web' && !({NEW_TAB})().newTab", 4000)
    state = page.evaluate(STATE)
    address = page.evaluate("() => window.ordenApp.workspace.active?.address ?? ''")
    if (
        len(state["tabs"]) != before + 1
        or page.evaluate(NEW_TAB)["newTab"]
        or not address.startswith(("https://", "http://"))
    ):
        wrong(f"a web note chosen on a new tab did not open the search engine in its place: {address!r} {state['tabs']}")
    else:
        say(f"New web note pressed   -> {address}, in its place")
    page.keyboard.press("Control+KeyW")
    page.wait_for_timeout(300)
def unsaved(page) -> None:
    say("--- a tab of each kind, and nothing on disk ---")
    files = page.evaluate(STATE)["files"]
    for kind, row in (
        ("canvas", "New canvas"),
        ("pages", "New page note"),
        ("web", "New web note"),
    ):
        page.keyboard.press("Control+KeyT")
        choose_kind(page, kind)
        settles(
            page,
            f"() => window.ordenApp.workspace.active?.kind === '{kind}' && !window.ordenApp.workspace.isNewTab(window.ordenApp.workspace.active)",
            4000,
        )
        page.wait_for_timeout(300)
        state = page.evaluate(STATE)
        if state["active"] != {"kind": kind, "path": None}:
            wrong(f"{row} did not open an unsaved {kind}: {state['active']}")
        else:
            say(f"{row:<22} -> a {kind} tab, path null")
        if state["files"] != files:
            wrong(f"{row} wrote something into the space: {state['files']}")
    say(f"the strip              -> {[one['shown'] for one in page.evaluate(STATE)['tabs']]}")
    page.screenshot(path=str(SHOTS / "unsaved-tabs.png"))
def saving(page) -> None:
    say("--- saving: a place for a new tab, Ctrl+S, a web tab ---")
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const tab = ws.tabs.find((one) => one.kind === 'canvas')
          if (tab) ws.activate(tab.id)
        }"""
    )
    page.wait_for_timeout(400)
    files = page.evaluate(STATE)["files"]
    page.keyboard.press("Control+KeyS")
    if not DRIVE.waited(page, "() => !!document.querySelector('[role=\"dialog\"] input')", "the layer"):
        wrong("Ctrl+S on an untouched plane did not ask where it goes")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    if page.evaluate(STATE)["files"] != files:
        wrong("Ctrl+S on an untouched plane wrote a file before it was answered")
    else:
        say("Control+S on a plane   -> asked where, nothing written")
    page.evaluate("() => window.ordenApp.workspace.openBlank()")
    page.wait_for_timeout(400)
    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.type("Plan for Monday")
    page.wait_for_timeout(1200)
    state = page.evaluate(STATE)
    if (state["active"] or {}).get("path") is not None or "Plan for Monday.md" in state["files"]:
        wrong(f"typing into a new tab made it a file: {state['active']}")
    elif not page.evaluate(DOTTED):
        wrong("the new note wears no dot")
    else:
        say("typed into a new tab   -> still a tab, with its dot")
    page.screenshot(path=str(SHOTS / "typed-new-tab.png"))
    page.keyboard.press("Control+KeyS")
    DRIVE.wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] input')", "the layer")
    offered = page.locator('[role="dialog"] input').first.input_value()
    page.screenshot(path=str(SHOTS / "save-layer.png"))
    page.keyboard.press("Enter")
    DRIVE.wait_for(
        page,
        "() => (window.ordenApp.workspace.active?.path ?? '').endsWith('/Plan for Monday.md')",
        "the note saved",
    )
    say(f"Control+S, Enter       -> {offered!r} saved as Plan for Monday.md")
    page.keyboard.press("Control+KeyS")
    page.wait_for_timeout(500)
    if page.locator('[role="dialog"] input').count():
        wrong("Ctrl+S on a note with a file asked something")
    else:
        say("Control+S on a note    -> nothing asked")
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const tab = ws.tabs.find((one) => one.kind === 'web' && one.path === null)
          if (tab) ws.activate(tab.id)
        }"""
    )
    page.wait_for_timeout(400)
    if page.evaluate(DOTTED):
        wrong("a web tab wears the dot")
    page.keyboard.press("Control+KeyS")
    DRIVE.wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] input')", "the layer")
    page.keyboard.press("Enter")
    DRIVE.wait_for(
        page,
        "() => (window.ordenApp.workspace.active?.path ?? '').endsWith('.url')",
        "the web tab saved",
    )
    say(f"Control+S on a web tab -> {page.evaluate(STATE)['active']['path']}")
def nothing_open(page) -> None:
    say("--- nothing open ---")
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)
    state = page.evaluate(STATE)
    if state["tabs"]:
        wrong(f"closing every tab left something open: {state['tabs']}")
    else:
        say("every tab closed       -> nothing open, and nothing made")
    settles(page, "() => !!document.activeElement?.closest('[data-new-here]')")
    here = page.evaluate(HERE)
    if here["kinds"] != [one for quarter in QUARTERS for one in quarter]:
        wrong(f"the empty pane does not offer the kinds: {here['kinds']}")
    else:
        say(f"the kinds              -> {here['kinds']}")
    if not here["middle"]:
        wrong("the keyboard did not land on the middle of the sun")
    else:
        say("the keyboard           -> on the middle")
    if not all(here["marks"]):
        wrong(f"an option wears no mark at all: {here['marks']}")
    page.screenshot(path=str(SHOTS / "nothing-open.png"))
    page.keyboard.press("ArrowUp")
    page.wait_for_timeout(250)
    if page.evaluate(HERE)["open"] != "notes":
        wrong(f"ArrowUp did not open the notes: {page.evaluate(HERE)}")
    else:
        say("ArrowUp                -> the notes open")
    for _ in range(3):
        page.keyboard.press("ArrowRight")
    page.wait_for_timeout(250)
    if page.evaluate(HERE)["picked"] != "New page note":
        wrong(f"the arrows do not walk the notes to the end: {page.evaluate(HERE)}")
    else:
        say("ArrowRight x3          -> New page note, at the end")
    page.screenshot(path=str(SHOTS / "nothing-open-notes.png"))
    page.keyboard.press("Enter")
    settles(page, "() => window.ordenApp.workspace.active?.kind === 'pages'", 4000)
    state = page.evaluate(STATE)
    if state["active"] != {"kind": "pages", "path": None}:
        wrong(f"Enter did not make a page note: {state['active']}")
    else:
        say("Enter                  -> an unsaved page note")
    held_over_the_buttons(page)
def held_over_the_buttons(page) -> None:
    say("--- Ctrl+T over an empty pane ---")
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)
    page.keyboard.press("KeyP")
    if not settles(page, "() => window.ordenApp.workspace.active?.kind === 'pages'", 4000):
        wrong(f"P over an empty pane made no page note: {page.evaluate(STATE)['active']}")
    else:
        say("P                      -> a page note")
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)
    page.keyboard.press("Control+KeyT")
    if not settles(page, f"() => ({NEW_TAB})().newTab"):
        wrong("Ctrl+T over an empty pane made no new tab")
    else:
        say("Control+T              -> a new tab, as anywhere")
    page.screenshot(path=str(SHOTS / "over-nothing-open.png"))
FITS = """() => {
  const here = document.querySelector('[data-new-here]')
  const sun = here?.querySelector('.sun')
  if (!here || !sun) return null
  const room = here.getBoundingClientRect()
  const box = sun.getBoundingClientRect()
  return {
    inside: box.left >= room.left - 1 && box.right <= room.right + 1 && box.top >= room.top - 1 && box.bottom <= room.bottom + 1,
    kinds: here.querySelectorAll('[data-kind]').length,
    labels: here.querySelectorAll('[data-kind] .label').length,
  }
}"""
def small(page) -> None:
    say("--- a small window ---")
    page.set_viewport_size({"width": 820, "height": 520})
    page.wait_for_timeout(500)
    fits = page.evaluate(FITS)
    if not fits or not fits["inside"] or fits["kinds"] != 7:
        wrong(f"the sun does not fit a small window with every kind: {fits}")
    else:
        say(f"a small window         -> the sun fits, {fits['kinds']} kinds")
    page.screenshot(path=str(SHOTS / "small.png"))
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(500)
    fits = page.evaluate(FITS)
    if not fits or fits["labels"] != 7:
        wrong(f"a large window again does not name every option: {fits}")
    else:
        say("a large window again   -> every option named")
def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
    )
    context.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-pass']))")
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_timeout(800)
    say(f"{page.evaluate(SEED)} file(s) in the space")
    page.wait_for_timeout(500)
    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    page.wait_for_timeout(200)
    palette(page)
    heading_key(page)
    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    chooser(page)
    unsaved(page)
    saving(page)
    nothing_open(page)
    small(page)
    page.screenshot(path=str(SHOTS / "after.png"))
    context.close()
def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)
    return DRIVE.verdict("everything the drive checked was right")
raise SystemExit(main())
