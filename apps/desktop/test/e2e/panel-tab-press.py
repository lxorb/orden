from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SIDES = """() => ({
  left: window.nibApp.workspace.panel,
  right: window.nibApp.workspace.rightPanel,
  leftDrawn: !!document.querySelector('aside[data-sidebar]:not(.right) [role=tablist]'),
  rightDrawn: !!document.querySelector('aside.right [role=tablist]'),
})"""

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

    pressed(page, "left", "Files", "tree", "the folder pressed while it is in front")
    pressed(page, "left", "Files", "tree", "and again")

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

    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    wait_for(page, "() => window.nibApp.workspace.panel === null", "the left side shut by its own button")
    page.evaluate("() => window.nibApp.workspace.toggleSidebar('left')")
    wait_for(page, "() => window.nibApp.workspace.panel === 'tree'", "the left side open again")
    context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a panel tab pressed is that panel, and the side stays"))
