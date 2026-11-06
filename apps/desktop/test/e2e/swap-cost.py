from __future__ import annotations

import statistics

from harness import Drive
from shell import DESKTOP_AGENT, SEED

DRIVE = Drive(__file__)
say = DRIVE.say

TIMED = """
async (script) => {
  const started = performance.now()
  eval(script)
  await new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(go)))
  return performance.now() - started
}
"""

ROUNDS = 24

def press(page, script: str) -> float:
    return page.evaluate(TIMED, script)

def run(page, name: str, scripts: list[str]) -> None:
    times = []
    for round in range(ROUNDS):
        times.append(press(page, scripts[round % len(scripts)]))

    times.sort()
    worst = times[int(len(times) * 0.95) - 1]
    say(f"{name}: median {statistics.median(times):.1f}ms, 95th {worst:.1f}ms, worst {times[-1]:.1f}ms")

def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 1440, "height": 900}, user_agent=DESKTOP_AGENT
        )
        page = context.new_page()
        DRIVE.open(page)
        page.evaluate(SEED)
        page.wait_for_timeout(800)

        run(
            page,
            "panel tabs   ",
            [
                "window.nibApp.workspace.showPanel('tree')",
                "window.nibApp.workspace.showPanel('outline')",
                "window.nibApp.workspace.showPanel('links')",
                "window.nibApp.workspace.showPanel('tree')",
            ],
        )

        page.evaluate("() => window.nibApp.settings.show()")
        page.wait_for_selector(".nib-screen.sheet", timeout=15000)
        page.wait_for_timeout(500)
        run(
            page,
            "settings pane",
            [
                "window.nibApp.settings.section = 'editor'",
                "window.nibApp.settings.section = 'appearance'",
                "window.nibApp.settings.section = 'markdown'",
                "window.nibApp.settings.section = 'general'",
            ],
        )
        page.evaluate("() => (window.nibApp.settings.open = false)")
        page.wait_for_timeout(400)

        tabs = page.evaluate("() => window.nibApp.workspace.tabsIn(window.nibApp.workspace.panes.focusedId).map((one) => one.id)")
        say(f"tabs open: {len(tabs)}")
        switches = [f"window.nibApp.workspace.activate('{one}')" for one in tabs]
        run(page, "note tab     ", switches)

        page.click(".cm-content")
        page.keyboard.type("measuring while typing ")
        run(page, "note tab, typing", switches)

        keyed = []
        for round in range(ROUNDS):
            keyed.append(press(page, "0"))
            page.keyboard.type("x")
        keyed.sort()
        say(f"a keystroke  : median {statistics.median(keyed):.1f}ms, worst {keyed[-1]:.1f}ms")

        context.close()

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
