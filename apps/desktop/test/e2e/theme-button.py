from __future__ import annotations

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PICKER = "[role=dialog][aria-label=Themes]"
THEME = "() => window.ordenApp.theme.id"
FOCUS_SHOWN = """() => {
  let shown = 1
  for (let at = document.activeElement; at; at = at.parentElement) shown *= Number(getComputedStyle(at).opacity)
  return shown
}"""


def fresh(browser: Browser) -> Page:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nSome words to judge a theme by, with a [link](https://example.com).")
    DRIVE.open_note(page, "Plan")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    wait_for(page, "!!document.querySelector('[data-region=foot]')?.offsetParent", "the sidebar's foot")
    return page


def opened(page: Page) -> None:
    page.locator("[data-region=foot] [aria-label=Themes]").click()
    wait_for(page, f"!!document.querySelector({PICKER!r})", "the theme picker")
    wait_for(page, f"!!document.activeElement?.closest({PICKER!r})", "the picker to take the keys")
    page.wait_for_timeout(300)


def card(page: Page, name: str) -> object:
    return page.locator(f"{PICKER} [role=option]", has_text=name).first


def drive(browser: Browser) -> None:
    page = fresh(browser)
    foot = page.locator("[data-region=foot]")
    if foot.locator("[aria-label=Light], [aria-label=Dark]").count():
        wrong("the light and dark switch is still in the foot")

    for side in ("light", "dark"):
        page.evaluate(f"() => window.ordenApp.theme.setScheme({side!r})")
        page.wait_for_timeout(200)
        kept = page.evaluate(THEME)
        opened(page)
        shot(page, f"{harness.ENGINE}-{side}-open")

        card(page, "Contrast").hover()
        page.wait_for_timeout(300)
        if page.evaluate(THEME) != "contrast":
            wrong(f"[{side}] pointing at Contrast did not try it")
        if page.locator(PICKER).get_attribute("data-seeing") != "id":
            wrong(f"[{side}] the picker stays solid while a theme is tried")
        shot(page, f"{harness.ENGINE}-{side}-trying")
        if page.locator(PICKER).get_attribute("data-seeing") != "id":
            wrong(f"[{side}] the picker went solid while the shot was taken")

        page.mouse.move(1200, 120)
        page.wait_for_timeout(300)
        if page.evaluate(THEME) != kept:
            wrong(f"[{side}] moving off did not give {kept} back")
        if page.locator(PICKER).get_attribute("data-seeing") is not None:
            wrong(f"[{side}] the picker stays see-through after moving off")

        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(250)
        tried = page.evaluate(THEME)
        if tried == kept:
            wrong(f"[{side}] the arrow tried nothing")
        shot(page, f"{harness.ENGINE}-{side}-arrow")
        page.wait_for_timeout(300)
        if page.evaluate(FOCUS_SHOWN) < 0.9:
            wrong(f"[{side}] the search field fades while the arrow tries a theme")
        page.keyboard.type("Con")
        page.wait_for_timeout(400)
        if page.evaluate(THEME) != "contrast":
            wrong(f"[{side}] typing Con did not try Contrast")
        if page.evaluate(FOCUS_SHOWN) < 0.9:
            wrong(f"[{side}] the search field fades while typing, the words can hardly be read")
        shot(page, f"{harness.ENGINE}-{side}-typing")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        if page.evaluate(THEME) != kept or page.locator(PICKER).count():
            wrong(f"[{side}] Escape did not close and give {kept} back")

        opened(page)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        if page.evaluate(THEME) != tried or page.locator(PICKER).count():
            wrong(f"[{side}] Enter did not keep {tried}")

        opened(page)
        card(page, "Classic").click()
        page.wait_for_timeout(300)
        if page.evaluate(THEME) != "default":
            wrong(f"[{side}] a click did not keep Classic")
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the themes button opens a picker that tries a theme see-through and keeps it"))
