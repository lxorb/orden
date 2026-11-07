from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = """---
title: A plan
tags: [one, two]
aliases:
  - The plan
count: 12
date: 2025-09-08
done: true
export:
  paper: A4
---

# One

The first part, which mentions nib and Zug.[^1]

## Under one

Something nested.

# Two

The second part.

[^1]: where the words came from
"""

SEED = """
async (note) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('A plan') || one.name.startsWith('One'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

def fresh(browser: Browser, finger: bool) -> Page:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1240, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.orden && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)
    return page


def selection(page: Page) -> None:
    page.evaluate(
        """() => {
          const doc = window.orden.state.doc
          const at = doc.toString().indexOf('The first part')
          window.orden.dispatch({ selection: { anchor: at, head: at + 14 } })
          window.orden.focus()
        }"""
    )
    page.wait_for_timeout(400)

    bar = page.locator("footer").last
    bar.hover()
    page.wait_for_timeout(500)
    said = bar.inner_text().replace("\n", " ")
    say(f"[status] {said!r}")
    shot(page, "03-selection")

    if "/" not in said:
        wrong(f"the bar does not say what is selected out of the whole: {said!r}")
    if not said.startswith("3/"):
        wrong(f"the selected words are not counted first: {said!r}")

def outline(page: Page) -> None:
    page.evaluate("() => window.ordenApp.workspace.showPanel('outline')")
    page.wait_for_timeout(600)

    rows = page.evaluate("() => [...document.querySelectorAll('.heading')].map((one) => one.textContent.trim())")
    notes = page.evaluate("() => [...document.querySelectorAll('.note')].map((one) => one.textContent.trim())")
    say(f"[outline] {json.dumps(rows)}")
    say(f"[footnotes] {json.dumps(notes)}")
    shot(page, "04-outline")

    if rows != ["One", "Under one", "Two"]:
        wrong(f"the outline is not the note's headings: {rows}")
    if len(notes) != 1 or "where the words came from" not in notes[0]:
        wrong(f"the footnotes section does not list the note's one footnote: {notes}")

    page.click(".note")
    page.wait_for_timeout(400)
    line = page.evaluate("() => window.orden.state.doc.lineAt(window.orden.state.selection.main.head).text")
    say(f"[footnote click] {json.dumps(line)}")
    if "The first part" not in line:
        wrong(f"a footnote row did not go to its mark: {line!r}")

    before = page.evaluate("() => window.orden.state.doc.toString()")
    page.locator(".heading").nth(2).drag_to(page.locator(".heading").first)
    page.wait_for_timeout(700)
    after = page.evaluate("() => window.orden.state.doc.toString()")
    order = page.evaluate("() => [...document.querySelectorAll('.heading')].map((one) => one.textContent.trim())")
    say(f"[dragged] {json.dumps(order)}")
    shot(page, "05-dragged")

    if after == before:
        wrong("dragging a heading changed nothing")
    if order != ["Two", "One", "Under one"]:
        wrong(f"the section did not move whole: {order}")
    if after.count("## Under one") != 1:
        wrong("the nested heading was copied rather than moved")

def dictionary(page: Page) -> None:
    page.evaluate("() => window.ordenApp.workspace.closePanel()")
    page.wait_for_timeout(400)

    place = page.evaluate(
        """() => {
          const at = window.orden.state.doc.toString().indexOf('nib and Zug')
          const box = window.orden.coordsAtPos(at + 1)
          return box && { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
        }"""
    )
    if not place:
        wrong("the word could not be found on screen")
        return

    page.mouse.click(place["x"], place["y"], button="right")
    page.wait_for_timeout(600)
    rows = page.evaluate("() => [...document.querySelectorAll('.orden-row')].map((one) => one.textContent.trim())")
    adding = [one for one in rows if "dictionary" in one]
    say(f"[menu] {json.dumps(adding)}")
    shot(page, "06-menu")

    if not adding:
        wrong("the menu over a word does not offer the dictionary")
        return

    page.evaluate(
        """() => {
          const row = [...document.querySelectorAll('.orden-row')]
            .find((one) => one.textContent.includes('dictionary'))
          row.click()
        }"""
    )
    page.wait_for_timeout(700)

    words = page.evaluate("() => window.ordenApp.modes.spellWords")
    quiet = page.evaluate(
        """() => [...document.querySelectorAll('.orden-known-word')].map((one) => ({
          word: one.textContent,
          spellcheck: one.getAttribute('spellcheck'),
        }))"""
    )
    say(f"[dictionary] {json.dumps(words)} quiet: {json.dumps(quiet)}")
    shot(page, "07-known")

    if "nib" not in (words or []):
        wrong(f"the word was not added: {words}")
    if not quiet:
        wrong("the word is in the list but the checker was not turned off over it")
    elif quiet[0]["spellcheck"] != "false":
        wrong(f"the mark does not turn the checker off: {quiet[0]}")

def drive(browser: Browser) -> None:
    page = fresh(browser, finger=False)
    selection(page)
    outline(page)
    dictionary(page)
    page.context.close()

def finger(browser: Browser) -> None:
    page = fresh(browser, finger=True)

    page.evaluate("() => window.ordenApp.workspace.showPanel('outline')")
    page.wait_for_timeout(700)
    shot(page, "11-phone-outline")

    notes = page.evaluate("() => document.querySelectorAll('.note').length")
    if notes != 1:
        wrong(f"the phone outline lists {notes} footnotes, not 1")

    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        say("--- a pointer ---")
        drive(browser)
        say("--- a finger ---")
        finger(browser)

    return DRIVE.verdict("a selection counts, a section moves, a word is a word")

if __name__ == "__main__":
    raise SystemExit(main())
