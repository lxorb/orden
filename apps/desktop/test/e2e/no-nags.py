"""A first launch, signed out, asks nobody to sign in (#415).

A browser that has never seen the app is opened and left until the session has
settled, which is when a hint may come up (start.ts, hints.svelte.ts): once as it
comes, and once on a desktop and on a phone with the feature hints already put away,
where the card that asked a reader to sign in used to be all that was left. Then
everything the app draws round the note - the panels, their foot, the notices row, a
hint card - is read, and none of it may push the reader towards an account: no sign in
to this, no account to make, no syncing to turn on, no app to get. The note itself is
the reader's and is not read.

What stays is checked too, so the drive is not passing on an empty window: on a fresh
desktop the session's one hint does come up, and it is about a feature or a key; and
signing in is still where somebody looks for it, the account row at the foot of the
panel and Settings > Account.

Run it from the repository root:

    python apps/desktop/test/e2e/no-nags.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

#: Twenty seconds to the settled session (start.ts), and room for a slow machine.
PATIENCE = 60

ANDROID = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

#: What a nag says, in any of its words. The account row's own "Sign in" is a control
#: somebody presses, not a sentence pushed at them, so it is not one of these.
NAG = re.compile(
    r"sign in to|sign up|log in to|create an account|make an account|turn on sync"
    r"|keep your notes|on every device|get the app|download the app",
    re.IGNORECASE,
)

#: Every visible line of text the app draws, the notes' own words left out.
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

#: The left side open, on whatever panel it holds.
OPEN_LEFT = "() => { const ws = window.nibApp.workspace; if (!ws.openOn('left')) ws.toggleSidebar('left') }"

#: The hint card on screen, by its words, or null.
HINT = "() => document.querySelector('.nib-bubble.hint')?.innerText.trim() ?? null"


def nags_in(page: Any) -> list[str]:
    return [one for one in page.evaluate(CHROME_TEXT) if NAG.search(one)]


def signed_out(page: Any, device: str) -> None:
    if page.evaluate("() => window.nibApp.account.signedIn"):
        wrong(f"[{device}] a fresh browser is signed in, so the drive asks nothing")


def desktop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    signed_out(page, "desktop")
    # A first launch keeps the panel shut; its foot and its cards are what is asked about.
    page.evaluate(OPEN_LEFT)
    wait_for(page, "() => !!document.querySelector('.foot .who')", "the panel's foot")

    # The session's one hint is the mark that it has settled.
    hint = wait_for(page, HINT, "the session's one hint", PATIENCE)
    say(f"[desktop] the hint: {hint!r}")
    if NAG.search(hint):
        wrong(f"[desktop] the hint pushes an account: {hint!r}")
    DRIVE.shot(page, "desktop-settled")

    found = nags_in(page)
    say(f"[desktop] lines that push an account: {found}")
    if found:
        wrong(f"[desktop] the app pushes an account unasked: {found}")

    # The ways in that stay: the account row, and Settings > Account.
    row = page.evaluate("() => document.querySelector('.foot .who')?.getAttribute('aria-label') ?? null")
    say(f"[desktop] the account row: {row!r}")
    if row != "Sign in":
        wrong(f"[desktop] the account row says {row!r}, not Sign in")
    page.evaluate("() => window.nibApp.settings.show('account')")
    wait_for(
        page,
        """() => [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] button')]
              .some((one) => one.innerText.trim() === 'Sign in')""",
        "Sign in in Settings > Account",
    )
    DRIVE.shot(page, "desktop-account")


#: The feature hints put away, as on a device that has seen them, so nothing is left
#: to come up but what the app would push unasked.
SEEN = "try { localStorage.setItem('nib:hints', JSON.stringify(['graph', 'palette'])) } catch {}"

#: Past the moment start.ts puts the session's hint up, counted from its own mark.
SETTLED = "() => performance.now() > performance.getEntriesByName('nib: start')[0].startTime + 21_000"

#: Nothing moving but what never stops (a caret, a row that breathes while it waits).
STILL = """
() => document.getAnimations().every(
  (one) => one.playState !== 'running' || one.effect?.getTiming().iterations === Infinity
)
"""


def settled_with_nothing_left(browser: Browser, device: str) -> None:
    """A signed-out session with every feature hint put away: once it has settled, no
    card comes up at all, and nothing round the note pushes an account."""
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
    wait_for(page, "() => !!document.querySelector('.foot .who')", "the panel's foot")
    # No card is left to mark the moment, so the page's own clock does: a second past
    # the twenty seconds start.ts waits from its own mark, and then whatever came up
    # done coming up.
    wait_for(page, SETTLED, "the session to settle", PATIENCE)
    wait_for(page, STILL, "the window to stop moving")
    DRIVE.settled(page)
    DRIVE.shot(page, f"{device}-nothing-left")

    hint = page.evaluate("() => document.querySelector('.nib-bubble.hint')?.textContent.trim() ?? null")
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
