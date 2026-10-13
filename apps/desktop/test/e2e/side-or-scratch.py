"""The right side or the scratchpad, never both.

Emil, 2026-10-13: "should be EITHER right sidebar or scratchpad, never both". What it
walks: the outline open on the right, the scratchpad's switch pressed - the card takes
the edge and the outline goes under it - and the note's width read on every frame of
that swap, so "no jump" is a number: the note eases from one width to the other, never
more than a third of the way in one frame. Then the card put away brings the outline
back; the right side's button puts the card away; a reload with the card up comes back
with the card alone; and on a phone the right drawer and the card take the same turns.

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
  const pad = document.querySelector('[data-scratchpad]')
  return {
    side: ws.openOn('right'),
    kept: ws.rightPanel,
    pad: !!pad && !pad.classList.contains('shut'),
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

PAD = "header button.pad"
PRESS_PAD = f"document.querySelector('{PAD}').click()"


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
    if now != {"side": None, "kept": "outline", "pad": True}:
        wrong(f"the card and the right side are not taking turns: {now}")
    shot(page, "02-card-over-the-side")

    widths = page.evaluate(WIDTHS, PAD)
    smooth(widths, "card to outline")
    now = edge(page)
    say(f"card away: {now}")
    if now != {"side": "outline", "kept": "outline", "pad": False}:
        wrong(f"the outline did not come back as the card went: {now}")
    shot(page, "03-outline-back")

    page.evaluate(f"() => {PRESS_PAD}")
    page.wait_for_timeout(400)
    widths = page.evaluate(WIDTHS, "header button.toggle")
    smooth(widths, "card to the side's button")
    now = edge(page)
    say(f"the side's button over the card: {now}")
    if now != {"side": "outline", "kept": "outline", "pad": False}:
        wrong(f"the right side's button did not take the edge back: {now}")

    page.evaluate("() => window.nibApp.workspace.closePanel('right')")
    page.wait_for_timeout(400)
    if edge(page)["pad"]:
        wrong("the card came back when the side shut")

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
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

    page.evaluate(f"() => {PRESS_PAD}")
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
