from __future__ import annotations

import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
PATIENCE = 60
STRETCH = 180

PASS_HOST = "pass.orden.so"
READER = "pass-web@example.com"
PASSWORD = "tulip ladder seven"
TITLE = "Bank of Tests"
SECRET = "hunter2-Very-Secret"

SIDE = ".pass .side"
CORNER = ".pass .side [data-region=foot]"
DIALOG = "[role=dialog]"


def wait_for(page: Page, expression: str, what: str, patience: float = PATIENCE) -> object:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        found = page.evaluate(f"() => {{ const found = {expression}; return found instanceof Node || found }}")
        if found:
            return found
        page.wait_for_timeout(100)
    shot(page, "gave-up")
    raise SystemExit(f"gave up waiting for {what}")


def has_text(selector: str, text: str) -> str:
    return f"[...document.querySelectorAll({selector!r})].some((one) => one.textContent.includes({text!r}))"


def named_as_pass(page: Page) -> None:
    title = page.title()
    if title != "Orden Pass":
        wrong(f"the page is called {title!r}")
    link = page.evaluate("() => document.querySelector('link[rel=manifest]')?.getAttribute('href')")
    if link != "/pass.webmanifest":
        wrong(f"the page links the manifest {link!r}")
    manifest = page.evaluate("() => fetch('/pass.webmanifest').then((answer) => answer.json())")
    if manifest.get("name") != "Orden Pass" or manifest.get("short_name") != "Pass":
        wrong(f"the manifest names {manifest.get('name')!r} / {manifest.get('short_name')!r}")
    for icon in manifest.get("icons", []):
        status = page.evaluate(f"() => fetch({icon['src']!r}).then((answer) => answer.status)")
        if status != 200:
            wrong(f"{icon['src']} answers {status}")
    say("named Orden Pass, with its own manifest and icons")


def signed_in(page: Page, worker: harness.Worker) -> None:
    wait_for(page, f"document.querySelector('{DIALOG} input[type=email]')", "the sign-in sheet")
    if page.locator(".pass").count():
        wrong("Pass shows before anybody signed in")
    shot(page, "01-sign-in")
    mark = len(worker.written())
    page.locator(f"{DIALOG} input[type=email]").fill(READER)
    page.locator(f"{DIALOG} button[type=submit]").click()
    found = worker.waits_for_mail(READER, r"(\d{3}) ?(\d{3})", "the sign-in code", mark)
    wait_for(page, f"document.querySelector('{DIALOG} input[inputmode=numeric]')", "the code boxes")
    page.locator(f"{DIALOG} input[inputmode=numeric]").first.fill(found.group(1) + found.group(2))
    wait_for(page, "document.querySelector('.pass')", "Pass after signing in")
    say("signed in with the code from the mail")


def set_up(page: Page) -> None:
    wait_for(page, has_text(".pass", "Set up Pass"), "the setup screen", STRETCH)
    fields = page.locator(".pass input[type=password]")
    fields.nth(0).fill(PASSWORD)
    fields.nth(1).fill(PASSWORD)
    page.get_by_role("button", name="Continue", exact=True).click()
    wait_for(page, "document.querySelector('.pass .code')", "the recovery key", STRETCH)
    page.get_by_role("button", name="I saved it", exact=True).click()
    wait_for(page, f"document.querySelector({SIDE!r})", "the three columns")
    say("Pass set up")


def corner(page: Page) -> None:
    wait_for(page, f"document.querySelector({CORNER!r})", "the account corner")
    titles = page.evaluate(
        f"() => [...document.querySelectorAll('{CORNER} button')].map((one) => one.getAttribute('aria-label') ?? '')"
    )
    say(f"the corner holds {titles}")
    if any(one in ("Light", "Dark", "Themes") for one in titles):
        wrong("the corner offers the theme switch")
    for wanted in ("Send feedback", "Settings"):
        if wanted not in titles:
            wrong(f"the corner has no {wanted}")
    who = page.locator(f"{CORNER} .who").get_attribute("aria-label") or ""
    if not who or who == "Sign in":
        wrong(f"the corner names the reader {who!r}")
    if page.locator(f"{SIDE} .foot button").filter(has_text="Settings").count():
        wrong("the side still has its own Settings row next to the corner")

    page.locator(f"{CORNER} .who").click()
    wait_for(page, "document.querySelector('[role=menu]')", "the account menu")
    items = page.evaluate("() => [...document.querySelectorAll('[role=menuitem]')].map((one) => one.textContent.trim())")
    if not any("Sign out" in one for one in items):
        wrong(f"the account menu holds {items}")
    shot(page, "02-account-menu")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('[role=menu]')", "the menu to close")

    page.locator(f"{CORNER} button[aria-label=Settings]").click()
    wait_for(page, "document.querySelector('.pass main.is-wide')", "Pass settings")
    page.locator(f"{SIDE} button").filter(has_text="All items").click()
    say("the corner names the reader, has no theme switch, opens the menu and Pass settings")


