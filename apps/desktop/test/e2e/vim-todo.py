from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NOTE = "# Chores\n\n- [ ] Wash up\n- [ ] Water the plants\n- [ ] Post the letter\n\nA plain line.\nAnd the one under it.\n"

DOC = "() => window.nib.state.doc.toString()"
MODE = "() => window.nibApp.modes.vimModeOf(window.nib)"

CARET_TO = """
(words) => {
  const view = window.nib
  const at = view.state.doc.toString().indexOf(words)
  view.dispatch({ selection: { anchor: at } })
  view.focus()
}
"""

LINE = "() => window.nib.state.doc.lineAt(window.nib.state.selection.main.head).text"

def line_of(page: Page, words: str) -> str:
    return next(one for one in page.evaluate(DOC).split("\n") if words in one)

def caret_to(page: Page, words: str) -> None:
    page.evaluate(CARET_TO, words)
    DRIVE.settled(page)

def normal(page: Page) -> None:
    page.keyboard.press("Escape")
    wait_for(page, f"({MODE})() === 'normal'", "normal mode")

def becomes(page: Page, words: str, line: str, what: str) -> None:
    if not DRIVE.waited(
        page,
        f"window.nib.state.doc.toString().split('\\n').some((one) => one.startsWith({json.dumps(line)}))",
        what,
        patience=10,
    ):
        say(f"  the line reads {line_of(page, words)!r}")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Chores")

    page.evaluate("() => window.nibApp.modes.setVimKeys(true)")
    wait_for(page, "document.querySelector('.cm-editor.nib-vim')", "modal editing")

    caret_to(page, "Wash up")
    normal(page)
    page.keyboard.press("Enter")
    becomes(page, "Wash up", "- [x] Wash up", "Enter in normal mode to tick the task")
    if "Wash up" not in page.evaluate(LINE):
        wrong(f"the caret left the task it ticked, for {page.evaluate(LINE)!r}")
    DRIVE.shot(page, "01-ticked")

    page.keyboard.press("Enter")
    becomes(page, "Wash up", "- [ ] Wash up", "Enter again to clear the task")
    DRIVE.shot(page, "02-cleared")

    before = page.evaluate(DOC)
    caret_to(page, "A plain line")
    normal(page)
    page.keyboard.press("Enter")
    DRIVE.settled(page)
    if page.evaluate(DOC) != before:
        wrong("Enter on a plain line in normal mode changed the note")
        say(f"  before {before!r}")
        say(f"  after  {page.evaluate(DOC)!r}")
    if page.evaluate(LINE) != "And the one under it.":
        wrong(f"Enter on a plain line did not go down a line: on {page.evaluate(LINE)!r}")

    caret_to(page, "Wash up")
    normal(page)
    page.keyboard.press("2")
    page.keyboard.press("Enter")
    DRIVE.settled(page)
    if page.evaluate(DOC) != before:
        wrong("2 and Enter on a task changed the note")
    if "Post the letter" not in page.evaluate(LINE):
        wrong(f"2 and Enter did not go two lines down: on {page.evaluate(LINE)!r}")

    caret_to(page, "Water the plants")
    normal(page)
    page.keyboard.press("A")
    wait_for(page, f"({MODE})() === 'insert'", "insert mode")
    page.keyboard.press("Enter")
    DRIVE.settled(page)
    after = page.evaluate(DOC)
    if "- [ ] Water the plants" not in after.split("\n"):
        wrong(f"Enter in insert mode touched the task: {line_of(page, 'Water the plants')!r}")
    if after.count("\n") != before.count("\n") + 1:
        wrong("Enter in insert mode did not make a new line")
    DRIVE.shot(page, "03-insert")
    normal(page)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Enter in normal mode ticks a task, and is Vim's everywhere else"))
