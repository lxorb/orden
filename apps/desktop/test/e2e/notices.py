from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PAGE_RECT = """
() => {
  const box = (el) => {
    if (!el) return null
    const one = el.getBoundingClientRect()
    return { x: one.x, y: one.y, width: one.width, height: one.height }
  }

  const web = box(document.querySelector('.web'))
  const head = box(document.querySelector('.web > .head'))
  if (!web || !head) return null

  return { x: web.x, y: head.y + head.height, width: web.width, height: web.height - head.height }
}
"""

WHAT_IS_OVER = """
(rect) => {
  const web = document.querySelector('.web')
  const found = []

  for (const x of [0.08, 0.5, 0.92]) {
    for (const y of [0.08, 0.5, 0.92]) {
      const on = document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y)
      if (on && web && (on === web || web.contains(on))) continue
      // A card of the notices row, which the page is cut round; see web-tab/covers.ts.
      if (on && on.closest('[data-notices] > *')) continue

      const name = on === null ? 'nothing' : on.tagName
      const first = on && typeof on.className === 'string' ? on.className.split(' ')[0] : ''
      found.push(first ? `${name}.${first}` : name)
    }
  }

  return found
}
"""

BOX = """
(selector) => {
  const el = document.querySelector(selector)
  if (!el) return null

  const one = el.getBoundingClientRect()
  return { x: one.x, y: one.y, width: one.width, height: one.height }
}
"""

BAR_CONTROLS = """
() => {
  const head = document.querySelector('.web > .head')
  if (!head) return []

  return [...head.querySelectorAll('button, input')].map((el) => {
    const one = el.getBoundingClientRect()
    return {
      name: el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName,
      x: one.x,
      y: one.y,
      width: one.width,
      height: one.height,
    }
  })
}
"""

def overlaps(one: dict[str, float], other: dict[str, float]) -> bool:
    return (
        one["x"] < other["x"] + other["width"]
        and other["x"] < one["x"] + one["width"]
        and one["y"] < other["y"] + other["height"]
        and other["y"] < one["y"] + one["height"]
    )

def clear_over_the_page(page: Page, when: str) -> dict[str, float]:
    rect = page.evaluate(PAGE_RECT)
    if not rect:
        raise SystemExit(f"there is no web surface on screen {when}")

    over = page.evaluate(WHAT_IS_OVER, rect)
    if over:
        wrong(f"{when}, the app is drawn over the page at {len(over)} of nine points: {over}")
    else:
        say(f"{when}, all nine points over the page are the page's own")

    return rect

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")

    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    wait_for(page, "document.querySelector('.web')", "a web tab")
    page.wait_for_timeout(250)
    shot(page, "01-page")

    clear = clear_over_the_page(page, "with nothing up")

    page.evaluate("() => { window.nibApp.updates.ready = '9.9.9' }")
    wait_for(page, "document.querySelector('.notice')", "the update notice")
    page.wait_for_timeout(500)
    shot(page, "02-notice")

    notice = page.evaluate(BOX, ".notice")
    if not notice:
        raise SystemExit("the update notice never arrived")

    noticed = clear_over_the_page(page, "with the update notice up")
    if not page.evaluate("() => !!document.querySelector('[data-notices] > .notice')"):
        wrong("the update notice is not a card of the notices row, so no page is cut round it")
    elif overlaps(notice, noticed):
        say("the update notice floats over the page, which is cut round it")
    else:
        say("the update notice is clear of the page")

    shorter = clear["height"] - noticed["height"]
    if abs(shorter) > 1:
        wrong(
            f"the page lost {shorter:.0f}px to a notice {notice['height']:.0f}px tall,"
            " so the notice pushed it rather than floating over it"
        )
    else:
        say("the page kept its height under the notice")

    page.evaluate("() => window.nibApp.updates.dismiss()")
    page.wait_for_timeout(500)
    back = page.evaluate(PAGE_RECT)
    if abs(back["height"] - clear["height"]) > 1:
        wrong(
            f"the page is {back['height']:.0f}px after the notice went,"
            f" against {clear['height']:.0f}px before it came"
        )
    else:
        say("the page has its room back")

    page.evaluate("() => window.nibApp.fullscreen.enter(window.nibApp.workspace.panes)")
    page.wait_for_timeout(500)
    shot(page, "03-fullscreen")

    filling = clear_over_the_page(page, "in full screen")
    if filling["height"] <= clear["height"]:
        wrong(
            f"the page is {filling['height']:.0f}px in full screen,"
            f" against {clear['height']:.0f}px with the app around it"
        )
    else:
        say(f"the page fills {filling['height']:.0f}px of the screen, up from {clear['height']:.0f}")

    if page.evaluate(BOX, ".leave"):
        wrong("the way out of full screen is drawn over a web page, which is behind it")
    else:
        say("no button over the page in full screen")

    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    if page.evaluate("() => window.nibApp.fullscreen.on"):
        wrong("Escape does not give the screen back from a web page")
        page.evaluate("() => window.nibApp.fullscreen.leave()")
    else:
        say("Escape gives the screen back")

    page.wait_for_timeout(400)
    shot(page, "04-back")
    context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("nothing of the app's is over the page")

if __name__ == "__main__":
    raise SystemExit(main())
