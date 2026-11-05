"""Each sidebar's button in the sidebar, and each sidebar out of its own edge (#1038).

The file list's button stood in the bar beside the search, and the right side's at the
bar's end beside the window's buttons. On a desktop each is now the side's own: the file
list's in its head, the right side's at the end of its first row. Shut, a side comes out
over the note when the pointer reaches the window's edge it went into, the file list at
the start edge (#1034) and the right side at the end edge, and its button there pins it.

What this presses and measures, with both sides shut and two panes:

  * **Nothing in the bar.** No sidebar button is to be seen in the bar, open or shut;
    shut, the bar keeps one said and not shown, for a screen reader and a keyboard.
  * **Out of each edge.** The pointer at the start edge brings the file list out with its
    button in its head; at the end edge, under the bar, the right side with its button at
    the end of its first row. Thrown into the bar's corner, where the window's buttons
    are, the pointer brings nothing out.
  * **Pinned by its button.** Pressing the button in a side that came out keeps it open,
    and pressing it again puts it away, with nothing left in the bar to see.
  * **By a key.** The bar's said button, reached by the keyboard, shows itself; Enter
    opens the side and the keyboard goes on to the side's own button, where Enter puts the
    side away again and the keyboard comes back to the bar's.
  * **Told once.** Somebody new, with the file list shut, is told once that the edge
    brings it out.
  * **A finger keeps the bar's.** On a touch screen, which has no edge to hover, the bar
    keeps its buttons in sight.

Run it from the repository root:

    python apps/desktop/test/e2e/side-edges.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/side-edges/`.
"""

from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WS = "window.nibApp.workspace"

#: A tablet held sideways: a touch screen with the file list docked beside the note.
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: The other hints put away already, so the one a session shows is this one: which of
#: several wanted at once goes up is the hints' own business (hints.svelte.ts).
OTHERS_SEEN = "localStorage.setItem('nib:hints', JSON.stringify(['drawer', 'graph', 'palette']))"

#: Every sidebar button on the page: which side, whether it is the bar's, whether it can
#: be seen, whether it is out of reach, and its middle.
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

#: Whether each side is out over the note, open, or neither.
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

    # The file list, out of the start edge, with its own button.
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

    # Thrown into the bar's corner at the end edge, where the window's buttons are.
    page.mouse.move(1279, 12)
    page.wait_for_timeout(300)
    if sides(page)["right"] != "shut":
        wrong(f"the pointer in the bar's corner brought the right side out: {sides(page)}")

    # The right side, out of the end edge under the bar, with its own button.
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

    # Out and gone again: the pointer leaving the side takes it away.
    page.mouse.move(1279, 400)
    page.wait_for_timeout(300)
    away(page)
    if sides(page)["right"] != "shut":
        wrong(f"the right side stayed out after the pointer left it: {sides(page)}")


def keyboard(page: Any) -> None:
    # Tab from the overview's button, the one before it in the bar, so the focus is the
    # keyboard's and the button shows itself.
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


def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 760})
    page.add_init_script(OTHERS_SEEN)
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
