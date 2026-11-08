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
  const clipped = (one) => {
    const box = one.getBoundingClientRect()
    for (let up = one.parentElement; up && !up.matches('.pass'); up = up.parentElement) {
      if (!/auto|scroll/.test(getComputedStyle(up).overflowX)) continue
      const room = up.getBoundingClientRect()
      if (room.right <= wide + 1 && (box.right > room.right || box.left < room.left)) return true
    }
    return false
  }
  return [...document.querySelectorAll('.pass *')]
    .filter((one) => one.checkVisibility() && !clipped(one))
    .map((one) => [one, one.getBoundingClientRect()])
    .filter(([, box]) => box.width && (box.right > wide + 1 || box.left < -1))
    .slice(0, 4)
    .map(([one, box]) => `${one.tagName.toLowerCase()}.${one.className} ${Math.round(box.left)}..${Math.round(box.right)}`)
}"""

SQUEEZED = """() => [...document.querySelectorAll('.pass [data-scrolls] > *')]
  .filter((one) => one.checkVisibility() && getComputedStyle(one).overflowY !== 'visible' && one.scrollHeight > one.clientHeight + 2)
  .slice(0, 4)
  .map((one) => `${one.tagName.toLowerCase()}.${one.className} ${one.clientHeight} of ${one.scrollHeight}`)"""

UNDER = """() => {
  const plus = document.querySelector('main .fab')?.getBoundingClientRect()
  if (!plus) return []
  for (const one of document.querySelectorAll('.pass [data-scrolls]')) one.scrollTop = one.scrollHeight
  return [...document.querySelectorAll('.pass :is(button, input, select, textarea)')]
    .filter((one) => one.checkVisibility())
    .map((one) => [one, one.getBoundingClientRect()])
    .filter(([, box]) => box.width && box.right > plus.left && box.left < plus.right && box.bottom > plus.top && box.top < plus.bottom)
    .map(([one]) => one.getAttribute('aria-label') || one.textContent.trim() || one.tagName.toLowerCase())
}"""

CUT = """() => [...document.querySelectorAll('.sheet *')]
  .filter((one) => one.checkVisibility() && one.scrollWidth > one.clientWidth + 1)
  .filter((one) => one.textContent.trim())
  .filter((one) => /hidden|clip/.test(getComputedStyle(one).overflowX))
  .filter((one) => getComputedStyle(one).textOverflow !== 'ellipsis' || /flex|grid/.test(getComputedStyle(one).display))
  .map((one) => one.className || one.tagName)"""

SHOWN = """() => ['side', 'list', 'item'].filter((one) => document.querySelector(`.pass .column.${one}`)?.checkVisibility())"""


def fits(page: Page, where: str) -> None:
    page.wait_for_timeout(400)
    past = page.evaluate(PAST)
    if past:
        wrong(f"{where}: runs past the phone's edge: {past}")
        shot(page, f"past-{where}")
    squeezed = page.evaluate(SQUEEZED)
    if squeezed:
        wrong(f"{where}: a scroller squeezes what it holds instead of scrolling: {squeezed}")
        shot(page, f"squeezed-{where}")
    under = page.evaluate(UNDER)
    if under:
        wrong(f"{where}: the end cannot be scrolled out from under the + button: {under}")
        shot(page, f"under-{where}")


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

    page.locator(".pass main").get_by_role("button", name="Edit", exact=True).click()
    page.get_by_label("Title", exact=True).fill(TITLE + "again")
    page.get_by_role("button", name="Save", exact=True).click()
    wait_for(page, f"document.querySelector('.pass main h2')?.textContent.includes({TITLE + 'again'!r})", "the login renamed")
    page.locator(".pass main").get_by_role("button", name="More", exact=True).click()
    page.get_by_role("menuitem", name="History", exact=True).click()
    wait_for(page, "document.querySelector('.sheet .name .title')", "the login's history")
    cut = page.evaluate(CUT)
    if cut:
        wrong(f"the history sheet cuts words off without an ellipsis: {cut}")
    shot(page, "history")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.sheet')", "the history closed")

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
    for name in ("Monitor", "Settings", "Trash"):
        if page.evaluate(SHOWN) != ["side"]:
            page.locator(".pass").get_by_role("button", name="Back", exact=True).first.click()
            column(page, "side", f"Back before {name}")
        page.locator(".pass .column.side").get_by_role("button", name=name, exact=True).first.click()
        page.wait_for_timeout(500)
        fits(page, name)
        if name == "Settings":
            for tab in page.locator(".pass [role=tab]").all_inner_texts()[1:]:
                page.locator(".pass [role=tab]", has_text=tab).first.click()
                fits(page, f"Settings {tab}")
        page.go_back()
        column(page, "list", f"Back from {name}")
        if page.evaluate("() => !document.querySelector('.pass [data-item]')"):
            wrong(f"Back from {name} does not show the list of logins")

    say("Back steps a phone's Pass from a login, the vaults, Monitor, Settings or Trash to the list, and the list fits the phone")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Pass on a phone fits it and its Back steps back through the columns"))
