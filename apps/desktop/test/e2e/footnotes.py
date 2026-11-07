from __future__ import annotations

from playwright.sync_api import Browser, Page

from settling import HIDE_CARET, quiet

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = (
    "# Where the words came from\n"
    "\n"
    "The first part[^one] of it.\n"
    "\n"
    "## Under one\n"
    "\n"
    "The second part[^two], and the first again[^one].\n"
    "\n"
    "[^one]: what the **first** one says\n"
    "\n"
    "[^two]: what the second one says\n"
)

SEED = """
async (note) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Where the words'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

LINE = """
() => {
  const view = window.orden
  return view.state.doc.lineAt(view.state.selection.main.head).text
}
"""

NUMBERS = "#write .cm-line .orden-footnote-number"

def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)

def the_card(page: Page) -> None:
    page.locator("#write .cm-line", has_text="Where the words").click()
    quiet(page)
    page.locator(NUMBERS).first.hover()
    wait_for(page, "document.querySelector('.orden-footnote-preview')", "the footnote's card")
    quiet(page)
    card = page.inner_text(".orden-footnote-preview")
    say(f"[card] {card!r}")
    is_true("what the first one says" in card, f"the card says {card!r}")
    is_true(
        page.evaluate("() => !!document.querySelector('.orden-footnote-preview strong')"),
        "the card shows the definition's markdown rather than drawing it",
    )
    shot(page, "01-card")
    page.mouse.move(5, 5)
    quiet(page)

def the_jump(page: Page) -> None:
    marks = page.locator(NUMBERS)
    marks.nth(2).click()
    quiet(page)
    said = page.evaluate(LINE)
    is_true(said.startswith("[^one]:"), f"pressing the mark went to {said!r}")
    shot(page, "02-definition")

    page.locator("#write .cm-line", has_text="what the second").click()
    quiet(page)
    page.locator("#write .cm-line", has_text="what the").first.locator(".orden-footnote-number").click()
    quiet(page)
    said = page.evaluate(LINE)
    is_true(
        said.startswith("The second part"),
        f"pressing the definition's number came back to {said!r} rather than the mark left",
    )
    shot(page, "03-back")

def the_outline(page: Page) -> None:
    page.evaluate("() => window.ordenApp.workspace.showPanel('outline')")
    quiet(page)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.body .row.note')].map((one) => one.textContent)"
    )
    say(f"[outline] {rows}")
    is_true(len(rows) == 2, f"the Outline's footnotes are {rows}")
    page.locator(".body .row.note").nth(1).click()
    quiet(page)
    said = page.evaluate(LINE)
    is_true(said.startswith("The second part"), f"the Outline's row went to {said!r}")
    shot(page, "04-outline")

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1240, "height": 860}, color_scheme="light")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.orden && document.querySelector('.cm-content')", "the editor")
    quiet(page)

    the_card(page)
    the_jump(page)
    the_outline(page)
    context.close()

def main() -> int:
    return DRIVE.run(drive, "a footnote is read and followed where it is used")

if __name__ == "__main__":
    raise SystemExit(main())
