from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PATIENCE = 60

ANDROID = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

NAG = re.compile(
    r"sign in to|sign up|log in to|create an account|make an account|turn on sync"
    r"|keep your notes|on every device|get the app|download the app",
    re.IGNORECASE,
)

CHROME_TEXT = """
() => {
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const host = node.parentElement
    if (!host || host.closest('.cm-editor, [contenteditable="true"]')) continue
    if (!host.checkVisibility({ visibilityProperty: true })) continue
    const words = node.textContent.trim()
    if (words) out.push(words)
  }
  return out
}
"""

OPEN_LEFT = "() => { const ws = window.ordenApp.workspace; if (!ws.openOn('left')) ws.toggleSidebar('left') }"

HINT = "() => document.querySelector('.orden-bubble.hint')?.innerText.trim() ?? null"

def nags_in(page: Any) -> list[str]:
    return [one for one in page.evaluate(CHROME_TEXT) if NAG.search(one)]

def signed_out(page: Any, device: str) -> None:
    if page.evaluate("() => window.ordenApp.account.signedIn"):
        wrong(f"[{device}] a fresh browser is signed in, so the drive asks nothing")

def desktop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    signed_out(page, "desktop")
    page.evaluate(OPEN_LEFT)
    wait_for(page, "() => !!document.querySelector('.foot .who')", "the panel's foot")

    hint = wait_for(page, HINT, "the session's one hint", PATIENCE)
    say(f"[desktop] the hint: {hint!r}")
    if NAG.search(hint):
        wrong(f"[desktop] the hint pushes an account: {hint!r}")
    DRIVE.shot(page, "desktop-settled")

    found = nags_in(page)
    say(f"[desktop] lines that push an account: {found}")
    if found:
        wrong(f"[desktop] the app pushes an account unasked: {found}")

    row = page.evaluate("() => document.querySelector('.foot .who')?.getAttribute('aria-label') ?? null")
    say(f"[desktop] the account row: {row!r}")
    if row != "Sign in":
        wrong(f"[desktop] the account row says {row!r}, not Sign in")
    page.evaluate("() => window.ordenApp.settings.show('account')")
    wait_for(
        page,
        """() => [...document.querySelectorAll('[role="region"][aria-label="Settings"] button')]
              .some((one) => one.innerText.trim() === 'Sign in')""",
        "Sign in in Settings > Account",
    )
    DRIVE.shot(page, "desktop-account")

SEEN = "try { localStorage.setItem('orden:hints', JSON.stringify(['graph', 'palette'])) } catch {}"

SETTLED = "() => performance.now() > performance.getEntriesByName('orden: start')[0].startTime + 21_000"

STILL = """
() => document.getAnimations().every(
  (one) => one.playState !== 'running' || one.effect?.getTiming().iterations === Infinity
)
"""

def settled_with_nothing_left(browser: Browser, device: str) -> None:
    options: dict[str, Any] = {"viewport": {"width": 1280, "height": 820}}
    if device == "phone":
        options = {
            "viewport": {"width": 390, "height": 844},
            "has_touch": True,
            "is_mobile": True,
            "user_agent": ANDROID,
        }
    page = DRIVE.page(browser, **options)
    page.add_init_script(SEEN)
    DRIVE.open(page)
    signed_out(page, device)
    page.evaluate(OPEN_LEFT)
    if device == "phone":
        wait_for(page, "() => !!document.querySelector('[data-phone-tabs]')", "the tab bar")
    else:
        wait_for(page, "() => !!document.querySelector('.foot .who')", "the panel's foot")
    wait_for(page, SETTLED, "the session to settle", PATIENCE)
    wait_for(page, STILL, "the window to stop moving")
    DRIVE.settled(page)
    DRIVE.shot(page, f"{device}-nothing-left")

    hint = page.evaluate("() => document.querySelector('.orden-bubble.hint')?.textContent.trim() ?? null")
    say(f"[{device}] the hint with the feature hints put away: {hint!r}")
    if hint is not None:
        wrong(f"[{device}] a card came up with nothing left to point at: {hint!r}")
    found = nags_in(page)
    say(f"[{device}] lines that push an account: {found}")
    if found:
        wrong(f"[{device}] the app pushes an account unasked: {found}")

def drive(browser: Browser) -> None:
    desktop(browser)
    settled_with_nothing_left(browser, "desktop")
    settled_with_nothing_left(browser, "phone")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a first launch, signed out, asks nobody to sign in"))
