from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
SHOTS = DRIVE.shots

EMOJI = ["\U0001F534", "\U0001F7E0", "\U0001F7E2", "\U0001F535", "\U0001F7E3"]

NOTE = (
    "# Marking up\n\n"
    "A plain ==highlight== the way every note already holds one.\n\n"
    + "".join(
        f"Careful: =={one} tone {number} mark== in a sentence.\n\n"
        for number, one in enumerate(EMOJI, start=1)
    )
    + "One with ==\U0001F535 **bold** inside== it.\n\n"
    "A last paragraph.\n\n"
    "A closing paragraph, for the keyboard to highlight.\n"
)

WRAPPED = (
    "# Wrapped\n\n"
    "A paragraph hard wrapped\nover three lines in the file\nand meant as one.\n\n"
    "The next paragraph.\n"
)

PLAN = "# The plan\n\nWhat the plan says.\n"
JOURNAL = "# Monday\n\nA passage worth lifting out into a note of its own.\n\nAnd the rest.\n"

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const one of notes) await ws.noteFrom(one, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

WRITTEN = """
() => {
  const found = [...document.querySelectorAll('.cm-content .nib-mark')]
  return found.map((one) => ({
    tone: [...one.classList].find((name) => name.startsWith('tone-')) ?? null,
    paint: getComputedStyle(one).backgroundColor,
    shown: one.textContent,
  }))
}
"""

READ = """
() => {
  const found = [...document.querySelectorAll('#write mark')]
  return found.map((one) => ({
    tone: one.className || null,
    paint: getComputedStyle(one).backgroundColor,
    shown: one.textContent,
  }))
}
"""

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def is_true(claim: bool, what: str) -> None:
    if claim:
        say(f"ok: {what}")
    else:
        wrong(what)

def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    say(f"shot {name}.png")

def fresh(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED, [NOTE, WRAPPED, PLAN, JOURNAL])}")
    page.wait_for_timeout(400)
    return page

