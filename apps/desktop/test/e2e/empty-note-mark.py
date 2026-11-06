from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WORN = """
(name) => {
  const row = [...document.querySelectorAll('.row[data-path]')]
    .find((one) => one.dataset.path.replace(/\\\\/g, '/').split('/').pop().replace(/\\.md$/, '') === name)
  if (!row) return 'no row'
  const svg = row.querySelector('svg')
  if (!svg) return 'no mark'
  const drawn = svg.innerHTML
  if (drawn.includes('M20 20a2 2 0 0 0 2-2V8')) return 'folder'
  if (drawn.includes('M16 13H8')) return 'note'
  if (drawn.includes('M6 22a2 2 0 0 1-2-2V4')) return 'file'
  return 'other'
}
"""

def worn(page: Page, name: str) -> str:
    return page.evaluate(WORN, name)

def expect(page: Page, name: str, mark: str, what: str) -> None:
    try:
        wait_for(page, f"({WORN})({name!r}) === {mark!r}", what, patience=15)
    except SystemExit:
        wrong(f"{what}: the row of {name} wears {worn(page, name)}, not {mark}")
    else:
        say(f"{name} wears {mark}")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Empty one\n\n", "# Full one\n\nSome words.\n")
    DRIVE.seed(page, "# Box\n", "# Inside\n\nWords inside.\n", folder="Box")

    expect(page, "Empty one", "file", "a note that is only its name")
    expect(page, "Full one", "note", "a note with words in it")
    expect(page, "Box", "folder", "a note that is only its name and holds a note")
    shot(page, "list")

    DRIVE.open_note(page, "Empty one")
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.keyboard.type("A first sentence.")
    expect(page, "Empty one", "note", "the empty note once it has words")
    for _ in range(len("A first sentence.")):
        page.keyboard.press("Backspace")
    expect(page, "Empty one", "file", "the note emptied again")

    tab = page.evaluate(
        """() => {
          const svg = document.querySelector('[data-tab][aria-current=page] svg')
          return svg ? svg.innerHTML.includes('M6 22a2 2 0 0 1-2-2V4') && !svg.innerHTML.includes('M16 13H8') : null
        }"""
    )
    if tab is not True:
        wrong("the tab of the empty note does not wear the empty page")
    shot(page, "emptied")

    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a note that says nothing wears the empty page, or the folder"))
