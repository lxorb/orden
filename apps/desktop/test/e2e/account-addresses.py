from __future__ import annotations

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()

PERSON = "ann@example.com"
WORK = "ann@work.example"
NEW = "ann@new.example"


def sign_in(page: Page, worker: harness.Worker) -> None:
    page.evaluate("() => (window.ordenApp.account.open = true)")
    page.locator("input[type=email]").fill(PERSON)
    already = len(worker.written())
    page.get_by_role("button", name="Continue").click()
    mailed = worker.waits_for_mail(
        PERSON, r"(\d{6}) is your (?:nibeditor|Orden) code", "the sign-in code", already
    ).group(1)
    page.locator(".digits input").first.fill(mailed)
    DRIVE.wait_for(page, "() => !!window.ordenApp.account.accountToken", "the session")
    keep = page.get_by_role("button", name="Keep them")
    try:
        keep.wait_for(timeout=8_000)
        keep.click()
    except Exception:  # noqa: BLE001 - nothing here to ask about is an answer too
        pass


def confirmed(page: Page, worker: harness.Worker, button: str, address: str, name: str) -> None:
    page.get_by_role("button", name=button, exact=True).click()
    page.locator(f'input[aria-label="{name}"]').fill(address)
    already = len(worker.written())
    page.get_by_role("button", name="Send code").click()
    mailed = worker.waits_for_mail(
        address, r"(\d{6}) adds this address to your Orden account", "the code for the address", already
    ).group(1)
    page.locator('input[aria-label="Code"]').fill(mailed)
    shot(page, f"{name.lower().replace(' ', '-')}-code")
    page.get_by_role("button", name="Confirm").click()


def drive(browser: Browser) -> None:
    worker = harness.Worker(DRIVE)
    worker.start()

    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    page.goto(ORIGIN, wait_until="domcontentloaded")
    DRIVE.wait_for(page, "() => !!window.ordenApp", "the app")
    sign_in(page, worker)
    page.evaluate("() => window.ordenApp.settings.show('account')")
    page.get_by_text("Second email").first.wait_for(timeout=10_000)
    shot(page, "account")

    confirmed(page, worker, "Add a second email", WORK, "Second email")
    DRIVE.wait_for(
        page, f"() => document.body.textContent.includes({WORK!r})", "the second address shown"
    )
    page.get_by_role("button", name="Make primary").wait_for(timeout=10_000)
    shot(page, "second-added")
    rows = worker.query(f"select email from user_addresses where email = '{WORK}'")
    if len(rows) != 1:
        wrong(f"the Worker does not keep the second address: {rows}")

    already = len(worker.written())
    confirmed(page, worker, "Change email", NEW, "New email")
    DRIVE.wait_for(
        page,
        f"() => window.ordenApp.account.user?.email === {NEW!r}",
        "the account to sign in with the new address",
    )
    shot(page, "changed")
    worker.waits_for_mail(PERSON, r"Your Orden address was changed", "the notice to the old address", already)
    say("the old address was told, with a way back")

    if page.locator("text=·").count() or page.locator("text=•").count():
        wrong("a dot or a bullet separates words in the account pane")
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "an account adds a second address and changes its own"))
