from __future__ import annotations

import hashlib
import json
import time
import uuid

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()

EMAIL = "scratchpad-sync@example.com"

RIGHT = 'header [data-side-toggle="right"]'
PAD_TAB = '[data-tab="scratchpad"]'
CARD = "[data-scratchpad-card] .cm-content"

WORDS = f"""() => {{
  const lines = [...document.querySelectorAll('{CARD} .cm-line')]
  return lines.length ? lines.map((one) => one.textContent).join('\\n') : null
}}"""

AGAIN = "() => document.dispatchEvent(new Event('visibilitychange'))"

PATIENCE = 45


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)

    def second(self, user: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )
        return token


def opened(browser, name: str, missing: bool = False) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: wrong(f"[{name}] page error: {error}"))
    page.asked = []  # type: ignore[attr-defined]
    page.on(
        "request",
        lambda one: page.asked.append(one.url) if "/v2/pad" in one.url else None,  # type: ignore[attr-defined]
    )
    if missing:
        context.route(
            "**/v2/pad",
            lambda route: route.fulfill(
                status=404, content_type="application/json", body='{"error":"not found"}'
            ),
        )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp?.workspace.activeSpace", timeout=60000)
    return page


def show_pad(page: Page) -> None:
    if not page.locator(PAD_TAB).is_visible():
        page.locator(RIGHT).click()
        page.locator(PAD_TAB).wait_for(state="visible", timeout=5000)
    if page.locator(PAD_TAB).get_attribute("aria-selected") != "true":
        page.locator(PAD_TAB).click()
    page.wait_for_function(f"() => !!document.querySelector('{CARD}')", timeout=10000)


def words(page: Page) -> str:
    return page.evaluate(WORDS) or ""


def typed(page: Page, text: str, at_start: bool = False) -> None:
    show_pad(page)
    page.locator(CARD).click()
    page.keyboard.press("Control+Home" if at_start else "Control+End")
    page.keyboard.type(text)
    page.wait_for_timeout(1200)


def signed_in(page: Page, token: str) -> None:
    page.evaluate(f"() => localStorage.setItem('nib:session', {json.dumps(token)})")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp?.account.user", timeout=60000)
    show_pad(page)


def holds(page: Page, name: str, *parts: str) -> bool:
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        now = words(page)
        if all(one in now for one in parts):
            return True
        page.evaluate(AGAIN)
        page.wait_for_timeout(1000)
    wrong(f"[{name}] the scratchpad never held {parts}: {words(page)!r}")
    return False


def same(desk: Page, phone: Page, what: str) -> None:
    for _ in range(PATIENCE):
        if words(desk) == words(phone):
            say(f"{what}: both read {words(desk)!r}")
            return
        desk.evaluate(AGAIN)
        phone.evaluate(AGAIN)
        desk.wait_for_timeout(1000)
    wrong(f"{what}: the two disagree: {words(desk)!r} / {words(phone)!r}")


def main() -> int:
    worker = Worker()
    with DRIVE.session(playwright=True) as play:
        worker.start()
        token = worker.account(EMAIL)
        user = worker.query(f"select id from users where email = '{EMAIL}'")[0]["id"]
        other = worker.second(user)
        first, second = DRIVE.browser(play), DRIVE.browser(play)

        desk, phone = opened(first, "desk"), opened(second, "phone")
        typed(desk, "Desk before signing in")
        typed(phone, "Phone before signing in")
        if desk.asked or phone.asked:  # type: ignore[attr-defined]
            wrong("signed out, the scratchpad went to the account")

        signed_in(desk, token)
        holds(desk, "desk", "Desk before signing in")
        signed_in(phone, other)
        holds(phone, "phone", "Desk before signing in", "Phone before signing in")
        holds(desk, "desk", "Desk before signing in", "Phone before signing in")
        same(desk, phone, "after both joined")
        shot(desk, "01-desk-joined")
        shot(phone, "01-phone-joined")

        typed(desk, " desk-at-once")
        typed(phone, "phone-at-once ", at_start=True)
        holds(desk, "desk", "desk-at-once", "phone-at-once")
        holds(phone, "phone", "desk-at-once", "phone-at-once")
        same(desk, phone, "after writing at once")
        shot(desk, "02-desk-at-once")

        desk.context.set_offline(True)
        typed(desk, " written-offline")
        desk.evaluate(AGAIN)
        typed(phone, "written-online ", at_start=True)
        phone.evaluate(AGAIN)
        phone.wait_for_timeout(3000)
        if "written-offline" in words(phone):
            wrong("the offline words reached the phone while the desk was offline")
        desk.context.set_offline(False)
        holds(phone, "phone", "written-offline", "written-online", "desk-at-once", "phone-at-once")
        holds(desk, "desk", "written-offline", "written-online")
        same(desk, phone, "after the desk came back")
        shot(phone, "03-phone-after-offline")

        desk.reload(wait_until="domcontentloaded")
        desk.wait_for_function("() => !!window.nibApp?.account.user", timeout=60000)
        show_pad(desk)
        desk.wait_for_timeout(3000)
        same(desk, phone, "after a reload")
        for part in ["Desk before", "Phone before", "written-offline", "written-online"]:
            if words(desk).count(part) != 1:
                wrong(f"after a reload {part!r} is there {words(desk).count(part)} times")

        old = opened(first, "old-server", missing=True)
        typed(old, "Only on this device")
        signed_in(old, token)
        typed(old, " still")
        old.evaluate(AGAIN)
        old.wait_for_timeout(2000)
        kept = words(old)
        say(f"against a Worker without the route: {kept!r}, asked {len(old.asked)} time(s)")  # type: ignore[attr-defined]
        if "Only on this device still" not in kept or "Desk before" in kept:
            wrong(f"against a Worker without the route the scratchpad changed: {kept!r}")
        old.reload(wait_until="domcontentloaded")
        old.wait_for_function("() => !!window.nibApp?.account.user", timeout=60000)
        show_pad(old)
        if "Only on this device still" not in words(old):
            wrong(f"against a Worker without the route a reload lost words: {words(old)!r}")

        held = worker.query(f"select count(*) as many from pad_updates where user_id = '{user}'")
        say(f"the account holds the scratchpad in {held[0]['many']} row(s)")

    return DRIVE.verdict("the scratchpad is one on every device of the account")


if __name__ == "__main__":
    raise SystemExit(main())
