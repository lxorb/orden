from __future__ import annotations

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

SHEET = "[role=region][aria-label=Settings]"

COUNT = "() => window.ordenApp.workspace.tabs.filter((one) => one.kind === 'settings').length"
FRONT = "() => window.ordenApp.workspace.active?.kind ?? null"


def fresh(browser: Browser, finger: bool) -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 420, "height": 880} if finger else {"width": 1280, "height": 820},
        has_touch=finger,
        is_mobile=finger,
        **({"user_agent": PHONE} if finger else {}),
    )
    DRIVE.open(page)
    return page


def one_tab_in_front(page: Page, label: str) -> None:
    wait_for(page, f"!!document.querySelector({SHEET!r})", f"[{label}] Settings in a pane")
    count = page.evaluate(COUNT)
    front = page.evaluate(FRONT)
    if count != 1 or front != "settings":
        wrong(f"[{label}] {count} Settings tabs, {front!r} in front")
    if page.evaluate("() => !!document.querySelector('[role=dialog][aria-label=Settings]')"):
        wrong(f"[{label}] Settings is still a dialog over the app")


def scheme(page: Page, side: str) -> None:
    page.evaluate(f"() => window.ordenApp.theme.setScheme({side!r})")
    page.wait_for_timeout(250)


def desktop(browser: Browser) -> None:
    page = fresh(browser, False)
    DRIVE.seed(page, "# Plan\n\nwords")
    DRIVE.open_note(page, "Plan")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    wait_for(page, "!!document.querySelector('[data-region=foot]')?.offsetParent", "the sidebar's foot")

    page.locator("[data-region=foot] [aria-label=Settings]").click()
    one_tab_in_front(page, "the foot's button")
    if "Settings" not in page.locator("[data-region=tabs]").inner_text():
        wrong("no tab in the strip says Settings")
    for side in ("light", "dark"):
        scheme(page, side)
        shot(page, f"{harness.ENGINE}-desktop-{side}")

    page.locator(f"{SHEET} input").first.fill("font")
    page.wait_for_timeout(300)
    if "Nothing matches" in page.locator(SHEET).inner_text():
        wrong("searching the settings for font finds nothing")
    shot(page, f"{harness.ENGINE}-desktop-search")
    page.locator(f"{SHEET} input").first.fill("")

    DRIVE.open_note(page, "Plan")
    if page.evaluate(FRONT) != "note":
        wrong("the note did not come in front of Settings")
    page.keyboard.press("Control+,")
    one_tab_in_front(page, "Mod-,")

    DRIVE.open_note(page, "Plan")
    page.evaluate("() => window.ordenApp.settings.show('shortcuts')")
    one_tab_in_front(page, "a deep link")
    if "Shortcuts" not in page.locator(f"{SHEET} .body h2").first.inner_text():
        wrong("a deep link to Shortcuts shows another page")
    shot(page, f"{harness.ENGINE}-desktop-deep-link")

    DRIVE.open_note(page, "Plan")
    page.locator("body").click(position={"x": 700, "y": 400})
    for _ in range(2):
        page.keyboard.down("Shift")
        page.keyboard.up("Shift")
        page.wait_for_timeout(60)
    wait_for(page, "!!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("Settings")
    page.wait_for_timeout(300)
    page.keyboard.press("Enter")
    one_tab_in_front(page, "the palette")

    page.evaluate("() => (window.ordenApp.settings.open = false)")
    page.wait_for_timeout(200)
    if page.evaluate(COUNT) != 0:
        wrong("closing Settings left its tab")
    page.context.close()


def phone(browser: Browser) -> None:
    page = fresh(browser, True)
    for side in ("light", "dark"):
        scheme(page, side)
        page.evaluate("() => window.ordenApp.settings.show()")
        one_tab_in_front(page, f"phone {side}")
        shot(page, f"{harness.ENGINE}-phone-{side}-list")
        page.locator(f"{SHEET} nav .item").nth(1).click()
        page.wait_for_timeout(300)
        if not page.locator(f"{SHEET} .body").count():
            wrong(f"[phone {side}] a row opened no page")
        shot(page, f"{harness.ENGINE}-phone-{side}-page")
        page.locator(f"{SHEET} header [aria-label=Back]").click()
        page.wait_for_timeout(300)
        if not page.locator(f"{SHEET} nav").count():
            wrong(f"[phone {side}] Back did not return to the list")
        if page.locator(f"{SHEET} header").count():
            wrong(f"[phone {side}] the list wears a second bar under the phone's own")
        page.evaluate("() => (window.ordenApp.settings.open = false)")
        page.wait_for_timeout(300)
        if page.evaluate(COUNT) != 0:
            wrong(f"[phone {side}] closing left the Settings tab")
    page.context.close()


def drive(browser: Browser) -> None:
    desktop(browser)
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Settings opens as one tab, by every way in, on a desktop and a phone"))
