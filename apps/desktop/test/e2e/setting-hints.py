from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

UNEXPLAINED = """
() => {
  const pane = document.querySelector('[role="dialog"][aria-label="Settings"]')
  const rows = [...pane.querySelectorAll('.orden-setting')].filter((row) =>
    !row.closest('.shortcut, .button, .extension') &&
    // A row's control, in the shapes Settings draws them in: a value - a dropdown or a
    // field - is `.orden-setting-value` or `.orden-field` since #1056, which put every one in
    // one box and one column.
    row.querySelector(
      '[role="switch"], .orden-switch, input[type="range"], .orden-segmented, .orden-setting-value,' +
        ' input.orden-field, .orden-swatches, .swatches, .pictures',
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
        page.evaluate("(id) => window.ordenApp.settings.show(id)", section)
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
    page.evaluate("() => window.ordenApp.settings.show('markdown')")
    row = page.locator(".orden-setting", has_text="Strict CommonMark").first
    glyph = row.locator(".explain button")
    label = glyph.get_attribute("aria-label")
    say(f"the glyph's name: {label!r}")
    if not label or "standard markdown" not in label:
        wrong(f"the glyph is named {label!r}")

    drawn = glyph.evaluate("(one) => one.querySelector('svg').innerHTML")
    say(f"the glyph: {drawn}")
    if "M9.09 9a3 3 0 0 1 5.83 1" not in drawn:
        wrong("the glyph is not a question mark")

    glyph.hover()
    shown = wait_for(page, "() => document.querySelector('.orden-bubble.sentence')?.innerText ?? ''",
                     "the sentence on hover")
    say(f"on hover: {shown!r}")
    DRIVE.shot(page, "hover")
    page.mouse.move(5, 5)
    wait_for(page, "() => !document.querySelector('.orden-bubble.sentence')", "the sentence gone again")

    page.evaluate("() => window.ordenApp.settings.show('general')")
    smart = page.locator(".orden-setting", has_text="Smart dates").first
    before = smart.locator("[role=switch]").get_attribute("aria-checked")
    smart.locator(".explain button").focus()
    shown = wait_for(page, "() => document.querySelector('.orden-bubble.sentence')?.innerText ?? ''",
                     "the sentence on focus")
    say(f"on focus: {shown!r}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    after = smart.locator("[role=switch]").get_attribute("aria-checked")
    say(f"Smart dates before Enter on its ?: {before}, after: {after}")
    if before != after:
        wrong("Enter on the ? turned the setting over")
    page.keyboard.press("Escape")

    page.evaluate("() => window.ordenApp.settings.show('ai')")
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
    page.evaluate("() => window.ordenApp.settings.show('general')")
    wait_for(page, "() => !!document.querySelector('[role=\"dialog\"][aria-label=\"Settings\"]')",
             "the settings")
    every_pane(page)
    the_sentence(page)

    page.evaluate(
        """() => {
          window.ordenApp.modes.glassesSeen = true
          window.ordenApp.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' }
        }"""
    )
    every_pane(page)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every setting has a ? that explains it"))
