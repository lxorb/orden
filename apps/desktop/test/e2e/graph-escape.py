from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

GRAPHS = "() => window.ordenApp.workspace.tabs.filter((one) => one.kind === 'graph').length"


def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1300, "height": 800})
    DRIVE.open(page)
    DRIVE.seed(page, "# Hub\n\n[[North]]", "# North\n\n[[Hub]]")
    page.evaluate("() => window.ordenApp.workspace.openGraph()")
    page.wait_for_selector("div.graph canvas", timeout=20000)
    page.evaluate("() => window.ordenApp.workspace.split('right')")
    wait_for(page, "window.ordenApp.workspace.panes.all?.length >= 2 || document.querySelectorAll('div.graph canvas').length >= 2", "a second pane")
    page.evaluate("() => window.ordenApp.workspace.openRelative('Hub.md')")
    wait_for(page, "window.ordenApp.workspace.active?.path?.endsWith('Hub.md')", "Hub open beside the graph")
    page.wait_for_timeout(600)
    shown = page.evaluate("() => document.querySelectorAll('div.graph canvas').length")
    say(f"graphs drawn {shown}, graph tabs {page.evaluate(GRAPHS)}")
    if shown != 1:
        wrong(f"the graph should be drawn in the other pane only, drawn {shown}")
        return

    page.evaluate("() => document.activeElement?.blur()")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    left = page.evaluate("() => document.querySelectorAll('div.graph canvas').length")
    say(f"after Escape in the other pane: graphs drawn {left}, graph tabs {page.evaluate(GRAPHS)}")
    if left != 1:
        wrong("Escape pressed in the note's pane closed the graph in the pane beside it")
        return

    page.locator("div.graph canvas").first.click(position={"x": 5, "y": 5})
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    gone = page.evaluate("() => document.querySelectorAll('div.graph canvas').length")
    say(f"after Escape in the graph's own pane: graphs drawn {gone}")
    if gone != 0:
        wrong("Escape in the graph's own pane no longer closes it")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
