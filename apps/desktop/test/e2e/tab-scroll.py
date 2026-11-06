from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SEED = """
async (names) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  for (const name of names) {
    const path = await ws.noteFrom(`# ${name}\\n\\nWords.\\n`, root)
    await ws.openEntry(path, { activate: true })
    ws.keep(ws.activeTabId)
  }
  for (const one of ws.tabs.filter((tab) => !names.includes(tab.shown))) ws.close(one.id)
}
"""

LOOK = """
() => {
  const strip = document.querySelector('.tabs')
  const box = strip.getBoundingClientRect()
  const active = strip.querySelector('.tab.active')?.getBoundingClientRect()
  const plus = strip.querySelector('.new')?.getBoundingClientRect()
  return {
    at: strip.scrollLeft,
    most: strip.scrollWidth - strip.clientWidth,
    left: box.left,
    right: box.left + strip.clientWidth,
    active: active ? { left: active.left, right: active.right } : null,
    plus: plus ? { left: plus.left, right: plus.right } : null,
  }
}
"""

MANY = 80

WIDE = 4200

ACTIVATE = "(at) => { const ws = window.nibApp.workspace; ws.activate(ws.tabs.at(at).id) }"

def names(count: int, start: int = 0) -> list[str]:
    return [f"Note {at + 1:02d}" for at in range(start, start + count)]

def look(page: Page) -> dict:
    return page.evaluate(LOOK)

def settle(page: Page) -> None:
    page.wait_for_timeout(300)
    page.evaluate(
        """() => new Promise((done) => {
          const strip = document.querySelector('.tabs')
          let last = NaN, same = 0, frames = 0
          const look = () => {
            const at = strip.scrollLeft
            same = at === last ? same + 1 : 0
            last = at
            if (same >= 5 || ++frames > 300) done()
            else requestAnimationFrame(look)
          }
          requestAnimationFrame(look)
        })"""
    )
    page.wait_for_timeout(100)

def over_strip(page: Page) -> None:
    seen = look(page)
    box = page.locator(".tabs").bounding_box()
    page.mouse.move(seen["right"] - 4, box["y"] + box["height"] / 2)

def turns(page: Page, dx: float, dy: float, shift: bool = False, times: int = 6) -> None:
    if shift:
        page.keyboard.down("Shift")
    for _ in range(times):
        page.mouse.wheel(dx, dy)
        page.wait_for_timeout(30)
    if shift:
        page.keyboard.up("Shift")
    page.wait_for_timeout(250)

def still(page: Page, where: str) -> None:
    seen = look(page)
    if seen["most"] > 0:
        wrong(f"{where}: the strip has {seen['most']}px to scroll with every tab in view")
    if seen["at"] != 0:
        wrong(f"{where}: the strip is {seen['at']}px along with every tab in view")

def fitting(page: Page) -> None:
    page.evaluate(SEED, names(3))
    wait_for(page, "document.querySelectorAll('.tabs .tab').length === 3", "three tabs")
    settle(page)
    still(page, "three tabs")

    over_strip(page)
    for label, dx, dy, shift in (
        ("the wheel", 0, 300, False),
        ("Shift and the wheel", 0, 300, True),
        ("a sideways swipe", 300, 0, False),
    ):
        turns(page, dx, dy, shift)
        still(page, f"three tabs, {label}")

    page.evaluate("() => { document.querySelector('.tabs').scrollLeft = 2000 }")
    page.wait_for_timeout(100)
    still(page, "three tabs, asked by a script")

    page.evaluate(ACTIVATE, 0)
    settle(page)
    still(page, "three tabs, the first one opened")
    DRIVE.shot(page, "01-three-tabs")

def to_the_end(page: Page, where: str) -> dict:
    over_strip(page)
    turns(page, 0, 400, times=40)
    seen = look(page)
    if seen["at"] < seen["most"] - 1:
        wrong(f"{where}: the wheel stopped at {seen['at']} of {seen['most']}px")
    plus = seen["plus"]
    if plus is None:
        wrong(f"{where}: no plus")
        return seen
    past = seen["right"] - plus["right"]
    say(f"{where}: at the end, {past:.1f}px of strip after the plus")
    if past < 0 or past > 8:
        wrong(f"{where}: the strip ends {past:.1f}px after the plus")
    return seen

