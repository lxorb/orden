from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PASSWORD = "tulip ladder seven"
TITLE = "Bank of Quiet Secrets"
LOCKED = "document.querySelector('.pass')?.textContent.includes('Pass is locked')"
ASKING = "[...document.querySelectorAll('[role=dialog]')].filter((one) => one.checkVisibility()).map((one) => one.textContent.trim())"
MENU = "[...document.querySelectorAll('[role=menu]')].filter((one) => one.checkVisibility()).map((one) => one.textContent.trim())"


def away(page: Page) -> None:
    page.evaluate("() => window.dispatchEvent(new Event('blur'))")
    page.clock.fast_forward("01:10")
    wait_for(page, LOCKED, "Pass locked by the time away", 30)


def unlock(page: Page) -> None:
    page.evaluate("() => window.dispatchEvent(new Event('focus'))")
    page.locator(".pass input[type=password]").fill(PASSWORD)
    page.get_by_role("button", name="Unlock", exact=True).click()
    wait_for(page, "document.querySelector('.pass .side')", "Pass open again", 180)


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 860}, reduced_motion="reduce")
    context.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['shown-pass'])); localStorage.setItem('orden:pass-settings', JSON.stringify({ relockAfter: 1 }))")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.clock.install()
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Set up Pass')", "the setup screen", 60)
    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Continue", exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", "the recovery key", 180)
    page.get_by_role("button", name="I saved it", exact=True).click()
    wait_for(page, "document.querySelector('.pass .column.list')?.checkVisibility()", "the list")

    page.get_by_role("button", name="New login", exact=True).click()
    page.get_by_label("Title", exact=True).fill(TITLE)
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, f"document.querySelector('.pass main h2')?.textContent.includes({TITLE!r})", "the login shown")
    page.locator(".pass main").get_by_role("button", name="Edit", exact=True).click()
    page.get_by_label("Title", exact=True).fill(TITLE + " II")
    page.get_by_role("button", name="Save", exact=True).click()
    wait_for(page, f"document.querySelector('.pass main h2')?.textContent.includes({TITLE + ' II'!r})", "the login renamed")

    page.locator(".pass main").get_by_role("button", name="More", exact=True).click()
    page.get_by_role("menuitem", name="History", exact=True).click()
    page.get_by_role("button", name="Clear history", exact=True).click()
    wait_for(page, f"({ASKING}).some((one) => one.includes('Clear the history?'))", "the question to clear")
    away(page)
    page.wait_for_timeout(300)
    if page.evaluate(ASKING):
        wrong(f"a question Pass asked stays over the lock: {page.evaluate(ASKING)}")
    shot(page, "locked-question")
    say("a lock takes away the question Pass was asking")

    unlock(page)
    page.locator(".pass [data-item]").first.click()
    page.locator(".pass main").get_by_role("button", name="More", exact=True).click()
    wait_for(page, f"({MENU}).length > 0", "the item's menu")
    away(page)
    page.wait_for_timeout(300)
    if page.evaluate(MENU):
        wrong(f"an item's menu stays over the lock: {page.evaluate(MENU)}")
    shot(page, "locked-menu")
    say("a lock takes away the item's menu")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a lock takes away what Pass was asking or offering"))
