from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PATIENCE = 40

def fresh(browser: Browser, scheme: str = "light") -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    return page

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\nthe first line\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nreading\\n', at('Reading'))
  return ws.tree.children.map((one) => one.name)
}
"""

NAMES = """
() => {
  const walk = (entry) => entry.children.flatMap((one) =>
    one.is_dir ? [one.name + '/', ...walk(one)] : [one.name])
  return walk(window.ordenApp.workspace.tree)
}
"""

def entry(page: Page, label: str) -> None:
    row = page.locator(".menu .orden-row", has_text=label).first
    row.wait_for(state="visible", timeout=PATIENCE * 1000)
    row.click()

def named(page: Page, what: str, name: str, shot: str | None = None) -> None:
    field = page.locator("aside .row .naming input")
    field.wait_for(state="visible", timeout=PATIENCE * 1000)

    page.wait_for_timeout(400)
    still = page.evaluate("() => document.activeElement?.closest('.naming') !== null")
    if not still:
        raise SystemExit(f"{what}: the name field lost the keyboard before a name was typed")

    if shot:
        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / shot))
        say(f"wrote {shot}")

    field.fill(name)
    field.press("Enter")
    say(f"{what}: typed {name}")

def rest(page: Page) -> None:
    page.locator("aside .rest").click(button="right", position={"x": 20, "y": 8})

def quiet_row(page: Page) -> None:
    page.locator("aside .row.is-quiet").first.click(button="right")

def note_row(page: Page, name: str) -> None:
    page.locator(f"aside .row[data-path$='{name}']").first.click(button="right")

def drive(browser: Browser) -> None:
    page = fresh(browser)
    try:
        say(f"the space holds {page.evaluate(SEED)}")
        wait_for(page, "() => !!document.querySelector('aside .rest')", "the file list")

        rest(page)
        entry(page, "New note")
        named(page, "a note from the background menu", "From the ground", "tree-naming.png")

        rest(page)
        entry(page, "New canvas")
        named(page, "a canvas from the background menu", "Ground plane")

        quiet_row(page)
        entry(page, "New note inside")
        named(page, "a note inside a folder nobody wrote", "Inside the folder")

        note_row(page, "Deep work.md")
        entry(page, "New note inside")
        named(page, "a note inside a note", "Inside the note")

        wait_for(
            page,
            "() => window.ordenApp.workspace.tree.children.length >= 4",
            "the four new rows",
        )
        page.wait_for_timeout(400)
        names = page.evaluate(NAMES)
        say(f"the space now holds {names}")

        want = [
            "From the ground.md",
            "Ground plane.canvas",
            "Inside the folder.md",
            "Inside the note.md",
        ]
        missing = [one for one in want if one not in names]
        if missing:
            raise SystemExit(f"nothing was made for {missing}; the list holds {names}")

        held = page.evaluate(
            """() => {
              const walk = (entry) => entry.children.flatMap((one) =>
                one.is_dir ? [[one.name, one.children.map((child) => child.name)], ...walk(one)] : [])
              return Object.fromEntries(walk(window.ordenApp.workspace.tree))
            }"""
        )
        say(f"the rows that hold rows hold {held}")

        if "Inside the folder.md" not in held.get("Reading", []):
            raise SystemExit(f"the note was not made inside Reading; it holds {held}")

        under = held.get("Deep work", [])
        for one in ("Deep work.md", "Inside the note.md"):
            if one not in under:
                raise SystemExit(f"{one} is not in the note that took one inside: {under}")
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("four things made: two on the ground, and two inside rows")

if __name__ == "__main__":
    sys.exit(main())