def overflowing(page: Page) -> None:
    page.set_viewport_size({"width": 900, "height": 700})
    page.evaluate(SEED, names(MANY))
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {MANY}", "the tabs")
    settle(page)
    seen = look(page)
    if seen["most"] <= 0:
        wrong(f"the tabs in 900px do not overflow (most {seen['most']})")
        return

    active = seen["active"]
    if not active or active["right"] > seen["right"] + 0.5 or active["left"] < seen["left"] - 0.5:
        wrong(f"the last tab opened is not in view: {seen}")

    over_strip(page)
    turns(page, 600, 0, times=10)
    seen = look(page)
    if seen["at"] > seen["most"] + 0.5:
        wrong(f"a sideways swipe went to {seen['at']} of {seen['most']}px")

    to_the_end(page, "eighty tabs")
    DRIVE.shot(page, "02-the-end")
    page.mouse.move(10, 400)

    page.evaluate(ACTIVATE, 0)
    settle(page)
    seen = look(page)
    if seen["at"] != 0:
        wrong(f"the first tab opened leaves the strip {seen['at']}px along")

    page.evaluate(ACTIVATE, 70)
    settle(page)
    seen = look(page)
    active = seen["active"]
    if not active:
        wrong("no open tab")
        return
    gap = seen["right"] - active["right"]
    say(f"the 71st tab opened from the start: {gap:.1f}px between it and the strip's end")
    if gap < 0 or gap > 20:
        wrong(f"the 71st tab opened from the start is {gap:.1f}px from the strip's end")
    DRIVE.shot(page, "03-revealed")

    page.evaluate(ACTIVATE, 1)
    settle(page)
    seen = look(page)
    active = seen["active"]
    gap = active["left"] - seen["left"] if active else -1
    say(f"the 2nd tab opened from there: {gap:.1f}px between the strip's start and it")
    if gap < 0 or gap > 20:
        wrong(f"the 2nd tab opened from there is {gap:.1f}px from the strip's start")

def closing(page: Page) -> None:
    page.set_viewport_size({"width": 900, "height": 700})
    page.evaluate(SEED, names(MANY))
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {MANY}", "the tabs")
    settle(page)
    to_the_end(page, "before closing")
    page.evaluate(
        "() => { const ws = window.nibApp.workspace; for (const tab of ws.tabs.slice(3)) ws.close(tab.id) }"
    )
    wait_for(page, "document.querySelectorAll('.tabs .tab').length === 3", "three tabs left")
    settle(page)
    still(page, "closed down to three")
    page.mouse.move(10, 400)

def widening(page: Page) -> None:
    page.set_viewport_size({"width": 700, "height": 700})
    page.evaluate(SEED, names(MANY))
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {MANY}", "the tabs")
    settle(page)
    if look(page)["most"] <= 0:
        wrong("eighty tabs in 700px do not overflow")
        return
    to_the_end(page, "eighty tabs in 700px")
    page.set_viewport_size({"width": WIDE, "height": 700})
    settle(page)
    still(page, f"eighty tabs in {WIDE}px")
    over_strip(page)
    turns(page, 0, 300)
    still(page, f"eighty tabs in {WIDE}px, the wheel")
    DRIVE.shot(page, "04-widened")

def drive(browser: Browser) -> None:
    for step in (fitting, overflowing, closing, widening):
        for icons in (True, False):
            page = DRIVE.page(browser, viewport={"width": 1600, "height": 800})
            page.context.add_init_script(
                f"localStorage.setItem('nib:icon-tabs', {'yes' if icons else 'no'!r})"
            )
            DRIVE.open(page)
            say(f"{step.__name__}, {'every tab but the open one its mark' if icons else 'as Chrome draws tabs'}")
            step(page)
            page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the strip scrolls only as far as its tabs"))
