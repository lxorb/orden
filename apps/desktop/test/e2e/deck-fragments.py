
from __future__ import annotations

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

DECK = "# First\n\nalpha words\n\n---\n\n# Second\n\n+ one\n+ two\n+ three\n"

WATCH = """() => {
  window.__seen = new Promise((resolve) => {
    const seen = []
    const start = performance.now()
    const look = () => {
      const items = [...document.querySelectorAll('.deck .slide li')]
      if (items.length) seen.push(Math.max(...items.map((one) => Number(getComputedStyle(one).opacity))))
      if (performance.now() - start < 900) requestAnimationFrame(look)
      else resolve(seen)
    }
    requestAnimationFrame(look)
  })
}"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    page.add_init_script("Element.prototype.requestFullscreen = () => Promise.resolve()")
    page.emulate_media(reduced_motion="no-preference")
    DRIVE.open(page)
    DRIVE.seed(page, DECK)
    DRIVE.open_note(page, "First")
    page.evaluate("() => window.ordenApp.present.start()")
    page.wait_for_selector(".stage")
    page.wait_for_timeout(600)
    page.keyboard.press("Home")
    page.wait_for_timeout(600)

    for visit in ("first", "second"):
        page.evaluate(WATCH)
        page.keyboard.press("ArrowRight")
        seen = page.evaluate("() => window.__seen")
        say(f"{visit} visit: most opaque list item per frame {[round(one, 2) for one in seen[:12]]}")
        if not seen:
            wrong(f"{visit} visit: the slide with the list never showed")
        elif max(seen) > 0.05:
            wrong(f"{visit} visit: list items not yet due flashed into view (opacity {max(seen):.2f})")
        page.keyboard.press("Home")
        page.wait_for_timeout(600)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
