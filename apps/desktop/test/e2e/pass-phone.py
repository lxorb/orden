from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
PASSWORD = "tulip ladder seven"
TITLE = "Averyveryverylongunbrokentitlewithoutanyspacesthatgoesonandon"

PAST = """() => {
  const wide = document.documentElement.clientWidth
  return [...document.querySelectorAll('.pass *')]
    .filter((one) => one.checkVisibility())
    .map((one) => [one, one.getBoundingClientRect()])
    .filter(([, box]) => box.width && (box.right > wide + 1 || box.left < -1))
    .slice(0, 4)
    .map(([one, box]) => `${one.tagName.toLowerCase()}.${one.className} ${Math.round(box.left)}..${Math.round(box.right)}`)
}"""

SHOWN = """() => ['side', 'list', 'item'].filter((one) => document.querySelector(`.pass .column.${one}`)?.checkVisibility())"""


def fits(page: Page, where: str) -> None:
    page.wait_for_timeout(400)
    past = page.evaluate(PAST)
    if past:
        wrong(f"{where}: runs past the phone's edge: {past}")
        shot(page, f"past-{where}")


def column(page: Page, want: str, where: str) -> None:
    page.wait_for_timeout(600)
    if not page.evaluate("() => !!window.ordenApp && !!document.querySelector('.pass')"):
        wrong(f"{where}: Back left the app")
        return
    shown = page.evaluate(SHOWN)
    if shown != [want]:
        wrong(f"{where}: shows {shown}, not the {want}")


def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 360, "height": 740},
        has_touch=True,
        is_mobile=True,
        user_agent=PHONE,
        reduced_motion="reduce",
    )
    context.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['shown-pass']))")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Set up Pass')", "the setup screen", 60)
    fits(page, "setup")

    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Continue", exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", "the recovery key", 180)
    fits(page, "recovery")
    page.get_by_role("button", name="I saved it", exact=True).click()
    wait_for(page, "document.querySelector('.pass .column.list')?.checkVisibility()", "the list")
    fits(page, "empty list")
    shot(page, "list")

    page.get_by_role("button", name="New login", exact=True).click()
    page.get_by_label("Title", exact=True).fill(TITLE)
    page.locator(".pass main input[type=password]").first.fill("pw-" + TITLE)
    fits(page, "new login")
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, f"document.querySelector('.pass main h2')?.textContent.includes({TITLE!r})", "the login shown")
    fits(page, "login")
    column(page, "item", "the login made")

    page.go_back()
    column(page, "list", "Back from a login")
    fits(page, "list of one")

    page.locator(".pass [data-item]").first.click()
    column(page, "item", "a login tapped")
    page.locator(".pass main").get_by_role("button", name="Back", exact=True).click()
    column(page, "list", "the login's own Back")
    page.wait_for_timeout(400)
    if page.evaluate("() => history.state?.ordenDepth ?? 0"):
        wrong("the login's own Back left a step behind for the phone's Back")

    page.locator(".pass .column.list").get_by_role("button", name="Back", exact=True).click()
    column(page, "side", "the list's own Back")
    fits(page, "vaults")
    page.go_back()
    column(page, "list", "Back from the vaults")
    say("Back steps a phone's Pass from a login to the list, and the list fits the phone")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Pass on a phone fits it and its Back steps back through the columns"))
