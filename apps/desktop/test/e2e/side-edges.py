from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WS = "window.ordenApp.workspace"

TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

OTHERS_SEEN = "localStorage.setItem('orden:hints', JSON.stringify(['drawer', 'graph', 'palette']))"

INSIDE = "localStorage.setItem('orden:side-toggles-inside', 'yes')"

END_GAP = """
() => {
  const bar = document.querySelector('header[data-chrome="top"]')
  const last = [...bar.querySelectorAll(':scope > .end > *')].filter((one) => one.getClientRects().length).at(-1)
  const lead = parseFloat(getComputedStyle(bar).paddingInlineStart)
  return { lead, end: last ? bar.getBoundingClientRect().right - last.getBoundingClientRect().right : null }
}
"""

TOGGLES = """
() => [...document.querySelectorAll('[data-side-toggle]')].map((one) => {
  const box = one.getBoundingClientRect()
  return {
    side: one.dataset.sideToggle,
    bar: !!one.closest('header[data-chrome="top"]'),
    seen: !one.classList.contains('orden-said') && box.width > 4 && !one.closest('[inert]'),
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  }
})
"""

SIDES = f"""
() => ({{
  left: {WS}.openOn('left') ? 'open' : document.querySelector('.column:not(.right).peek') ? 'out' : 'shut',
  right: {WS}.rightShows !== null ? 'open' : document.querySelector('.column.right.peek') ? 'out' : 'shut',
}})
"""

def toggles(page: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = page.evaluate(TOGGLES)
    return found

def sides(page: Any) -> dict[str, str]:
    found: dict[str, str] = page.evaluate(SIDES)
    return found

def away(page: Any) -> None:
    page.mouse.move(640, 400)
    page.wait_for_timeout(400)

def in_bar(page: Any, state: str) -> None:
    found = toggles(page)
    for side in ("left", "right"):
        if not any(one["side"] == side and one["bar"] and one["seen"] for one in found):
            wrong(f"[{state}] the {side} sidebar's button is not to be seen in the bar: {found}")
        if any(one["side"] == side and not one["bar"] for one in found):
            wrong(f"[{state}] the {side} sidebar has a button of its own: {found}")

def in_the_bar(page: Any, state: str) -> None:
    in_bar(page, f"{state}-shut")
    gap = page.evaluate(END_GAP)
    say(f"[{state}] the bar's end: {gap}")
    if gap["end"] is None or abs(gap["end"] - gap["lead"]) > 0.5:
        wrong(f"[{state}] the bar's last button is not as far from its end as the first is from its start: {gap}")
    shot(page, f"{state}-01-shut")

    page.mouse.move(1279, 400)
    page.wait_for_timeout(300)
    if sides(page)["right"] != "shut":
        wrong(f"[{state}] the pointer at the end edge brought the right side out: {sides(page)}")
    away(page)

    page.mouse.move(400, 400)
    page.mouse.move(0, 400)
    page.wait_for_timeout(300)
    if sides(page)["left"] != "out":
        wrong(f"[{state}] the pointer at the start edge did not bring the file list out: {sides(page)}")
    shot(page, f"{state}-02-left-out")
    away(page)

    for side in ("left", "right"):
        button = next(one for one in toggles(page) if one["side"] == side and one["bar"])
        page.mouse.click(button["x"], button["y"])
        page.wait_for_timeout(400)
        if sides(page)[side] != "open":
            wrong(f"[{state}] the bar's {side} button did not open its side: {sides(page)}")
        in_bar(page, f"{state}-{side}-open")
        shot(page, f"{state}-03-{side}-open")
        button = next(one for one in toggles(page) if one["side"] == side and one["bar"])
        page.mouse.click(button["x"], button["y"])
        page.wait_for_timeout(400)
        if sides(page)[side] != "shut":
            wrong(f"[{state}] the bar's {side} button did not put its side away: {sides(page)}")
    away(page)

def as_left(browser: Any, stored: bool) -> None:
    state = "stored-inside" if stored else "default"
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 760})
    page.add_init_script(OTHERS_SEEN)
    if stored:
        page.add_init_script(INSIDE)
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n", "# Kestrel\n\nA bird.\n")
    DRIVE.open_note(page, "Plan")
    page.evaluate(f"() => {{ {WS}.split('row'); {WS}.closePanel(); {WS}.closeRight() }}")
    DRIVE.settled(page)
    page.wait_for_timeout(500)

    in_the_bar(page, state)
    if page.evaluate("() => !!document.querySelector('.orden-bubble.hint[role=status]')"):
        wrong(f"[{state}] an edge hint is up with the buttons in the bar")

def drive(browser: Any) -> None:
    as_left(browser, stored=False)
    as_left(browser, stored=True)

    phone = DRIVE.page(
        browser,
        viewport={"width": 1280, "height": 800},
        user_agent=TABLET_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    phone.add_init_script(INSIDE)
    DRIVE.open(phone)
    DRIVE.seed(phone, "# Plan\n\nWhat we are doing.\n")
    DRIVE.open_note(phone, "Plan")
    DRIVE.settled(phone)
    touch = phone.evaluate("() => document.documentElement.hasAttribute('data-touch')")
    if not touch:
        wrong("the touch screen was not taken for one")
    seen = [one for one in toggles(phone) if one["bar"] and one["seen"]]
    if not any(one["side"] == "left" for one in seen) and not phone.evaluate(
        "() => document.documentElement.hasAttribute('data-drawer')"
    ):
        wrong(f"a touch screen's bar lost its file list button: {toggles(phone)}")
    shot(phone, "08-touch")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
