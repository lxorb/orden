
from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DOC = "# Plan\n\nFirst line beta.\nSecond line alpha.\n\nthird\n"
WORDS = "# Words\n\nLeft as they were.\n"

MIDDLE = DOC.index("alpha")
LINES = (DOC.index("First"), DOC.index("alpha.") + len("alpha."))

CASES = {
    "Code block": (
        "Second line \n```\n\n```\nalpha.",
        "```\nFirst line beta.\nSecond line alpha.\n```",
    ),
    "Math block": (
        "Second line \n$$\n\n$$\nalpha.",
        "$$\nFirst line beta.\nSecond line alpha.\n$$",
    ),
    "Callout": (
        "Second line \n> [!NOTE]\n> \n\nalpha.",
        "> [!NOTE]\n> First line beta.\n> Second line alpha.",
    ),
    "Table": (
        "|     |     |\n\nalpha.",
        "First line beta.\nSecond line alpha.\n\n| Column 1",
    ),
}

def run_row(page: Page, row: str) -> None:
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type(row, delay=1)
    page.wait_for_function(
        "(row) => [...document.querySelectorAll('[role=option]')].some((one) => one.innerText.startsWith(row))",
        arg=row,
    )
    page.keyboard.press("Enter")
    page.wait_for_selector(".palette input", state="detached")

def put(page: Page, anchor: int, head: int) -> None:
    page.evaluate(
        """([doc, anchor, head]) => {
          const view = window.nib
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor, head } })
          view.focus()
        }""",
        [DOC, anchor, head],
    )

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, DOC, WORDS)
    DRIVE.open_note(page, "Plan")

    for row, (inside, selected) in CASES.items():
        say(row)
        put(page, MIDDLE, MIDDLE)
        run_row(page, row)
        text = page.evaluate("() => window.nib.state.doc.toString()")
        if inside not in text:
            wrong(f"{row} inside a line: {text!r}")

        put(page, *LINES)
        run_row(page, row)
        text = page.evaluate("() => window.nib.state.doc.toString()")
        if selected not in text:
            wrong(f"{row} over two lines: {text!r}")

    say("Ctrl+Z takes the block back and leaves the words")
    DRIVE.open_note(page, "Words")
    page.evaluate(
        """(head) => {
          window.nib.dispatch({ selection: { anchor: 0, head } })
          window.nib.focus()
        }""",
        len(WORDS),
    )
    run_row(page, "Code block")
    if "```" not in page.evaluate("() => window.nib.state.doc.toString()"):
        wrong("the selection was not wrapped")
    page.wait_for_function("() => window.nib.hasFocus")
    page.keyboard.press("Control+z")
    DRIVE.wait_for(page, f"() => window.nib.state.doc.toString() === {WORDS!r}", "the words as they were")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
