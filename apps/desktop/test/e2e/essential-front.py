"""An essential says its note's tab in the strip is the one in front (#1110).

An essential kept as a tab in the strip (a double click on its tile, #1051) is that tab
from then on, and while that tab is in front the tile in the sidebar wears a ring of the
accent around it - another state than the open one's lift, which is the essential
shown where a tab shows. This keeps an essential as a tab, holds its tile to the bar
while the tab is in front and to none once another tab is, and to the lift without the
bar while the essential itself is shown.

Run it from the repository root:

    python apps/desktop/test/e2e/essential-front.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist.
"""

from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

KEEP = """async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  if (ws.panel !== 'tree') ws.showPanel('tree')
  ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: `${root}/Slack.md`, is_dir: false }))
  return ws.bookmarks.list.length
}"""

TILE = """() => {
  const tile = document.querySelector('.tiles .tile')
  return { on: tile.classList.contains('is-on'), front: tile.classList.contains('is-front') && getComputedStyle(tile).outlineStyle === 'solid' }
}"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 800})
    DRIVE.open(page)
    DRIVE.seed(page, "# Slack\n\nWords.\n", "# One\n\nWords.\n")
    DRIVE.open_note(page, "One")
    say(f"kept: {page.evaluate(KEEP)}")
    wait_for(page, "document.querySelectorAll('.tiles .tile').length > 0", "the essential's tile")
    page.wait_for_timeout(500)

    page.locator(".tiles .tile").first.dblclick()
    page.wait_for_timeout(600)
    DRIVE.shot(page, "front")
    kept = page.evaluate(TILE)
    say(f"kept as a tab, in front: {kept}")
    if not kept["front"]:
        wrong("the essential's tile does not say its tab is in front")

    page.locator(".tabs .pick[data-tab]").first.click()
    page.wait_for_timeout(600)
    behind = page.evaluate(TILE)
    say(f"another tab in front: {behind}")
    if behind["front"]:
        wrong("the essential's tile still says its tab is in front with another one there")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "an essential says its tab is in front"))
