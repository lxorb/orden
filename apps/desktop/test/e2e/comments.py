from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = (
    "# Comments\n\n"
    "A line with %%a note to myself%% inside it.\n\n"
    "%% a whole line of it %%\n\n"
    "A line with <!-- the other spelling --> inside it.\n\n"
    "%%\nwritten across\nlines\n%%\n\n"
    "Before <!-- an aside\nbroken over a line --> after.\n\n"
    "```\n"
    "%% kept, because a fence is showing it %%\n"
    "```\n"
)

SEED = """
async (note) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

WRITTEN = """
() => ({
  shown: [...document.querySelectorAll('.cm-content .cm-line')]
    .map((line) => line.textContent)
    .join('\\n'),
  doc: window.orden.state.doc.toString(),
})
"""

def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    page.wait_for_timeout(400)

    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Comments'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.orden && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)
    return page

def drive(browser: Browser) -> None:
    page = fresh(browser)

    written = page.evaluate(WRITTEN)
    say(f"[written] {json.dumps(written['shown'])}")
    shot(page, "01-written")

    if "a note to myself" in written["shown"]:
        wrong("a percent comment is on the page in the editor")
    if "the other spelling" in written["shown"]:
        wrong("an HTML comment is on the page in the editor")
    if "a whole line of it" in written["shown"]:
        wrong("a percent comment on its own line is on the page")
    if "kept, because a fence is showing it" not in written["shown"]:
        wrong("a comment inside a fence was hidden, and a fence is showing it")
    if "A line with  inside it." not in written["shown"]:
        wrong("the words around a comment did not stay")

    for across in ("written across", "broken over a line"):
        if across not in written["shown"]:
            wrong(f"a comment across lines is not on the page: {across}")

    if "%%a note to myself%%" not in written["doc"]:
        wrong("the comment was rewritten in the note")

    at = written["doc"].index("a note to myself") + 4
    page.evaluate(
        """(at) => {
          window.orden.dispatch({ selection: { anchor: at } })
          window.orden.focus()
        }""",
        at,
    )
    page.wait_for_timeout(500)
    revealed = page.evaluate(WRITTEN)
    shot(page, "02-caret-inside")
    if "a note to myself" not in revealed["shown"]:
        wrong("the comment did not come back with the caret inside it")

    page.evaluate(
        """() => {
          const end = window.orden.state.doc.length
          window.orden.dispatch({ changes: { from: end, insert: 'TYPED' }, selection: { anchor: end + 5 } })
        }"""
    )
    page.wait_for_timeout(300)
    typed = page.evaluate(WRITTEN)
    if not typed["doc"].endswith("```\nTYPED"):
        wrong(f"typing went somewhere else: {json.dumps(typed['doc'][-40:])}")
    if "TYPED" not in typed["shown"]:
        wrong("what was typed is not on the page")

    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, "03-reading")
    read = page.evaluate("() => document.querySelector('#write')?.textContent ?? ''")
    say(f"[reading] {json.dumps(read[:160])}")

    for hidden in (
        "a note to myself",
        "the other spelling",
        "a whole line of it",
        "written across",
        "broken over a line",
    ):
        if hidden in read:
            wrong(f"a comment reached the reading view: {hidden}")
    if "kept, because a fence is showing it" not in read:
        wrong("the fence stopped showing what it was showing")
    if "A line with  inside it." not in read:
        wrong("the words around a comment did not survive the reading view")

    page.context.close()

def main() -> int:
    return DRIVE.run(drive, "a note to yourself stays one, whichever way it is written")

if __name__ == "__main__":
    raise SystemExit(main())
