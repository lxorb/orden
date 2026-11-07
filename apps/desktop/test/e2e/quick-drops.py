from __future__ import annotations

from playwright.sync_api import Browser, Locator, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PATIENCE = 15

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nThe plan.\\n', root)
  await ws.noteFrom('# Spare\\n\\nA spare.\\n', root)
  await ws.noteFrom('# Sections\\n\\n## First\\n\\none\\n\\n## Second\\n\\ntwo\\n', root)
  await ws.noteFrom('# Deep\\n\\nDown in Old.\\n', root + '/Old')
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Sections.md')
  await ws.openEntry(note.path, {})
  if (ws.panel !== 'tree') ws.showPanel('tree')
  for (const path of ws.visibleRows()) if (!path.endsWith('.md')) ws.device.expand(path)
  return ws.notes.map((one) => one.path.slice(root.length + 1)).sort()
}
"""

TREE = """
() => {
  const root = window.ordenApp.workspace.activeSpace.root
  return [...document.querySelectorAll('aside .row[data-path]')].map((row) =>
    row.getAttribute('data-path').slice(root.length + 1)).sort()
}
"""

def row(page: Page, at: str) -> Locator:
    return page.locator(f"aside .row[data-path$='/{at}']").first

def quick(page: Page, source: Locator, target: Locator, what: str) -> None:
    start = source.bounding_box()
    end = target.bounding_box()
    assert start and end, what
    page.mouse.move(start["x"] + start["width"] / 2, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + start["width"] / 2 + 6, start["y"] + start["height"] / 2 + 2)
    page.mouse.move(end["x"] + end["width"] / 2, end["y"] + end["height"] / 2)
    page.mouse.up()
    say(f"let go at once: {what}")

def until(page: Page, check: str, what: str) -> None:
    try:
        wait_for(page, check, what, PATIENCE)
        say(f"taken: {what}")
    except BaseException:
        wrong(f"not taken: {what}")

def archived(page: Page) -> None:
    page.locator('aside .row[data-path$="/Plan.md"]').first.click(button="right")
    wait_for(page, "document.querySelector('.rows .orden-row')", "the menu of Plan")
    page.locator(".rows .orden-row", has_text="Archive").first.click()
    page.locator(".archive-head").wait_for(state="visible", timeout=PATIENCE * 1000)
    page.wait_for_timeout(400)

    quick(page, row(page, "Spare.md"), page.locator(".archive-head"), "Spare onto the archive")
    until(
        page,
        f"!({TREE})().includes('Spare.md')",
        "a row let go of on the archive at once is archived",
    )

def rooted(page: Page) -> None:
    rest = page.locator(".rest[data-space-rest]")
    rest.wait_for(state="visible", timeout=PATIENCE * 1000)
    quick(page, row(page, "Old/Deep.md"), rest, "Old/Deep onto the bare list")
    until(
        page,
        f"(({TREE})()).includes('Deep.md')",
        "a row let go of on the bare list at once moves to the space's top",
    )

def sections(page: Page) -> None:
    page.evaluate("() => window.ordenApp.workspace.showPanel('outline')")
    second = page.locator("aside .row.heading", has_text="Second").first
    second.wait_for(state="visible", timeout=PATIENCE * 1000)
    page.wait_for_timeout(300)
    quick(page, second, page.locator("aside .row.heading", has_text="First").first, "Second onto First")
    until(
        page,
        """() => {
          const text = document.querySelector('.cm-content')?.innerText ?? ''
          return text.indexOf('Second') >= 0 && text.indexOf('Second') < text.indexOf('First')
        }""",
        "a section let go of on another heading at once moves there",
    )
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")

def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820}, color_scheme="light", reduced_motion="reduce"
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    try:
        DRIVE.open(page)
        say(f"the space holds {page.evaluate(SEED)}")
        wait_for(page, "document.querySelector('.cm-content')", "the editor")
        wait_for(page, "document.querySelector(\"aside .row[data-path$='/Old/Deep.md']\")", "the rows")
        page.wait_for_timeout(600)

        archived(page)
        rooted(page)
        sections(page)
        shot(page, "quick-drops")
    finally:
        context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "rows and sections let go of the moment they reach a drop"))
