from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

UP = "!!document.querySelector('.picker[data-spaces-open]')"
NAMES = ["Journal", "ETH", "Lab", "Reading", "Recipes", "Taxes", "Travel", "Uni", "VIS", "Work", "Zettel"]

HERE = "() => window.nibApp.workspace.activeSpace?.name"
ROWS = """() => [...document.querySelectorAll('.picker .orden-row')].map((one) => [
  one.querySelector('.place')?.textContent,
  one.querySelector('.orden-row-label')?.textContent,
  one.querySelector('.orden-row-label b')?.textContent ?? null,
])"""

def key(page: Page, chord: str = "Control+Space") -> None:
    page.keyboard.press(chord)

def opened(page: Page, scheme: str, what: str, chord: str = "Control+Space") -> None:
    key(page, chord)
    wait_for(page, UP, f"[{scheme}] the switcher for {what}")
    page.wait_for_timeout(250)

def gone(page: Page, scheme: str, what: str) -> None:
    wait_for(page, f"!({UP})", f"[{scheme}] the switcher gone {what}")
    page.wait_for_timeout(250)

def switching(page: Page, scheme: str) -> None:
    page.emulate_media(color_scheme=scheme)
    first = page.evaluate(HERE)
    page.evaluate(
        "async (names) => { for (const name of names) await window.nibApp.workspace.addSpace(name) }",
        NAMES,
    )
    page.evaluate(
        "async (name) => { const ws = window.nibApp.workspace; await ws.showSpace(ws.spaces[0].id) }",
        first,
    )
    wait_for(page, "window.nibApp.workspace.spaces.length >= 12", f"[{scheme}] twelve spaces")
    names = page.evaluate("() => window.nibApp.workspace.spaces.map((one) => one.name)")
    say(f"[{scheme}] spaces: {names}")

    opened(page, scheme, "the first look")
    box = page.locator(".picker").bounding_box()
    view = page.viewport_size
    say(f"[{scheme}] the box {box}, the window {view}")
    if box and view and abs((box["x"] + box["width"] / 2) - view["width"] / 2) > 2:
        wrong(f"[{scheme}] the switcher is not centred across")
    if page.locator(".picker input, .picker textarea, .picker [contenteditable]").count():
        wrong(f"[{scheme}] the switcher has a field")
    rows = page.evaluate(ROWS)
    if any(one[0] is not None for one in rows):
        wrong(f"[{scheme}] a row wears a number before Alt or a digit: {rows}")
    DRIVE.shot(page, f"{scheme}-01-open")
    page.keyboard.down("Alt")
    page.wait_for_timeout(200)
    tabs = page.locator(".numeral").count()
    rows = page.evaluate(ROWS)
    DRIVE.shot(page, f"{scheme}-01-alt")
    page.keyboard.up("Alt")
    say(f"[{scheme}] Alt held over the switcher: {tabs} tab numbers, rows {[one[0] for one in rows]}")
    if tabs:
        wrong(f"[{scheme}] the tabs' Alt numbers showed beside the space numbers")
    if [one[0] for one in rows] != [str(at + 1) for at in range(len(names))]:
        wrong(f"[{scheme}] Alt did not number the rows 1 to {len(names)}: {rows}")
    try:
        page.wait_for_function(f"!({ROWS})().some((one) => one[0] != null)", timeout=3000, polling=50)
    except Exception:  # noqa: BLE001 - still there, which the check below says
        pass
    if any(one[0] is not None for one in page.evaluate(ROWS)):
        wrong(f"[{scheme}] the numbers stayed after Alt was let go of")

    page.keyboard.type("re")
    page.wait_for_timeout(300)
    rows = page.evaluate(ROWS)
    say(f"[{scheme}] 're' shows {rows}")
    if not rows or any(one[2] is None for one in rows):
        wrong(f"[{scheme}] 're' left a row without its hits: {rows}")
    height = page.locator(".picker").bounding_box()
    if box and height and abs(height["height"] - box["height"]) > 1:
        wrong(f"[{scheme}] the switcher changed height as a name was typed")
    DRIVE.shot(page, f"{scheme}-02-name")
    if page.evaluate(HERE) != first:
        wrong(f"[{scheme}] a name switched without Enter")
    page.keyboard.press("Backspace")
    page.keyboard.type("ci")
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    gone(page, scheme, "on Enter")
    if page.evaluate(HERE) != "Recipes":
        wrong(f"[{scheme}] Enter on 'rci' went to {page.evaluate(HERE)!r}, not Recipes")

    opened(page, scheme, "a digit")
    page.keyboard.press("3")
    gone(page, scheme, "on 3")
    if page.evaluate(HERE) != names[2]:
        wrong(f"[{scheme}] 3 went to {page.evaluate(HERE)!r}, not {names[2]}")

    opened(page, scheme, "a digit that waits")
    page.keyboard.press("1")
    page.wait_for_timeout(150)
    rows = page.evaluate(ROWS)
    say(f"[{scheme}] '1' shows {[one[0] for one in rows]}")
    DRIVE.shot(page, f"{scheme}-03-waiting")
    if page.evaluate(HERE) == names[0]:
        wrong(f"[{scheme}] 1 went before a second digit could come")
    gone(page, scheme, "after the wait")
    if page.evaluate(HERE) != names[0]:
        wrong(f"[{scheme}] 1 went to {page.evaluate(HERE)!r}, not {names[0]}")

    opened(page, scheme, "two digits")
    page.keyboard.press("1")
    page.keyboard.press("2")
    gone(page, scheme, "on 12")
    if page.evaluate(HERE) != names[11]:
        wrong(f"[{scheme}] 12 went to {page.evaluate(HERE)!r}, not {names[11]}")

    opened(page, scheme, "Alt and a digit")
    page.keyboard.press("Alt+4")
    gone(page, scheme, "on Alt+4")
    if page.evaluate(HERE) != names[3]:
        wrong(f"[{scheme}] Alt+4 went to {page.evaluate(HERE)!r}, not {names[3]}")
    opened(page, scheme, "two digits again")
    page.keyboard.press("1")
    page.keyboard.press("2")
    gone(page, scheme, "on 12 again")

    opened(page, scheme, "the key again")
    key(page)
    gone(page, scheme, "on the key again")
    opened(page, scheme, "the second key", "Control+Shift+Space")
    key(page, "Control+Shift+Space")
    gone(page, scheme, "on the second key again")
    opened(page, scheme, "Escape")
    page.keyboard.press("Escape")
    gone(page, scheme, "on Escape")
    if page.evaluate(HERE) != names[11]:
        wrong(f"[{scheme}] closing it changed the space")

    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    opened(page, scheme, "with the panel shut")
    page.keyboard.press("Escape")
    gone(page, scheme, "with the panel shut")

