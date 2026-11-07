from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import WEBKIT, Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

def row_input(page: Page, name: str):
    return page.locator('[role="region"][aria-label="Settings"] .orden-setting', has_text=name).locator("input")

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    if not WEBKIT:
        context.grant_permissions(["local-fonts"])
    page = context.new_page()
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.settings.show('appearance')")
    field = row_input(page, "Note font")
    field.scroll_into_view_if_needed()
    if not WEBKIT:
        picks_from_the_list(page, field)
    missing(page, field)

def picks_from_the_list(page: Page, field) -> None:
    field.click()
    listed = wait_for(
        page,
        "() => { const rows = [...document.querySelectorAll('[role=option]')]"
        ".map((one) => one.textContent.trim()); return rows.length ? rows : null }",
        "the fonts installed",
    )
    say(f"listed {len(listed)} families, from {listed[:5]}")
    if not listed:
        wrong("no fonts were listed")
        return

    face = page.locator("[role=option]").first.evaluate("(one) => one.style.fontFamily")
    if listed[0] not in face:
        wrong(f"the first row is not set in its own face: {face!r}")

    picked = listed[0]
    field.fill(picked[:4])
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    chosen = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--font-content').trim()")
    say(f"the notes' stack after picking {picked!r}: {chosen!r}")
    if not chosen.startswith(f'"{picked}"'):
        wrong(f"{picked!r} is not at the head of the notes' stack: {chosen!r}")
    if page.locator("text=Not installed on this device").count():
        wrong("an installed face is said to be missing")
    DRIVE.shot(page, "picked")

def missing(page: Page, field) -> None:
    field.click()
    field.fill("Nonexistent Face Of Nobody")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)
    if not page.locator("text=Not installed on this device").count():
        wrong("a face nothing draws was taken without a word")
    else:
        say("a face nothing draws is said to be not installed")
    DRIVE.shot(page, "missing")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a face for notes is picked from the fonts installed, and a missing one is said"))
