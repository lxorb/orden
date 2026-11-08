from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

from harness import ROOT, Drive

DRIVE = Drive(__file__, dev=True, chats=True)
say, wrong, shot, wait_for, waited = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for, DRIVE.waited

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAKE = f"/@fs{(ROOT / 'packages' / 'chats' / 'src' / 'fake-provider.ts').as_posix()}"

PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

EVERY = """
async (fake) => {
  const made = await import(fake)
  const { accounts } = await import('/src/lib/chats/linked.ts')
  for (const one of accounts.offered) accounts.offer({ ...one, available: () => true })
  const pairs = made.fakeProvider({ id: 'pairs', name: 'Pairs', signIn: 'qr' })
  accounts.offer(pairs)
  window.__pairs = pairs
}
"""

COUNT = "() => window.ordenApp.workspace.tabs.filter((one) => one.kind === 'connect').length"

SERVICES = ["Email", "Gmail", "Microsoft 365", "Telegram", "Slack", "WhatsApp", "Signal"]


def scheme(page: Page, side: str) -> None:
    page.evaluate(f"() => window.ordenApp.theme.setScheme({side!r})")
    page.wait_for_timeout(250)


def at(page: Page, step: str, what: str) -> bool:
    if waited(page, f"document.querySelector('.add-chat')?.dataset.step === {step!r}", what):
        return True
    kinds = page.evaluate("() => window.ordenApp.workspace.tabs.map((one) => one.kind)")
    say(f"tabs: {kinds}")
    shot(page, f"lost-{step}")
    return False


def fresh(browser: Browser, finger: bool = False, language: str = "en") -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 420, "height": 880} if finger else {"width": 1280, "height": 860},
        has_touch=finger,
        is_mobile=finger,
        reduced_motion="reduce",
        **({"user_agent": PHONE} if finger else {}),
    )
    if language != "en":
        page.context.add_init_script(f"localStorage.setItem('orden:language', {language!r})")
    DRIVE.open(page)
    page.evaluate(EVERY, FAKE)
    return page


def no_old_form(page: Page) -> None:
    left = page.evaluate("""() => ({
      form: !!document.querySelector('.chats form, .chats .connect, .chats .service'),
      secret: !!document.querySelector('.chats input[type=password]'),
    })""")
    if left["form"] or left["secret"]:
        wrong(f"the sidebar still holds a form to connect with ({left})")


def tile(page: Page, name: str) -> None:
    page.locator(".add-chat .tile", has=page.locator(".tile-name", has_text=name)).first.click()


def look_at(page: Page, name: str) -> None:
    info = page.evaluate("""() => {
      const add = document.querySelector('.add-chat')
      return {
        email: !!add.querySelector('input[type=email]'),
        password: !!add.querySelector('input[type=password]'),
        advanced: add.querySelector('details.advanced')?.open ?? null,
        tel: !!add.querySelector('input[type=tel]'),
        steps: add.querySelectorAll('.steps li').length,
        guide: add.querySelectorAll('.guide li').length,
        warning: !!add.querySelector('.warning'),
        submit: add.querySelector('button[type=submit]')?.textContent.trim() ?? '',
        disabled: add.querySelector('button[type=submit]')?.disabled ?? null,
        separators: /[\\u00b7\\u2022]/.test(add.innerText),
      }
    }""")
    if info["separators"]:
        wrong(f"[{name}] a dot or bullet separates words")
    if name == "Email":
        if not info["email"] or not info["password"] or info["advanced"] is not False:
            wrong(f"[Email] wants address and password first, servers folded under Advanced ({info})")
    elif name in ("Gmail", "Microsoft 365"):
        if not info["submit"].startswith("Sign in with"):
            wrong(f"[{name}] no sign-in button ({info})")
    elif name == "Telegram":
        if not info["tel"] or info["guide"] < 3:
            wrong(f"[Telegram] lacks the phone or the steps to an API ID ({info})")
    elif name == "Slack":
        if info["guide"] < 4:
            wrong(f"[Slack] does not explain the one-click app step by step ({info})")
    elif name in ("WhatsApp", "Signal"):
        if info["steps"] != 3 or not info["warning"] or info["submit"] != "Show the QR code" or not info["disabled"]:
            wrong(f"[{name}] lacks the pairing steps, the warning or the QR button ({info})")


