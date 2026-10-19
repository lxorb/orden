"""Which kinds a new tab offers, chosen in Settings › Note types (#355).

Emil: "user should be able to configure which items of the Ctrl + T menu should be shown /
hidden in settings". Each kind a device can make has a switch in Settings › Note types; a
kind switched off is offered nowhere - not under Ctrl+T, not in a pane with nothing open -
and the last one still offered cannot be switched off. The choice is kept on the account
(`hiddenKinds`; see lib/kind-choice.ts).

What it checks, on the built web app in Chromium, on a desktop and on a phone:

    Ctrl+T (the plus on a phone) offers the canvas
    the canvas switched off in Settings › Note types, the new tab does not offer it
    switched back on, it does again
    every kind but the note switched off, the note's switch cannot be switched off

    python apps/desktop/test/e2e/tab-kinds.py
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

#: The kinds the new tab in front offers, by `data-kind`.
OFFERED = """() => [...document.querySelectorAll('.here[role=group] [data-kind]')]
  .map((one) => one.getAttribute('data-kind'))"""

#: The switches of Settings › Note types, by what they are called, and whether each is on
#: and whether it may be turned at all.
#: A phone, as pages.py makes one: the viewport store told so, which is what decides
#: which kinds a device has (a phone has no website; see `kindsHere`).
AS_PHONE = """
() => {
  const app = window.nibApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

SWITCHES = """() => [...document.querySelectorAll('[role=switch]')].map((one) => ({
  name: one.textContent.trim(),
  on: one.getAttribute('aria-checked') === 'true',
  locked: one.getAttribute('aria-disabled') === 'true',
}))"""


def new_tab(page: Page, label: str, phone: bool) -> list[str]:
    """A new tab, the way a reader makes one, and what it offers."""
    if phone:
        page.evaluate("() => window.nibApp.workspace.newTab()")
    else:
        page.locator(".cm-content").first.click()
        page.keyboard.press("Control+t")
    wait_for(page, "document.querySelector('.here[role=group] [data-kind]')", f"[{label}] the new tab's kinds")
    offered = list(page.evaluate(OFFERED))
    say(f"[{label}] the new tab offers {offered}")
    page.evaluate("() => window.nibApp.workspace.closeActive()")
    return offered


def settings(page: Page) -> None:
    page.evaluate("() => window.nibApp.settings.show('kinds')")
    wait_for(page, "document.querySelectorAll('[role=switch]').length > 1", "Settings › Note types")


def closed(page: Page) -> None:
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('[role=switch]')", "Settings to close")


def press(page: Page, name: str) -> None:
    """The switch called exactly `name`, pressed; forced, so a locked one is pressed too
    rather than waited on."""
    names = [one["name"] for one in page.evaluate(SWITCHES)]
    page.locator("[role=switch]").nth(names.index(name)).click(force=True)


def drive_on(browser: Browser, label: str, phone: bool) -> None:
    options = {"viewport": {"width": 412, "height": 915}, "has_touch": True, "is_mobile": True} if phone else {
        "viewport": {"width": 1280, "height": 820}
    }
    page = DRIVE.page(browser, **options)
    DRIVE.open(page)
    if phone:
        page.evaluate(AS_PHONE)
    DRIVE.seed(page, "# Kestrel\n\nA kestrel hangs on the wind.\n")
    DRIVE.open_note(page, "Kestrel")

    first = new_tab(page, label, phone)
    if "canvas" not in first:
        wrong(f"[{label}] a new tab does not offer a canvas to begin with")
    if phone and "web" in first:
        wrong(f"[{label}] a phone was offered a website, which it has none of")

    settings(page)
    shot(page, f"{label}-01-note-types")
    press(page, "Canvas")
    if any(one["name"] == "Canvas" and one["on"] for one in page.evaluate(SWITCHES)):
        wrong(f"[{label}] the canvas's switch did not turn off")
    closed(page)

    offered = new_tab(page, label, phone)
    if "canvas" in offered:
        wrong(f"[{label}] a canvas switched off is still offered")
    if "note" not in offered:
        wrong(f"[{label}] the note went with the canvas")

    settings(page)
    press(page, "Canvas")
    closed(page)
    if "canvas" not in new_tab(page, label, phone):
        wrong(f"[{label}] a canvas switched back on is not offered")

    # Every kind but the note off: the note's switch cannot be turned off.
    settings(page)
    for one in page.evaluate(SWITCHES):
        if one["on"] and one["name"] != "Note":
            press(page, one["name"])
    switches = page.evaluate(SWITCHES)
    note = next((one for one in switches if one["name"] == "Note"), None)
    say(f"[{label}] with one left: {switches}")
    if not note or not note["on"] or not note["locked"]:
        wrong(f"[{label}] the last kind offered is not held on: {note}")
    press(page, "Note")
    after = next((one for one in page.evaluate(SWITCHES) if one["name"] == "Note"), None)
    if not after or not after["on"]:
        wrong(f"[{label}] the last kind offered was switched off")
    shot(page, f"{label}-02-one-left")
    closed(page)
    if new_tab(page, label, phone) != ["note"]:
        wrong(f"[{label}] with the note alone left, the new tab offers something else")
    page.close()


def drive(browser: Browser) -> None:
    drive_on(browser, "desktop", False)
    drive_on(browser, "phone", True)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a kind switched off is offered nowhere, and back on, it is again"))
