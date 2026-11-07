from __future__ import annotations

from playwright.sync_api import Browser, Page, Route

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LAYER = "() => !!document.querySelector('[role=\"dialog\"] form input')"

SHEET = '[role="dialog"][aria-label^="Save changes to"]'
QUESTION = "() => !!document.querySelector('[role=\"dialog\"][aria-label^=\"Save changes to\"]')"

STATE = """
() => {
  const ws = window.ordenApp.workspace
  const front = ws.active
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, path: one.path, shown: one.shown })),
    files: ws.files.map((one) => one.path.slice(ws.activeSpace.root.length + 1)),
    front: front ? { kind: front.kind, path: front.path, doc: front.doc } : null,
    dotted: !!(front && document.querySelector(`[data-tab="${front.id}"] .orden-unsaved`)),
  }
}
"""

def state(page: Page) -> dict:
    return page.evaluate(STATE)  # type: ignore[no-any-return]

LATE = 400

def late(page: Page) -> None:
    def held(route: Route) -> None:
        page.wait_for_timeout(LATE)
        route.continue_()

    page.route("**/assets/carrying-*.js", held)

def typed(page: Page, words: str) -> None:
    page.evaluate("() => window.ordenApp.workspace.openBlank()")
    wait_for(page, "document.querySelector('.cm-content')", "the editor")
    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.type(words)
    page.wait_for_timeout(900)

