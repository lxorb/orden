from __future__ import annotations

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

UP = "!!document.querySelector('.palette input')"

WHERE = """
() => {
  const at = document.activeElement
  if (at?.closest('.cm-content')) return 'note'
  if (at?.closest('.palette')) return 'palette'
  return at?.tagName ?? null
}
"""

def shift_twice(page: Page) -> None:
    for _ in range(2):
        page.keyboard.down("Shift")
        page.keyboard.up("Shift")
        page.wait_for_timeout(60)

def toggling(page: Page, scheme: str) -> None:
    page.emulate_media(color_scheme=scheme)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n")
    DRIVE.open_note(page, "Plan")
    page.locator(".cm-content").first.click()
    page.wait_for_timeout(200)

    shift_twice(page)
    wait_for(page, UP, f"[{scheme}] the palette on Shift twice")
    if page.evaluate(WHERE) != "palette":
        wrong(f"[{scheme}] the palette's field did not take the keyboard")
    page.keyboard.type("deselect all")
    page.wait_for_timeout(200)
    hint = page.evaluate(
        "() => [...document.querySelectorAll('.palette .orden-row')].find((one) => one.textContent.includes('Deselect all tabs'))?.querySelector('kbd')?.textContent ?? null"
    )
    say(f"[{scheme}] the Deselect all tabs row wears {hint!r}")
    key = "Ctrl+Shift+D"
    if hint != key:
        wrong(f"[{scheme}] the Deselect all tabs row wears {hint!r}, not its key {key!r}")
    DRIVE.shot(page, f"{scheme}-01-open")

    shift_twice(page)
    wait_for(page, f"!({UP})", f"[{scheme}] the palette gone on Shift twice again")
    page.wait_for_timeout(250)
    where = page.evaluate(WHERE)
    say(f"[{scheme}] put away; the keyboard is in the {where}")
    if where != "note":
        wrong(f"[{scheme}] the keyboard went to {where}, not back to the note")
    DRIVE.shot(page, f"{scheme}-02-closed")

    shift_twice(page)
    wait_for(page, UP, f"[{scheme}] the palette again")
    typed = page.evaluate("() => document.querySelector('.palette input').value")
    if typed:
        wrong(f"[{scheme}] the palette came back on {typed!r}, not an empty field")
    page.keyboard.press("Escape")
    wait_for(page, f"!({UP})", f"[{scheme}] Escape to close it")

def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 800})
        DRIVE.open(page)
        toggling(page, scheme)
        page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Shift twice opens the palette and puts it away"))
