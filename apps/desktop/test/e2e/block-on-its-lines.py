"""A block from the palette stands on its own lines and takes no words with it.

With the caret inside a line, `Code block` wrote the closing fence glued to the rest of
the line, which closes nothing, so the note below read as code. With words selected it
deleted them and left an empty block. See `insertBlock` in packages/editor/src/commands.ts.

    python apps/desktop/test/e2e/block-on-its-lines.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DOC = "# Plan\n\nFirst line beta.\nSecond line alpha.\n\nthird\n"

MIDDLE = DOC.index("alpha")
LINES = (DOC.index("First"), DOC.index("alpha.") + len("alpha."))

#: What each row comes to, with the caret inside a line and with two lines selected.
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
        "Second line \n> [!NOTE]\n> \nalpha.",
        "> [!NOTE]\n> First line beta.\n> Second line alpha.",
    ),
    "Table": (
        "|     |     |\nalpha.",
        "First line beta.\nSecond line alpha.\n| Column 1",
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
    DRIVE.seed(page, DOC)
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
    put(page, *LINES)
    run_row(page, "Code block")
    page.keyboard.press("Control+z")
    DRIVE.wait_for(page, "() => !window.nib.state.doc.toString().includes('```')", "the fence gone")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
