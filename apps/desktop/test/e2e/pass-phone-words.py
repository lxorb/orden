from __future__ import annotations

import re

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
PASSWORD = "tulip ladder seven"
TITLE = "Averyveryverylongunbrokentitlewithoutanyspacesthatgoesonandon"
LANGUAGES = ("de", "my", "ta")
WIDTH = 320

PAST = """() => {
  const wide = document.documentElement.clientWidth
  const clipped = (one) => {
    const box = one.getBoundingClientRect()
    for (let up = one.parentElement; up && !up.matches('.pass'); up = up.parentElement) {
      if (!/auto|scroll/.test(getComputedStyle(up).overflowX)) continue
      const room = up.getBoundingClientRect()
      if (room.right <= wide + 1 && (box.right > room.right + 1 || box.left < room.left - 1)) return true
    }
    return false
  }
  return [...document.querySelectorAll('.pass :is(button, input, select, h2, label, [role=tab])')]
    .filter((one) => one.checkVisibility() && !clipped(one))
    .map((one) => [one, one.getBoundingClientRect()])
    .filter(([, box]) => box.right > wide + 1 || box.left < -1)
    .slice(0, 4)
    .map(([one, box]) => `${one.tagName.toLowerCase()} ${JSON.stringify((one.getAttribute('aria-label') || one.textContent).trim().slice(0, 30))} ${Math.round(box.left)}..${Math.round(box.right)}`)
}"""

TITLED = """() => {
  const title = document.querySelector('.pass main h2')
  return !!title && title.getBoundingClientRect().width >= 40
}"""


SIDE = "() => !!document.querySelector('.pass .column.side')?.checkVisibility()"


def words(language: str):
    source = (harness.APP / "src" / "locales" / f"{language}.ts").read_text(encoding="utf-8")

    def said(english: str) -> str:
        key = re.escape(english)
        found = re.search(rf"^  (?:'{key}'|{key}):\s*'((?:[^'\\]|\\.)*)',", source, re.M)
        return found.group(1).replace("\\'", "'") if found else english

    return said


def fits(page: Page, where: str) -> None:
    page.wait_for_timeout(400)
    past = page.evaluate(PAST)
    if past:
        wrong(f"{where}: runs past the phone's edge: {past}")
        shot(page, f"past-{where}")


def look(browser: Browser, language: str) -> None:
    said = words(language)
    context = browser.new_context(
        viewport={"width": WIDTH, "height": 700},
        has_touch=True,
        is_mobile=True,
        user_agent=PHONE,
        reduced_motion="reduce",
    )
    context.add_init_script(
        "localStorage.setItem('orden:hidden-kinds', JSON.stringify(['shown-pass']));"
        f" localStorage.setItem('orden:language', {language!r})"
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass input[type=password]')", f"[{language}] the setup screen", 60)
    fits(page, f"{language} setup")
    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name=said("Continue"), exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", f"[{language}] the recovery key", 180)
    page.get_by_role("button", name=said("I saved it"), exact=True).click()
    wait_for(page, "document.querySelector('.pass .column.list')?.checkVisibility()", f"[{language}] the list")

    page.get_by_role("button", name=said("New login"), exact=True).click()
    page.get_by_label(said("Title"), exact=True).fill(TITLE)
    fits(page, f"{language} new login")
    page.get_by_role("button", name=said("Create"), exact=True).click()
    wait_for(page, f"document.querySelector('.pass main h2')?.textContent.includes({TITLE!r})", f"[{language}] the login")
    fits(page, f"{language} login")
    if not page.evaluate(TITLED):
        wrong(f"[{language}] the login's title is squeezed out of its header")
        shot(page, f"{language}-untitled")
    page.go_back()
    page.wait_for_timeout(500)
    fits(page, f"{language} list")
    page.locator(".pass .column.list").get_by_role("button", name=said("Select items"), exact=True).click()
    fits(page, f"{language} picking")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    if page.locator(".pass .bar.picking").count():
        page.locator(".pass .bar.picking button").last.click()

    page.locator(".pass [data-item]").first.click()
    page.locator(".pass main").get_by_role("button", name=said("More"), exact=True).click()
    page.get_by_role("menuitem", name=said("Move to trash"), exact=True).click()
    page.wait_for_timeout(500)
    for name in ("Monitor", "Settings", "Trash"):
        for _ in range(3):
            if page.evaluate(SIDE):
                break
            page.locator(".pass").get_by_role("button", name=said("Back"), exact=True).first.click()
            page.wait_for_timeout(300)
        page.locator(".pass .column.side").get_by_role("button", name=re.compile("^" + re.escape(said(name)))).first.click()
        page.wait_for_timeout(500)
        fits(page, f"{language} {name}")
        if name == "Settings":
            for tab in page.locator(".pass [role=tab]").all_inner_texts()[1:]:
                page.locator(".pass [role=tab]", has_text=tab).first.click()
                fits(page, f"{language} Settings {tab}")
        if name == "Trash" and page.locator(".pass [data-item]").count():
            page.locator(".pass [data-item]").first.click()
            fits(page, f"{language} a login in the trash")
        page.go_back()
        page.wait_for_timeout(400)
    say(f"[{language}] Pass fits a {WIDTH}px phone")
    context.close()


def drive(browser: Browser) -> None:
    for language in LANGUAGES:
        look(browser, language)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Pass fits a narrow phone in languages with long words"))
