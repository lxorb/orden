from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LOOK = """() => [...document.querySelectorAll('.tabs')].map((strip) => {
  const id = strip.dataset.strip
  const pane = document.querySelector(`[data-pane="${id}"]`)
  const tab = strip.querySelector('.tab.active')
  const fill = tab?.querySelector('.fill')
  const rtl = document.documentElement.dir === 'rtl'
  const foot = (side) => (fill ? getComputedStyle(fill, side).display !== 'none' : false)
  const box = (one) => one?.getBoundingClientRect()
  const style = pane ? getComputedStyle(pane) : null
  return {
    id,
    first: tab === strip.querySelector('.tab'),
    start: rtl ? box(pane)?.right : box(pane)?.left,
    fill: fill ? (rtl ? box(fill).right : box(fill).left) : null,
    ahead: foot(rtl ? '::after' : '::before'),
    behind: foot(rtl ? '::before' : '::after'),
    corner: style ? parseFloat(rtl ? style.borderTopRightRadius : style.borderTopLeftRadius) : null,
  }
})"""

def strips(page: Page) -> dict[str, dict]:
    page.wait_for_timeout(600)
    return {one["id"]: one for one in page.evaluate(LOOK)}

def pane_ids(page: Page) -> list[str]:
    return page.evaluate("() => window.nibApp.workspace.panes.all.map((one) => one.id)")

def flush(label: str, one: dict, squared: bool) -> None:
    say(f"[{label}] {one}")
    if one["fill"] is None or abs(one["fill"] - one["start"]) > 0.5:
        wrong(f"[{label}] the first tab's side is at {one['fill']}, not the pane's edge {one['start']}")
    if one["ahead"]:
        wrong(f"[{label}] the first tab still flares out ahead of itself")
    if not one["behind"]:
        wrong(f"[{label}] the first tab lost its foot behind it")
    if squared and one["corner"] != 0:
        wrong(f"[{label}] the pane's corner under the tab is {one['corner']}px round, not square")

def flared(label: str, one: dict, corner: float | None = None) -> None:
    say(f"[{label}] {one}")
    if not (one["ahead"] and one["behind"]):
        wrong(f"[{label}] the tab in front does not flare out on both sides")
    if one["fill"] is not None and abs(one["fill"] - one["start"]) < 1:
        wrong(f"[{label}] the tab in front stands at the pane's edge though something is ahead of it")
    if corner is not None and one["corner"] != corner:
        wrong(f"[{label}] the pane's corner is {one['corner']}px, not its card's {corner}px")

def opened(browser: Browser, *scripts: str) -> Page:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 700})
    for script in ("localStorage.setItem('orden:icon-tabs', 'no')", *scripts):
        page.add_init_script(script)
    DRIVE.open(page)
    DRIVE.seed(page, "# Alpha\n\nWords.\n")
    DRIVE.open_note(page, "Alpha")
    return page

def split(page: Page, along: str) -> list[str]:
    page.evaluate(f"() => window.nibApp.workspace.split('{along}')")
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 2", "the split")
    return pane_ids(page)

def drive(browser: Browser) -> None:
    for mode, scripts in (("fit", ()), ("uniform", ("localStorage.setItem('orden:fit-tabs', 'no')",))):
        page = opened(browser, *scripts)
        page.evaluate(
            """() => {
              const ws = window.nibApp.workspace
              const pane = ws.panes.focused
              ws.activate(ws.tabsIn(pane.id)[0].id)
            }"""
        )
        only = strips(page)
        card = next(iter(only.values()))["corner"]
        for one in only.values():
            flared(f"{mode}, one pane, the search ahead", one, card)

        left, right = split(page, "row")
        seen = strips(page)
        flared(f"{mode}, row, the bar's first strip", seen[left], card)
        flush(f"{mode}, row, the second strip", seen[right], squared=True)
        DRIVE.shot(page, f"{mode}-row")

        page.evaluate(f"() => window.nibApp.workspace.newTab('{right}')")
        wait_for(
            page,
            f"window.nibApp.workspace.tabsIn('{right}').length === 2"
            f" && window.nibApp.workspace.panes.at('{right}').activeTabId"
            f" === window.nibApp.workspace.tabsIn('{right}')[1].id",
            "a second tab in front in the second pane",
        )
        flared(f"{mode}, row, the second tab in front", strips(page)[right], card)
        page.close()

        page = opened(browser, *scripts)
        _upper, lower = split(page, "column")
        flush(f"{mode}, column, the lower pane's own strip", strips(page)[lower], squared=False)
        DRIVE.shot(page, f"{mode}-column")
        page.close()

    page = opened(browser, "localStorage.setItem('orden:language', 'ar')")
    wait_for(page, "document.documentElement.dir === 'rtl'", "the words running from the right")
    _first, second = split(page, "row")
    flush("right to left, row, the second strip", strips(page)[second], squared=True)
    DRIVE.shot(page, "rtl-row")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the first tab with nothing ahead of it stands at its pane's edge"))
