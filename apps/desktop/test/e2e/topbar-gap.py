from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SLIVER = 24

MEASURE = """
() => {
  const bar = document.querySelector('header[data-chrome="top"]')
  const shown = (one) => one && one.getClientRects().length > 0
  const strips = [...bar.querySelectorAll('[data-top-strip]')]
  const last = strips.at(-1)
  const group = [
    ...(last ? last.querySelectorAll(':scope > .strip > button') : []),
    bar.querySelector('.end > [data-side-toggle="right"]'),
    ...bar.querySelectorAll('.end > .controls > button'),
  ].filter(shown)
  const boxes = group.map((one) => {
    const box = one.getBoundingClientRect()
    return { what: one.getAttribute('aria-label') || one.className, left: box.left, right: box.right }
  })
  const first = boxes[0]?.left ?? bar.getBoundingClientRect().right
  const drags = [...(last ? last.querySelectorAll('.strip > [data-tauri-drag-region]') : [])]
    .map((one) => one.getBoundingClientRect())
    .filter((box) => box.right <= first + 0.5)
    .map((box) => box.width)
  const right = bar.querySelector('.end > [data-side-toggle="right"]')?.getBoundingClientRect()
  return { boxes, drag: Math.max(0, ...drags), right: right ? right.left : null }
}
"""

def row(page: Any, state: str) -> dict[str, Any]:
    DRIVE.settled(page)
    page.wait_for_timeout(400)
    seen: dict[str, Any] = page.evaluate(MEASURE)
    boxes = seen["boxes"]
    steps = [round(after["left"] - before["right"], 2) for before, after in zip(boxes, boxes[1:])]
    say(f"[{state}] {[one['what'] for one in boxes]} steps {steps}, drag {seen['drag']:.0f}px")
    if any(abs(step - steps[0]) > 0.5 for step in steps):
        wrong(f"[{state}] the buttons at the bar's end are not one step apart: {steps}")
    if seen["drag"] < SLIVER - 0.5:
        wrong(f"[{state}] nothing to drag the window by ahead of the buttons: {seen['drag']}px")
    shot(page, state, clip={"x": 0, "y": 0, "width": page.viewport_size["width"], "height": 44})
    return seen

def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 760})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n", "# Kestrel\n\nA bird.\n")
    DRIVE.open_note(page, "Plan")

    note = row(page, "01-note")

    page.evaluate("() => window.ordenApp.workspace.openWebsite()")
    wait_for(page, "window.ordenApp.workspace.active?.note?.kind === 'web'", "the web tab")
    web = row(page, "02-web-tab")
    if note["right"] is None or web["right"] is None:
        wrong(f"the right side's button is not in the bar: {note['right']}, {web['right']}")
    elif abs(note["right"] - web["right"]) > 0.5:
        wrong(f"the right side's button moves between a note and a web tab: {note['right']} -> {web['right']}")

    DRIVE.open_note(page, "Plan")
    page.evaluate("() => window.ordenApp.workspace.toggleSidebar('left')")
    row(page, "03-left-toggled")
    page.evaluate("() => window.ordenApp.workspace.toggleSidebar('right')")
    row(page, "04-right-toggled")
    page.evaluate("() => window.ordenApp.workspace.toggleSidebar('right')")

    page.set_viewport_size({"width": 640, "height": 760})
    row(page, "05-narrow")

    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          for (let i = 0; i < 14; i++) {
            const path = await ws.noteFrom(`# Tab ${i}\\n\\nWords.\\n`, ws.activeSpace.root)
            await ws.openEntry(path, { activate: true })
            ws.keep(ws.activeTabId)
          }
        }"""
    )
    DRIVE.open_note(page, "Plan")
    row(page, "06-narrow-many-tabs")

    page.set_viewport_size({"width": 1180, "height": 760})
    page.evaluate("() => window.ordenApp.workspace.split('row')")
    row(page, "07-split")

    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          ws.panes.fills = ws.panes.focusedId
        }"""
    )
    wait_for(page, "document.querySelector('header[data-chrome=\"top\"] .strip .link')", "the chain")
    row(page, "08-filled-twinned")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
