from __future__ import annotations

import importlib.util
from pathlib import Path

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
APP = harness.APP

_spec = importlib.util.spec_from_file_location("first_paint", Path(__file__).parent / "first-paint.py")
assert _spec and _spec.loader
first_paint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(first_paint)

NOTES = 3000

LIST = 'aside [data-region="list"]'

COUNT = """
() => {
  const box = document.querySelector('aside [data-region="list"]')
  const rows = document.querySelectorAll('aside [data-region="list"] .row')
  const ul = document.querySelector('aside [data-region="list"] ul')
  return {
    rows: rows.length,
    first: rows[0]?.textContent.trim() ?? null,
    last: rows[rows.length - 1]?.textContent.trim() ?? null,
    listHeight: ul ? Math.round(ul.getBoundingClientRect().height) : null,
    runs: box ? box.scrollHeight : null,
    at: box ? Math.round(box.scrollTop) : null,
  }
}
"""

FOCUS = """
() => {
  const on = document.activeElement
  const box = document.querySelector('aside [data-region="list"]')
  let inView = null
  if (on instanceof HTMLElement && box) {
    const row = on.getBoundingClientRect()
    const holds = box.getBoundingClientRect()
    inView = row.top >= holds.top - 1 && row.bottom <= holds.bottom + 1
  }

  return {
    tag: on?.tagName ?? null,
    words: on?.textContent?.trim().slice(0, 40) ?? null,
    inView,
  }
}
"""

IN_VIEW = """
() => {
  const row = document.querySelector('aside [data-region="list"] .row.is-on')
  if (!row) return 'no open row in the page'

  const box = document.querySelector('aside [data-region="list"]')
  const one = row.getBoundingClientRect()
  const holds = box.getBoundingClientRect()

  return {
    row: row.textContent.trim(),
    inView: one.top >= holds.top - 1 && one.bottom <= holds.bottom + 1,
    rowTop: Math.round(one.top),
    rowBottom: Math.round(one.bottom),
    boxTop: Math.round(holds.top),
    boxBottom: Math.round(holds.bottom),
  }
}
"""

SLIDE = """
async (twist) => {
  const ul = document.querySelector('aside [data-region="list"] ul')
  const ws = window.ordenApp.workspace
  const seen = []

  ws.toggleFolder(twist)
  for (let frame = 0; frame < 14; frame++) {
    await new Promise((go) => requestAnimationFrame(go))
    seen.push(Math.round(ul.getBoundingClientRect().height))
  }

  return seen
}
"""

SCROLL_TO = '(at) => { document.querySelector(\'aside [data-region="list"]\').scrollTop = at }'

FIRST_FOLDER = """
() => window.ordenApp.workspace.tree.children.find((one) => one.is_dir).path
"""

ALL_OPEN = """
() => {
  const ws = window.ordenApp.workspace
  const open = (entry) => {
    for (const child of entry.children) {
      if (!child.is_dir) continue
      if (!ws.isExpanded(child.path)) ws.toggleFolder(child.path)
      open(child)
    }
  }

  open(ws.tree)
  return ws.visibleTree().length
}
"""

FAR_NOTE = """
() => {
  const ws = window.ordenApp.workspace
  const notes = ws.tree.children.filter((one) => !one.is_dir)
  return notes[Math.min(600, notes.length - 1)].path
}
"""

def ready(page: Page, origin: str) -> None:
    page.goto(origin, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.ordenApp", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp.workspace.activeSpace", timeout=60000)
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .row", timeout=60000)
    page.wait_for_timeout(2500)

def main() -> int:
    origin = DRIVE.origin
    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=first_paint.DESKTOP_AGENT,
        )
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"page error: {error}"))

        page.goto(f"{origin}{harness.SEED_PATH}", wait_until="domcontentloaded")
        page.evaluate(first_paint.SEED, NOTES)
        say(f"{NOTES} notes seeded")

        ready(page, origin)
        say(f"at rest:        {page.evaluate(COUNT)}")

        page.evaluate(SCROLL_TO, 20000)
        page.wait_for_timeout(400)
        say(f"20,000px down:  {page.evaluate(COUNT)}")

        page.evaluate(SCROLL_TO, 0)
        page.wait_for_timeout(300)
        page.locator(f"{LIST} .row").first.focus()
        page.wait_for_timeout(300)
        say(f"the first row:  {page.evaluate(FOCUS)}")

        page.keyboard.press("End")
        page.wait_for_timeout(500)
        say(f"End:            {page.evaluate(FOCUS)}")
        say(f"                {page.evaluate(COUNT)}")

        page.keyboard.press("Home")
        page.wait_for_timeout(500)
        say(f"Home:           {page.evaluate(FOCUS)}")

        for letter in "note-19":
            page.keyboard.press("Minus" if letter == "-" else letter)
        page.wait_for_timeout(600)
        say(f"spelled a name: {page.evaluate(FOCUS)}")

        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(400)
        say(f"two downs:      {page.evaluate(FOCUS)}")

        twist = page.evaluate(FIRST_FOLDER)
        say(f"a twist on:     {twist}")
        say(f"  opening:      {page.evaluate(SLIDE, twist)}")
        page.wait_for_timeout(400)
        say(f"  open:         {page.evaluate(COUNT)}")
        say(f"  shutting:     {page.evaluate(SLIDE, twist)}")
        page.wait_for_timeout(400)
        say(f"  shut:         {page.evaluate(COUNT)}")

        page.evaluate(
            """async () => {
                const ws = window.ordenApp.workspace
                await ws.openEntry(ws.notes[ws.notes.length - 1].path)
            }"""
        )
        page.wait_for_timeout(800)
        say(f"the last note:  {page.evaluate(COUNT)}")
        say(f"  in view:      {page.evaluate(IN_VIEW)}")

        far = page.evaluate(FAR_NOTE)
        page.evaluate("(path) => window.ordenApp.workspace.startRenaming(path)", far)
        page.wait_for_timeout(700)
        said = page.evaluate(f'() => !!document.querySelector({LIST!r} + " input")')
        say(f"renaming a row  600 down: field in the page = {said}")
        say(f"                {page.evaluate(COUNT)}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        page.evaluate(SCROLL_TO, 12345)
        page.wait_for_timeout(900)
        ready(page, origin)
        page.wait_for_timeout(1500)
        say(f"after a reload: {page.evaluate(COUNT)}")
        say(f"                panel = {page.evaluate('() => window.ordenApp.workspace.panel')}")

        say(f"every note open: {page.evaluate(ALL_OPEN)} rows in the list")
        page.wait_for_timeout(1200)
        say(f"                {page.evaluate(COUNT)}")
        page.evaluate(SCROLL_TO, 40000)
        page.wait_for_timeout(400)
        say(f"  40,000px down: {page.evaluate(COUNT)}")

    return DRIVE.verdict()

if __name__ == "__main__":
    raise SystemExit(main())
