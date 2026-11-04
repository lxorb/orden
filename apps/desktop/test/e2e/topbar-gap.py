"""The buttons at the right end of the top bar, one step apart.

Emil, issue #1060: *"I don't understand this gap."* With a note in front the bar ended
in the note's `⋯`, the scratchpad's switch and the right side's switch, and between the
`⋯` and the scratchpad there was a stretch as wide as another button. It was the strip of
window the bar is dragged by, put after the strip of tabs and so after the strip's own
buttons too: room with nothing in it, in the middle of a row of buttons.

What this measures, in every state the row has:

  - the buttons from the strip's last one to the window's own are one group, every one
    against the next with the same step, nothing between them;
  - the right side's button - the scratchpad's switch until it became one of the right
    side's tabs (#1032) - is in the same place whether the note's `⋯` is there or not,
    so nothing jumps as a web tab and a note change places;
  - there is always a stretch to drag the window by, at least the sliver wide, ahead of
    that group, however many tabs there are.

Run it from the repository root:

    python apps/desktop/test/e2e/topbar-gap.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/topbar-gap/`.
"""

from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

#: The sliver's width, `--space-5`: what the window can always be dragged by.
SLIVER = 24

#: The row's end, as the page draws it: each button of the group, and the widest stretch
#: to drag the window by ahead of it.
MEASURE = """
() => {
  const bar = document.querySelector('header[data-chrome="top"]')
  const shown = (one) => one && one.getClientRects().length > 0
  const group = [
    ...bar.querySelectorAll(':scope > .strip > button'),
    bar.querySelector(':scope > [data-side-toggle="right"]'),
    ...bar.querySelectorAll(':scope > .controls > button'),
  ].filter(shown)
  const boxes = group.map((one) => {
    const box = one.getBoundingClientRect()
    return { what: one.getAttribute('aria-label') || one.className, left: box.left, right: box.right }
  })
  const first = boxes[0]?.left ?? bar.getBoundingClientRect().right
  const drags = [...bar.querySelectorAll('[data-tauri-drag-region]:not([data-region="tabs"])')]
    .map((one) => one.getBoundingClientRect())
    .filter((box) => box.right <= first + 0.5)
    .map((box) => box.width)
  const right = bar.querySelector(':scope > [data-side-toggle="right"]')?.getBoundingClientRect()
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

    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    wait_for(page, "window.nibApp.workspace.active?.note?.kind === 'web'", "the web tab")
    web = row(page, "02-web-tab")
    if note["right"] is None or web["right"] is None:
        wrong(f"the right side's button is not in the bar: {note['right']}, {web['right']}")
    elif abs(note["right"] - web["right"]) > 0.5:
        wrong(f"the right side's button moves between a note and a web tab: {note['right']} -> {web['right']}")

    DRIVE.open_note(page, "Plan")
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    row(page, "03-left-toggled")
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('right')")
    row(page, "04-right-toggled")
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('right')")

    page.set_viewport_size({"width": 640, "height": 760})
    row(page, "05-narrow")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
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
    page.evaluate("() => window.nibApp.workspace.split('right')")
    row(page, "07-split")

    # The same note in both panes, and one of them filling the window: the strip is up
    # here again, with the chain that links the two panes' scrolling ahead of the `⋯`.
    # The bar itself is out of sight until the pointer reaches the top, so it is
    # measured and not looked at.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.panes.fills = ws.panes.focusedId
        }"""
    )
    wait_for(page, "document.querySelector('header[data-chrome=\"top\"] .strip .link')", "the chain")
    row(page, "08-filled-twinned")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