def made_login(page: Page) -> None:
    page.locator(f"{SIDE} .new").click()
    page.get_by_role("menuitem", name="Login", exact=True).click()
    page.get_by_label("Title", exact=True).fill(TITLE)
    page.locator(".pass main input[type=password]").first.fill(SECRET)
    page.get_by_role("button", name="Create", exact=True).click()
    wait_for(page, has_text(".pass main h2", TITLE), "the new login shown")
    shot(page, "03-item")
    say("a login made")


def locked_and_opened(page: Page) -> None:
    page.locator(f"{SIDE} .foot button").filter(has_text="Lock").click()
    wait_for(page, has_text(".pass", "Pass is locked"), "the lock")
    if TITLE in page.locator(".pass").inner_text():
        wrong("the lock screen shows an item")
    shot(page, "04-locked")
    page.locator(".pass input[type=password]").fill(PASSWORD)
    page.get_by_role("button", name="Unlock", exact=True).click()
    wait_for(page, f"document.querySelector({SIDE!r})", "Pass open again", STRETCH)
    wait_for(page, has_text(".pass [data-item]", TITLE), "the login after unlocking")
    say("locked and opened again")


def came_back(page: Page) -> None:
    page.reload(wait_until="domcontentloaded")
    wait_for(page, has_text(".pass", "Pass is locked"), "Pass locked after a reload", STRETCH)
    if page.locator(f"{DIALOG} input[type=email]").count():
        wrong("the reload asks to sign in again")
    page.locator(".pass input[type=password]").fill(PASSWORD)
    page.get_by_role("button", name="Unlock", exact=True).click()
    wait_for(page, has_text(".pass [data-item]", TITLE), "the login after the reload", STRETCH)
    say("still signed in after a reload")


def offered_a_reload(page: Page) -> None:
    piece = "**/assets/FeedbackSheet-*.js"
    page.route(piece, lambda route: route.abort())
    page.locator(f"{CORNER} button[aria-label='Send feedback']").click()
    wait_for(page, "document.querySelector('.reload[role=alert] button')", "the offer to reload after a piece of the page failed to load")
    page.unroute(piece)
    shot(page, "05-reload-offered")
    say("a piece of the page that failed to load offers a reload")


def on_a_phone(page: Page) -> None:
    page.set_viewport_size({"width": 390, "height": 760})
    wait_for(page, "document.querySelector(\".pass[data-columns='1']\")", "one column")
    wider = page.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    if wider > 0:
        wrong(f"the page is {wider}px wider than a phone")
    shot(page, "05-phone-list")
    page.locator(".pass .list button[aria-label=Back]").click()
    wait_for(page, f"document.querySelector({CORNER!r})", "the side with the corner on a phone")
    box = page.locator(CORNER).bounding_box()
    if box is None or box["y"] + box["height"] > 760 + 1 or box["x"] < 0:
        wrong(f"the corner sits at {box} on a phone")
    wider = page.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    if wider > 0:
        wrong(f"the side is {wider}px wider than a phone")
    shot(page, "06-phone-side")
    page.locator(f"{SIDE} button").filter(has_text="All items").click()
    wait_for(page, has_text(".pass [data-item]", TITLE), "the list again on a phone")
    say("usable on a phone")


def signed_out(page: Page) -> None:
    page.set_viewport_size({"width": 1280, "height": 820})
    wait_for(page, f"document.querySelector({CORNER!r})", "the corner again")
    page.locator(f"{CORNER} .who").click()
    page.get_by_role("menuitem", name="Sign out").click()
    wait_for(page, f"document.querySelector('{DIALOG} input[type=email]') && !document.querySelector('.pass')", "the sign-in sheet after signing out")
    shot(page, "07-signed-out")
    say("signed out, asked to sign in again")


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start(upstream=PASS_HOST)
        context = browser.new_context(
            viewport={"width": 1280, "height": 820},
            reduced_motion="reduce",
        )
        page = context.new_page()
        page.set_default_timeout(30000)
        page.on("pageerror", lambda error: wrong(f"page error: {error}"))
        page.goto(worker.origin, wait_until="domcontentloaded")
        named_as_pass(page)
        signed_in(page, worker)
        set_up(page)
        corner(page)
        made_login(page)
        locked_and_opened(page)
        came_back(page)
        offered_a_reload(page)
        on_a_phone(page)
        signed_out(page)
    return DRIVE.verdict("Pass on its own name: signed in, set up, a login made, locked and opened, the corner without a theme switch, a phone")


if __name__ == "__main__":
    raise SystemExit(main())
