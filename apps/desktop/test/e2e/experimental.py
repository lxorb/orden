from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import EXPERIMENTAL_SWITCH, Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

FEATURES = ["Chats", "Applications", "Password manager", "Time tracker", "Databases"]

KEPT = "() => JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]')"


def knob(page: Page, label: str):
    return page.locator(f'[role=switch][aria-label="{label}"]')


def checked(page: Page, label: str) -> bool:
    return knob(page, label).get_attribute("aria-checked") == "true"


def locked(page: Page, label: str) -> bool:
    return knob(page, label).get_attribute("aria-disabled") == "true"


def section(page: Page) -> None:
    page.evaluate("() => window.ordenApp.settings.show('experimental')")
    page.locator(EXPERIMENTAL_SWITCH).wait_for(state="visible", timeout=15_000)


def master(page: Page, confirm: bool | None) -> None:
    page.locator(EXPERIMENTAL_SWITCH).click()
    if confirm is None:
        page.wait_for_timeout(400)
        return
    sheet = page.locator("[role=dialog].sheet")
    sheet.wait_for(state="visible", timeout=10_000)
    words = sheet.inner_text()
    if "100%" not in words:
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


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    section(page)
    shot(page, "start")

    if checked(page, "Enable experimental features"):
        wrong("experimental features start on")
    for label in FEATURES:
        if checked(page, label) or not locked(page, label):
            wrong(f"{label} is not off and locked at first")
    say("everything starts off, the features locked")

    master(page, False)
    if checked(page, "Enable experimental features"):
        wrong("Escape on the warning turned it on")
    say("Escape on the warning leaves it off")

    master(page, True)
    if not checked(page, "Enable experimental features"):
        wrong("confirming did not turn it on")
    for label in FEATURES:
        if locked(page, label):
            wrong(f"{label} is still locked with the master on")
    say("confirmed, the features can be turned on")

    for label in FEATURES:
        flip(page, label, True)
    if not page.evaluate("() => document.body.textContent.includes('My keywords')"):
        wrong("Chats is on, but its settings are not under it")
    if not page.evaluate("() => document.body.textContent.includes('Share the clipboard with applications')"):
        wrong("Applications is on, but its clipboard switch is not under it")
    shot(page, "all-on")
    say("each feature turns on, with its settings under it")

    master(page, None)
    if checked(page, "Enable experimental features"):
        wrong("the master did not turn off")
    for label in FEATURES:
        if not checked(page, label) or not locked(page, label):
            wrong(f"{label} lost its choice, or is not locked, with the master off")
    if page.evaluate("() => document.body.textContent.includes('My keywords')"):
        wrong("the chat settings show with the master off")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+Shift+P")
    wait_for(page, "() => !!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("pass")
    page.wait_for_timeout(500)
    rows = page.evaluate("() => [...document.querySelectorAll('.palette ul li')].map((one) => one.textContent.trim())")
    if [one for one in rows if "Pass" in one]:
        wrong(f"the palette offers Pass with the master off: {rows}")
    page.keyboard.press("Escape")
    say("master off: every feature hidden, each keeping its choice")

    section(page)
    master(page, True)
    for label in FEATURES:
        if not checked(page, label):
            wrong(f"{label} did not come back on with the master")
    for label in FEATURES:
        flip(page, label, False)
    kept = page.evaluate(KEPT)
    if kept != ["experimental"]:
        wrong(f"after turning each feature off, the account keeps {kept}")
    shot(page, "each-off")
    say("master on again brings each back; each turns off on its own")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "The Experimental section turns the master and each feature on and off"))
