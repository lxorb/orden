"""A new tab's address, half typed, across a switch of tabs (#381), light and dark.

Emil: *"when I input stuff into the input field of a new tab in the top and then switch
to another one and then back it is gone"*. Chrome keeps an address being typed with its
tab, caret and all, and gives the field the keyboard again as the tab comes back.

What it proves, and photographs:

* **A press on another tab**: words typed into a new tab's field, the caret moved back
  among them, another tab pressed and then this one: the words are there, the field has
  the keyboard, and the caret is where it was.
* **Ctrl+Tab from inside the field**: the same, with the keyboard never leaving it.
* **Left for something else**: the field pressed past, then another tab and back: the
  field does not take the keyboard, which only a field that had it as its tab was left
  does.

From the repository root:

    python apps/desktop/test/e2e/address-kept.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go beside this file under
`shots/address-kept/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot


STATE = """
() => {
  const field = [...document.querySelectorAll('input[role="combobox"][aria-label="Address"]')].find((one) => one.checkVisibility())
  return {
    front: window.nibApp.workspace.active?.id ?? null,
    value: field?.value ?? null,
    focused: !!field && document.activeElement === field,
    caret: field ? [field.selectionStart, field.selectionEnd] : null,
  }
}
"""


def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def tab_of(page: Page, tab_id: str):
    return page.locator(f'[data-tab="{tab_id}"]')


def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    DRIVE.open(page)
    DRIVE.seed(page, "# Trips\n\nWhere we went.\n")
    DRIVE.open_note(page, "Trips")
    note = page.evaluate("() => window.nibApp.workspace.active.id")

    # A press on another tab, and back.
    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    DRIVE.wait_for(page, "document.activeElement?.getAttribute('aria-label') === 'Address'", "the new tab's field")
    web = page.evaluate("() => window.nibApp.workspace.active.id")
    page.keyboard.type("weather in zurich")
    for _ in range(7):
        page.keyboard.press("ArrowLeft")
    before = page.evaluate(STATE)
    shot(page, f"{scheme}-1-typed")

    tab_of(page, note).click()
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {note!r}", "the note in front")
    page.wait_for_timeout(300)
    tab_of(page, web).click()
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {web!r}", "the new tab again")
    page.wait_for_timeout(400)
    after = page.evaluate(STATE)
    shot(page, f"{scheme}-2-back")
    check(f"[{scheme}] the words are there: {after['value']!r}", after["value"] == "weather in zurich")
    check(f"[{scheme}] the field has the keyboard again", after["focused"])
    check(f"[{scheme}] the caret is where it was: {before['caret']} and {after['caret']}", after["caret"] == before["caret"] == [10, 10])

    # Typing goes on from the caret.
    page.keyboard.type("a")
    on = page.evaluate(STATE)
    check(f"[{scheme}] and typing goes on from there: {on['value']!r}", on["value"] == "weather ina zurich")

    # Ctrl+Tab from inside the field, and back.
    page.keyboard.press("Control+Tab")
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id !== {web!r}", "the next tab")
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Shift+Tab")
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {web!r}", "the new tab again")
    page.wait_for_timeout(400)
    back = page.evaluate(STATE)
    check(f"[{scheme}] Ctrl+Tab and back: {back['value']!r} at {back['caret']}", back["value"] == "weather ina zurich" and back["caret"] == [11, 11] and back["focused"])

    # Left for something else in the tab, then another tab and back: the field is not put
    # in front of the next key, which only a field that had the keyboard is (#381).
    box = page.locator('input[role="combobox"][aria-label="Address"]').first.bounding_box()
    assert box
    # Bare ground, clear of the new tab's tiles.
    page.mouse.click(box["x"] + 60, box["y"] + box["height"] + 560)
    page.wait_for_timeout(300)
    left = page.evaluate(STATE)
    check(f"[{scheme}] a press past the field takes the keyboard from it", not left["focused"])
    tab_of(page, note).click()
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {note!r}", "the note in front")
    page.wait_for_timeout(300)
    tab_of(page, web).click()
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {web!r}", "the new tab again")
    page.wait_for_timeout(500)
    unasked = page.evaluate(STATE)
    shot(page, f"{scheme}-3-left")
    check(f"[{scheme}] back, the field it was left by does not take the keyboard", not unasked["focused"])
    check(f"[{scheme}] and its words are still in it: {unasked['value']!r}", unasked["value"] == "weather ina zurich")

    # And a new tab gone from at once, with its field never typed in or left: back, its
    # field has the keyboard, which it had.
    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    DRIVE.wait_for(page, "document.activeElement?.getAttribute('aria-label') === 'Address'", "another new tab's field")
    fresh = page.evaluate("() => window.nibApp.workspace.active.id")
    tab_of(page, note).click()
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {note!r}", "the note in front")
    page.wait_for_timeout(300)
    tab_of(page, fresh).click()
    DRIVE.wait_for(page, f"window.nibApp.workspace.active?.id === {fresh!r}", "the fresh tab again")
    page.wait_for_timeout(500)
    check(f"[{scheme}] a field that had the keyboard has it back", page.evaluate(STATE)["focused"])
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("an address half typed stays with its tab, caret and all")


if __name__ == "__main__":
    raise SystemExit(main())
