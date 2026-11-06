from __future__ import annotations

import base64
import hashlib
import hmac
import struct
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()

PERSON = "leaving@example.com"

STEP = 30

def totp(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[19] & 15
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 1_000_000).zfill(6)

class Authenticator:

    def __init__(self, secret: str) -> None:
        self.secret = secret
        self.used: set[int] = set()

    def code(self) -> str:
        while int(time.time() // STEP) in self.used:
            time.sleep(0.5)
        step = int(time.time() // STEP)
        self.used.add(step)
        return totp(self.secret, step)

def sign_in(page: Page, worker: harness.Worker, phone: Authenticator) -> None:
    page.evaluate("() => (window.nibApp.account.open = true)")
    page.locator("input[type=email]").fill(PERSON)
    already = len(worker.written())
    page.get_by_role("button", name="Continue").click()
    mailed = worker.waits_for_mail(
        PERSON, r"(\d{6}) is your (?:nibeditor|Orden) code", "the sign-in code", already
    ).group(1)
    page.locator(".digits input").first.fill(mailed)

    page.get_by_text("Now the code from your authenticator app").wait_for(timeout=20_000)
    page.locator(".digits input").first.fill(phone.code())
    DRIVE.wait_for(page, "() => !!window.nibApp.account.accountToken", "the session")

    keep = page.get_by_role("button", name="Keep them")
    try:
        keep.wait_for(timeout=8_000)
        keep.click()
    except Exception:  # noqa: BLE001 - nothing here to ask about is an answer too
        pass
    say("signed in with the mailed code and the app's")

def drive(browser: Browser) -> None:
    worker = harness.Worker(DRIVE, variables={"SECOND_FACTOR_SECRET": "a secret for the drive"})
    worker.start()

    token = worker.account(PERSON)
    begun = worker.request("/v1/second", token, {})
    phone = Authenticator(begun["secret"])
    worker.request("/v1/second/confirm", token, {"holding": begun["holding"], "code": phone.code()})
    say("the account asks for a second code from here on")

    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 820}, color_scheme=scheme)
        page.goto(ORIGIN, wait_until="domcontentloaded")
        DRIVE.wait_for(page, "() => !!window.nibApp", "the app")
        sign_in(page, worker, phone)

        page.evaluate("() => window.nibApp.settings.show('account')")
        page.get_by_role("button", name="Delete account").click()
        already = len(worker.written())
        mailed = worker.waits_for_mail(
            PERSON, r"(\d{6}) deletes your (?:nibeditor|Orden) account", "the code that deletes", already
        ).group(1)
        say(f"[{scheme}] the mail that deletes says {mailed}")

        change = page.locator('input[aria-label="Code to change sign-in"]')
        delete = page.locator('input[aria-label="App code to delete"]')
        delete.wait_for(timeout=10_000)
        if change.count() != 1 or delete.count() != 1:
            wrong(f"[{scheme}] the two app codes are not named apart: {change.count()}, {delete.count()}")
        if page.locator('input[aria-label="Code from the app"]').count():
            wrong(f"[{scheme}] a field on the pane is still called Code from the app")
        delete.scroll_into_view_if_needed()
        shot(page, f"pane-{scheme}")

        if scheme == "dark":
            page.get_by_role("button", name="Cancel").first.click()
            page.context.close()
            continue

        page.locator('input[aria-label="Code"]').fill(mailed)
        delete.fill(phone.code())
        page.get_by_role("button", name="Continue").click()
        page.get_by_role("button", name="Delete now").click()
        DRIVE.wait_for(page, "() => !window.nibApp.account.accountToken", "signed out")
        say("deleted, and signed out")
        shot(page, "gone")

        worker.waits_for_mail(
            PERSON, r"Your (?:nibeditor|Orden) account has been deleted", "the receipt", already
        )
        left = worker.query(f"select count(*) as n from users where email = '{PERSON}'")
        if left and left[0].get("n"):
            wrong("the account is still in the database")
        else:
            say("the Worker holds no account for that address, and the receipt came")
        page.context.close()
        token = worker.account(PERSON)
        begun = worker.request("/v1/second", token, {})
        phone = Authenticator(begun["secret"])
        worker.request(
            "/v1/second/confirm", token, {"holding": begun["holding"], "code": phone.code()}
        )

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "an account with a second factor deletes itself"))
