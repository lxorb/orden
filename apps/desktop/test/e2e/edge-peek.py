"""The file list brought out by the pointer at the window's edge (#1034), driven in the
built app and timed a frame at a time.

What it presses and measures, with the left sidebar shut and two notes open:

  * **At once.** The pointer reaching the edge: how long from that move to the first
    frame the list has moved on, and how long until it is all the way in. Then the
    pointer leaving it: how long until it starts back, and until it is gone.
  * **Nothing under it moves.** The pane's box on every frame of both slides.
  * **A card.** Out, the list stands in from the window's edges with rounded corners
    and a shadow, over the note.

Run it from the repository root:

    python apps/desktop/test/e2e/edge-peek.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go beside this file under
`shots/edge-peek/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import HIDE_CARET, quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SIZE = {"width": 1280, "height": 800}

ARRANGE = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nWhat we are doing, and why it matters.\\n', root)
  await ws.noteFrom('# Other\\n\\nA note beside it.\\n', root)
  await ws.loadTree()
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  const note = ws.notes.find((one) => one.name.startsWith('Plan'))
  await ws.openEntry(note.path, { activate: true })
  ws.showPanel('tree')
  ws.showPanel('tree')
  ws.panel = null
}
"""

# Watches every frame from now on: how far the list reaches into the window - nothing
# while it is hidden - and where the pane's box is, with the moment the pointer moved
# that the drive asks about.
WATCH = """
() => {
  const frames = []
  window.__peek = { frames, moved: null }
  addEventListener('pointermove', (event) => { window.__peek.moved = event.timeStamp }, true)
  const tick = (now) => {
    const aside = document.querySelector('.panels aside')
    const pane = document.querySelector('[data-pane]')
    const a = aside?.getBoundingClientRect()
    const p = pane?.getBoundingClientRect()
    const floating = aside?.parentElement?.classList.contains('floating')
    const seen = a && floating ? Math.max(0, Math.round(a.right)) : 0
    frames.push({ at: now, left: seen,
      pane: p ? [p.x, p.y, p.width, p.height] : null })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
"""

# The list out: its box, its corner and its shadow, and the pane's box.
SHAPE = """
() => {
  const aside = document.querySelector('.panels aside')
  const r = aside.getBoundingClientRect()
  const style = getComputedStyle(aside)
  return {
    box: [r.x, r.y, r.width, r.height].map(Math.round),
    window: [innerWidth, innerHeight],
    radius: style.borderTopLeftRadius,
    shadow: style.boxShadow,
    over: document.elementFromPoint(r.x + 20, r.y + r.height / 2)?.closest('aside') === aside,
  }
}
"""


def timed(page: Page, x: int, settled: str, what: str) -> dict:
    """The pointer to `x`, then frames until the list has stopped where `settled` says."""
    page.evaluate("() => { window.__peek.frames.length = 0; window.__peek.moved = null }")
    page.wait_for_timeout(100)
    page.mouse.move(x, 400)
    wait_for(page, settled, what)
    page.wait_for_timeout(150)
    frames, moved = page.evaluate("() => [window.__peek.frames.slice(), window.__peek.moved]")
    if moved is None:
        wrong(f"{what}: no pointer move heard")
        return {}
    start = [one for one in frames if one["at"] <= moved][-1]["left"]
    after = [one for one in frames if one["at"] > moved]
    end = after[-1]["left"]
    first = next((i for i, one in enumerate(after) if one["left"] != start), None)
    reached = next((i for i, one in enumerate(after) if i >= first and one["left"] == end), None) if first is not None else None
    panes = {json.dumps(one["pane"]) for one in frames}
    result = {
        "first_moved_ms": round(after[first]["at"] - moved, 1) if first is not None else None,
        "slide_ms": round(after[reached]["at"] - after[first]["at"], 1) if reached is not None else None,
        "frames": [one["left"] for one in after[first : reached + 1]] if reached is not None else [],
        "from": start,
        "to": end,
        "pane_boxes": len(panes),
    }
    say(f"{what}: {json.dumps(result)}")
    if len(panes) != 1:
        wrong(f"{what}: the pane moved under it: {sorted(panes)}")
    return result


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport=SIZE, color_scheme="light")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.evaluate(ARRANGE)
    wait_for(page, "window.nibApp.workspace.panel === null", "the list shut")
    page.mouse.move(640, 400)
    quiet(page)
    page.evaluate(WATCH)

    runs = []
    for turn in range(3):
        shown = timed(
            page,
            0,
            "(() => { const a = document.querySelector('.panels aside'); const r = a.getBoundingClientRect();"
            " return r.right > 100 && getComputedStyle(a).transform === 'none' })()",
            f"in #{turn + 1}",
        )
        if turn == 0:
            quiet(page)
            shape = page.evaluate(SHAPE)
            say(f"out: {json.dumps(shape)}")
            if shape["box"][0] <= 0 or shape["box"][1] <= 0:
                wrong(f"the list is flush with the window's edge: {shape['box']}")
            if shape["box"][1] + shape["box"][3] >= shape["window"][1]:
                wrong(f"the list reaches the window's bottom: {shape['box']}")
            if shape["radius"] in ("0px", ""):
                wrong("the list has square corners")
            if shape["shadow"] == "none":
                wrong("the list has no shadow")
            if not shape["over"]:
                wrong("the list is not on top")
            DRIVE.shot(page, "01-out")
        hidden = timed(
            page,
            900,
            "(() => { const c = document.querySelector('.panels .column'); return !c.classList.contains('floating') })()",
            f"out #{turn + 1}",
        )
        runs.append({"in": shown, "out": hidden})
    say(f"runs: {json.dumps(runs)}")
    for run in runs:
        first = run["in"].get("first_moved_ms")
        if first is None or first > 34:
            wrong(f"the list took {first} ms, more than two frames, to start moving after the edge")
    DRIVE.shot(page, "02-gone")

    page.emulate_media(color_scheme="dark")
    page.mouse.move(0, 400)
    wait_for(page, "getComputedStyle(document.querySelector('.panels aside')).transform === 'none'", "in, dark")
    quiet(page)
    DRIVE.shot(page, "03-out-dark")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
