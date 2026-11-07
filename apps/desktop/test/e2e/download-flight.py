from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = "# Flying\n\nA note that leaves as a file.\n"

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const written = ws.notes.find((one) => one.name.startsWith('Flying'))
  await ws.openEntry(written.path, { activate: true })
  return written.name
}
"""

WATCH = """
() => {
  window.__flights = { seen: 0, most: 0, places: [], pressable: false }
  const look = () => {
    const cards = [...document.querySelectorAll('[data-flight]')]
    const watched = window.__flights
    watched.most = Math.max(watched.most, cards.length)
    for (const card of cards) {
      watched.seen += 1
      const box = card.getBoundingClientRect()
      watched.places.push([Math.round(box.x), Math.round(box.y)])
      if (getComputedStyle(card).pointerEvents !== 'none') watched.pressable = true
    }
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}
"""

SAID = "() => document.querySelector('p.orden-said[aria-live]')?.textContent ?? ''"

def is_true(claim: bool, what: str) -> None:
    if claim:
        say(f"ok   {what}")
    else:
        wrong(what)

def export(page: Page) -> None:
    page.keyboard.press("Control+o")
    page.wait_for_timeout(400)
    page.keyboard.type("> Export as Plain text")
    page.wait_for_timeout(700)
    with page.expect_download(timeout=40000):
        page.keyboard.press("Enter")

def opened(browser: Browser, reduced: bool) -> tuple[object, Page]:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
        reduced_motion="reduce" if reduced else "no-preference",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(
        page,
        "window.nib && document.querySelector('.cm-content')"
        " && window.nibApp.workspace.active?.note?.name?.startsWith('Flying')",
        "the note to be the one open",
    )
    page.evaluate(WATCH)
    return context, page

def flying(browser: Browser) -> None:
    context, page = opened(browser, reduced=False)

    export(page)
    page.wait_for_timeout(120)
    shot(page, "01-in-the-air")
    page.wait_for_timeout(900)
    watched = page.evaluate("() => window.__flights")
    places = watched["places"]
    say(f"[one] {watched['seen']} frames, from {places[:1]} to {places[-1:]}")
    is_true(watched["seen"] > 3, "the file flew")
    is_true(len({tuple(one) for one in places}) > 3, "and moved on its way")
    is_true(not watched["pressable"], "and took no press")
    is_true(page.locator("[data-flight]").count() == 0, "and was gone once it landed")
    is_true("Downloading" in page.evaluate(SAID) and ".txt" in page.evaluate(SAID), "and was said")
    shot(page, "02-landed")

    flights = 0
    for _ in range(3):
        page.evaluate("() => { window.__flights.seen = 0 }")
        export(page)
        page.wait_for_timeout(900)
        flights += 1 if page.evaluate("() => window.__flights.seen") > 3 else 0
    say(f"[again] {flights} of 3 exports in a row flew")
    is_true(flights == 3, "every export in a row flies, not only the first")

    context.close()

def still(browser: Browser) -> None:
    context, page = opened(browser, reduced=True)

    export(page)
    page.wait_for_timeout(900)
    watched = page.evaluate("() => window.__flights")
    is_true(watched["seen"] == 0, "nothing flies for a reader who asked for less movement")
    is_true("Downloading" in page.evaluate(SAID), "and the download is still said")
    shot(page, "03-still")

    context.close()

def main() -> int:
    with DRIVE.session() as browser:
        flying(browser)
        still(browser)

    return DRIVE.verdict("a download flies to where downloads are, and is said")

if __name__ == "__main__":
    raise SystemExit(main())
