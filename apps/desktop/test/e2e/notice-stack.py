from __future__ import annotations

from typing import Any

from playwright.sync_api import Browser

from harness import Drive
from shell import PHONE_AGENT

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SIZES = {
    "desktop": {"width": 1280, "height": 800},
    "narrow": {"width": 520, "height": 700},
    "phone": {"width": 390, "height": 844},
}

CORNER = """
() => [...document.querySelectorAll('[data-notices] > *, [role="dialog"][aria-label="Personalize"], .fab')]
  .filter((one) => one.checkVisibility())
  .map((one) => {
    const box = one.getBoundingClientRect()
    const name = one.getAttribute('aria-label') || one.textContent.trim().replace(/\\s+/g, ' ').slice(0, 32)
    return { name, left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  })
"""

def overlap(one: dict[str, Any], other: dict[str, Any]) -> bool:
    across = min(one["right"], other["right"]) - max(one["left"], other["left"])
    down = min(one["bottom"], other["bottom"]) - max(one["top"], other["top"])
    return across > 1 and down > 1

def drive(browser: Browser, kind: str) -> None:
    phone = kind == "phone"
    context = browser.new_context(
        viewport=SIZES[kind],
        user_agent=PHONE_AGENT if phone else None,
        has_touch=phone,
        is_mobile=phone,
        reduced_motion="reduce",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{kind}] page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")

    if kind == "narrow":
        page.evaluate("() => { window.ordenApp.workspace.showPanel('tree'); window.ordenApp.workspace.showPanel('outline') }")
    page.evaluate("() => { window.ordenApp.settings.setup = 0; window.ordenApp.updates.ready = '9.9.9' }")
    wait_for(
        page,
        "document.querySelector('[role=\"dialog\"][aria-label=\"Personalize\"]')",
        "the Personalize card",
    )
    page.wait_for_timeout(300)
    DRIVE.shot(page, kind)

    shown = page.evaluate(CORNER)
    names = [one["name"] for one in shown]
    say(f"[{kind}] in the corner: {names}")
    if len(shown) < 2:
        wrong(f"[{kind}] the card and the update notice are not both up: {names}")
    width = SIZES[kind]["width"]
    for one in shown:
        if one["left"] < 0 or one["right"] > width:
            wrong(f"[{kind}] {one['name']!r} reaches past the window, {one['left']:.0f} to {one['right']:.0f} of {width}")
    for at, one in enumerate(shown):
        for other in shown[at + 1 :]:
            if overlap(one, other):
                wrong(f"[{kind}] {one['name']!r} and {other['name']!r} are drawn over each other")
    if kind == "desktop":
        peek(page)
    context.close()

def peek(page) -> None:
    page.evaluate("() => { const ws = window.ordenApp.workspace; ws.showPanel('tree'); ws.showPanel('tree'); ws.panel = null }")
    wait_for(page, "window.ordenApp.workspace.panel === null", "the list shut")
    page.mouse.move(640, 400)
    page.wait_for_timeout(200)
    page.mouse.move(0, 400)
    wait_for(page, "document.querySelector('.panels .column')?.classList.contains('floating')", "the shut list out under the pointer")
    page.wait_for_timeout(400)
    card = page.evaluate(
        "() => !!document.querySelector('[role=\"dialog\"][aria-label=\"Personalize\"]')?.checkVisibility()"
    )
    say(f"[desktop] the card while the shut list is out: {'up' if card else 'gone'}")
    if not card:
        wrong("[desktop] the Personalize card went away while the shut list peeked out")

def main() -> int:
    with DRIVE.session() as browser:
        for kind in SIZES:
            drive(browser, kind)

    return DRIVE.verdict("the Personalize card, the update notice and the New note button keep apart")

if __name__ == "__main__":
    raise SystemExit(main())
