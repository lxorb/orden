from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import Browser, Page, Route

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

BUDGET = 1500

PASSWORD = "tulip ladder seven"
SECRET = "hunter2-Very-Secret"

ROWS = "document.querySelectorAll('.pass [data-item]').length"

ATTACHED = b"the deed to the house, page one"

CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authentication, content-type, accept",
    "access-control-allow-methods": "GET, POST, DELETE, PATCH, OPTIONS",
}

SIMPLELOGIN = {
    "/api/v2/mailboxes": {"mailboxes": [{"id": 1, "email": "me@example.com", "default": True}]},
    "/api/v5/alias/options": {
        "can_create": True,
        "prefix_suggestion": "",
        "suffixes": [{"suffix": ".cat@slmail.me", "signed_suffix": ".cat@slmail.me.SIG", "is_premium": False}],
    },
    "/api/v3/alias/custom/new": {
        "id": 7,
        "email": "shop.cat@slmail.me",
        "enabled": True,
        "name": "",
        "note": None,
        "mailboxes": [{"id": 1, "email": "me@example.com"}],
    },
    "/api/aliases/7/activities": {"activities": []},
}

ALIAS_ASKED: list[str] = []


def simplelogin(route: Route) -> None:
    request = route.request
    if request.method == "OPTIONS":
        route.fulfill(status=204, headers=CORS)
        return
    path = request.url.split("app.simplelogin.io", 1)[1].split("?", 1)[0]
    ALIAS_ASKED.append(f"{request.method} {path}")
    if request.headers.get("authentication") != "sl-test-key":
        route.fulfill(status=401, headers=CORS, content_type="application/json", body='{"error": "Wrong api key"}')
        return
    answer = SIMPLELOGIN.get(path)
    status = 201 if request.method == "POST" else 200
    route.fulfill(
        status=status if answer is not None else 404,
        headers=CORS,
        content_type="application/json",
        body=json.dumps(answer if answer is not None else {"error": "not here"}),
    )


def opened(page: Page) -> None:
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')", "the Pass tab")


def made_login(page: Page, title: str, username: str, password: str) -> None:
    page.locator(".pass .side .new").click()
    page.get_by_role("menuitem", name="Login", exact=True).click()
    page.get_by_label("Title", exact=True).fill(title)
    wait_for(page, "document.querySelector('.pass input')", "the form")
    fields = page.locator(".pass main input:not([type=password]):not([aria-label='Title'])")
    for index in range(fields.count()):
        one = fields.nth(index)
        label = one.evaluate("(field) => field.labels?.[0]?.textContent ?? field.getAttribute('aria-label') ?? ''")
        if "username" in label.lower() or "email" in label.lower():
            one.fill(username)
            break
    page.locator(".pass main input[type=password]").first.fill(password)
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, f"[...document.querySelectorAll('.pass main h2')].some((one) => one.textContent.includes({title!r}))", "the new login shown")


