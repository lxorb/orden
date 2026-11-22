from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
FEATURES = ["Chats", "Password manager", "Time tracker", "Databases"]
KEPT = "() => JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]')"
SHEET = "[role=dialog].sheet"
def knob(page: Page, label: str):
    return page.locator(f'[role=switch][aria-label="{label}"]')
def checked(page: Page, label: str) -> bool:
    return knob(page, label).get_attribute("aria-checked") == "true"
def locked(page: Page, label: str) -> bool:
    return knob(page, label).get_attribute("aria-disabled") == "true"
def section(page: Page) -> None:
    page.evaluate("() => window.ordenApp.settings.show('experimental')")
    knob(page, FEATURES[0]).wait_for(state="visible", timeout=15_000)
def warned(page: Page, label: str, confirm: bool) -> None:
    knob(page, label).click()
    sheet = page.locator(SHEET)
    sheet.wait_for(state="visible", timeout=10_000)
    words = sheet.inner_text()
    if "Turn on experimental features?" not in words or "100%" not in words:
        wrong(f"the warning does not say bugs will come: {words!r}")
    shot(page, "modal")
    if confirm:
        sheet.locator(".row button.orden-button:not(.is-quiet)", has_text="Turn on").click()
    else:
        page.keyboard.press("Escape")
    page.wait_for_timeout(400)
def flip(page: Page, label: str, on: bool) -> None:
    if checked(page, label) == on:
        wrong(f"{label} is already {'on' if on else 'off'}")
    knob(page, label).click()
    wait_for(
        page,
        f"document.querySelector('[role=switch][aria-label=\"{label}\"]')?.getAttribute('aria-checked') === '{str(on).lower()}'",
        f"{label} to turn {'on' if on else 'off'}",
    )
    if page.locator(SHEET).is_visible():
        wrong(f"turning {label} {'on' if on else 'off'} asked the warning again")
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    section(page)
    shot(page, "start")
    if knob(page, "Enable experimental features").count():
        wrong("there is still a master switch")
    for label in FEATURES:
        if checked(page, label) or locked(page, label):
            wrong(f"{label} is not off and free at first")
    say("one list, everything off, nothing locked, no master switch")
    warned(page, "Chats", False)
    if checked(page, "Chats") or page.evaluate(KEPT):
        wrong(f"Escape on the warning changed something: {page.evaluate(KEPT)}")
    say("Escape on the warning leaves everything off")
    warned(page, "Chats", True)
    if not checked(page, "Chats"):
        wrong("confirming did not turn Chats on")
    if not page.evaluate("() => document.body.textContent.includes('My keywords')"):
        wrong("Chats is on, but its settings are not under it")
    say("confirmed, Chats is on with its settings under it")
    for label in FEATURES[1:]:
        flip(page, label, True)
    shot(page, "all-on")
    say("the other features turn on without asking again")
    for label in FEATURES:
        flip(page, label, False)
    kept = page.evaluate(KEPT)
    if kept != ["experimental"]:
        wrong(f"after turning each feature off, the account keeps {kept}")
    if page.evaluate("() => document.body.textContent.includes('My keywords')"):
        wrong("the chat settings show with Chats off")
    shot(page, "each-off")
    say("each turns off on its own, and the warning stays accepted")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+Shift+P")
    wait_for(page, "() => !!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("pass")
    page.wait_for_timeout(500)
    rows = page.evaluate("() => [...document.querySelectorAll('.palette ul li')].map((one) => one.textContent.trim())")
    if [one for one in rows if "Pass" in one]:
        wrong(f"the palette offers Pass with the password manager off: {rows}")
    page.keyboard.press("Escape")
    say("with the features off, the palette does not offer them")
    section(page)
    flip(page, "Password manager", True)
    say("turning one on again does not ask again")
raise SystemExit(DRIVE.run(drive, "The Experimental section turns each feature on and off, warning once"))
