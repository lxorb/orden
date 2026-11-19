import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
BULLETS = "# A note of lists\n\nintro\n\n- milk\n- eggs\n- tea\n\nend\n"
TASKS = "# A note of lists\n\nintro\n\n- [ ] milk\n- [x] eggs\n- [ ] tea\n\nend\n"
SEED = """
async ([note]) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const one = ws.notes.find((entry) => entry.name.startsWith('A note'))
  await ws.openEntry(one.path, { activate: true })
}
"""
CARET = """
([words]) => {
  const view = window.orden
  view.focus()
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(words) }, userEvent: 'select' })
}
"""
EDGES = """
([first, last]) => {
  const view = window.orden
  const text = view.state.doc.toString()
  const start = view.coordsAtPos(text.indexOf(first), 1)
  const end = view.coordsAtPos(text.indexOf(last) + last.length, -1)
  return { x0: start.left + 1, y0: (start.top + start.bottom) / 2, x1: end.right + 2, y1: (end.top + end.bottom) / 2 }
}
"""
def fresh(browser: Browser, label: str, note: str) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        permissions=["clipboard-read", "clipboard-write"],
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate(SEED, [note])
    wait_for(page, "window.orden && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page
def source(page: Page) -> str:
    return page.evaluate("() => window.orden.state.doc.toString()")
def clipboard(page: Page) -> str:
    return page.evaluate("() => navigator.clipboard.readText()")
def by_keys(page: Page) -> None:
    page.evaluate(CARET, ["milk"])
    page.keyboard.press("Shift+ArrowDown")
    page.keyboard.press("Shift+End")
    page.wait_for_timeout(200)
def by_mouse(page: Page) -> None:
    edges = page.evaluate(EDGES, ["milk", "eggs"])
    page.mouse.move(edges["x0"], edges["y0"])
    page.mouse.down()
    page.mouse.move(edges["x1"], edges["y1"], steps=12)
    page.mouse.up()
    page.wait_for_timeout(200)
def picked(page: Page) -> str:
    return page.evaluate(
        "() => { const { from, to } = window.orden.state.selection.main; return window.orden.state.sliceDoc(from, to) }"
    )
def check(page: Page, label: str, kept: str, carried: str | None) -> None:
    text = source(page)
    say(f"[{label}] the note: {json.dumps(text)}")
    if text != kept:
        wrong(f"[{label}] the items did not go whole: {json.dumps(text)}")
    if carried is not None:
        held = clipboard(page)
        say(f"[{label}] the clipboard: {json.dumps(held)}")
        if held != carried:
            wrong(f"[{label}] the clipboard is not the items as Markdown: {json.dumps(held)}")
def drive(browser: Browser, label: str, note: str, pick, key: str, kept: str, carried: str | None) -> None:
    page = fresh(browser, label, note)
    pick(page)
    say(f"[{label}] selected: {json.dumps(picked(page))}")
    page.keyboard.press(key)
    page.wait_for_timeout(300)
    shot(page, label)
    check(page, label, kept, carried)
    page.context.close()
def main() -> int:
    kept = "# A note of lists\n\nintro\n\n- tea\n\nend\n"
    with DRIVE.session() as browser:
        drive(browser, "keys-cut", BULLETS, by_keys, "Control+x", kept, "- milk\n- eggs")
        drive(browser, "mouse-cut", BULLETS, by_mouse, "Control+x", kept, "- milk\n- eggs")
        drive(browser, "keys-backspace", BULLETS, by_keys, "Backspace", kept, None)
        drive(browser, "mouse-delete", BULLETS, by_mouse, "Delete", kept, None)
        drive(
            browser,
            "task-cut",
            TASKS,
            by_keys,
            "Control+x",
            "# A note of lists\n\nintro\n\n- [ ] tea\n\nend\n",
            "- [ ] milk\n- [x] eggs",
        )
    return DRIVE.verdict("list items selected and cut or deleted go whole, markers and all")
raise SystemExit(main())
