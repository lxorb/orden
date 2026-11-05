
from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot


def delete_after_typing(page: Page) -> None:
    say("a note deleted straight after typing comes back with what was typed")
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(" last words", delay=1)
    path = page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const path = ws.active.path
          await ws.remove(path, false)
          await ws.undoFileAction()
          return path
        }"""
    )
    text = page.evaluate("(path) => window.nibApp.workspace.noteText(path)", path)
    if "last words" not in (text or ""):
        wrong(f"undo put the note back as {text!r}")


def palette_rename(page: Page) -> None:
    say("the palette's Rename promises no key the note cannot hear")
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type("Rename", delay=1)
    page.wait_for_function("() => [...document.querySelectorAll('[role=option]')].some((one) => one.innerText.startsWith('Rename'))")
    row = page.evaluate(
        "() => [...document.querySelectorAll('[role=option]')].find((one) => one.innerText.startsWith('Rename')).innerText"
    )
    if "F2" in row:
        wrong(f"the row says {row!r}")
    page.keyboard.press("Escape")


def enter_as_a_key(page: Page) -> None:
    say("Enter is not taken as an app key, and Ctrl+F9 is")
    page.keyboard.press("Control+,")
    page.wait_for_function(
        """() => {
          const sheet = document.querySelector('[role=dialog]')
          const panes = [...(sheet?.querySelectorAll('nav button, [role=tab], aside button') ?? [])]
          const pane = panes.find((one) => one.innerText.trim() === 'Shortcuts')
          pane?.click()
          return !!pane
        }"""
    )
    page.wait_for_function(
        "() => [...document.querySelectorAll('[role=dialog] button')].some((one) => one.parentElement.innerText.startsWith('Scratchpad') || one.parentElement.parentElement.innerText.startsWith('Scratchpad'))"
    )
    press_row = """() => {
      const buttons = [...document.querySelectorAll('[role=dialog] button')]
      buttons
        .filter((one) => one.parentElement.parentElement.innerText.startsWith('Scratchpad') || one.parentElement.innerText.startsWith('Scratchpad'))[0]
        .click()
    }"""
    for key, taken in (("Enter", False), ("Tab", False), ("ArrowLeft", False), ("Control+F9", True)):
        page.evaluate(press_row)
        page.keyboard.press(key)
        said = page.evaluate("() => window.nibApp.shortcuts.overrides['app.scratchpad'] ?? null")
        say(f"  {key}: {said}")
        if bool(said) != taken:
            wrong(f"{key} {'was' if said else 'was not'} taken as an app key: {said!r}")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nFirst\n", "# Other\n\nSecond\n")
    DRIVE.open_note(page, "Plan")
    delete_after_typing(page)
    DRIVE.open_note(page, "Other")
    palette_rename(page)
    enter_as_a_key(page)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