def desktop(browser: Browser) -> None:
    page = fresh(browser)
    page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    wait_for(page, "!!document.querySelector('.chats [aria-label=\"Add a chat account\"]')", "the sidebar's +")
    no_old_form(page)
    page.locator('.chats [aria-label="Add a chat account"]').click()
    if not at(page, "choose", "the window from the sidebar's +"):
        return
    no_old_form(page)
    names = page.evaluate("() => [...document.querySelectorAll('.add-chat .tile-name')].map((one) => one.textContent)")
    for name in SERVICES:
        if name not in names:
            wrong(f"no tile for {name} ({names})")
    hints = page.evaluate("() => [...document.querySelectorAll('.add-chat .tile')].filter((one) => !one.querySelector('.tile-hint')).map((one) => one.textContent.trim())")
    if [one for one in hints if "Pairs" not in one]:
        wrong(f"tiles without a hint: {hints}")
    for side in ("light", "dark"):
        scheme(page, side)
        shot(page, f"choose-{side}")

    for name in SERVICES:
        tile(page, name)
        if not at(page, "connect", f"{name}'s connect step"):
            continue
        look_at(page, name)
        for side in ("light", "dark"):
            scheme(page, side)
            shot(page, f"connect-{name.lower().replace(' ', '-')}-{side}")
        page.locator('.add-chat [aria-label="Back"]').click()
        at(page, "choose", f"Back from {name}")

    tile(page, "Email")
    at(page, "connect", "Email again")
    page.locator(".add-chat input[type=email]").fill("ada@localhost")
    page.locator(".add-chat input[type=password]").fill("secret")
    page.locator(".add-chat button[type=submit]").click()
    if waited(page, "!!document.querySelector('.add-chat .failed')", "the failed check"):
        reason = page.locator(".add-chat .failed").inner_text()
        if len(page.locator(".add-chat .failed p").all()) != 2:
            wrong(f"a failure says no reason and fix ({reason!r})")
        for side in ("light", "dark"):
            scheme(page, side)
            shot(page, f"check-failed-{side}")
        page.locator('.add-chat [aria-label="Back"]').click()
        at(page, "connect", "Back to the details")
        if not page.evaluate("() => document.querySelector('.add-chat details.advanced')?.open === true"):
            wrong("a failed mail check leaves the servers folded away")
        if page.locator(".add-chat input[type=email]").input_value() != "ada@localhost":
            wrong("Back lost the address")
        shot(page, "connect-email-advanced")

    page.keyboard.press("Escape")
    at(page, "choose", "Escape back to the tiles")
    page.wait_for_timeout(150)
    page.keyboard.press("Escape")
    asking = "[...document.querySelectorAll('[role=dialog]')].some((one) => one.textContent.includes('Stop adding'))"
    if waited(page, asking, "the ask before closing with something entered"):
        shot(page, "asks-before-closing")
        page.locator("[role=dialog] button", has_text="Discard").click()
    wait_for(page, f"({COUNT})() === 0", "the window closed")

    page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    page.locator('.chats [aria-label="Add a chat account"]').click()
    at(page, "choose", "the window again")
    tile(page, "Pairs")
    at(page, "connect", "Pairs's connect step")
    page.locator(".add-chat input.orden-field").first.fill("Ada")
    page.locator(".add-chat button[type=submit]").click()
    if waited(page, "!!document.querySelector('.add-chat .square svg')", "the QR code in the check step"):
        for side in ("light", "dark"):
            scheme(page, side)
            shot(page, f"check-qr-{side}")
        page.evaluate("() => window.__pairs.world.pair()")
        if at(page, "done", "the done step"):
            picks = page.evaluate("() => document.querySelectorAll('.add-chat .pick input:checked').length")
            if not picks:
                wrong("the done step offers no chats to open")
            for side in ("light", "dark"):
                scheme(page, side)
                shot(page, f"done-{side}")
            page.locator(".add-chat .actions .orden-button").last.click()
            wait_for(page, f"({COUNT})() === 0", "the window closed on Open chats")
            if page.evaluate("() => window.ordenApp.workspace.active?.kind") != "channel":
                wrong("Open chats opened no chat")
    page.context.close()


