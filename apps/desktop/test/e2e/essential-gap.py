"""The room a strip makes for an essential dragged into it is the tab it becomes (#1110).

An essential dragged into the tab strip is kept there as a tab, in front, where it is let
go of (#1051). While it is carried over the strip the tabs make way for it - and they
made way by a tab of the standard width, whatever tab it became: with Icon tabs on, and
with tabs as wide as their names (#1114), the gap stood far wider than the tab let go
into it. This carries an essential's tile to the start of the strip, measures the room
the tabs made for it, lets go, and holds that room to the tab that arrived - and every
other tab to where it stood under the carried one.

Run it from the repository root:

    python apps/desktop/test/e2e/essential-gap.py

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

BOXES = """() => Object.fromEntries([...document.querySelectorAll('.tabs .tab')].map((one) => {
  const r = one.getBoundingClientRect()
  return [one.dataset.box, { x: r.x, width: r.width, name: one.querySelector('.label')?.textContent.trim() }]
}))"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 800})
    page.add_init_script(
        "window.__events = [];"
        " for (const type of ['dragstart', 'dragover', 'drop', 'dragend'])"
        "   window.addEventListener(type, (e) => { const said = type + ':' + (e.target?.className?.baseVal ?? e.target?.className ?? '');"
        "     if (window.__events.at(-1) !== said) window.__events.push(said) }, true)"
    )
    DRIVE.open(page)
    DRIVE.seed(page, "# Slack\n\nWords.\n", "# One\n\nWords.\n", "# Two\n\nWords.\n")
    for name in ("One", "Two"):
        DRIVE.open_note(page, name)
    say(f"kept: {page.evaluate(KEEP)}")
    wait_for(page, "document.querySelectorAll('.tiles .tile').length > 0", "the essential's tile")
    page.wait_for_timeout(800)

    before = page.evaluate(BOXES)
    start = min(one["x"] for one in before.values())
    first = min(before.values(), key=lambda one: one["x"])

    tile = page.locator(".tiles .tile").first.bounding_box()
    assert tile
    page.mouse.move(tile["x"] + tile["width"] / 2, tile["y"] + tile["height"] / 2)
    page.mouse.down()
    page.mouse.move(tile["x"] + 30, tile["y"] + 10, steps=4)
    # Over the front of the first tab: the strip's first place.
    page.mouse.move(first["x"] + 4, 20, steps=10)
    for nudge in (1, 2, 3):
        page.mouse.move(first["x"] + 4 + nudge, 20)
        page.wait_for_timeout(80)
    page.wait_for_timeout(500)
    during = page.evaluate(BOXES)
    gap = min(one["x"] for one in during.values()) - start
    page.mouse.up()
    page.wait_for_timeout(1200)

    after = page.evaluate(BOXES)
    arrived = [one for key, one in after.items() if key not in before]
    say(f"the room made: {gap:.0f}; the tabs after: {[(one['name'], round(one['width'])) for one in after.values()]}")
    if len(arrived) != 1:
        say(f"what the drag met: {page.evaluate('() => window.__events.slice(-12)')}")
        wrong(f"one tab did not arrive: {list(after)} after {list(before)}")
        return
    tab = arrived[0]
    if abs(tab["width"] - gap) > 2:
        wrong(f"the strip made {gap:.0f} of room for a tab {tab['width']:.0f} wide")
    for key, one in during.items():
        now = after.get(key)
        if now and abs(now["width"] - one["width"]) > 2:
            wrong(f"{one['name']} was {one['width']:.0f} wide under the carried tab and {now['width']:.0f} after")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "an essential carried into the strip is given its own room"))