def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 760}, color_scheme=scheme, reduced_motion="reduce")
    late(page)
    DRIVE.open(page)
    DRIVE.seed(page, "# Trips\n\nWhere we went.\n")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")

    say(f"--- {scheme}: the dot ---")
    typed(page, "Groceries\nmilk, eggs, bread")
    now = state(page)
    if now["front"]["path"] is not None or any(one.startswith("Groceries") for one in now["files"]):
        wrong(f"typing into a new note made it a file: {now['front']}")
    if not now["dotted"]:
        wrong("the new note wears no dot")
    say(f"typed into a new note -> no file, dot: {now['dotted']}")

    page.evaluate("() => window.ordenApp.workspace.openWebsite()")
    page.wait_for_timeout(400)
    if state(page)["dotted"]:
        wrong("a new web tab wears the dot")
    else:
        say("a new web tab          -> no dot")
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const note = ws.tabs.find((one) => one.kind === 'note' && one.path === null)
          if (note) ws.activate(note.id)
        }"""
    )
    DRIVE.settled(page)
    DRIVE.shot(page, f"{scheme}-01-dot")

    say(f"--- {scheme}: save ---")
    page.keyboard.press("Control+KeyS")
    wait_for(page, LAYER, "the layer under the tab")
    offered = page.locator('[role="dialog"] form input').first.input_value()
    if offered != "Groceries":
        wrong(f"the name offered is {offered!r}")
    DRIVE.shot(page, f"{scheme}-02-save")

    page.locator('[role="dialog"] .where').click()
    page.keyboard.type("Trips")
    wait_for(page, "document.querySelector('[role=\"dialog\"] .orden-row')", "the places")
    DRIVE.shot(page, f"{scheme}-03-places")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    wait_for(page, "(window.ordenApp.workspace.active?.path ?? '').endsWith('Trips/Groceries.md')", "the save")
    now = state(page)
    if now["dotted"]:
        wrong("the saved note still wears the dot")
    say(f"Ctrl+S, Trips, Enter   -> {now['front']['path']}")
    DRIVE.settled(page)
    DRIVE.shot(page, f"{scheme}-04-saved")

    say(f"--- {scheme}: dropped on the list ---")
    typed(page, "Dropped here")
    tab = page.evaluate("() => window.ordenApp.workspace.active.id")
    grip = page.locator(f'[data-tab="{tab}"]').bounding_box()
    rest = page.locator("[data-space-rest]").bounding_box()
    if grip and rest:
        page.mouse.move(grip["x"] + 30, grip["y"] + grip["height"] / 2)
        page.mouse.down()
        page.mouse.move(grip["x"] + 30, grip["y"] + 60, steps=6)
        page.mouse.move(rest["x"] + 60, rest["y"] + 40, steps=12)
        page.wait_for_timeout(300)
        DRIVE.shot(page, f"{scheme}-05-dropping")
        page.mouse.up()
        if DRIVE.waited(page, "(window.ordenApp.workspace.tabs.find((one) => one.doc === 'Dropped here')?.path ?? '').endsWith('/Dropped here.md')", "the drop"):
            say("a tab dropped below the rows -> saved at the root of the space")
    else:
        wrong("no tab or no stretch below the rows to drag between")

    say(f"--- {scheme}: close and reopen ---")
    typed(page, "Scratch thought")
    page.keyboard.press("Control+KeyW")
    wait_for(page, QUESTION, "the question before it closes")
    buttons = page.locator(f"{SHEET} button").all_inner_texts()
    if [one.strip() for one in buttons] != ["Cancel", "Don’t save", "Save"]:
        wrong(f"the question's answers are {buttons}")
    DRIVE.settled(page)
    DRIVE.shot(page, f"{scheme}-06-asked")
    page.keyboard.press("Escape")
    wait_for(page, f"!({QUESTION})()", "the question gone")
    if page.evaluate("() => window.ordenApp.workspace.active?.path") is not None or not page.evaluate(
        "() => window.ordenApp.workspace.tabs.some((one) => one.path === null && one.note.blank === false && one.shown.startsWith('Scratch'))"
    ):
        wrong("Cancel did not keep the tab with its words")
    else:
        say("Ctrl+W, Escape         -> asked, and kept")
    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Control+KeyW")
    wait_for(page, QUESTION, "the question again")
    page.locator(f"{SHEET} button", has_text="Don’t save").click()
    wait_for(page, f"!({QUESTION})()", "the question answered")
    page.evaluate(
        """() => {
          const { settings } = window.ordenApp
          settings.section = 'trash'
          settings.open = true
        }"""
    )
    if DRIVE.waited(page, "document.body.innerText.includes('Scratch thought')", "Recently deleted"):
        say("Don’t save             -> closed, and in Recently deleted")
    else:
        wrong("the closed note's words are not in Recently deleted")
    DRIVE.shot(page, f"{scheme}-06-recently-deleted")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Control+Shift+KeyT")
    wait_for(page, "window.ordenApp.workspace.active?.doc === 'Scratch thought'", "the tab back")
    say("Ctrl+Shift+T           -> back with its words")

    say(f"--- {scheme}: closed with Save ---")
    typed(page, "Kept thought")
    page.keyboard.press("Control+KeyW")
    wait_for(page, QUESTION, "the question before it closes")
    page.locator(f"{SHEET} button", has_text="Save").last.click()
    wait_for(page, LAYER, "the layer under the tab")
    DRIVE.shot(page, f"{scheme}-06b-save-to-close")
    page.keyboard.press("Enter")
    wait_for(
        page,
        "!window.ordenApp.workspace.tabs.some((one) => one.shown.startsWith('Kept thought'))"
        " && window.ordenApp.workspace.files.some((one) => one.path.endsWith('/Kept thought.md'))",
        "the note saved and its tab closed",
    )
    say("Ctrl+W, Save, Enter    -> Kept thought.md, and the tab closed")

    say(f"--- {scheme}: a restart ---")
    page.evaluate("() => window.ordenApp.workspace.persist()")
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    wait_for(
        page,
        "window.ordenApp.workspace.tabs.some((one) => one.path === null && one.doc === 'Scratch thought')",
        "the unsaved note back",
    )
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const tab = ws.tabs.find((one) => one.path === null && one.doc === 'Scratch thought')
          if (tab) ws.activate(tab.id)
        }"""
    )
    DRIVE.settled(page)
    if not state(page)["dotted"]:
        wrong("the unsaved note came back without its dot")
    say("reloaded               -> the unsaved note back, words and dot")
    DRIVE.shot(page, f"{scheme}-07-restart")

    say(f"--- {scheme}: one tab per web note ---")
    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          await ws.createWebsite(ws.activeSpace.root, 'Svelte.url')
        }"""
    )
    wait_for(page, "(window.ordenApp.workspace.active?.path ?? '').endsWith('Svelte.url')", "the web note")
    page.evaluate("() => window.ordenApp.workspace.split('row')")
    page.wait_for_timeout(400)
    tabs = state(page)["tabs"]
    held = [one for one in tabs if (one["path"] or "").endswith("Svelte.url")]
    loose = [one for one in tabs if one["kind"] == "web" and one["path"] is None]
    if len(held) != 1 or not loose:
        wrong(f"a split of a web note is not one tab and a copy: {tabs}")
    else:
        say("split of a web note    -> the note once, an unsaved web tab beside it")
    page.close()

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            drive(browser, scheme)
    return DRIVE.verdict("a tab with no file waits for a place, and a web note is open once")

if __name__ == "__main__":
    raise SystemExit(main())
