from __future__ import annotations

import json
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()
PATIENCE = 60
STRETCH = 180
POKE_EVERY = 4

ADA = "ada-pass@example.com"
BOB = "bob-pass@example.com"
PASSWORD = "tulip ladder seven"
VAULT = "Family"
TITLE = "Family bank"
SECRET = "hunter2-Very-Secret"

SIDE = ".pass .side"
DIALOG = "[role=dialog]"


def wait_for(page: Page, expression: str, what: str, patience: float = PATIENCE, poke: bool = False) -> object:
    until = time.monotonic() + patience
    poked = 0.0
    while time.monotonic() < until:
        if poke and time.monotonic() - poked > POKE_EVERY:
            poked = time.monotonic()
            page.evaluate("() => window.dispatchEvent(new Event('focus'))")
        found = page.evaluate(f"() => {{ const found = {expression}; return found instanceof Node || found }}")
        if found:
            return found
        page.wait_for_timeout(500 if poke else 100)
    shot(page, "gave-up")
    foot = page.evaluate("() => document.querySelector('.pass .side .foot')?.outerHTML ?? '(no foot)'")
    raise SystemExit(f"gave up waiting for {what}; the side's foot: {foot[:600]}")


def has_text(selector: str, text: str) -> str:
    return f"[...document.querySelectorAll({selector!r})].some((one) => one.textContent.includes({text!r}))"


def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820},
        reduced_motion="reduce",
        permissions=["clipboard-read", "clipboard-write"],
    )
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    context.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['shown-pass']))")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "!!window.nibApp?.account.user", f"[{label}] the account")
    return page


def set_up(page: Page, label: str) -> None:
    page.keyboard.press("Control+Alt+v")
    wait_for(page, "document.querySelector('.pass')?.textContent.includes('Set up Pass')", f"[{label}] setup", STRETCH)
    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Continue", exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", f"[{label}] the recovery key", STRETCH)
    page.get_by_role("button", name="I saved it", exact=True).click()
    wait_for(page, f"document.querySelector({SIDE!r})", f"[{label}] the three columns")
    wait_for(page, "document.querySelector('.pass [data-sync=synced]')", f"[{label}] Pass synced", PATIENCE, poke=True)
    say(f"[{label}] Pass set up and synced")


def made_vault(page: Page) -> None:
    page.locator(f"{SIDE} button").filter(has_text="New vault").click()
    page.locator(f"{DIALOG} input[aria-label=Name]").fill(VAULT)
    page.get_by_role("button", name="Create vault", exact=True).click()
    wait_for(page, has_text(f"{SIDE} [data-vault]", VAULT), "the new vault")


def made_login(page: Page) -> None:
    page.locator(f"{SIDE} .new").click()
    page.get_by_role("menuitem", name="Login", exact=True).click()
    page.get_by_label("Title", exact=True).fill(TITLE)
    page.locator(".pass main input[type=password]").first.fill(SECRET)
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, has_text(".pass main h2", TITLE), "the new login shown")


def invited(ada: Page) -> None:
    ada.locator(f"{SIDE} [data-vault]").filter(has_text=VAULT).click(button="right")
    ada.get_by_role("menuitem", name="Share", exact=True).click()
    wait_for(ada, f"document.querySelector('{DIALOG} [data-member]')", "the members")
    ada.locator(f"{DIALOG} input[type=email]").fill(BOB)
    code = str(wait_for(ada, f"document.querySelector('{DIALOG} [data-safety] code')?.textContent", "Bob's safety code"))
    if len(code.replace(" ", "")) != 32:
        wrong(f"the safety code reads {code!r}")
    ada.get_by_role("combobox", name="Role", exact=True).click()
    ada.get_by_role("option", name="Editor", exact=True).click()
    shot(ada, "01-share-sheet")
    ada.get_by_role("button", name="Invite", exact=True).click()
    wait_for(ada, f"document.querySelector('{DIALOG} [data-member={json.dumps(BOB)}] [data-state=pending]')", "Bob pending")
    shot(ada, "02-invited")
    ada.keyboard.press("Escape")
    say(f"Ada invited Bob to {VAULT}, safety code {code}")


