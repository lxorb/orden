from __future__ import annotations

import json

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PASSWORD = "tulip ladder"

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Diary\\n\\nThe secret words.\\n', root)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Diary.md')
  await ws.openEntry(note.path, {})
  if (ws.panel !== 'tree') ws.showPanel('tree')
  return { root, path: note.path }
}
"""

PROTECTION_ON = (
    "try { const kept = JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]');"
    " const list = Array.isArray(kept) ? kept : [];"
    " if (!list.includes('shown-protection'))"
    " localStorage.setItem('orden:hidden-kinds', JSON.stringify([...list, 'shown-protection'])) }"
    " catch {}"
)

PROTECTED = """
(where) => window.ordenApp.workspace.protection.own(where.root, where.path)?.way ?? null
"""


def opened(browser: Browser, on: bool):
    context = browser.new_context(viewport={"width": 1280, "height": 820}, reduced_motion="reduce")
    if on:
        context.add_init_script(PROTECTION_ON)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}") if message.type == "error" else None,
    )
    DRIVE.open(page)
    where = page.evaluate(SEED)
    say(f"the note: {json.dumps(where)}")
    wait_for(page, "document.querySelector('.cm-content')", "the editor")
    return context, page, where


def drive(browser: Browser) -> None:
    context, page, where = opened(browser, False)
    row = page.locator(f'.row[data-path="{where["path"]}"]')
    row.click(button="right")
    page.get_by_role("menuitem", name="Rename", exact=True).wait_for()
    if page.get_by_role("menuitem", name="Protect", exact=True).count():
        wrong("Protect is in the menu while protection is off")
    say("no Protect while protection is off")
    context.close()

    context, page, where = opened(browser, True)
    row = page.locator(f'.row[data-path="{where["path"]}"]')
    row.click(button="right")
    page.get_by_role("menuitem", name="Protect", exact=True).click()
    wait_for(page, "document.querySelector('input[type=password]')", "the password sheet")
    shot(page, "01-choose")
    fields = page.locator("input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Protect", exact=True).click()
    wait_for(page, f"({PROTECTED})({json.dumps(where)}) === 'password'", "the note protected", 30)
    say("protected with a password")

    row.click(button="right")
    page.get_by_role("menuitem", name="Lock", exact=True).click()
    wait_for(page, "document.querySelector('.locked input[type=password]')", "the lock screen")
    shot(page, "02-locked")
    if "secret words" in page.locator(".pane").first.inner_text():
        wrong("the lock screen shows the note's words")

    page.locator(".locked input[type=password]").fill("wrong")
    page.locator(".locked button[type=submit]").click()
    wait_for(page, "document.querySelector('.locked [role=alert]')", "the wrong password said")

    page.locator(".locked input[type=password]").fill(PASSWORD)
    page.locator(".locked button[type=submit]").click()
    wait_for(page, "!document.querySelector('.locked') && document.querySelector('.cm-content')", "the note open again", 30)
    shot(page, "03-open")
    say("unlocked with the password")
    context.close()


def main() -> int:
    return DRIVE.run(drive, "a note is protected with a password, locks, and opens with it")


if __name__ == "__main__":
    raise SystemExit(main())
