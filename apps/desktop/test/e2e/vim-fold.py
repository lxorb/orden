from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NOTE = "# Chapter one\n\nThe first words.\n\n- a list item\n  - a child of it\n  - another child\n- the last item\n\n# Chapter two\n\nThe second chapter.\n"

DOC = "() => window.nib.state.doc.toString()"
MODE = "() => window.nibApp.modes.vimModeOf(window.nib)"
FOLDED = "() => document.querySelectorAll('.nib-folded').length"
IN_NOTE = "() => !!document.activeElement?.closest('.cm-content')"

CARET_TO = """
(words) => {
  const view = window.nib
  const at = view.state.doc.toString().indexOf(words)
  view.dispatch({ selection: { anchor: at + 2 } })
  view.focus()
}
"""


def caret_to(page: Page, words: str) -> None:
    page.evaluate(CARET_TO, words)
    DRIVE.settled(page)


def normal(page: Page) -> None:
    page.keyboard.press("Escape")
    wait_for(page, f"({MODE})() === 'normal'", "normal mode")


def folds(page: Page, count: int, what: str) -> None:
    DRIVE.waited(page, f"({FOLDED})() === {count}", what, patience=10)
    if not page.evaluate(IN_NOTE):
        wrong(f"{what}: the keyboard left the note")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Chapter one")

    page.evaluate("() => window.nibApp.modes.setVimKeys(true)")
    wait_for(page, "document.querySelector('.cm-editor.nib-vim')", "modal editing")

    caret_to(page, "Chapter one")
    normal(page)
    page.keyboard.press("Tab")
    folds(page, 1, "Tab on a heading folds it")
    DRIVE.shot(page, "01-heading")

    page.keyboard.press("Escape")
    page.keyboard.press("Tab")
    folds(page, 0, "Escape and then Tab opens it again")

    caret_to(page, "a list item")
    normal(page)
    page.keyboard.press("Tab")
    folds(page, 1, "Tab on a list item folds its children")
    if page.evaluate(DOC) != NOTE:
        wrong("Tab in normal mode changed the note")
    DRIVE.shot(page, "02-list")
    page.keyboard.press("Tab")
    folds(page, 0, "Tab again opens the list item")

    page.keyboard.press("Shift+Tab")
    folds(page, 2, "Shift+Tab folds every heading")
    DRIVE.shot(page, "03-all")
    page.keyboard.press("Shift+Tab")
    folds(page, 0, "Shift+Tab again opens everything")

    caret_to(page, "the last item")
    normal(page)
    page.keyboard.press("A")
    wait_for(page, f"({MODE})() === 'insert'", "insert mode")
    page.keyboard.press("Tab")
    DRIVE.settled(page)
    if "  - the last item" not in page.evaluate(DOC):
        wrong("Tab in insert mode did not indent the list item")
    normal(page)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Tab in Vim's normal mode folds, as Org mode does"))
