"""Enter on a task in Vim's normal mode ticks it, in the built app.

Asked for in #361: *"when pressing enter while on a todo in vim normal mode, then it
should be checked"*. What this drives, with modal editing on, against the real editor
and the real note:

  * Enter on a task in normal mode ticks it, the caret staying on its line, and Enter
    again clears it - what Ctrl+Enter does.
  * Enter on a line that is not a task is still Vim's own: the caret goes down a line
    and the note is untouched. It was not, before this: taking the app's keys off
    Vim's keymap left it shorter than the library counts from, every key of Vim's that
    stands for others threw, and Enter fell through to the editor's own and split the
    line - so a plain Enter in normal mode wrote a new list item.
  * A count in front of Enter is still a count: `2` and Enter on a task goes two lines
    down and ticks nothing.
  * Enter in insert mode on a task is still a new line, and ticks nothing.

    python apps/desktop/test/e2e/vim-todo.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/vim-todo/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NOTE = "# Chores\n\n- [ ] Wash up\n- [ ] Water the plants\n- [ ] Post the letter\n\nA plain line.\nAnd the one under it.\n"

DOC = "() => window.nib.state.doc.toString()"
MODE = "() => window.nibApp.modes.vimModeOf(window.nib)"

# The caret onto a line, by the words on it, and the editor given the keyboard.
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
    """The line holding `words` comes to start with `line`; the app ticks a box as it
    ticks every box, a moment after the key and with the day it was done after it."""
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

    # Enter on a task: ticked, the caret where it was; and again: cleared.
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

    # Enter on a plain line: Vim's own, down a line, nothing written.
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

    # A count is a count: two lines down from a task, and no box ticked.
    caret_to(page, "Wash up")
    normal(page)
    page.keyboard.press("2")
    page.keyboard.press("Enter")
    DRIVE.settled(page)
    if page.evaluate(DOC) != before:
        wrong("2 and Enter on a task changed the note")
    if "Post the letter" not in page.evaluate(LINE):
        wrong(f"2 and Enter did not go two lines down: on {page.evaluate(LINE)!r}")

    # Insert mode: Enter is a new line, and the task under the caret is left alone.
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
