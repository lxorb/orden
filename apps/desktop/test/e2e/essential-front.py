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
