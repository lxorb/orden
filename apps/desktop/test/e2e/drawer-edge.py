"""What a shut drawer leaves at the left edge of the screen.

Emil photographed a phone whose title bar had something of the panel's own header
sitting in front of the sidebar button, partly cut off. This is the state that
produces it: a handheld wide enough that the drawer slides *over* the note rather
than becoming the whole screen, so the bar underneath stays put while the panel
travels across it.

It photographs the top left corner at each stage of the drawer going - open,
part-way, and shut - so what is under the bar at each of them can be looked at
rather than guessed.

Build first, as for shell.py, then from the repository root:

    python apps/desktop/test/e2e/drawer-edge.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from shell import ORIGIN, PHONE_AGENT, Pages, SEED, say

OUT = Path(__file__).resolve().parent / "shots" / "shell-drawer-edge"

# What is actually painted over the bar: every element the top left corner of the
# screen hits, from the front backwards, with the panel's own box beside it.
CORNER = """
() => {
  const at = document.elementsFromPoint(12, 28).map((one) => {
    const name = one.tagName.toLowerCase()
    const cls = typeof one.className === 'string' ? one.className : ''
    return cls ? `${name}.${cls.trim().split(/\\s+/).join('.')}` : name
  })
  const panels = document.querySelector('.panels')
  const box = panels ? panels.getBoundingClientRect() : null
  return {
    under: at.slice(0, 4),
    panels: box ? { left: Math.round(box.left), right: Math.round(box.right) } : null,
  }
}
"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    pages = Pages()
    pages.start()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            context = browser.new_context(
                viewport={"width": 844, "height": 390},
                user_agent=PHONE_AGENT,
                has_touch=True,
                is_mobile=True,
                device_scale_factor=2,
            )
            page = context.new_page()
            page.goto(ORIGIN, wait_until="domcontentloaded")
            page.wait_for_function("() => !!window.nibApp", timeout=20000)
            page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
            page.evaluate(SEED)
            page.wait_for_timeout(700)

            def corner(tag: str) -> None:
                page.screenshot(
                    path=str(OUT / f"{tag}.png"), clip={"x": 0, "y": 0, "width": 420, "height": 90}
                )
                say(f"{tag}: {page.evaluate(CORNER)}")

            page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
            page.wait_for_timeout(600)
            corner("01-open")

            page.evaluate("() => window.nibApp.workspace.closePanel()")
            page.wait_for_timeout(90)
            corner("02-going")

            page.wait_for_timeout(700)
            corner("03-shut")

            context.close()
            browser.close()
    finally:
        pages.stop()

    say(f"shots in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