def open_note(page: Page, starts: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { activate: true })
        }""",
        starts,
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)

def at(page: Page, words: str, offset: int = 0) -> int:
    found = page.evaluate("(words) => window.nib.state.doc.toString().indexOf(words)", words)
    if found < 0:
        raise SystemExit(f"the note does not say {words!r}")

    return found + offset

def select(page: Page, anchor: int, head: int) -> None:
    page.evaluate(
        "([anchor, head]) => {"
        "  window.nib.focus();"
        "  window.nib.dispatch({ selection: { anchor, head }, scrollIntoView: true })"
        "}",
        [anchor, head],
    )
    page.wait_for_timeout(300)

def opaque(colour: str) -> bool:
    if colour in ("", "transparent", "rgba(0, 0, 0, 0)"):
        return False
    return True

def in_the_editor(page: Page) -> None:
    open_note(page, "Marking up")
    select(page, at(page, "A last paragraph"), at(page, "A last paragraph"))
    page.wait_for_timeout(300)

    marks = page.evaluate(WRITTEN)
    tones = [one["tone"] for one in marks]
    is_true(len(marks) == 6, f"the editor coloured six highlights, not {len(marks)}")
    is_true(
        tones == ["tone-1", "tone-2", "tone-4", "tone-5", "tone-6", "tone-5"],
        f"each emoji drew its own tone: {tones}",
    )

    painted = {one["tone"]: one["paint"] for one in marks}
    is_true(
        all(opaque(colour) for colour in painted.values()),
        f"every tone paints a colour: {painted}",
    )
    is_true(
        len(set(painted.values())) == 5,
        f"the five tones are five different colours: {sorted(set(painted.values()))}",
    )

    shown = "".join(one["shown"] for one in marks)
    is_true(
        not any(emoji in shown for emoji in EMOJI),
        f"the colour never reached the screen as an emoji: {shown!r}",
    )
    is_true(
        "==" not in page.evaluate("() => document.querySelector('.cm-content').textContent"),
        "the marks are hidden while the caret is away",
    )

    shot(page, "editor-six-tones")

    select(page, at(page, "tone 1 mark", 2), at(page, "tone 1 mark", 2))
    page.wait_for_timeout(400)
    line = page.evaluate(
        """() => {
          const at = window.nib.state.selection.main.head
          const line = window.nib.domAtPos(at).node
          const row = line.nodeType === 1 ? line.closest('.cm-line') : line.parentElement.closest('.cm-line')
          return row ? row.textContent : ''
        }"""
    )
    is_true("==" in line, f"the marks come back with the caret inside: {line!r}")
    is_true("\U0001F534" in line, "and so does the colour, so it stays editable")
    shot(page, "editor-revealed")

    select(page, at(page, "A last paragraph"), at(page, "A last paragraph"))
    page.wait_for_timeout(300)
    box = page.evaluate(
        """() => {
          const mark = document.querySelector('.cm-content .nib-mark')
          const box = mark.getBoundingClientRect()
          return { x: box.left + 4, y: box.top + box.height / 2 }
        }"""
    )
    page.mouse.click(box["x"], box["y"])
    page.wait_for_timeout(400)
    landed = page.evaluate(
        """() => {
          const at = window.nib.state.selection.main.head
          return window.nib.state.doc.sliceString(at, at + 6)
        }"""
    )
    is_true(
        not any(emoji in landed for emoji in EMOJI),
        f"a click on the words lands in the words, not in the colour: {landed!r}",
    )

def in_the_reading_view(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('#write mark')", "the note read")
    page.wait_for_timeout(500)

    marks = page.evaluate(READ)
    tones = [one["tone"] for one in marks]
    is_true(
        tones == [None, "tone-1", "tone-2", "tone-4", "tone-5", "tone-6", "tone-5"],
        f"the reading view wears the same classes: {tones}",
    )
    is_true(
        all(opaque(one["paint"]) for one in marks),
        f"and paints every one of them: {[one['paint'] for one in marks]}",
    )
    is_true(
        not any(emoji in one["shown"] for one in marks for emoji in EMOJI),
        "and the emoji is nowhere on the page",
    )
    shot(page, "reading-six-tones")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)

def the_bar(page: Page) -> None:
    open_note(page, "Marking up")
    before = page.evaluate("() => window.nibApp.modes.highlightTone")
    is_true(before is None, f"nothing is chosen to begin with, so the plain one: {before}")

    select(page, at(page, "A last paragraph"), at(page, "A last paragraph", 6))
    wait_for(page, "document.querySelector('.nib-bar-at')", "the formatting bar")
    shot(page, "bar-actions")

    shape = page.evaluate(
        """() => {
          const bar = document.querySelector('.nib-bar-at')
          return { role: bar.getAttribute('role'), label: bar.getAttribute('aria-label') }
        }"""
    )
    is_true(shape["role"] == "toolbar", f"the bar says what it is: {shape}")
    is_true(bool(shape["label"]), "and it is named, since every button on it is one letter")

    dots = page.locator(".nib-bar-at button.swatch")
    is_true(dots.count() == 1, f"one dot beside the actions, not {dots.count()}")
    dots.first.click()
    page.wait_for_timeout(300)
    opened = page.locator(".nib-bar-at button.swatch")
    is_true(opened.count() == 6, f"the dot opens the six colours, not {opened.count()}")
    is_true(
        page.locator(".nib-bar-at button.swatch.bare").count() == 1,
        "and one of them is the highlight with no colour of its own",
    )
    shot(page, "bar-colours")

    opened.nth(1).click()
    page.wait_for_timeout(500)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    is_true(
        "==\U0001F534 A last==" in text,
        f"picking red wrote the markup Obsidian writes: {text[text.index('A last') - 20 :][:40]!r}",
    )
    is_true(
        page.evaluate("() => window.nibApp.modes.highlightTone") == 1,
        "and the colour stuck",
    )

    select(page, at(page, "A plain"), at(page, "A plain", 7))
    page.wait_for_timeout(300)
    page.locator('.nib-bar-at button[aria-label="Highlight"]').click()
    page.wait_for_timeout(400)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    is_true("==\U0001F534 A plain==" in text, "the button writes the colour that stuck")

    page.evaluate("() => window.nibApp.modes.setHighlightTone(null)")
    select(page, at(page, "A closing"), at(page, "A closing", 9))
    page.wait_for_timeout(300)
    page.locator(".nib-bar-at button.swatch").first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    is_true(
        page.locator(".nib-bar-at button.swatch").count() == 6,
        "Enter on the dot opens the colours",
    )

    inside = page.evaluate(
        """() => {
          const bar = document.querySelector('.nib-bar-at')
          return bar ? bar.contains(document.activeElement) : false
        }"""
    )
    is_true(inside, "and the keyboard stays in the bar rather than falling to the page")

    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(200)
    moved = page.evaluate(
        """() => {
          const on = document.activeElement
          const dots = [...document.querySelectorAll('.nib-bar-at button.swatch')]
          return dots.indexOf(on)
        }"""
    )
    is_true(moved == 1, f"the arrows step along the colours, landing on {moved}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    is_true("==\U0001F534 A closing==" in text, "and Enter on a colour highlights in it")

    page.evaluate("() => window.nibApp.modes.setHighlightTone(null)")
    page.wait_for_timeout(200)
    is_true(
        page.evaluate("() => window.nibApp.modes.highlightTone") is None,
        "the plain highlight is one of the six answers",
    )

def the_newline(page: Page) -> None:
    open_note(page, "Wrapped")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('#write p')", "the note read")
    page.wait_for_timeout(500)

    def breaks() -> int:
        return page.evaluate("() => document.querySelectorAll('#write p br').length")

    is_true(breaks() == 0, f"CommonMark to begin with, so no break: {breaks()}")
    shot(page, "reading-commonmark")

    page.evaluate("() => window.nibApp.modes.toggleHardBreaks()")
    page.wait_for_timeout(900)
    is_true(breaks() == 2, f"the switch breaks the wrapped paragraph: {breaks()}")
    shot(page, "reading-hard-breaks")

    page.evaluate("() => window.nibApp.modes.toggleHardBreaks()")
    page.wait_for_timeout(900)
    is_true(breaks() == 0, "and puts it back")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)

def the_link(page: Page) -> None:
    open_note(page, "Monday")
    start = at(page, "A passage worth")
    end = at(page, "of its own", 10)

    for spelling, wanted in (
        ("wikilink", "[[A passage worth lifting out into a note of its own]]"),
        ("shortest", "](A%20passage%20worth%20lifting%20out%20into%20a%20note%20of%20its%20own.md)"),
    ):
        page.evaluate("(one) => window.nibApp.modes.setLinkFormat(one)", spelling)
        page.wait_for_timeout(200)
        page.evaluate(
            "([from, to]) => window.nibApp.workspace.extractSelection(from, to)",
            [start, end],
        )
        page.wait_for_timeout(900)

        text = page.evaluate("() => window.nib.state.doc.toString()")
        is_true(wanted in text, f"{spelling} wrote {wanted!r}")

        page.evaluate("() => window.nibApp.workspace.undoFileAction()")
        page.wait_for_timeout(700)

    page.evaluate("() => window.nibApp.modes.setLinkFormat('wikilink')")
    page.wait_for_timeout(200)

    resolved = page.evaluate(
        """() => {
          const links = window.nibApp.links
          const from = window.nibApp.workspace.active.path
          return [
            links.targetOf(from, { kind: 'wikilink', target: 'The plan' }),
            links.targetOf(from, { kind: 'markdown', target: 'The plan.md' }),
          ]
        }"""
    )
    is_true(
        all(one for one in resolved) and resolved[0] == resolved[1],
        f"a wikilink and a markdown link reach the same note: {resolved}",
    )

def drive(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme)
    try:
        in_the_editor(page)
        in_the_reading_view(page)
        the_bar(page)
        the_newline(page)
        the_link(page)
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)

    return DRIVE.verdict("six colours, one link spelling, one answer about a newline")

if __name__ == "__main__":
    raise SystemExit(main())
