
from __future__ import annotations

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

DECK = "# First\n\nalpha words\n\nNote: words for the speaker\n\n---\n\n# Second\n\n- one\n- two\n"

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    refused: list[str] = []
    page.on("console", lambda said: refused.append(said.text) if "Content Security Policy" in said.text else None)
    DRIVE.open(page)
    DRIVE.seed(page, DECK)
    DRIVE.open_note(page, "First")
    page.evaluate("() => window.nibApp.present.start()")
    page.wait_for_selector(".stage")
    page.wait_for_timeout(300)
    page.keyboard.press("Home")

    page.keyboard.press("n")
    page.wait_for_selector(".notes")
    page.keyboard.press("Escape")
    page.wait_for_selector(".notes", state="detached")
    if not page.evaluate("() => window.nibApp.present.on"):
        wrong("Escape with the notes sheet up left the deck")
    page.keyboard.press("Escape")
    wait_for(page, "!window.nibApp.present.on", "Escape to leave the deck")

    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type("Export slides as PDF", delay=1)
    page.wait_for_function(
        "() => [...document.querySelectorAll('[role=option]')].some((one) => one.innerText.startsWith('Export slides as PDF'))"
    )
    page.keyboard.press("Enter")
    wait_for(
        page,
        "document.querySelector('iframe[aria-hidden]')?.contentDocument?.querySelector('.stage')?.style.getPropertyValue('--stage-scale')",
        "the print frame's script to fit the slides",
    )
    if refused:
        wrong(f"the print frame's script was refused: {refused[0][:160]}")
    say(f"policy refusals: {len(refused)}")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
