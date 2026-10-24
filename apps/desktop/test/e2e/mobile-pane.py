"""Settings offers the Mobile section on a phone, and not on a laptop that has never been
on one (#769).

A reader on a NixOS laptop: *"I am on the laptop but I see mobile tab, should it be
hidden?"* The section is the bar over a phone's keyboard and the pull past the top of a
list, which only a phone and a tablet draw. A laptop gets it once the account says a
handheld has been on it, which is said here the way the account's answer leaves it.

Run it from the repository root:

    python apps/desktop/test/e2e/mobile-pane.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

#: The sections the settings list, by name.
LISTED = """
() => [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] nav button.item')]
  .map((one) => one.innerText.trim())
"""


def listed(page: Page) -> list[str]:
    # On a phone the list is a screen of its own, before any section is opened.
    page.evaluate("() => { window.nibApp.settings.show('general'); window.nibApp.settings.listing = true }")
    wait_for(page, "() => !!document.querySelector('[role=\"dialog\"][aria-label=\"Settings\"] nav button')",
             "the settings' sections")
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

    page.evaluate("() => { window.nibApp.modes.mobileSeen = true }")
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