def accepted(bob: Page) -> None:
    wait_for(bob, f"document.querySelector('{SIDE} [data-invites]')?.textContent === '1'", "the invitation counted", PATIENCE, poke=True)
    bob.locator(f"{SIDE} button").filter(has_text="Shared with me").click()
    wait_for(bob, has_text("[data-invite]", VAULT), "the invitation naming the vault")
    if ADA not in bob.locator("[data-invite]").inner_text():
        wrong("the invitation does not name Ada")
    shot(bob, "03-invitation")
    bob.locator("[data-invite]").get_by_role("button", name="Accept", exact=True).click()
    wait_for(bob, has_text(f"{SIDE} [data-vault]", VAULT), "the shared vault on Bob's side", PATIENCE, poke=True)
    bob.locator(f"{SIDE} [data-vault]").filter(has_text=VAULT).click()
    wait_for(bob, has_text(".pass [data-item]", TITLE), "the shared login on Bob's side", PATIENCE, poke=True)
    bob.locator(".pass [data-item]").filter(has_text=TITLE).click()
    password = bob.locator(".pass [data-field='Password']")
    password.locator("[aria-pressed]").click()
    if SECRET not in password.inner_text():
        wrong("Bob cannot see the shared password")
    shot(bob, "04-bob-sees")
    say("Bob accepted and reads the shared login")


def linked(ada: Page) -> str:
    ada.locator(".pass [data-item]").filter(has_text=TITLE).click()
    ada.locator(".pass main").get_by_role("button", name="More", exact=True).click()
    ada.get_by_role("menuitem", name="Share", exact=True).click()
    ada.get_by_role("menuitem", name="Create secure link", exact=True).click()
    wait_for(ada, f"document.querySelector('{DIALOG}')?.textContent.includes('Expires after')", "the link sheet")
    shot(ada, "05-link-sheet")
    ada.get_by_role("button", name="Create", exact=True).click()
    url = str(wait_for(ada, "document.querySelector('[data-link-url]')?.value", "the link made"))
    if "#" not in url or "/pass-link/" not in url:
        wrong(f"the link reads {url!r}")
    shot(ada, "06-link-made")
    ada.keyboard.press("Escape")
    say("Ada made a secure link")
    return url


def opened_link(browser: Browser, url: str) -> None:
    context = browser.new_context(viewport={"width": 900, "height": 760}, reduced_motion="reduce")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[link] page error: {error}"))
    page.goto(url, wait_until="domcontentloaded")
    wait_for(page, has_text(".link-card .link-title", TITLE), "the link's item")
    if "#" in page.url:
        wrong("the link's key stays in the address")
    field = page.locator(".link-field").filter(has_text="Password")
    if SECRET in field.inner_text():
        wrong("the link shows the password before Show")
    field.get_by_role("button", name="Show", exact=True).click()
    if SECRET not in field.inner_text():
        wrong("the link does not show the password")
    shot(page, "07-link-page")
    context.close()
    say("somebody without an account opened the link")


def listed(ada: Page) -> None:
    ada.locator(f"{SIDE} button").filter(has_text="Secure links").click()
    wait_for(ada, has_text("[data-link]", TITLE), "the link listed")
    views = ada.locator("[data-link] [data-views]").first.inner_text()
    if views != "1 view":
        wrong(f"the link lists {views!r}")
    shot(ada, "08-links-page")
    say(f"Ada's links list the link, {views}")


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        ada_token = worker.account(ADA)
        bob_token = worker.account(BOB)
        ada = signed_in(browser, ada_token, "ada")
        bob = signed_in(browser, bob_token, "bob")
        set_up(ada, "ada")
        set_up(bob, "bob")
        made_vault(ada)
        made_login(ada)
        wait_for(ada, "document.querySelector('.pass [data-sync=synced]')", "Ada synced", PATIENCE, poke=True)
        invited(ada)
        accepted(bob)
        url = linked(ada)
        opened_link(browser, url)
        listed(ada)
    return DRIVE.verdict("Ada shares a vault with Bob, who accepts and reads it; a secure link opens for anybody")


if __name__ == "__main__":
    raise SystemExit(main())
