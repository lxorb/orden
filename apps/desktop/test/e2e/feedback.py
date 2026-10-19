"""Send feedback (#548): the bug at the foot of the sidebar, the sheet it opens, and the
report the real Worker keeps.

On a desktop's screen and a phone's: the bug is beside the account and the settings;
it opens Send feedback, whose Send is off until something is written; Cancel puts it
away. Written and sent, signed out, the Worker keeps the words with the version, the
platform and the app's recent log, and the sheet goes. Shift Shift and "feedback" finds
the same sheet.

    python apps/desktop/test/e2e/feedback.py
"""

from __future__ import annotations

import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
ORIGIN = harness.worker_origin()

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

BUG = ".foot button[aria-label='Send feedback']"
SHEET = "[role=dialog][aria-label='Send feedback']"
SEND = f"{SHEET} button[type=submit]"


def fresh(browser: Browser, finger: bool, scheme: str) -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 420, "height": 880} if finger else {"width": 1180, "height": 820},
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        **({"user_agent": PHONE} if finger else {}),
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    DRIVE.ready(page)
    page.evaluate("() => { window.nibApp.workspace.panel = 'tree' }")
    wait_for(page, f"!!document.querySelector({BUG!r})", "the bug at the foot of the sidebar")
    return page


def reports(worker: harness.Worker) -> list[dict]:
    until = time.monotonic() + 10
    while True:
        try:
            return worker.query("select user_id, text, version, platform, log from feedback")
        except (SystemExit, Exception):  # noqa: BLE001 - a busy database is asked again
            if time.monotonic() > until:
                raise
            time.sleep(0.3)


def drive(browser: Browser, worker: harness.Worker) -> None:
    for label, finger, scheme in (
        ("desktop", False, "light"),
        ("desktop-dark", False, "dark"),
        ("phone", True, "light"),
    ):
        page = fresh(browser, finger, scheme)
        shot(page, f"{label}-foot", clip=page.locator(".foot").bounding_box())

        page.locator(BUG).click()
        wait_for(page, f"!!document.querySelector({SHEET!r})", f"[{label}] the sheet")
        page.wait_for_timeout(400)
        if not page.locator(SEND).is_disabled():
            wrong(f"[{label}] Send is not off with nothing written")
        if page.locator(f"{SHEET} textarea").get_attribute("placeholder") != "Describe the issue":
            wrong(f"[{label}] the field does not say Describe the issue")
        shot(page, f"{label}-sheet")

        page.locator(f"{SHEET} button", has_text="Cancel").click()
        wait_for(page, f"!document.querySelector({SHEET!r})", f"[{label}] the sheet put away")

        if label != "desktop":
            page.context.close()
            continue

        # Written and sent, signed out.
        page.locator(BUG).click()
        wait_for(page, f"!!document.querySelector({SHEET!r})", "the sheet again")
        page.locator(f"{SHEET} textarea").fill("The tab strip lost its line under the tabs.")
        if page.locator(SEND).is_disabled():
            wrong("Send is still off with something written")
        shot(page, f"{label}-written")
        page.locator(SEND).click()
        wait_for(page, f"!document.querySelector({SHEET!r})", "the sheet gone once sent")

        kept = reports(worker)
        say(f"the Worker keeps {[{**one, 'log': f'{len(one['log'])} chars'} for one in kept]}")
        if len(kept) != 1:
            wrong(f"the Worker keeps {len(kept)} reports, not one")
        else:
            one = kept[0]
            if one["text"] != "The tab strip lost its line under the tabs." or one["user_id"] is not None:
                wrong(f"the report is not the words, from nobody signed in: {one}")
            if not one["version"] or not one["platform"].startswith("web"):
                wrong(f"the report does not say the version and the platform: {one}")
            if "page loaded" not in one["log"]:
                wrong("the report carries no recent log")

        # The palette finds the same sheet.
        page.locator("body").click(position={"x": 700, "y": 400})
        for _ in range(2):
            page.keyboard.down("Shift")
            page.keyboard.up("Shift")
            page.wait_for_timeout(60)
        wait_for(page, "!!document.querySelector('.palette input')", "the palette")
        page.keyboard.type("feedback")
        page.wait_for_timeout(400)
        first = page.locator(".palette [role=option]").first.inner_text()
        say(f"'feedback' finds first: {' '.join(first.split())!r}")
        if "Send feedback" not in first:
            wrong(f"'feedback' does not find Send feedback first: {first!r}")
        page.keyboard.press("Enter")
        wait_for(page, f"!!document.querySelector({SHEET!r})", "the sheet from the palette")
        page.context.close()


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        drive(browser, worker)
    return DRIVE.verdict("Send feedback is at the foot of the sidebar and the Worker keeps what it sends")


if __name__ == "__main__":
    raise SystemExit(main())
