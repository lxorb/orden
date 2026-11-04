"""A web tab's page fits its pane's card exactly, under a bar with no empty line (#1118).

A web tab beside a note in a narrow pane: the page stood under an empty dark band below
the address, because the bar had wrapped its last glyph, the dots, alone onto a second
line. And the page is a webview of its own, placed over the room the tab leaves under its
bar (`.hole` in web-tab/WebTab.svelte, measured and handed to the crate as it is): that
room is the one rectangle the page is put in, so it has to be the card's content box and
nothing else. What this measures, in the built web app, where the same room holds the
page's card instead of the hole:

  * **The room is the card under the bar**: its left, right and bottom are the pane's
    own, and its top is the bar's bottom - no gap, nothing over the card's edge - in one
    pane, beside the right side, in two and three panes, filling the window, with the
    words larger, and at every width of a sweep that crosses the bar's wrapping.
  * **The bar never holds a line of glyphs alone beside a field on another**: on one
    line, or the glyphs on the first and the field alone across the whole of the second.

Run it from the repository root:

    python apps/desktop/test/e2e/web-pane-fit.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go beside this file under
`shots/web-pane-fit/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

# A note and a web tab, the web tab in front, nothing else open.
ARRANGE = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Beside\\n\\nA note beside a page.\\n', root)
  await ws.loadTree()
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  const note = ws.notes.find((one) => one.name.startsWith('Beside'))
  await ws.openEntry(note.path, { activate: true })
  ws.openPage('https://example.com/')
}
"""

# Every web tab on screen: its pane, its bar and the room under the bar, and the bar's
# items line by line.
LOOK = """
() => {
  const box = (one) => {
    const r = one.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
  return [...document.querySelectorAll('[data-pane]')]
    .filter((pane) => pane.getClientRects().length && pane.querySelector('.web'))
    .map((pane) => {
      const web = pane.querySelector('.web')
      const head = web.querySelector(':scope > .head')
      const bar = head.querySelector('.webbar')
      const room = [...web.children].filter((one) => one !== head && one.getClientRects().length).at(-1)
      const style = getComputedStyle(bar)
      const inner = box(bar)
      inner.left += parseFloat(style.paddingLeft)
      inner.right -= parseFloat(style.paddingRight)
      const items = [...bar.children]
        .filter((one) => one.getClientRects().length)
        .map((one) => ({ field: one.classList.contains('field'), ...box(one) }))
      return { pane: box(pane), head: box(head), room: room ? box(room) : null, bar: inner, items }
    })
}
"""


def lines_of(items: list[dict]) -> list[list[dict]]:
    """The bar's items by the line they are on, top to bottom."""
    lines: list[list[dict]] = []
    for one in sorted(items, key=lambda item: (item["top"], item["left"])):
        middle = (one["top"] + one["bottom"]) / 2
        if lines and lines[-1][0]["top"] <= middle <= lines[-1][0]["bottom"]:
            lines[-1].append(one)
        else:
            lines.append([one])
    return lines


def checked(page: Page, label: str) -> None:
    tabs = page.evaluate(LOOK)
    if not tabs:
        wrong(f"[{label}] no web tab on screen")
        return
    for index, tab in enumerate(tabs):
        where = f"[{label} #{index}]"
        pane, head, room, bar = tab["pane"], tab["head"], tab["room"], tab["bar"]
        if room is None:
            wrong(f"{where} nothing under the bar")
            continue
        off = {
            "left": room["left"] - pane["left"],
            "right": room["right"] - pane["right"],
            "bottom": room["bottom"] - pane["bottom"],
            "top": room["top"] - head["bottom"],
        }
        if any(abs(value) > 0.5 for value in off.values()):
            wrong(f"{where} the page's room is not the card under the bar: {json.dumps(off)}")

        lines = lines_of(tab["items"])
        fields = [number for number, line in enumerate(lines) if any(one["field"] for one in line)]
        if len(fields) != 1:
            wrong(f"{where} the field is on {len(fields)} lines")
            continue
        if len(lines) == 1:
            continue
        line = lines[fields[0]]
        alone = len(line) == 1 and line[0]["right"] - line[0]["left"] >= bar["right"] - bar["left"] - 0.5
        glyphs = [one for number, one in enumerate(lines) if number != fields[0]]
        if not alone or fields[0] != len(lines) - 1 or len(glyphs) != 1:
            shape = [["field" if one["field"] else "glyph" for one in line] for line in lines]
            wrong(f"{where} the bar wrapped into {shape}, not the glyphs over the field alone")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    page.evaluate(ARRANGE)
    wait_for(page, "document.querySelector('.web .webbar')", "the web tab's bar")
    quiet(page)

    checked(page, "one pane")
    DRIVE.steady(page, "01-one-pane")

    page.evaluate("() => window.nibApp.workspace.showRight('outline')")
    wait_for(page, "!!document.querySelector('.panels.right.open')", "the right side")
    quiet(page)
    checked(page, "beside the right side")

    # Narrower, a pixel at a time across where the bar wraps: the issue's narrow pane.
    for width in range(760, 459, -1):
        page.set_viewport_size({"width": width, "height": 820})
        page.wait_for_timeout(30)
        checked(page, f"right side, {width} wide")
    quiet(page)
    DRIVE.steady(page, "02-narrow-beside-the-right-side")
    page.set_viewport_size({"width": 1180, "height": 820})

    page.evaluate("() => window.nibApp.workspace.closePanel('right')")
    quiet(page)
    checked(page, "right side shut")

    page.evaluate("() => window.nibApp.workspace.split('row')")
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 2", "two panes")
    quiet(page)
    checked(page, "two panes")
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.openPage('https://example.org/')
          ws.split('column')
        }"""
    )
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 3", "three panes")
    quiet(page)
    checked(page, "three panes")
    DRIVE.steady(page, "03-three-panes")
    for width in (900, 760, 640):
        page.set_viewport_size({"width": width, "height": 820})
        quiet(page)
        checked(page, f"three panes, {width} wide")
    DRIVE.steady(page, "04-three-narrow-panes")
    page.set_viewport_size({"width": 1180, "height": 820})

    page.evaluate("() => window.nibApp.modes.setZoom(1.4)")
    quiet(page)
    checked(page, "the words larger")
    page.evaluate("() => window.nibApp.modes.setZoom(1)")

    page.locator("[data-pane] .web .webbar .field input").first.click()
    page.keyboard.press("Shift+F11")
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 1", "the window filled")
    quiet(page)
    checked(page, "filling the window")
    DRIVE.steady(page, "05-filling-the-window")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
