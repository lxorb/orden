"""Every setting has a `?` beside it, and the sentence behind it shows (#768).

Every pane of Settings is opened in turn, and every row in it that sets something - a
switch, a slider, a dropdown, a row of choices, of colours or a field to type in - has
to carry the glyph. Then one is hovered, tapped and reached with the keyboard, and the
sentence has to be there each time; and Enter on the glyph of a row that is a switch as
a whole explains the row and leaves the setting as it was.

Run it from the repository root:

    python apps/desktop/test/e2e/setting-hints.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

#: The rows of the pane on screen that set something, and which of them have no `?`.
#: A row of a list (a shortcut, a command on the phone's bar, a device, a host) is a
#: thing in a list rather than a setting, and says what it is by its name.
UNEXPLAINED = """
() => {
  const pane = document.querySelector('[role="dialog"][aria-label="Settings"]')
  const rows = [...pane.querySelectorAll('.nib-setting')].filter((row) =>
    !row.closest('.shortcut, .button, .extension') &&
    row.querySelector(
      '[role="switch"], .nib-switch, input[type="range"], .nib-segmented, .pick, .nib-swatches,' +
        ' .swatches, input.inline, .pictures',
    ),
  )
  return {
    rows: rows.length,
    without: rows
      .filter((row) => !row.querySelector('.explain button'))
      .map((row) => (row.querySelector('.name')?.innerText ?? row.innerText).trim().split('\\n')[0]),
  }
}
"""

def every_pane(page: Page) -> None:
    ids = ["general", "editor", "kinds", "shortcuts", "mobile", "spelling", "markdown", "appearance",
           "ai", "glasses", "export", "sync", "account", "trash", "import"]
    counted = 0
    for section in ids:
        page.evaluate("(id) => window.nibApp.settings.show(id)", section)
        page.wait_for_timeout(600)
        found = page.evaluate(UNEXPLAINED)
        counted += found["rows"]
        say(f"{section}: {found['rows']} settings, without a ?: {found['without']}")
        if found["without"]:
            wrong(f"{section}: no ? beside {found['without']}")
        DRIVE.shot(page, f"pane-{section}")
    if counted < 60:
        wrong(f"only {counted} settings were found across the panes")


def the_sentence(page: Page) -> None:
    page.evaluate("() => window.nibApp.settings.show('markdown')")
    row = page.locator(".nib-setting", has_text="Strict CommonMark").first
    glyph = row.locator(".explain button")
    label = glyph.get_attribute("aria-label")
    say(f"the glyph's name: {label!r}")
    if not label or "standard markdown" not in label:
        wrong(f"the glyph is named {label!r}")

    # The glyph is a question mark: lucide's circle-question-mark has the circle and the
    # hook of the mark, and the info glyph it replaces has two straight lines instead.
    drawn = glyph.evaluate("(one) => one.querySelector('svg').innerHTML")
    say(f"the glyph: {drawn}")
    if "M9.09 9a3 3 0 0 1 5.83 1" not in drawn:
        wrong("the glyph is not a question mark")

    glyph.hover()
    shown = wait_for(page, "() => document.querySelector('.explain .nib-bubble')?.innerText ?? ''",
                     "the sentence on hover")
    say(f"on hover: {shown!r}")
    DRIVE.shot(page, "hover")
    page.mouse.move(5, 5)
    wait_for(page, "() => !document.querySelector('.explain .nib-bubble')", "the sentence gone again")

    page.evaluate("() => window.nibApp.settings.show('general')")
    smart = page.locator(".nib-setting", has_text="Smart dates").first
    before = smart.locator("[role=switch]").get_attribute("aria-checked")
    smart.locator(".explain button").focus()
    shown = wait_for(page, "() => document.querySelector('.explain .nib-bubble')?.innerText ?? ''",
                     "the sentence on focus")
    say(f"on focus: {shown!r}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    after = smart.locator("[role=switch]").get_attribute("aria-checked")
    say(f"Smart dates before Enter on its ?: {before}, after: {after}")
    if before != after:
        wrong("Enter on the ? turned the setting over")
    page.keyboard.press("Escape")

    # A row that is a switch as a whole, which hears every key pressed inside it (#522):
    # Enter and Space on its ? explain it and leave it as it was.
    page.evaluate("() => window.nibApp.settings.show('ai')")
    # Turning this one needs an account, so what is watched is whether the row's own
    # handler took the keys: it cancels the two it turns the switch on, so a key that
    # reaches the window cancelled is a key the row acted on.
    vault = page.locator("[role=switch]", has_text="vault").first
    page.evaluate(
        "() => { window.__taken = []; window.addEventListener('keydown', (event) =>"
        " { if (event.defaultPrevented) window.__taken.push(event.key) }) }"
    )
    vault.locator(".explain button").focus()
    page.keyboard.press("Enter")
    page.keyboard.press(" ")
    page.wait_for_timeout(300)
    taken = page.evaluate("() => window.__taken")
    say(f"keys on the vault row's ? that the row took: {taken}")
    if taken:
        wrong(f"the row took {taken} from its ?, and turns its switch on them")
    page.keyboard.press("Escape")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    page.evaluate("() => window.nibApp.settings.show('general')")
    wait_for(page, "() => !!document.querySelector('[role=\"dialog\"][aria-label=\"Settings\"]')",
             "the settings")
    every_pane(page)
    the_sentence(page)

    # The panes only somebody signed in, or with a pair of glasses, is shown: the
    # account said to the app the way a sign-in leaves it, and the glasses as seen.
    page.evaluate(
        """() => {
          window.nibApp.modes.glassesSeen = true
          window.nibApp.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' }
        }"""
    )
    every_pane(page)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every setting has a ? that explains it"))
