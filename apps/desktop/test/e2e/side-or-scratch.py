"""The right side or the scratchpad, never both.

Emil, 2026-10-13: "should be EITHER right sidebar or scratchpad, never both". Since #1032
the scratchpad is one of the right side's own tabs, so the two take turns in one place.
What it walks: the outline open on the right, the scratchpad's tab pressed - the card
takes the side and the outline goes under it - and the note's width read on every frame
of that swap, so "no jump" is a number: the note never goes past either width. Then the
outline's tab brings the outline back; the right side's one button with the card up
shuts the side whole, and again opens it on the card; a reload with the card up comes
back with the card alone; and on a phone, where the scratchpad is in the left drawer's
foot (#1030), the right drawer and the card take the same turns.

    python apps/desktop/test/e2e/side-or-scratch.py

Shots go beside this file under `shots/side-or-scratch/`, which is ignored.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

# What stands at the right edge: the side's panel showing, and the card's column.
EDGE = """
() => {
  const ws = window.nibApp.workspace
  // The card's own element, docked in the right side on a desktop and the one note on a
  // phone: the side showing it, and it drawn.
  const card = document.querySelector('[data-scratchpad-card]')
  return {
    side: ws.openOn('right'),
    kept: ws.rightPanel,
    pad: ws.rightShows === 'scratchpad' && !!card && !card.closest('.shut'),
  }
}
"""

# The note's width on every frame for a while after the last button `press` names is
# pressed.
WIDTHS = """
async (press) => {
  const panes = document.querySelector('[data-panes]')
  const widths = []
  let going = true
  const sample = () => {
    widths.push([Math.round(performance.now()), Math.round(panes.getBoundingClientRect().width)])
    if (going) requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
  await new Promise((done) => requestAnimationFrame(done))
  ;[...document.querySelectorAll(press)].at(-1).click()
  await new Promise((done) => setTimeout(done, 600))
  going = false
  return widths
}
"""

#: The scratchpad's tab and the outline's on the right side, and the side's one button.
PAD = '[data-tab="scratchpad"]'
OUTLINE = '[data-tab="outline"]'
RIGHT = 'header [data-side-toggle="right"]'
PRESS_PAD = f"document.querySelector('{PAD}').click()"
#: A phone's scratchpad, in the left drawer's foot.
FOOT_PAD = '[data-region="foot"] button[aria-label="Scratchpad"]'


def smooth(frames: list[list[int]], what: str) -> None:
    """Eased from one width to the other: never further than the whole change in one
    frame's worth of the slide, and never past either end."""
    widths = [width for _, width in frames]
    first, last = widths[0], widths[-1]
    say(f"{what}: {frames}")
    low, high = min(first, last), max(first, last)
    if any(width < low - 1 or width > high + 1 for width in widths):
        wrong(f"{what}: the note went past the widths it was easing between: {widths}")


def edge(page: Page) -> dict:
    return page.evaluate(EDGE)


def desktop(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1440, "height": 900})
    DRIVE.open(page)
    DRIVE.seed(page, "# Kestrel notes\n\n## What went in\n\nA kestrel.\n\n## Wind\n\nSteady.\n")
    DRIVE.open_note(page, "Kestrel")

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)
    shot(page, "01-outline")

    widths = page.evaluate(WIDTHS, PAD)
    smooth(widths, "outline to card")
    now = edge(page)
    say(f"card up: {now}")
    if not now["pad"] or now["side"] is not None or now["kept"] != "outline":
        wrong(f"the card and the outline are not taking turns on the right side: {now}")
    shot(page, "02-card-over-the-side")

    widths = page.evaluate(WIDTHS, OUTLINE)
    smooth(widths, "card to outline")
    now = edge(page)
    say(f"outline's tab: {now}")
    if now != {"side": "outline", "kept": "outline", "pad": False}:
        wrong(f"the outline did not come back as the card went: {now}")
    shot(page, "03-outline-back")

    # The side's one button with the card up shuts the side whole, and again opens it
    # on what it showed: the card (#1032).
    page.evaluate(f"() => {PRESS_PAD}")
    page.wait_for_timeout(400)
    widths = page.evaluate(WIDTHS, RIGHT)
    smooth(widths, "card to the side's button")
    now = edge(page)
    say(f"the side's button over the card: {now}")
    if now["side"] is not None or now["pad"]:
        wrong(f"the right side's button did not shut the side whole: {now}")
    page.locator(RIGHT).click()
    page.wait_for_timeout(500)
    now = edge(page)
    say(f"the side's button again: {now}")
    if not now["pad"] or now["side"] is not None:
        wrong(f"the right side did not open again on the card it showed: {now}")

    page.evaluate("() => window.nibApp.workspace.closeRight()")
    page.wait_for_timeout(400)
    if edge(page)["pad"]:
        wrong("the card stayed when the side shut")

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(300)
    page.evaluate(f"() => {PRESS_PAD}")
    page.wait_for_timeout(500)
    page.evaluate("() => window.nibApp.workspace.flush?.()")
    page.wait_for_timeout(400)
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp?.workspace.activeSpace", "the app after a reload")
    page.wait_for_timeout(1500)
    now = edge(page)
    say(f"after a reload: {now}")
    if now["side"] is not None or not now["pad"]:
        wrong(f"a reload came back with both, or without the card: {now}")
    shot(page, "04-after-a-reload")
    page.close()


def phone(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=(
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
            " Chrome/140.0.0.0 Mobile Safari/537.36"
        ),
        has_touch=True,
        is_mobile=True,
        device_scale_factor=2,
    )
    DRIVE.open(page)
    DRIVE.seed(page, "# Kestrel notes\n\n## What went in\n\nA kestrel.\n")
    DRIVE.open_note(page, "Kestrel")

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)
    shot(page, "05-phone-drawer")

    # The scratchpad's glyph is in the left drawer's foot (#1030).
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    wait_for(page, f"document.querySelector('{FOOT_PAD}')", "the drawer's foot")
    page.wait_for_timeout(400)
    page.locator(FOOT_PAD).tap()
    page.wait_for_timeout(500)
    now = edge(page)
    say(f"phone, card up: {now}")
    drawer = page.evaluate("() => document.querySelector('.panels.right')?.classList.contains('open')")
    if now["side"] is not None or not now["pad"] or drawer:
        wrong(f"on a phone the drawer and the card stood together: {now}, drawer open {drawer}")
    shot(page, "06-phone-card")

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)
    now = edge(page)
    if now != {"side": "outline", "kept": "outline", "pad": False}:
        wrong(f"on a phone the drawer did not take the edge back: {now}")
    shot(page, "07-phone-drawer-back")
    page.close()


def drive(browser: Browser) -> None:
    desktop(browser)
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the right side and the scratchpad take turns"))
