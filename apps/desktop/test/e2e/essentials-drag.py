"""A file dragged from the file list into the Essentials, and a tile dragged back out (#412).

A note dragged onto the Essentials leaves the list and is a tile; a tile dragged onto a
folder's row leaves the Essentials and lands in that folder, the folder opened to show
it. Two picked at once go together. Each is one Ctrl+Z, and Ctrl+Shift+Z does it again.
And it moves: right after a drop the page has animations running - the tiles' and the
rows' - unless the reader asked for less motion, when it has none.

    python apps/desktop/test/e2e/essentials-drag.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations


from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PATIENCE = 30
HINTS = "try { localStorage.setItem('nib:hints', JSON.stringify(['sign-in', 'graph', 'palette'])) } catch {}"

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await ws.noteFrom('# Alpha\\n\\none\\n', root)
  await ws.noteFrom('# Beta\\n\\ntwo\\n', root)
  await ws.noteFrom('# Gamma\\n\\nthree\\n', at('Work'))
  await ws.loadTree()
  return root
}
"""

# What is kept, and which rows the list draws, by name.
STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    kept: ws.bookmarks.list.filter((one) => one.kind === 'note').map((one) => one.path).sort(),
    rows: [...document.querySelectorAll('aside .row[data-path]')].map((one) => one.dataset.path
      .slice(ws.activeSpace.root.length + 1)).sort(),
    tiles: document.querySelectorAll('.tiles [data-at]').length,
  }
}
"""

# Every animation the page starts, counted as it is asked for: the tiles' FLIP and
# their scale in and out, and the rows' slide, all go through `Element.animate`.
COUNTING = """
(() => {
  window.__animated = 0
  const animate = Element.prototype.animate
  Element.prototype.animate = function (frames, options) {
    const lasts = typeof options === 'number' ? options : options?.duration ?? 0
    if (lasts > 0) window.__animated += 1
    return animate.call(this, frames, options)
  }
  window.addEventListener('dragstart', () => (window.__events = ['dragstart']), true)
  for (const type of ['dragover', 'drop', 'dragend']) {
    window.addEventListener(type, (event) => {
      const last = window.__events?.at(-1)
      const said = type + ':' + (event.target?.closest?.('.tiles') ? 'tiles' : event.target?.className ?? '')
      if (last !== said) window.__events?.push(said)
    }, true)
  }
})()
"""
MOVING = "() => { const n = window.__animated; window.__animated = 0; return n }"


def row(page: Page, at: str):
    return page.locator(f"aside .row[data-path$='/{at}']").first


def until(page: Page, check: str, what: str) -> bool:
    try:
        wait_for(page, f"() => {{ const s = ({STATE})(); return {check} }}", what, PATIENCE)
        return True
    except BaseException:
        wrong(f"{what}: {page.evaluate(STATE)}")
        return False


def moved(page: Page, what: str, want: bool = True) -> None:
    """Whether the page started animating after a drop: within a second, the tiles' and
    the rows' animations begin a frame or two after the change they show."""
    running = 0
    for _ in range(10):
        page.wait_for_timeout(100)
        running += page.evaluate(MOVING)
        if running and want:
            break
    say(f"{what}: {running} animations started")
    if want and not running:
        wrong(f"{what}: nothing moved")
    if not want and running:
        wrong(f"{what}: {running} animations ran for a reader who asked for less motion")


def drag(page: Page, source, target, what: str) -> None:
    source.drag_to(target)
    say(f"dragged: {what}")
    page.wait_for_timeout(40)


def keys(page: Page, chord: str) -> None:
    marked = "() => { window.__mark = window.nibApp.workspace.undone.last }"
    page.evaluate(marked)
    page.keyboard.press(chord)
    wait_for(page, "() => window.nibApp.workspace.undone.last !== window.__mark", f"{chord} landed", PATIENCE)


def walk(browser: Browser, reduced: bool) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 800}, reduced_motion="reduce" if reduced else "no-preference"
    )
    page = context.new_page()
    page.add_init_script(HINTS)
    page.add_init_script(COUNTING)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    tag = "[less motion] " if reduced else ""
    try:
        DRIVE.open(page)
        say(f"{tag}the space is {page.evaluate(SEED)}")
        page.evaluate("() => window.nibApp.workspace.device.expand(window.nibApp.workspace.activeSpace.root + '/Work')")
        wait_for(page, "() => !!document.querySelector(\"aside .row[data-path$='/Work/Gamma.md']\")", "the rows")
        page.wait_for_timeout(500)

        # Into the Essentials: the grid offers an empty place once a file is carried up past
        # the list - not before, or it would push the list under a row being reordered.
        page.evaluate(MOVING)
        row(page, "Alpha.md").hover()
        page.mouse.down()
        # Up out of the list, over the panel's tabs, which is when the grid makes room.
        tabs = page.locator("aside:not(.right) .switch").first.bounding_box()
        assert tabs
        page.mouse.move(tabs["x"] + 40, tabs["y"] + tabs["height"] / 2, steps=6)
        for nudge in (4, 8, 12):
            page.mouse.move(tabs["x"] + 40 + nudge, tabs["y"] + tabs["height"] / 2)
            page.wait_for_timeout(60)
        grid = page.locator(".tiles")
        grid.wait_for(state="visible", timeout=PATIENCE * 1000)
        box = grid.bounding_box()
        assert box
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=6)
        page.mouse.up()
        page.wait_for_timeout(40)
        if not until(page, "s.kept.includes('Alpha.md') && !s.rows.includes('Alpha.md') && s.tiles === 1", f"{tag}a file dragged into the Essentials"):
            say(f"{tag}what the drag met: {page.evaluate('() => window.__events')}")
        moved(page, f"{tag}into the Essentials", not reduced)

        keys(page, "Control+z")
        until(page, "!s.kept.length && s.rows.includes('Alpha.md')", f"{tag}undone, the file back in the list")
        keys(page, "Control+Shift+z")
        until(page, "s.kept.includes('Alpha.md') && !s.rows.includes('Alpha.md')", f"{tag}done again")

        # Back out, onto the folder's row: into the folder, the folder open.
        page.wait_for_timeout(300)
        page.evaluate(MOVING)
        drag(page, page.locator(".tiles [data-at]").first, row(page, "Work"), "Alpha's tile onto Work")
        until(page, "!s.kept.length && s.rows.includes('Work/Alpha.md')", f"{tag}a tile dragged into a folder of the list")
        moved(page, f"{tag}out of the Essentials", not reduced)
        keys(page, "Control+z")
        until(page, "s.kept.includes('Alpha.md') && !s.rows.includes('Work/Alpha.md')", f"{tag}undone, the tile back")

        # Two picked at once: one drag, both tiles, one undo.
        row(page, "Beta.md").click()
        row(page, "Work/Gamma.md").click(modifiers=["Alt"])
        drag(page, row(page, "Beta.md"), page.locator(".tiles"), "Beta and Gamma onto the Essentials")
        until(page, "s.kept.includes('Beta.md') && s.kept.includes('Work/Gamma.md') && s.tiles === 3", f"{tag}two dragged into the Essentials")
        keys(page, "Control+z")
        until(page, "s.kept.length === 1 && s.rows.includes('Beta.md') && s.rows.includes('Work/Gamma.md')", f"{tag}both undone at once")
        DRIVE.shot(page, "essentials-drag" + ("-reduced" if reduced else ""))
    finally:
        context.close()


def drive(browser: Browser) -> None:
    walk(browser, reduced=False)
    walk(browser, reduced=True)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "files dragged into the Essentials and tiles back out, each one undo"))
