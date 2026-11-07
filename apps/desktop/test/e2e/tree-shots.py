from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PATIENCE = 40

def fresh(browser: Browser, label: str, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    return page

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  // The drawer opens on nothing until somebody asks for a panel.
  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\nthe first line\\n', root)
  await ws.noteFrom('# Meeting notes\\n\\nwho said what\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nreading\\n', at('Reading'))

  const paper = await ws.noteFrom('# paper\\n', at('Reading'))
  await ws.rename(paper, 'Deep Learning.pdf')

  // Named outright: with a name in hand the file is written at once, rather than a
  // row waiting to be typed into. See `createCanvas`.
  await ws.createCanvas(root, 'Roadmap.canvas')

  ws.toggleFolder(at('Reading'))
  await ws.openEntry(at('Meeting notes.md'))
  return ws.tree.children.map((one) => one.name)
}
"""

ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) =>
  [row.className, row.querySelector('svg')?.getAttribute('viewBox') ?? 'no mark',
   row.textContent.trim()].join(' | '))
"""

UNLISTED = """
() => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  const entry = (name) => ({
    name, path: at(name), is_dir: false, modified: 0, created: 0, children: [],
  })

  ws.tree.children.push(entry('Whiteboard.png'), entry('numbers.csv'))
  return ws.tree.children.map((one) => one.name)
}
"""

def shoot(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme, scheme)
    try:
        say(f"[{scheme}] the space holds {page.evaluate(SEED)}")

        wait_for(
            page,
            "() => document.querySelectorAll('aside .row .mark').length >= 4",
            f"[{scheme}] a mark on every file row",
        )
        page.wait_for_timeout(400)

        for one in page.evaluate(ROWS):
            say(f"[{scheme}] {one}")

        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"tree-{scheme}.png"))
        say(f"[{scheme}] wrote tree-{scheme}.png")

        if scheme == "light":
            say(f"[{scheme}] with the unlisted kinds: {page.evaluate(UNLISTED)}")
            page.wait_for_timeout(300)
            page.locator("aside:not(.right)").screenshot(path=str(SHOTS / "tree-every-mark.png"))
            say(f"[{scheme}] wrote tree-every-mark.png")
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        shoot(browser, "light")
        shoot(browser, "dark")

    return DRIVE.verdict("the tree was shot light and dark")

if __name__ == "__main__":
    sys.exit(main())
