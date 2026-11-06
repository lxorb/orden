from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WS = "window.nibApp.workspace"

TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

OTHERS_SEEN = "localStorage.setItem('nib:hints', JSON.stringify(['drawer', 'graph', 'palette']))"

INSIDE = "localStorage.setItem('nib:side-toggles-inside', 'yes')"

SETTING = "Sidebar toggles inside the sidebars"

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
    seen: !one.classList.contains('nib-said') && box.width > 4 && !one.closest('[inert]'),
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

def none_in_bar(page: Any, state: str) -> None:
    seen = [one for one in toggles(page) if one["bar"] and one["seen"]]
    if seen:
        wrong(f"[{state}] a sidebar button is to be seen in the bar: {seen}")

def sides(page: Any) -> dict[str, str]:
    found: dict[str, str] = page.evaluate(SIDES)
    return found

def own(page: Any, side: str) -> dict[str, Any] | None:
    return next((one for one in toggles(page) if one["side"] == side and not one["bar"] and one["seen"]), None)

def away(page: Any) -> None:
    page.mouse.move(640, 400)
    page.wait_for_timeout(400)

def pointer(page: Any) -> None:
    none_in_bar(page, "01-shut")
    shot(page, "01-shut")

    page.mouse.move(400, 400)
    page.mouse.move(0, 400)
    page.wait_for_timeout(300)
    if sides(page)["left"] != "out":
        wrong(f"the pointer at the start edge did not bring the file list out: {sides(page)}")
    button = own(page, "left")
    if not button:
        wrong("the file list that came out has no button of its own")
    shot(page, "02-left-out")
    if button:
        page.mouse.move(button["x"], button["y"])
        page.mouse.click(button["x"], button["y"])
        page.wait_for_timeout(400)
        if sides(page)["left"] != "open":
            wrong(f"its button did not pin the file list open: {sides(page)}")
        none_in_bar(page, "03-left-pinned")
        shot(page, "03-left-pinned")
        button = own(page, "left")
        if button:
            page.mouse.click(button["x"], button["y"])
            page.wait_for_timeout(400)
        if sides(page)["left"] != "shut":
            wrong(f"its button did not put the file list away: {sides(page)}")
    away(page)

    page.mouse.move(1279, 12)
    page.wait_for_timeout(300)
    if sides(page)["right"] != "shut":
        wrong(f"the pointer in the bar's corner brought the right side out: {sides(page)}")

    page.mouse.move(1279, 400)
    page.wait_for_timeout(300)
    if sides(page)["right"] != "out":
        wrong(f"the pointer at the end edge did not bring the right side out: {sides(page)}")
    button = own(page, "right")
    if not button:
        wrong("the right side that came out has no button of its own")
    shot(page, "04-right-out")
    if button:
        page.mouse.move(button["x"], button["y"])
        page.mouse.click(button["x"], button["y"])
        page.wait_for_timeout(400)
        if sides(page)["right"] != "open":
            wrong(f"its button did not pin the right side open: {sides(page)}")
        none_in_bar(page, "05-right-pinned")
        shot(page, "05-right-pinned")
        button = own(page, "right")
        if button:
            page.mouse.click(button["x"], button["y"])
            page.wait_for_timeout(400)
        if sides(page)["right"] != "shut":
            wrong(f"its button did not put the right side away: {sides(page)}")
    away(page)

    page.mouse.move(1279, 400)
    page.wait_for_timeout(300)
    away(page)
    if sides(page)["right"] != "shut":
        wrong(f"the right side stayed out after the pointer left it: {sides(page)}")

