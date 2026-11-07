from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

import harness
from harness import Drive
from settling import quiet

NEEDS = ("tab-stops",)

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

AXE = harness.APP / "node_modules" / "axe-core" / "axe.min.js"

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name)
  const folder = join(root, 'Field notes')
  const note = '---\\nplace: Moor\\nweather: Fair\\nhour: Dusk\\ntags: [one]\\n---\\n\\nWords.\\n'
  for (const words of ['# Alder', '# Birch', '# Cedar', '# Damson']) {
    await ws.noteFrom(words + '\\n\\nWords.\\n', root)
  }
  await ws.noteFrom('# Ledger\\n\\nWords.\\n', folder)
  const held = await ws.noteFrom(note, root)
  ws.device.expand(folder)
  await ws.loadTree()
  for (const name of ['Alder', 'Birch', 'Cedar']) {
    const found = ws.notes.find((one) => one.name.startsWith(name))
    await ws.openEntry(found.path, { activate: true })
    ws.keep(ws.activeTabId)
  }
  return held
}
"""

WHERE = """
() => {
  const at = document.activeElement
  if (!at || at === document.body) return 'body'
  const cls = (at.className ?? '').toString().split(' ').filter(Boolean)[0] ?? ''
  const named = at.getAttribute('aria-label') ?? (at.textContent ?? '').trim().slice(0, 24)
  return `${at.closest('[data-region]')?.dataset.region ?? '-'}|${at.tagName.toLowerCase()}.${cls}|${named}`
}
"""

SAID = "() => document.querySelector('p.orden-said[role=status]')?.textContent ?? ''"

AXE_RULES = """
async () => {
  const found = await window.axe.run(document, {
    resultTypes: ['violations'],
    runOnly: [
      'landmark-unique',
      'aria-required-children',
      'aria-required-parent',
      'aria-required-attr',
      'aria-valid-attr-value',
      'aria-allowed-role',
      'aria-prohibited-attr',
      'nested-interactive',
    ],
  })
  return found.violations.map((one) => ({
    id: one.id,
    where: one.nodes.slice(0, 4).map((node) => node.target.join(' ')),
  }))
}
"""

def where(page: Page) -> str:
    return page.evaluate(WHERE)

def press(page: Page, *keys: str) -> str:
    for key in keys:
        page.keyboard.press(key)
    quiet(page)
    return where(page)

def into_region(page: Page, region: str) -> None:
    for _ in range(12):
        if where(page).startswith(f"{region}|"):
            return
        page.keyboard.press("F6")
    wrong(f"F6 never reached {region}: stands on {where(page)}")

def to_row(page: Page, starts: str) -> None:
    into_region(page, "list")
    page.keyboard.press("Home")
    page.evaluate("() => new Promise(requestAnimationFrame)")
    seen = []
    for _ in range(14):
        at = where(page).split("|")[-1]
        seen.append(at)
        if at.startswith(starts):
            return
        page.keyboard.press("ArrowDown")
        page.evaluate("() => new Promise(requestAnimationFrame)")
    wrong(f"no row called {starts}: the arrows went {seen}")

def choose(page: Page, label: str) -> None:
    wait_for(page, "document.querySelector('[role=menu]')", "the menu")
    for _ in range(40):
        at = page.evaluate("() => document.activeElement?.textContent?.trim() ?? ''")
        lit = page.evaluate("() => document.querySelector('[role=menu] .lit, [role=menu] .is-lit')?.textContent?.trim() ?? ''")
        if at.startswith(label) or lit.startswith(label):
            page.keyboard.press("Enter")
            quiet(page)
            return
        page.keyboard.press("ArrowDown")
    wrong(f"the menu has no {label}: {page.evaluate('() => document.querySelector(`[role=menu]`)?.textContent')}")
    page.keyboard.press("Escape")

def tree_roles(page: Page) -> None:
    seen = page.evaluate(
        """() => {
          const row = (name) => [...document.querySelectorAll('[role=tree] [role=treeitem]')]
            .find((one) => one.textContent.trim().startsWith(name))
          const of = (one) => one && ({
            level: one.getAttribute('aria-level'),
            expanded: one.getAttribute('aria-expanded'),
            selected: one.getAttribute('aria-selected'),
          })
          return { folder: of(row('Field notes')), inside: of(row('Ledger')), alone: of(row('Alder')) }
        }"""
    )
    say(f"[tree] {json.dumps(seen)}")
    if seen["folder"]["expanded"] != "true" or seen["folder"]["level"] != "1":
        wrong(f"the folder is not an open row at the top level: {seen['folder']}")
    if seen["inside"]["level"] != "2":
        wrong(f"a row inside a folder is not a level down: {seen['inside']}")
    if seen["alone"]["selected"] is None:
        wrong("a row does not say whether it is selected")

def tab_says(page: Page) -> None:
    seen = page.evaluate(
        "() => [...document.querySelectorAll('.tabs .pick')].map((one) => [one.getAttribute('aria-label'), one.getAttribute('aria-current')])"
    )
    say(f"[strip] {seen}")
    current = [name for name, said in seen if said]
    if len(current) != 1 or not page.evaluate("(name) => window.ordenApp.workspace.active?.shown === name", current[0]):
        wrong(f"the strip does not say which tab is in front: {seen}")

def row_deleted(page: Page) -> None:
    to_row(page, "Damson")
    press(page, "Shift+F10")
    choose(page, "Delete")
    if page.evaluate("() => !!document.querySelector('[role=dialog], [role=alertdialog]')"):
        press(page, "Enter")
    wait_for(page, "!window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note to go")
    quiet(page)
    at = where(page)
    say(f"[delete] after a row's Delete the keyboard is on {at}")
    if not at.startswith("list|button.orden-row"):
        wrong(f"the keyboard went with the deleted row: {at}")

def open_row_deleted(page: Page) -> None:
    page.evaluate(
        "async () => { const ws = window.ordenApp.workspace; await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Damson')).path, { activate: true }) }"
    )
    quiet(page)
    to_row(page, "Damson")
    press(page, "Shift+F10")
    choose(page, "Delete")
    if page.evaluate("() => !!document.querySelector('[role=dialog], [role=alertdialog]')"):
        press(page, "Enter")
    wait_for(page, "!window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the open note to go")
    quiet(page)
    at = where(page)
    say(f"[delete] after the open note's row went the keyboard is on {at}")
    if not at.startswith("list|button.orden-row"):
        wrong(f"the keyboard did not stay in the list: {at}")
    press(page, "Control+z")
    wait_for(page, "window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note back")
    quiet(page)

def toast_keys(page: Page) -> None:
    said = page.evaluate(SAID)
    say(f"[toast] the region says {said!r}")
    if "Deleted" not in said or "Undo" not in said:
        wrong(f"the region did not say what happened and the way back: {said!r}")
    if page.evaluate("() => document.querySelector('.toast')?.getAttribute('role') === 'status'"):
        wrong("the toast is a live region that arrived with its words")

    came_from = where(page)
    for count in range(1, 31):
        at = press(page, "Tab")
        if at.endswith("|Undo") or "editor|" in at:
            break
    say(f"[toast] {count} Tabs from the row: {at}")
    if not at.endswith("|Undo"):
        wrong(f"Tab reached the note before Undo: {at}")

    at = press(page, "Enter")
    wait_for(page, "window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note back")
    quiet(page)
    say(f"[toast] Undo pressed: the keyboard is on {where(page)}, it came from {came_from}")
    if where(page) == "body":
        wrong("the keyboard went with the toast")

    to_row(page, "Damson")
    press(page, "Shift+F10")
    choose(page, "Delete")
    if page.evaluate("() => !!document.querySelector('[role=dialog], [role=alertdialog]')"):
        press(page, "Enter")
    wait_for(page, "document.querySelector('.toast .undo')", "the toast again")
    page.evaluate("() => window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Shift+F6")
    at = where(page)
    say(f"[toast] Shift+F6 from the note: {at}")
    if not at.endswith("|Undo"):
        wrong(f"Shift+F6 from the note did not reach Undo: {at}")
    for key, region in (
        ("F6", "editor|"),
        ("Shift+F6", "notices|"),
        ("Tab", "editor|"),
        ("Shift+F6", "notices|"),
        ("Shift+Tab", "-|"),
        ("Tab", "notices|"),
        ("F6", "editor|"),
        ("Shift+F6", "notices|"),
    ):
        page.keyboard.press(key)
        at = where(page)
        say(f"[toast] {key} beside Undo: {at}")
        if not at.startswith(region):
            wrong(f"{key} beside Undo went to {at}, not {region}: F6, Tab and the list disagree")
    press(page, "Enter")
    wait_for(page, "window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note back")
    quiet(page)
    at = where(page)
    say(f"[toast] Undo: the keyboard is on {at}")
    if not at.startswith("editor|"):
        wrong(f"Undo did not hand the keyboard back to the note it came from: {at}")

def hand_back_hidden(page: Page) -> None:
    to_row(page, "Damson")
    press(page, "Shift+F10")
    choose(page, "Delete")
    if page.evaluate("() => !!document.querySelector('[role=dialog], [role=alertdialog]')"):
        press(page, "Enter")
    wait_for(page, "document.querySelector('.toast .undo')", "the toast")
    for _ in range(3):
        page.keyboard.press("F6")
    at = where(page)
    if not at.endswith("|Undo"):
        wrong(f"F6 three times from the list (foot, strip, card) did not reach Undo: {at}")
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.openOn('left')) ws.toggleSidebar('left') }")
    page.keyboard.press("Enter")
    wait_for(page, "window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note back")
    quiet(page)
    at = where(page)
    say(f"[toast] Undo with the sidebar shut since: {at}")
    if at == "body":
        wrong("the keyboard fell to the page: what it came from is hidden")
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (!ws.openOn('left')) ws.toggleSidebar('left') }")
    quiet(page)

def enter_after_going(page: Page) -> None:
    page.evaluate(
        "async () => { const ws = window.ordenApp.workspace; await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Damson')).path, { activate: true }) }"
    )
    quiet(page)
    to_row(page, "Damson")
    press(page, "Shift+F10")
    choose(page, "Delete")
    if page.evaluate("() => !!document.querySelector('[role=dialog], [role=alertdialog]')"):
        press(page, "Enter")
    wait_for(page, "!window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note to go")
    quiet(page)
    at = press(page, "Enter")
    say(f"[caret] Enter on the row that took the keyboard: {at}")
    if not at.startswith("editor|"):
        wrong(f"Enter on the row left the keyboard off the note: {at}")
    page.evaluate("async () => { await window.ordenApp.workspace.undoFileAction() }")
    wait_for(page, "window.ordenApp.workspace.notes.some((one) => one.name.startsWith('Damson'))", "the note back")
    quiet(page)

    for name in ("Alder", "Birch", "Cedar", "Read me"):
        page.evaluate(
            "async (name) => { const ws = window.ordenApp.workspace; await ws.openEntry(ws.notes.find((one) => one.name.startsWith(name)).path, { activate: true }); ws.keep(ws.activeTabId) }",
            name,
        )
    quiet(page)
    page.evaluate("() => document.querySelector('.tabs .active > .pick').focus()")
    press(page, "Delete")
    quiet(page)
    if not where(page).startswith("tabs|"):
        wrong(f"the close did not leave the keyboard on the strip: {where(page)}")
    at = press(page, "Enter")
    say(f"[caret] Enter on the tab in front after a close: {at}")
    if not at.startswith("editor|"):
        wrong(f"Enter on the tab in front left the keyboard off the note: {at}")
    page.evaluate("() => document.querySelector('.tabs .active > .pick').focus()")
    press(page, "Delete")
    quiet(page)
    press(page, "ArrowLeft")
    at = press(page, "Enter")
    say(f"[caret] an arrow and Enter after a close: {at}")
    if not at.startswith("editor|"):
        wrong(f"Enter on the next tab left the keyboard off the note: {at}")

def tab_closed(page: Page) -> None:
    into_region(page, "tabs")
    before = page.evaluate("() => window.ordenApp.workspace.tabs.length")
    at = press(page, "Delete")
    wait_for(page, f"window.ordenApp.workspace.tabs.length < {before}", "the tab to close")
    quiet(page)
    at = where(page)
    say(f"[tab] after Delete on the strip the keyboard is on {at}")
    if not at.startswith("tabs|button.pick"):
        wrong(f"the keyboard went with the closed tab: {at}")

ABOUT = "() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map((one) => one.textContent.trim())"

LINE = """() => {
  const at = getSelection().focusNode
  return (at.nodeType === 1 ? at : at.parentElement).closest('.cm-line')?.textContent ?? null
}"""

def note_menu(page: Page) -> None:
    said = "# Menu key\n\nfirst para here\n\n\n\nlast words go here now"
    page.evaluate(
        """async (said) => {
          const ws = window.ordenApp.workspace
          await ws.noteFrom(said, ws.activeSpace.root)
          await ws.loadTree()
          await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Menu key')).path, { activate: true })
        }""",
        said,
    )
    wait_for(page, "[...document.querySelectorAll('.cm-line')].some((one) => one.textContent.includes('last words'))", "the note")
    quiet(page)

    def caret_on(words: str | None) -> dict:
        page.evaluate("() => document.querySelector('.cm-content').focus()")
        page.keyboard.press("Meta+ArrowUp" if harness.WEBKIT else "Control+Home")
        past = False
        for _ in range(12):
            at = page.evaluate(LINE)
            if at == "" and words is None and past:
                break
            if at and words is not None and words in at:
                break
            past = past or "first para" in (at or "")
            page.keyboard.press("ArrowDown")
        quiet(page)
        return page.evaluate(
            """() => { const line = getSelection().focusNode; const one = (line.nodeType === 1 ? line : line.parentElement).closest('.cm-line'); const box = one.getBoundingClientRect(); return { x: box.x + 40, y: box.y + box.height / 2, text: one.textContent } }"""
        )

    empty = caret_on(None)
    say(f"[note menu] the empty line: {empty}")
    press(page, "Shift+F10")
    by_key = page.evaluate(ABOUT)
    press(page, "Escape")
    page.mouse.click(empty["x"], empty["y"], button="right")
    quiet(page)
    by_press = page.evaluate(ABOUT)
    press(page, "Escape")
    say(f"[note menu] from the key {by_key[:6]}, from a press {by_press[:6]}")
    if not by_key:
        wrong("the note gave no menu on the key")
    if by_key != by_press:
        wrong(f"the key's menu on an empty line is about another block: {by_key} and not {by_press}")

    caret_on("first para")
    press(page, "Shift+F10")
    choose(page, "Duplicate")
    words = page.evaluate("() => window.ordenApp.workspace.active?.note?.latest ?? ''")
    say(f"[note menu] after Duplicate: {words!r}")
    if words.count("first para here") != 2 or words.count("last words go here now") != 1:
        wrong(f"Duplicate from the key did not act on the caret's block: {words!r}")

def named_sides(page: Page) -> None:
    page.evaluate("() => { const ws = window.ordenApp.workspace; ws.showPanel('search'); ws.movePanel('search', 'right'); ws.showPanel('tree') }")
    wait_for(page, "document.querySelectorAll('aside[data-sidebar]').length === 2", "both sidebars")
    quiet(page)
    names = page.evaluate("() => [...document.querySelectorAll('aside[data-sidebar]')].map((one) => one.getAttribute('aria-label'))")
    say(f"[sides] {names}")
    if len(set(names)) != 2:
        wrong(f"the two sidebars share a name: {names}")

def divider(page: Page) -> None:
    page.evaluate("() => window.ordenApp.workspace.split('row')")
    wait_for(page, "document.querySelector('.divider')", "the divider")
    quiet(page)
    page.evaluate("() => document.querySelector('.divider').focus()")
    seen = page.evaluate(
        """() => {
          const one = document.querySelector('.divider')
          return ['role', 'aria-label', 'aria-orientation', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax']
            .map((name) => [name, one.getAttribute(name)])
        }"""
    )
    say(f"[divider] {seen}")
    said = dict(seen)
    if said["role"] != "separator" or not said["aria-label"] or said["aria-valuemin"] is None:
        wrong(f"the divider is not what a window splitter says it is: {seen}")
    was = page.evaluate("() => Number(document.querySelector('.divider').getAttribute('aria-valuenow'))")
    press(page, "ArrowRight")
    moved = page.evaluate("() => Number(document.querySelector('.divider').getAttribute('aria-valuenow'))")
    say(f"[divider] ArrowRight: {was} to {moved}")
    if moved <= was:
        wrong(f"the arrow did not move the divider: {was} to {moved}")
    press(page, "Home")
    least = page.evaluate("() => Number(document.querySelector('.divider').getAttribute('aria-valuenow'))")
    press(page, "End")
    most = page.evaluate("() => Number(document.querySelector('.divider').getAttribute('aria-valuenow'))")
    say(f"[divider] Home {least}, End {most}")
    ends = page.evaluate(
        "() => ['aria-valuemin', 'aria-valuemax'].map((name) => Number(document.querySelector('.divider').getAttribute(name)))"
    )
    if ends != [least, most]:
        wrong(f"the divider says its range is {ends}, and goes {least} to {most}")
    if not least < was < most:
        wrong(f"Home and End did not take it to its ends: {least}, {most}")
    press(page, "Enter")
    DRIVE.shot(page, "two-panes")
    axe_says(page, "two panes")
    page.evaluate("() => window.ordenApp.workspace.panes.collapse()")
    quiet(page)

def axe_says(page: Page, surface: str) -> None:
    found = page.evaluate(AXE_RULES)
    say(f"[axe] {surface}: {json.dumps(found)}")
    if found:
        wrong(f"axe, {surface}: {json.dumps(found)}")

def toggle_order(page: Page) -> None:
    for side, selector in (("left", ".panels:not(.right) aside"), ("right", ".panels.right aside")):
        toggle = f"[data-side-toggle={side}]"
        page.evaluate(
            "(side) => { const ws = window.ordenApp.workspace; if (ws.openOn(side)) ws.toggleSidebar(side) }", side
        )
        quiet(page)
        page.evaluate("(toggle) => document.querySelector(toggle).focus()", toggle)
        press(page, "Enter")
        wait_for(page, f"window.ordenApp.workspace.openOn('{side}')", f"the {side} side to open")
        at = press(page, "Tab")
        inside = page.evaluate("(selector) => !!document.activeElement?.closest(selector)", selector)
        say(f"[toggle] {side}: Tab after opening lands on {at}")
        if not inside:
            wrong(f"Tab after opening the {side} sidebar did not go into it: {at}")
        at = press(page, "Shift+Tab")
        say(f"[toggle] {side}: Shift+Tab back: {at}")
        back = page.evaluate("(toggle) => document.activeElement === document.querySelector(toggle)", toggle)
        if not back:
            wrong(f"Shift+Tab did not go back to the {side} toggle: {at}")
        at = press(page, "Tab")
        inside = page.evaluate("(selector) => !!document.activeElement?.closest(selector)", selector)
        say(f"[toggle] {side}: Tab again from the toggle: {at}")
        if inside:
            wrong(f"Tab from the {side} toggle went into the sidebar a second time: {at}")

VERSION = (
    "[...document.querySelectorAll('.setting.pressable')]"
    ".find((row) => row.querySelector('.what')?.textContent.trim().startsWith('Version'))"
    "?.querySelector('.value.said')"
)

def version_row(page: Page) -> None:
    if not harness.WEBKIT:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.evaluate("() => window.ordenApp.settings.show()")
    wait_for(page, f"!!{VERSION}", "the version's row")
    quiet(page)
    axe_says(page, "settings")
    page.evaluate(f"() => {VERSION}.focus()")
    seen = page.evaluate(
        f"""() => {{
          const one = {VERSION}
          return {{ held: document.activeElement === one, role: one.getAttribute('role'), row: one.closest('.setting').getAttribute('role') }}
        }}"""
    )
    say(f"[version] {seen}")
    if not seen["held"] or seen["role"] != "button" or seen["row"] is not None:
        wrong(f"the version is not the control, its row is: {seen}")
        press(page, "Escape")
        return
    at = press(page, "Enter")
    wait_for(page, f"{VERSION}?.textContent === 'Copied'", "the row to say it copied")
    say(f"[version] Enter on it: Copied, the keyboard on {at}")
    press(page, "Escape")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 860})
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")
    held = page.evaluate(SEED)
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    quiet(page)
    DRIVE.inject(page, AXE)
    page.wait_for_function("() => !!window.axe", timeout=20000)

    page.evaluate("() => document.activeElement?.blur?.()")
    for name, part in (
        ("tree", lambda: tree_roles(page)),
        ("strip", lambda: tab_says(page)),
        ("axe", lambda: axe_says(page, "the window")),
        ("delete", lambda: row_deleted(page)),
        ("toast", lambda: toast_keys(page)),
        ("open row", lambda: open_row_deleted(page)),
        ("hand back", lambda: hand_back_hidden(page)),
        ("enter", lambda: enter_after_going(page)),
        ("tab", lambda: tab_closed(page)),
        ("note menu", lambda: note_menu(page)),
        ("sides", lambda: named_sides(page)),
        ("axe", lambda: axe_says(page, "both sidebars")),
        ("divider", lambda: divider(page)),
        ("toggle", lambda: toggle_order(page)),
        ("version", lambda: version_row(page)),
    ):
        try:
            part()
        except (Exception, SystemExit) as error:
            wrong(f"{name}: {error}")
            page.keyboard.press("Escape")
    page.context.close()

def main() -> int:
    return DRIVE.run(drive, "the keyboard stays somewhere, and a screen reader is told where")

if __name__ == "__main__":
    raise SystemExit(main())
