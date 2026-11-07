from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LOOK = """() => [...document.querySelectorAll('[data-pane]')].map((pane) => {
  const box = pane.getBoundingClientRect()
  const style = getComputedStyle(pane)
  const radius = (name) => parseFloat(style[name])
  return {
    id: pane.dataset.pane,
    top: box.top,
    bottom: box.bottom,
    left: box.left,
    right: box.right,
    height: innerHeight,
    topStart: radius('borderTopLeftRadius'),
    topEnd: radius('borderTopRightRadius'),
    footStart: radius('borderBottomLeftRadius'),
    footEnd: radius('borderBottomRightRadius'),
  }
})"""

CARD = 10.0
INSET = 6.0

def panes(page: Page) -> dict[str, dict]:
    page.wait_for_timeout(500)
    return {one["id"]: one for one in page.evaluate(LOOK)}

def grounded(label: str, one: dict) -> None:
    say(f"[{label}] {one}")
    if one["footStart"] != 0 or one["footEnd"] != 0:
        wrong(f"[{label}] the foot is {one['footStart']}/{one['footEnd']}px round, not square")
    if abs(one["bottom"] - one["height"]) > 0.5:
        wrong(f"[{label}] the card ends at {one['bottom']}, not at the window's bottom {one['height']}")

def rounded(label: str, one: dict, inset: bool) -> None:
    say(f"[{label}] {one}")
    if one["footStart"] != CARD or one["footEnd"] != CARD:
        wrong(f"[{label}] the foot is {one['footStart']}/{one['footEnd']}px, not the card's {CARD}px")
    if inset and abs(one["height"] - one["bottom"] - INSET) > 0.5:
        wrong(f"[{label}] the card ends {one['height'] - one['bottom']}px above the bottom, not {INSET}px")

def same_top_and_sides(label: str, before: dict, after: dict) -> None:
    for side in ("top", "left", "right", "topStart", "topEnd"):
        if abs(before[side] - after[side]) > 0.5:
            wrong(f"[{label}] the {side} moved from {before[side]} to {after[side]}")

def opened(browser: Browser, on: bool) -> Page:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 760})
    if on:
        page.add_init_script("localStorage.setItem('orden:modes', JSON.stringify({ flushBottom: true }))")
    DRIVE.open(page)
    DRIVE.seed(page, "# Alpha\n\nWords.\n")
    DRIVE.open_note(page, "Alpha")
    return page

def split(page: Page, along: str, count: int) -> None:
    page.evaluate(f"() => window.nibApp.workspace.split('{along}')")
    wait_for(page, f"document.querySelectorAll('[data-pane]').length === {count}", f"the {along} split")

def ids(page: Page) -> list[str]:
    return page.evaluate("() => window.nibApp.workspace.panes.all.map((one) => one.id)")

def toggle(page: Page, want: bool) -> None:
    page.evaluate("() => window.nibApp.modes.toggleFlushBottom()")
    wait_for(page, f"window.nibApp.modes.flushBottom === {'true' if want else 'false'}", "the setting")

def drive(browser: Browser) -> None:
    page = opened(browser, on=False)
    (only,) = panes(page).values()
    rounded("off, one pane", only, inset=True)
    DRIVE.shot(page, "off-one")
    page.close()

    page = opened(browser, on=True)
    (one,) = panes(page).values()
    grounded("on, one pane", one)
    same_top_and_sides("on, one pane", only, one)
    DRIVE.shot(page, "on-one")

    toggle(page, False)
    rounded("turned off, one pane", panes(page)[one["id"]], inset=True)
    toggle(page, True)
    grounded("turned on again, one pane", panes(page)[one["id"]])

    page.evaluate("() => { window.nibApp.workspace.showPanel('tree'); window.nibApp.workspace.showPanel('outline') }")
    wait_for(page, "document.querySelectorAll('aside').length > 0", "the sidebars docked")
    docked = panes(page)[one["id"]]
    grounded("on, sidebars docked", docked)
    if docked["left"] <= one["left"] and docked["right"] >= one["right"]:
        wrong(f"[on, sidebars docked] no sidebar beside the pane: {docked}")
    DRIVE.shot(page, "on-one-sidebars-docked")

    page.evaluate("() => { window.nibApp.workspace.closePanel('left'); window.nibApp.workspace.closePanel('right') }")
    wait_for(page, "window.nibApp.workspace.panel === null", "the sidebar hidden")
    grounded("on, sidebar hidden", panes(page)[one["id"]])
    DRIVE.shot(page, "on-one-sidebar-hidden")

    for theme in ("glass", "wallpaper"):
        page.evaluate(f"() => window.nibApp.theme.select('{theme}')")
        wait_for(page, f"window.nibApp.theme.id === '{theme}'", f"the {theme} theme")
        grounded(f"on, {theme}", panes(page)[one["id"]])
        DRIVE.shot(page, f"on-one-{theme}")
    page.evaluate("() => window.nibApp.theme.select('default')")

    page.evaluate("() => window.nibApp.fullscreen.enter(window.nibApp.workspace.panes)")
    wait_for(page, "window.nibApp.fullscreen.on", "full screen")
    full = panes(page)[one["id"]]
    say(f"[on, full screen] {full}")
    if full["footStart"] != 0 or full["bottom"] > full["height"] + 0.5:
        wrong(f"[on, full screen] the card is {full}")
    page.evaluate("() => window.nibApp.fullscreen.leave()")
    wait_for(page, "!window.nibApp.fullscreen.on", "full screen left")
    page.close()

    page = opened(browser, on=True)
    split(page, "column", 2)
    upper, lower = ids(page)
    seen = panes(page)
    rounded("on, column, the upper pane", seen[upper], inset=False)
    grounded("on, column, the lower pane", seen[lower])
    DRIVE.shot(page, "on-column")
    toggle(page, False)
    seen = panes(page)
    rounded("off, column, the upper pane", seen[upper], inset=False)
    rounded("off, column, the lower pane", seen[lower], inset=True)
    DRIVE.shot(page, "off-column")
    page.close()

    page = opened(browser, on=True)
    split(page, "row", 2)
    left, right = ids(page)
    seen = panes(page)
    grounded("on, row, the left pane", seen[left])
    grounded("on, row, the right pane", seen[right])
    DRIVE.shot(page, "on-row")

    page.evaluate(f"() => window.nibApp.workspace.focusPane('{right}')")
    split(page, "column", 3)
    under = next(one for one in ids(page) if one not in (left, right))
    seen = panes(page)
    grounded("on, row then column, the left pane", seen[left])
    rounded("on, row then column, the right upper pane", seen[right], inset=False)
    grounded("on, row then column, the right lower pane", seen[under])
    DRIVE.shot(page, "on-row-column")
    toggle(page, False)
    seen = panes(page)
    for name, pane in (("left", left), ("right upper", right)):
        rounded(f"off, row then column, the {name} pane", seen[pane], inset=name == "left")
    rounded("off, row then column, the right lower pane", seen[under], inset=True)
    DRIVE.shot(page, "off-row-column")
    page.close()

    page = opened(browser, on=False)
    split(page, "row", 2)
    DRIVE.shot(page, "off-row")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the panes on the window's bottom run into it, square"))
