from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

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

PAD = '[data-tab="scratchpad"]'
OUTLINE = '[data-tab="outline"]'
RIGHT = 'header [data-side-toggle="right"]'
PRESS_PAD = f"document.querySelector('{PAD}').click()"
YOU = "[data-phone-you]"
PAD_ITEM = '[role="menuitem"]:has-text("Scratchpad")'

def smooth(frames: list[list[int]], what: str) -> None:
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

    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    wait_for(page, f"document.querySelector('{YOU}')", "the drawer's head")
    page.wait_for_timeout(400)
    page.locator(YOU).tap()
    page.locator(PAD_ITEM).wait_for(state="visible", timeout=5000)
    page.locator(PAD_ITEM).tap()
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