def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820},
        reduced_motion="reduce",
        permissions=["clipboard-read", "clipboard-write"],
    )
    context.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-pass']))")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}") if message.type == "error" else None,
    )
    DRIVE.open(page)
    opened(page)
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Set up Pass')", "the setup screen", 60)
    shot(page, "01-setup")

    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Continue", exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", "the recovery key", 180)
    code = page.locator(".pass .code").inner_text()
    if len("".join(ch for ch in code if ch.isalnum())) < 20:
        wrong(f"the recovery key is short: {code!r}")
    shot(page, "02-recovery")
    page.get_by_role("button", name="I saved it", exact=True).click()
    wait_for(page, "document.querySelector('.pass .side')", "the three columns")
    shot(page, "03-empty")
    say("set up, recovery key shown once")

    made_login(page, "Bank of Tests", "ada@example.com", SECRET)
    made_login(page, "Mail", "grace@example.com", "short")
    wait_for(page, f"{ROWS} === 2", "two rows")
    if SECRET in page.locator(".pass").inner_text():
        wrong("the password shows before Show is pressed")
    shot(page, "04-item")
    say("two logins made")

    page.locator(".pass input[type=search]").fill("bank")
    wait_for(page, f"{ROWS} === 1", "the search narrowing to one row")
    shot(page, "05-search")
    page.locator(".pass input[type=search]").fill("")
    wait_for(page, f"{ROWS} === 2", "both rows again")
    page.locator(".pass [data-item]").filter(has_text="Bank of Tests").click()

    password = page.locator(".pass [data-field='Password']")
    password.locator(".tap").click()
    wait_for(page, f"navigator.clipboard.readText().then((text) => text === {SECRET!r})", "the password copied")
    password.locator("[aria-pressed]").click()
    if SECRET not in password.inner_text():
        wrong("Show did not show the password")
    say("searched, copied and shown")

    page.locator(".pass [data-item]").filter(has_text="Mail").click()
    page.locator(".pass main").get_by_role("button", name="Edit", exact=True).click()
    page.locator(".pass main input[type=file]").set_input_files(
        {"name": "deed.txt", "mimeType": "text/plain", "buffer": ATTACHED}
    )
    wait_for(page, "document.querySelector('.pass main')?.textContent.includes('deed.txt')", "the file waiting to be attached")
    page.get_by_role("button", name="Save", exact=True).click()
    wait_for(page, "document.querySelector('.pass [data-file=\"deed.txt\"]')", "the attached file listed", 60)
    with page.expect_download() as fetched:
        page.get_by_role("button", name="Download deed.txt").click()
    if Path(fetched.value.path()).read_bytes() != ATTACHED:
        wrong("the downloaded file is not the one attached")
    shot(page, "05b-attachment")
    say("a file attached, sealed on the device and downloaded again")

    page.locator(".pass .side .foot button").filter(has_text="Lock").click()
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Pass is locked')", "the lock")
    if "Bank of Tests" in page.locator(".pass").inner_text():
        wrong("the lock screen shows an item")
    shot(page, "06-locked")
    page.locator(".pass input[type=password]").fill("not the password")
    page.get_by_role("button", name="Unlock", exact=True).click()
    wait_for(page, "document.querySelector('.pass [role=alert]')", "the wrong password said", 120)
    shot(page, "07-wrong")
    page.locator(".pass input[type=password]").fill(PASSWORD)
    page.get_by_role("button", name="Unlock", exact=True).click()
    wait_for(page, "document.querySelector('.pass .side')", "Pass open again", 180)
    say("locked, refused a wrong password, opened")

    page.locator(".pass [data-item]").filter(has_text="Bank of Tests").click()
    page.locator(".pass main").get_by_role("button", name="Edit", exact=True).click()
    page.get_by_label("Title", exact=True).fill("Bank of Proofs")
    page.get_by_role("button", name="Save", exact=True).click()
    wait_for(page, "[...document.querySelectorAll('.pass [data-item]')].some((one) => one.textContent.includes('Bank of Proofs'))", "the new title")
    say("edited")

    page.locator(".pass main").get_by_role("button", name="More", exact=True).click()
    page.get_by_role("menuitem", name="Move to trash", exact=True).click()
    wait_for(page, f"{ROWS} === 1", "one row left")
    page.locator(".pass .side button").filter(has_text="Trash").click()
    wait_for(page, f"{ROWS} === 1", "the trashed row")
    page.locator(".pass [data-item]").first.click()
    shot(page, "08-trash")
    page.locator(".pass main").get_by_role("button", name="Restore", exact=True).click()
    wait_for(page, f"{ROWS} === 0", "the trash empty again")
    page.locator(".pass .side button").filter(has_text="All items").click()
    wait_for(page, f"{ROWS} === 2", "both rows back")
    say("trashed and restored")

    page.locator(".pass .side .new").click()
    page.get_by_role("menuitem", name="Password", exact=True).click()
    wait_for(page, "document.querySelector('[role=dialog]')", "the generator")
    first = page.locator("[role=dialog] .generated").first.inner_text()
    page.get_by_role("button", name="Regenerate").click()
    page.wait_for_timeout(200)
    second = page.locator("[role=dialog] .generated").first.inner_text()
    if not first or first == second:
        wrong(f"the generator gave {first!r} then {second!r}")
    shot(page, "09-generator")
    page.keyboard.press("Escape")

    page.locator(".pass .side button").filter(has_text="Monitor").click()
    wait_for(page, "document.querySelector('.pass .monitor')", "Monitor")
    shot(page, "10-monitor")
    page.locator(".pass .side button").filter(has_text="Settings").click()
    wait_for(page, "document.querySelector('.pass .settings')", "Settings")
    shot(page, "11-settings")
    say("generator, Monitor and Settings drawn")

    page.route("https://app.simplelogin.io/**", simplelogin)
    page.get_by_role("tab", name="Aliases", exact=True).click()
    page.get_by_label("API key", exact=True).fill("sl-test-key")
    page.get_by_role("button", name="Connect", exact=True).click()
    wait_for(page, "[...document.querySelectorAll('.pass button')].some((one) => one.textContent.trim() === 'Disconnect')", "the alias service connected", 30)
    shot(page, "12-aliases")
    page.locator(".pass .side button").filter(has_text="All items").click()
    page.locator(".pass .side .new").click()
    page.get_by_role("menuitem", name="Alias", exact=True).click()
    wait_for(
        page,
        "document.querySelector('.pass [data-alias-preview]') || !(document.querySelector('.pass main .hint')?.textContent ?? 'Asking').includes('Asking')",
        "the alias form",
        30,
    )
    if not page.locator(".pass [data-alias-preview]").count():
        wrong(f"no alias form from the service: {page.locator('.pass main').inner_text()!r} after {ALIAS_ASKED}")
        return
    page.get_by_label("Title", exact=True).fill("Shop")
    page.get_by_label("Prefix", exact=True).fill("shop")
    wait_for(page, "document.querySelector('.pass [data-alias-preview]')?.textContent === 'shop.cat@slmail.me'", "the address previewed")
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, "document.querySelector('.pass [data-field=\"Alias address\"]')?.textContent.includes('shop.cat@slmail.me')", "the new alias shown", 30)
    if "POST /api/v3/alias/custom/new" not in ALIAS_ASKED:
        wrong(f"the alias was not made at the service: {ALIAS_ASKED}")
    shot(page, "13-alias")
    say("an alias service connected and an alias made there")
    context.close()


def main() -> int:
    return DRIVE.run(
        drive,
        "Pass is set up, holds logins and files, searches, copies, locks, edits, trashes, generates and makes aliases",
    )


if __name__ == "__main__":
    raise SystemExit(main())
