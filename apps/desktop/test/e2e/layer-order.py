from __future__ import annotations

from typing import Any

from playwright.sync_api import Browser

from harness import Drive
from shell import PHONE_AGENT

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

STATE = """
() => ({
  depth: window.nibApp.overlays.depth,
  settings: window.nibApp.settings.open,
  store: window.nibApp.themeStore.open,
})
"""

BROWSE = """
() => {
  window.nibApp.settings.show('appearance')
  window.nibApp.themeStore.show()
}
"""

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
    wait_for(page, "window.nibApp.themeStore", "the theme store")

    page.evaluate(BROWSE)
    wait_for(page, "window.nibApp.overlays.depth === 2", "Settings and the theme store, both up")
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

    return DRIVE.verdict("a layer opened over Settings in the same moment is the first to close")

if __name__ == "__main__":
    raise SystemExit(main())