STANDING = """() => {
  const at = document.activeElement
  return at?.closest?.('.picker') ? (at.querySelector('.orden-row-label')?.textContent ?? '') : null
}"""

def walking(page: Page, scheme: str) -> None:
    names = page.evaluate("() => window.nibApp.workspace.shownSpaces.map((one) => one.name)")
    here = page.evaluate(HERE)
    at = names.index(here)

    opened(page, scheme, "the arrows")
    if page.evaluate(STANDING) != here:
        wrong(f"[{scheme}] the switcher opened with the keyboard on {page.evaluate(STANDING)!r}, not {here!r}")
    page.keyboard.press("ArrowDown")
    below = names[(at + 1) % len(names)]
    if page.evaluate(STANDING) != below:
        wrong(f"[{scheme}] ArrowDown from {here!r} stood on {page.evaluate(STANDING)!r}, not {below!r}")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("ArrowUp")
    above = names[(at - 1) % len(names)]
    say(f"[{scheme}] down and up twice from {here!r}: {page.evaluate(STANDING)!r}")
    if page.evaluate(STANDING) != above:
        wrong(f"[{scheme}] ArrowUp twice stood on {page.evaluate(STANDING)!r}, not {above!r}")
    if page.evaluate(HERE) != here:
        wrong(f"[{scheme}] an arrow switched the space")
    page.keyboard.press("Escape")
    gone(page, scheme, "on Escape after the arrows")
    if page.evaluate(HERE) != here:
        wrong(f"[{scheme}] Escape after the arrows went to {page.evaluate(HERE)!r}")

    page.evaluate(
        "() => { const ws = window.nibApp.workspace;"
        " ws.movePanel('outline', 'right'); ws.showPanel('outline'); ws.closePanel('left') }"
    )
    sides = "() => [window.nibApp.workspace.panel, window.nibApp.workspace.openOn('right')]"
    before = page.evaluate(sides)
    opened(page, scheme, "Enter on a row")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    gone(page, scheme, "on Enter on a row")
    if page.evaluate(HERE) != below:
        wrong(f"[{scheme}] ArrowDown and Enter went to {page.evaluate(HERE)!r}, not {below!r}")
    page.wait_for_timeout(300)
    after = page.evaluate(sides)
    say(f"[{scheme}] the sides before the switch {before}, after it {after}")
    if after != before:
        wrong(f"[{scheme}] the switch changed the sides of the window: {before} -> {after}")

    names = page.evaluate("() => window.nibApp.workspace.shownSpaces.map((one) => one.name)")
    at = names.index(page.evaluate(HERE))
    opened(page, scheme, "the arrows with the key held")
    page.keyboard.down("Control")
    page.keyboard.down("Shift")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.keyboard.up("Shift")
    page.keyboard.up("Control")
    gone(page, scheme, "on Enter with the key held")
    two = names[(at + 2) % len(names)]
    say(f"[{scheme}] two rows down with the key held: {page.evaluate(HERE)!r}")
    if page.evaluate(HERE) != two:
        wrong(f"[{scheme}] the arrows with the key held went to {page.evaluate(HERE)!r}, not {two!r}")

def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 800})
        DRIVE.open(page)
        switching(page, scheme)
        walking(page, scheme)
        page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Ctrl+Space switches space by number and by name"))