def keyboard(page: Any) -> None:
    page.focus("header .nib-glyph.overview")
    page.keyboard.press("Tab")
    page.wait_for_timeout(200)
    if not page.evaluate("() => !!document.activeElement?.matches('header [data-side-toggle=\"left\"]')"):
        wrong("Tab along the bar does not reach the file list's button")
    bar = next((one for one in toggles(page) if one["bar"] and one["side"] == "left"), None)
    if not bar or not bar["seen"]:
        wrong(f"the bar's said button does not show itself under the keyboard: {bar}")
    shot(page, "06-keyed")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    if sides(page)["left"] != "open":
        wrong(f"Enter on the bar's button did not open the file list: {sides(page)}")
    held = page.evaluate(
        "() => { const on = document.activeElement; return !!on?.matches('[data-sidebar] [data-side-toggle=\"left\"]') }"
    )
    if not held:
        wrong("the keyboard did not go on to the file list's own button")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    if sides(page)["left"] != "shut":
        wrong(f"Enter on the file list's button did not put it away: {sides(page)}")
    back = page.evaluate(
        "() => !!document.activeElement?.matches('header [data-side-toggle=\"left\"]')"
    )
    if not back:
        wrong("the keyboard did not come back to the bar's button")

def told(page: Any) -> None:
    page.mouse.move(640, 400)
    if not DRIVE.waited(
        page,
        "[...document.querySelectorAll('.nib-bubble.hint[role=status]')].some((one) => one.textContent.includes('edge'))",
        "the hint that the edge brings the file list out",
        patience=40,
    ):
        return
    shot(page, "07-told")
    page.mouse.move(400, 400)
    page.mouse.move(0, 400)
    page.wait_for_timeout(300)
    gone = page.evaluate("() => !document.querySelector('.nib-bubble.hint[role=status]')")
    if not gone:
        wrong("the hint stayed once the edge had brought the file list out")
    away(page)

def in_bar(page: Any, state: str) -> None:
    found = toggles(page)
    for side in ("left", "right"):
        if not any(one["side"] == side and one["bar"] and one["seen"] for one in found):
            wrong(f"[{state}] the {side} sidebar's button is not to be seen in the bar: {found}")
        if any(one["side"] == side and not one["bar"] for one in found):
            wrong(f"[{state}] the {side} sidebar has a button of its own: {found}")

def flip(page: Any, on: bool) -> None:
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    row = page.locator(".nib-setting", has_text=SETTING).first
    row.wait_for(timeout=5000)
    switch = row.locator("[role=switch]")
    if (switch.get_attribute("aria-checked") == "true") != on:
        switch.click()
    if (switch.get_attribute("aria-checked") == "true") != on:
        wrong(f"the switch did not turn {'on' if on else 'off'}")
    page.wait_for_timeout(300)
    shot(page, f"10-setting-{'on' if on else 'off'}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    away(page)

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

def by_default(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 760})
    page.add_init_script(OTHERS_SEEN)
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n", "# Kestrel\n\nA bird.\n")
    DRIVE.open_note(page, "Plan")
    page.evaluate(f"() => {{ {WS}.split('row'); {WS}.closePanel(); {WS}.closeRight() }}")
    DRIVE.settled(page)
    page.wait_for_timeout(500)

    in_the_bar(page, "off")
    if page.evaluate("() => !!document.querySelector('.nib-bubble.hint[role=status]')"):
        wrong("the edge's hint is up with the buttons in the bar")

    flip(page, True)
    none_in_bar(page, "on-live")
    page.mouse.move(1279, 400)
    page.wait_for_timeout(300)
    if sides(page)["right"] != "out":
        wrong(f"turned on, the pointer at the end edge did not bring the right side out: {sides(page)}")
    if not own(page, "right"):
        wrong("turned on, the right side that came out has no button of its own")
    shot(page, "11-on-live-right-out")
    away(page)

    flip(page, False)
    in_the_bar(page, "off-again")

def drive(browser: Any) -> None:
    by_default(browser)

    page = DRIVE.page(browser, viewport={"width": 1280, "height": 760})
    page.add_init_script(OTHERS_SEEN)
    page.add_init_script(INSIDE)
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n", "# Kestrel\n\nA bird.\n")
    DRIVE.open_note(page, "Plan")
    page.evaluate(f"() => {{ {WS}.split('row'); {WS}.closePanel(); {WS}.closeRight() }}")
    DRIVE.settled(page)
    page.wait_for_timeout(500)

    told(page)
    pointer(page)
    keyboard(page)

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
