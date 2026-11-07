from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import LANDED

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

LISTED = """
() => [...document.querySelectorAll('[role="region"][aria-label="Settings"] nav button.item')]
  .map((one) => one.innerText.trim())
"""

def listed(page: Page) -> list[str]:
    page.evaluate("() => { window.ordenApp.settings.show('general'); window.ordenApp.settings.listing = true }")
    wait_for(page, "() => !!document.querySelector('[role=\"region\"][aria-label=\"Settings\"] nav button')",
             "the settings' sections")
    wait_for(page, f"() => {LANDED}", "the settings' sheets")
    return page.evaluate(LISTED)

def laptop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    sections = listed(page)
    say(f"[laptop] sections: {sections}")
    if "Mobile" in sections:
        wrong("[laptop] the Mobile section is offered on a laptop that was never on a phone")
    if "Shortcuts" not in sections:
        wrong("[laptop] the other sections went with it")
    DRIVE.shot(page, "laptop")

    page.evaluate("() => { window.ordenApp.modes.mobileSeen = true }")
    page.wait_for_timeout(300)
    sections = page.evaluate(LISTED)
    say(f"[laptop, a phone on the account] sections: {sections}")
    if "Mobile" not in sections:
        wrong("[laptop] no Mobile section once the account has been on a phone")
    page.context.close()

def phone(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    page = context.new_page()
    DRIVE.open(page)
    sections = listed(page)
    say(f"[phone] sections: {sections}")
    if "Mobile" not in sections:
        wrong("[phone] no Mobile section on a phone")
    DRIVE.shot(page, "phone")
    context.close()

def drive(browser: Browser) -> None:
    laptop(browser)
    phone(browser)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the Mobile section is a phone's, and a laptop's once there is one"))
