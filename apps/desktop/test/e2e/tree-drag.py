"""A note dragged with a mouse in the file list: into a note, and between two in Manual.

What it proves, with the pointer a hand has and the drag the platform starts rather than
the call a drop makes (#427): a note let go in the middle of another makes the other one
hold it, and in the order somebody arranges, a note let go at the edge between two rows
stands there. nesting.py shoots the row this makes, and tree-order.py the order it keeps.

    python apps/desktop/test/e2e/tree-drag.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/tree-drag/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for, shot = DRIVE.say, DRIVE.wrong, DRIVE.wait_for, DRIVE.shot

SEED = """async (names) => {
  const ws = window.nibApp.workspace
  for (const name of names) await ws.noteFrom(`# ${name}\\n\\nwords\\n`, ws.activeSpace.root)
  await ws.loadTree()
}"""

PATHS = "() => window.nibApp.workspace.notes.map((one) => one.path.split('/').slice(-2).join('/')).sort()"
# By where each row stands: a row keeps its element as the order changes.
ROWS = """() => [...document.querySelectorAll('aside:not(.right) .row')]
  .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  .map((one) => one.querySelector('.nib-row-label').textContent.trim())"""


def row(page: Page, name: str):
    return page.locator("aside:not(.right) .row", has_text=name).first


def drag(page: Page, name: str, onto: str, where: float) -> None:
    """Pressed on one row and let go a fraction of the way down another, in steps."""
    start = row(page, name).bounding_box()
    end = row(page, onto).bounding_box()
    if not start or not end:
        wrong(f"no row for {name} or {onto}")
        return
    page.mouse.move(start["x"] + 40, start["y"] + start["height"] / 2)
    page.mouse.down()
    x, y = end["x"] + 40, end["y"] + end["height"] * where
    page.mouse.move(x, y, steps=8)
    # One more, as a hand's last: the gap opened under the pointer has put the carried
    # row there, and the row the pointer is now over has to take it at once.
    page.mouse.move(x, y + 0.5)
    shot(page, f"over-{onto}")
    page.mouse.up()


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    page.evaluate("() => { const ws = window.nibApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    page.evaluate(SEED, ["Lark", "Plover", "Wren"])
    wait_for(page, "document.querySelectorAll('aside:not(.right) .row').length >= 3", "the rows")

    # Manual, from the menu a reader chooses it in.
    page.locator("aside button[aria-label='Order of the files']").click()
    page.locator("[role=menu] [role=menuitem]", has_text="Manual").first.click()
    wait_for(page, "window.nibApp.workspace.sortMode === 'manual'", "Manual")

    before = page.evaluate(ROWS)
    say(f"before: {before}")
    moving, under = before[-1], before[0]
    drag(page, moving, under, 0.04)
    # Settled: the slide after a drop moves every row, and a row's place is read off it.
    wait_for(page, f"window.nibApp.workspace.arranged.dragging === false && !document.getAnimations().length", "the rows settled")
    now = page.evaluate(ROWS)
    say(f"reordered: {now}")
    if now[0] != moving:
        wrong(f"{moving} let go above {under} did not stand there: {now}")

    drag(page, now[0], now[1], 0.5)
    wait_for(page, f"window.nibApp.workspace.notes.some((one) => one.path.includes('/{now[1]}/{now[0]}'))", "the note nested")
    say(f"nested: {page.evaluate(PATHS)}")
    shot(page, "nested")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