def openers(browser: Browser) -> None:
    page = fresh(browser)
    page.locator("body").click(position={"x": 700, "y": 400})
    for _ in range(2):
        page.keyboard.down("Shift")
        page.keyboard.up("Shift")
        page.wait_for_timeout(60)
    wait_for(page, "!!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("Add a chat account")
    page.wait_for_timeout(300)
    page.keyboard.press("Enter")
    at(page, "choose", "the window from the palette")
    page.evaluate("() => window.ordenApp.workspace.closeConnect()")
    wait_for(page, f"({COUNT})() === 0", "the window closed")

    page.evaluate("() => window.ordenApp.settings.show('general')")
    wait_for(page, "!!document.querySelector('[role=region][aria-label=Settings]')", "Settings")
    found = page.locator("[role=region][aria-label=Settings] .setting", has_text="Chat accounts")
    found.first.scroll_into_view_if_needed()
    found.locator(".value").first.click()
    at(page, "choose", "the window from Settings")
    if page.evaluate(COUNT) != 1:
        wrong("more than one window to add a chat")
    page.context.close()


def phone(browser: Browser) -> None:
    page = fresh(browser, finger=True)
    page.evaluate("() => import('/src/lib/chats/view/adding.svelte.ts').then((one) => one.addChat())")
    if not at(page, "choose", "the window on a phone"):
        return
    width = page.evaluate("() => document.querySelector('.add-chat').getBoundingClientRect().width")
    if width < 400:
        wrong(f"on a phone the window is {width}px wide, not the whole screen")
    for side in ("light", "dark"):
        scheme(page, side)
        shot(page, f"phone-choose-{side}")
        tile(page, "WhatsApp")
        at(page, "connect", "WhatsApp on a phone")
        shot(page, f"phone-connect-whatsapp-{side}")
        page.locator('.add-chat [aria-label="Back"]').click()
        at(page, "choose", "Back on a phone")
    page.context.close()


def rtl(browser: Browser) -> None:
    page = fresh(browser, language="ar")
    page.evaluate("() => import('/src/lib/chats/view/adding.svelte.ts').then((one) => one.addChat())")
    if not at(page, "choose", "the window in Arabic"):
        return
    if page.evaluate("() => getComputedStyle(document.querySelector('.add-chat')).direction") != "rtl":
        wrong("in Arabic the window reads left to right")
    english = page.evaluate("() => document.querySelector('.add-chat h1').textContent")
    if english == "Add a chat account":
        wrong("the window's title is not translated into Arabic")
    shot(page, "rtl-choose")
    tile(page, "Slack")
    at(page, "connect", "Slack in Arabic")
    shot(page, "rtl-connect-slack")
    page.context.close()


def narrow(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 700, "height": 760}, reduced_motion="reduce")
    DRIVE.open(page)
    page.evaluate(EVERY, FAKE)
    page.evaluate("() => import('/src/lib/chats/view/adding.svelte.ts').then((one) => one.addChat())")
    if not at(page, "choose", "the window in a narrow window"):
        return
    over = page.evaluate("() => { const add = document.querySelector('.add-chat'); return add.scrollWidth > add.clientWidth + 1 }")
    if over:
        wrong("a narrow window scrolls sideways")
    shot(page, "narrow-choose")
    page.context.close()


def drive(browser: Browser) -> None:
    for name, steps in (("desktop", desktop), ("openers", openers), ("phone", phone), ("rtl", rtl), ("narrow", narrow)):
        say(f"-- {name}")
        steps(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "adding a chat walks each service to its connect step in its own window"))
