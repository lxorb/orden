from __future__ import annotations

from harness import Drive
from shell import PHONE_AGENT, SEED

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

SCREENS = [("portrait", 390, 844), ("landscape", 844, 390)]

SHADOWS = """
() => [...document.querySelectorAll('.panels[data-chrome]')].map((one) => ({
  side: one.classList.contains('right') ? 'right' : 'left',
  open: one.classList.contains('open'),
  shadow: getComputedStyle(one).boxShadow,
}))
"""

def look(page, screen: str, moment: str, wanted_open: set[str]) -> None:
    for one in page.evaluate(SHADOWS):
        casts = one["shadow"] != "none"
        say(f"[{screen}] {moment}: {one['side']} {'open' if one['open'] else 'shut'}, shadow {one['shadow'][:40]}")
        if not one["open"] and casts:
            wrong(f"[{screen}] {moment}: the shut {one['side']} drawer casts its shadow onto the screen")
        if one["side"] in wanted_open and not one["open"]:
            wrong(f"[{screen}] {moment}: the {one['side']} drawer did not open")

def main() -> int:
    with DRIVE.session() as browser:
        for screen, width, height in SCREENS:
            context = browser.new_context(
                viewport={"width": width, "height": height},
                user_agent=PHONE_AGENT,
                has_touch=True,
                is_mobile=True,
            )
            page = context.new_page()
            DRIVE.open(page)
            page.evaluate(SEED)
            page.wait_for_timeout(900)
            if not page.evaluate("() => !!document.querySelector('.panels.right')"):
                page.evaluate("() => window.ordenApp.workspace.showPanel('outline', 'right')")
                page.wait_for_timeout(600)
                page.evaluate("() => window.ordenApp.workspace.closePanel()")
                page.wait_for_timeout(900)
            look(page, screen, "at rest", set())
            shot(page, f"{screen}-rest")

            page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
            page.wait_for_timeout(700)
            look(page, screen, "left opened", {"left"})

            page.evaluate("() => window.ordenApp.workspace.closePanel()")
            page.wait_for_timeout(900)
            look(page, screen, "left shut again", set())
            context.close()

    return DRIVE.verdict("a shut drawer casts no shadow onto the screen")

if __name__ == "__main__":
    raise SystemExit(main())
