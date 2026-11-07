from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PATIENCE = 40

DESKTOP = {"width": 1180, "height": 760}
PHONE = {"width": 390, "height": 844}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def check(fine: bool, what: str) -> None:
    say(("ok   " if fine else "FAIL ") + what)
    if not fine:
        failures.append(what)

def fresh(browser: Browser, label: str, viewport: dict[str, int]) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    return page

AS_PHONE = """
() => {
  const app = window.ordenApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Quick start\\n\\nwhat this space is\\n', root)
  await ws.noteFrom('# Kitchen rebuild\\n\\nthe quote\\n', at('Projects'))
  await ws.noteFrom('# Loft\\n\\nthe other one\\n', at('Projects'))

  const page = await ws.noteFrom('# Handbook\\n\\nthe front page\\n', at('Handbook'))
  await ws.rename(page, 'index.md')
  await ws.noteFrom('# Chapter one\\n\\nthe first chapter\\n', at('Handbook'))

  ws.device.expand(at('Projects'))
  ws.device.expand(at('Handbook'))
  await ws.loadTree()

  return ws.notes.map((one) => one.path).sort()
}
"""

ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) =>
  [
    row.dataset.path ?? '',
    row.className.replace(/svelte-\\w+/, '').trim(),
    row.textContent.trim().slice(0, 30),
  ].join(' | '))
"""

MENU = """
() => [...document.querySelectorAll('[role="menuitem"]')].map((one) => one.textContent.trim())
"""

def row(page: Page, path_ends: str):
    return page.locator(f'aside .row[data-path$="{path_ends}"]').first

def relist(page: Page, where: str) -> None:
    if where != "phone":
        return

    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(350)

def unlist(page: Page, where: str) -> None:
    if where != "phone":
        return

    page.evaluate("() => { window.ordenApp.workspace.panel = null }")
    page.wait_for_timeout(350)

def shoot(browser: Browser, where: str, viewport: dict[str, int]) -> None:
    label = where
    page = fresh(browser, label, viewport)
    try:
        say(f"[{label}] the space holds {page.evaluate(SEED)}")

        if where == "phone":
            page.evaluate(AS_PHONE)
            page.evaluate(
                "() => { const ws = window.ordenApp.workspace;"
                " if (!ws.panel) ws.showPanel('tree') }"
            )
            page.wait_for_timeout(350)

        page.wait_for_timeout(500)
        for one in page.evaluate(ROWS):
            say(f"[{label}] {one}")

        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"vault-{where}.png"))
        say(f"[{label}] wrote vault-{where}.png")

        quiet = row(page, "Projects")
        check(quiet.count() == 1, f"[{label}] the folder is one row, named after itself")
        check(
            "is-quiet" in (quiet.get_attribute("class") or ""),
            f"[{label}] drawn quietly, because nobody has written in it",
        )
        check(
            quiet.locator(".twist").count() == 1,
            f"[{label}] with a twist for what it holds",
        )
        check(
            page.locator("aside .row .mark svg").count() > 0,
            f"[{label}] and a mark of the same family as every other row",
        )

        quiet.click(button="right")
        page.wait_for_selector('[role="menu"]:visible', timeout=5000)
        offered = page.evaluate(MENU)
        say(f"[{label}] its menu offers {offered}")
        check(
            not any("folder" in one.lower() for one in offered),
            f"[{label}] no entry anywhere says folder",
        )
        check(
            "New note inside" in offered,
            f"[{label}] and a note can be made inside it",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        quiet.click()
        wait_for(
            page,
            "() => window.ordenApp.workspace.active?.path?.endsWith('Projects/Projects.md')",
            f"[{label}] the folder note to open",
        )
        check(
            page.evaluate("() => window.ordenApp.workspace.active.doc === ''"),
            f"[{label}] as an empty page",
        )
        check(
            page.evaluate(
                "() => !window.ordenApp.workspace.notes.some((one) =>"
                " one.path.endsWith('Projects/Projects.md'))"
            ),
            f"[{label}] and nothing was written into the vault by looking",
        )
        relist(page, where)
        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"opened-{where}.png"))
        say(f"[{label}] wrote opened-{where}.png")

        unlist(page, where)
        page.locator(".cm-content").first.click()
        page.keyboard.type("The two of them")
        wait_for(
            page,
            "() => window.ordenApp.workspace.notes.some((one) =>"
            " one.path.endsWith('Projects/Projects.md'))",
            f"[{label}] the note to be written",
        )
        page.wait_for_timeout(500)
        relist(page, where)
        check(True, f"[{label}] writing in it wrote the note the row stands for")
        check(
            "is-quiet" not in (row(page, "Projects").get_attribute("class") or ""),
            f"[{label}] and the row is no longer quiet",
        )
        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"written-{where}.png"))
        say(f"[{label}] wrote written-{where}.png")

        row(page, "Loft.md").click()
        wait_for(
            page,
            "() => window.ordenApp.workspace.active?.path?.endsWith('Projects/Loft.md')",
            f"[{label}] the note to open",
        )
        page.keyboard.press("Control+Shift+KeyP")
        page.wait_for_selector(".palette input")
        page.keyboard.type("Move this note")
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")
        page.locator('div.sheet[role="dialog"]').wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"move-{where}.png"))
        say(f"[{label}] wrote move-{where}.png")

        offered = [one.strip() for one in page.locator(".found-row").all_inner_texts()]
        say(f"[{label}] the sheet offers {offered}")
        check(
            "Handbook" in offered and any(one.endswith("Notes") for one in offered),
            f"[{label}] a row that holds notes is a place, and so is the space",
        )
        check(
            page.locator(".found-row .space").count() == 1,
            f"[{label}] and the space wears its own mark rather than a folder's",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        relist(page, where)

        book = row(page, "Handbook")
        check(
            book.inner_text().strip().startswith("Handbook"),
            f"[{label}] a folder whose page is an index is named after the folder",
        )
        check(
            page.locator('aside .row[data-path$="index.md"]').count() == 0,
            f"[{label}] and the index is not a row of its own inside itself",
        )
        check(
            "is-quiet" not in (book.get_attribute("class") or ""),
            f"[{label}] nor quiet, because it has a page after all",
        )
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        shoot(browser, "desktop", DESKTOP)
        shoot(browser, "phone", PHONE)

    return DRIVE.verdict("a vault's folders read as notes nobody has written yet")

if __name__ == "__main__":
    sys.exit(main())
