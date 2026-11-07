from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PASSWORD = "tulip ladder seven"

SEEN = """() => ({
  tab: !!document.querySelector('.pass'),
  tabs: window.nibApp.workspace.tabs.filter((one) => one.kind === 'pass').length,
})"""

PALETTE = """() => [...document.querySelectorAll('.palette ul li')].map((one) => one.textContent.trim())"""


def switch(page: Page, on: bool) -> None:
    page.evaluate("() => window.nibApp.settings.show('general')")
    row = page.locator('[role=switch][aria-label="Password manager"]')
    row.wait_for(state="visible", timeout=15_000)
    if (row.get_attribute("aria-checked") == "true") != on:
        row.click()
    wait_for(
        page,
        f"document.querySelector('[role=switch][aria-label=\"Password manager\"]')?.getAttribute('aria-checked') === '{str(on).lower()}'",
        "the switch",
    )
    shot(page, f"switch-{'on' if on else 'off'}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)


def offered(page: Page) -> list[str]:
    page.keyboard.press("Control+Shift+P")
    wait_for(page, "() => !!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("pass")
    page.wait_for_timeout(400)
    rows = page.evaluate(PALETTE)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    return [one for one in rows if "Pass" in one]


def none_of_it(page: Page, when: str) -> None:
    page.keyboard.press("Control+Alt+v")
    page.wait_for_timeout(600)
    seen = page.evaluate(SEEN)
    if seen["tab"] or seen["tabs"]:
        wrong(f"{when}: Ctrl+Alt+V opened Pass: {seen}")
    rows = offered(page)
    if rows:
        wrong(f"{when}: the palette offers {rows}")
    page.evaluate("() => { const ws = window.nibApp.workspace; for (const one of [...ws.tabs]) ws.close(one.id, false) }")
    wait_for(page, "document.querySelector('.here .kind')", "the empty pane's kinds")
    cards = page.evaluate("() => [...document.querySelectorAll('.here .kind .orden-row-label')].map((one) => one.textContent.trim())")
    if not cards:
        wrong(f"{when}: no new tab to look at")
    page.keyboard.press("k")
    page.wait_for_timeout(500)
    if page.evaluate(SEEN)["tabs"]:
        wrong(f"{when}: K in the empty pane opened Pass")
    if "Pass" in cards:
        wrong(f"{when}: a new tab offers Pass")
    shot(page, f"none-{when.replace(' ', '-')}")
    say(f"{when}: no Pass tab, command or new-tab kind, of {cards}")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)

    none_of_it(page, "never turned on")

    switch(page, True)
    rows = offered(page)
    if not rows:
        wrong("turned on, the palette offers no Pass command")
    say(f"turned on, the palette offers {rows}")
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Set up Pass')", "the setup screen", 60)
    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Continue", exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", "the recovery key", 180)
    page.get_by_role("button", name="I saved it", exact=True).click()
    wait_for(page, "document.querySelector('.pass .side')", "the three columns")
    page.locator(".pass .side .new").click()
    page.get_by_role("menuitem", name="Login", exact=True).click()
    page.get_by_label("Title", exact=True).fill("Kept Through Off")
    page.locator(".pass main input[type=password]").first.fill("pw-kept")
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, "[...document.querySelectorAll('.pass [data-item]')].some((one) => one.textContent.includes('Kept Through Off'))", "the login")
    shot(page, "made")
    say("set up, a login made")

    switch(page, False)
    none_of_it(page, "turned off")

    switch(page, True)
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')", "the Pass tab again")
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Pass is locked')", "Pass locked by turning it off")
    page.locator(".pass input[type=password]").fill(PASSWORD)
    page.get_by_role("button", name="Unlock", exact=True).click()
    wait_for(page, "[...document.querySelectorAll('.pass [data-item]')].some((one) => one.textContent.includes('Kept Through Off'))", "the login kept", 180)
    shot(page, "kept")
    say("turned on again, locked, opened: the login is still there")

    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')", "Pass after a reload, still on")
    say("still on after a reload")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Pass is off until turned on, and keeps its vaults through off and on"))
