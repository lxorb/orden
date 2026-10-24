"""A panel tab pressed is that panel, and never the side it is in gone (#770).

A Linux reader on Hyprland: "When I click folder icon, it hides the bar." The panel tabs
sit in the side they switch, and the one in front, pressed again, shut the side - the
whole bar gone from under the pointer, on a press that meant "this one". A tab selects,
as every tab does; the side is shut by its own button.

What it presses, on both sides, with the mouse:

    the tab in front - the file list's folder - and the side stays, on the same panel
    another tab, and the side shows that one; then that one again, and it stays
    the sidebar's own button, which still shuts the side, and opens it again

Run it from the repository root:

    python apps/desktop/test/e2e/panel-tab-press.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

# Which panel each side shows, and whether each side is drawn at all.
SIDES = """() => ({
  left: window.nibApp.workspace.panel,
  right: window.nibApp.workspace.rightPanel,
  leftDrawn: !!document.querySelector('aside[data-sidebar]:not(.right) [role=tablist]'),
  rightDrawn: !!document.querySelector('aside.right [role=tablist]'),
})"""


#: Each side's own element: the left one is the sidebar with no side named.
ASIDE = {"left": "aside[data-sidebar]:not(.right)", "right": "aside.right"}


def tab(page: Page, side: str, label: str):
    return page.locator(f"{ASIDE[side]} [role=tablist] [role=tab][aria-label='{label}']")


def pressed(page: Page, side: str, label: str, wanted: str | None, what: str) -> None:
    tab(page, side, label).click()
    page.wait_for_timeout(300)
    seen = page.evaluate(SIDES)
    say(f"[{side}] {what}: {seen}")
    if seen[side] != wanted or not seen[f"{side}Drawn"]:
        wrong(f"[{side}] {what}: the side shows {seen[side]!r}, drawn {seen[f'{side}Drawn']}, not {wanted!r}")


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1400, "height": 800})
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => { const ws = window.nibApp.workspace; ws.showPanel('tree') }")
    wait_for(page, "() => window.nibApp.workspace.panel === 'tree'", "the file list")
    wait_for(page, "() => !!document.querySelector('aside[data-sidebar]:not(.right) [role=tablist]')", "the left side's tabs")

    # The left side: the folder, which is the tab in front, pressed.
    pressed(page, "left", "Files", "tree", "the folder pressed while it is in front")
    pressed(page, "left", "Files", "tree", "and again")

    # The right side, opened on whichever panel it shows first: its tab in front, pressed.
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('right')")
    wait_for(page, "() => window.nibApp.workspace.rightPanel !== null", "the right side")
    page.wait_for_timeout(300)
    right = page.evaluate("() => window.nibApp.workspace.rightPanel")
    if right:
        label = page.evaluate(
            "() => document.querySelector('aside.right [role=tab][aria-selected=true]')?.getAttribute('aria-label')"
        )
        if not label:
            wrong("the right side shows no tab in front")
        else:
            pressed(page, "right", label, right, "its tab in front pressed")
    DRIVE.shot(page, "01-after-presses")

    # Another tab of the left side, and then that one again.
    labels = page.locator("aside[data-sidebar]:not(.right) [role=tablist] [role=tab]:not(.behind)").evaluate_all(
        "(tabs) => tabs.map((one) => one.getAttribute('aria-label'))"
    )
    other = next((one for one in labels if one != "Files"), None)
    if other:
        tab(page, "left", other).click()
        page.wait_for_timeout(300)
        shows = page.evaluate(SIDES)["left"]
        pressed(page, "left", other, shows, f"{other} pressed while it is in front")
        tab(page, "left", "Files").click()
        page.wait_for_timeout(300)

    # The side's own button still shuts it, and opens it again.
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    wait_for(page, "() => window.nibApp.workspace.panel === null", "the left side shut by its own button")
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    wait_for(page, "() => window.nibApp.workspace.panel === 'tree'", "the left side open again")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a panel tab pressed is that panel, and the side stays"))
