"""A web tab saved as a note, from the dots (#405).

Emil: "und entferne bitte diese komische schere um browser tabs als note zu speichern".
The scissors are off the web tab's bar on every platform, and the clipper they pressed
is Save as a note behind the dots, in Chrome's place for Save page. See docs/web-tabs.md,
"Clipping the page".

What it checks, on the built web app in Chromium:

    the bar has back, forward, reload, the address and the dots, and no scissors
    the dots hold Save as a note, and pressing it writes the page into the space as a
      note with the page's address as its `source:`

Run it from the repository root:

    python apps/desktop/test/e2e/web-clip.py
"""

from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

URL = "https://example.com/clipped"

# The notes in the space that say they came from somewhere, by path and front matter.
SOURCED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.loadTree()
  const out = []
  for (const one of ws.files.filter((file) => file.name.endsWith('.md'))) {
    const text = (await ws.noteText(one.path)) ?? ''
    if (text.includes('source:')) out.push([one.path, text.split('---')[1] ?? ''])
  }
  return out
}
"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)

    page.evaluate(f"() => window.nibApp.workspace.openPage({URL!r}, 'plain')")
    wait_for(page, "document.querySelector('.webbar')", "the web tab's bar")
    wait_for(
        page,
        "window.nibApp.workspace.active?.kind === 'web'",
        "the web tab in front",
    )

    glyphs = page.evaluate(
        "() => [...document.querySelectorAll('.webbar button')].map((one) => one.getAttribute('aria-label'))"
    )
    say(f"the bar: {glyphs}")
    if any(label and label.startswith("Clip") for label in glyphs):
        wrong("the bar still wears the scissors")
    if "More" not in glyphs:
        wrong("the bar has no dots")
    shot(page, "01-the-bar")

    before = page.evaluate(SOURCED)
    page.click('.webbar button[aria-label="More"]')
    row = page.locator("[role=menu] [role=menuitem]", has_text="Save as a note").first
    if not DRIVE.waited(page, "!!document.querySelector('[role=menu]')", "the dots' menu"):
        return
    shot(page, "02-the-dots")
    if row.count() < 1:
        wrong("the dots have no Save as a note row")
        return

    row.click()
    # Asked of the space until the note is there: the clip writes it a round trip or
    # two after the press, and a busy machine takes longer.
    after = before
    for _ in range(60):
        after = page.evaluate(SOURCED)
        if len(after) > len(before):
            break
        page.wait_for_timeout(250)
    fresh = [one for one in after if one not in before]
    say(f"saved: {fresh}")
    if not any(URL in matter for _path, matter in fresh):
        wrong(f"no note says it came from {URL}")
    shot(page, "03-saved")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the scissors are gone and the dots save the page as a note"))
