from __future__ import annotations

from typing import Any

from playwright.sync_api import Browser

from harness import Drive
from shell import PHONE_AGENT

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

STATE = """
() => ({
  depth: window.ordenApp.overlays.depth,
  settings: window.ordenApp.settings.open,
  store: window.ordenApp.themeStore.open,
})
"""

BROWSE = """
() => {
  window.ordenApp.settings.show('appearance')
  window.ordenApp.themeStore.show()
}
"""

MENU = """
() => {
  const row = [...document.querySelectorAll('.orden-row:has(.orden-row-label)')].find((one) => one.checkVisibility())
  if (!row) return false
  const box = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: box.left + 12, clientY: box.top + box.height / 2,
  }))
  return true
}
"""

MENUS = "() => [...document.querySelectorAll('[role=\"menu\"]')].filter((one) => one.checkVisibility()).length"

def shortcut_over_a_menu(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[menu] page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    wait_for(page, f"({MENU})()", "a row in the file list to hold a menu")
    wait_for(page, f"({MENUS})() > 0", "the row's menu")
    page.keyboard.press("Control+Comma")
    wait_for(page, "document.querySelector('[role=\"dialog\"] nav')", "Settings, from its shortcut")
    up = state(page)
    menus = page.evaluate(MENUS)
    say(f"[menu] Ctrl+, over a row's menu: {up}, {menus} menu(s) up")
    if menus:
        wrong("a row's menu stays up under Settings opened by its shortcut")
    page.keyboard.press("Escape")
    left = state(page)
    if left["settings"] or left["depth"] or page.evaluate(MENUS):
        wrong(f"one Escape after it should leave nothing up: {left}")
    context.close()

def state(page: Any) -> dict[str, Any]:
    page.wait_for_timeout(500)
    return page.evaluate(STATE)

def drive(browser: Browser, phone: bool) -> None:
    kind = "phone" if phone else "desktop"
    context = browser.new_context(
        viewport={"width": 390, "height": 844} if phone else {"width": 1280, "height": 800},
        user_agent=PHONE_AGENT if phone else None,
        has_touch=phone,
        is_mobile=phone,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{kind}] page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.themeStore", "the theme store")

    page.evaluate(BROWSE)
    wait_for(page, "window.ordenApp.overlays.depth === 2", "Settings and the theme store, both up")
    say(f"[{kind}] Settings and the store at once: {state(page)}")

    if phone:
        page.go_back()
    else:
        page.keyboard.press("Escape")
    first = state(page)
    say(f"[{kind}] one step back: {first}")
    if first["store"] or not first["settings"] or first["depth"] != 1:
        wrong(f"[{kind}] one step back should close the store over Settings and only it: {first}")

    for _ in range(3 if phone else 1):
        if phone:
            page.go_back()
        else:
            page.keyboard.press("Escape")
        rest = state(page)
        if not rest["settings"]:
            break
    say(f"[{kind}] stepping back the rest of the way: {rest}")
    if rest["settings"] or rest["store"] or rest["depth"] != 0:
        wrong(f"[{kind}] stepping back the rest of the way should leave nothing up: {rest}")
    context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser, phone=False)
        drive(browser, phone=True)
        shortcut_over_a_menu(browser)

    return DRIVE.verdict("a layer opened over Settings in the same moment is the first to close")

if __name__ == "__main__":
    raise SystemExit(main())
