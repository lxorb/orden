from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
HINTS = """
() => {
  const pane = document.querySelector('[role="region"][aria-label="Settings"]')
  const words = (text) => (text ?? '').toLowerCase().match(/[\\p{L}\\p{N}]+/gu) ?? []
  const rows = [...pane.querySelectorAll('.orden-setting')].filter((row) => row.querySelector('.explain button'))
  return {
    rows: pane.querySelectorAll('.orden-setting').length,
    hinted: rows.length,
    echoes: rows
      .filter((row) => {
        const label = new Set(words(row.querySelector('.name')?.innerText ?? ''))
        return words(row.querySelector('.explain button').getAttribute('aria-label')).every((one) => label.has(one))
      })
      .map((row) => (row.querySelector('.name')?.innerText ?? row.innerText).trim().split('\\n')[0]),
    unlike: rows
      .filter((row) => !row.querySelector('.explain svg')?.innerHTML.includes('M12 16v-4'))
      .map((row) => (row.querySelector('.name')?.innerText ?? row.innerText).trim().split('\\n')[0]),
  }
}
"""
def every_pane(page: Page) -> None:
    ids = ["general", "editor", "kinds", "shortcuts", "mobile", "appearance",
           "ai", "experimental", "sync", "account", "trash", "import"]
    hinted = 0
    for section in ids:
        page.evaluate("(id) => window.ordenApp.settings.show(id)", section)
        page.wait_for_timeout(600)
        found = page.evaluate(HINTS)
        hinted += found["hinted"]
        say(f"{section}: {found['rows']} rows, {found['hinted']} with an i")
        if found["echoes"]:
            wrong(f"{section}: the i only repeats the name of {found['echoes']}")
        if found["unlike"]:
            wrong(f"{section}: the i is not an info circle beside {found['unlike']}")
        DRIVE.shot(page, f"pane-{section}")
    if hinted < 10:
        wrong(f"only {hinted} settings with an i were found across the panes")
def the_sentence(page: Page) -> None:
    page.evaluate("() => window.ordenApp.settings.show('editor')")
    row = page.locator(".orden-setting", has_text="Strict CommonMark").first
    glyph = row.locator(".explain button")
    label = glyph.get_attribute("aria-label")
    say(f"the glyph's name: {label!r}")
    if not label or "standard markdown" not in label:
        wrong(f"the glyph is named {label!r}")
    drawn = glyph.evaluate("(one) => one.querySelector('svg').innerHTML")
    say(f"the glyph: {drawn}")
    if "M12 16v-4" not in drawn:
        wrong("the glyph is not an info circle")
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
    say(f"Smart dates before Enter on its i: {before}, after: {after}")
    if before != after:
        wrong("Enter on the i turned the setting over")
    page.keyboard.press("Escape")
    page.evaluate("() => window.ordenApp.settings.show('ai')")
    vault = page.locator(".orden-setting", has_text="vault").first
    page.evaluate(
        "() => { window.__taken = []; window.addEventListener('keydown', (event) =>"
        " { if (event.defaultPrevented) window.__taken.push(event.key) }) }"
    )
    vault.locator(".explain button").focus()
    page.keyboard.press("Enter")
    page.keyboard.press(" ")
    page.wait_for_timeout(300)
    taken = page.evaluate("() => window.__taken")
    say(f"keys on the vault row's i that the row took: {taken}")
    if taken:
        wrong(f"the row took {taken} from its i, and turns its switch on them")
    page.keyboard.press("Escape")
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.settings.show('general')")
    wait_for(page, "() => !!document.querySelector('[role=\"region\"][aria-label=\"Settings\"]')",
             "the settings")
    every_pane(page)
    the_sentence(page)
    page.evaluate(
        """() => {
          window.ordenApp.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' }
        }"""
    )
    every_pane(page)
raise SystemExit(DRIVE.run(drive, "every i beside a setting explains it in more than its name"))
