from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive, WRITE
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

ERRANDS = """# Errands

- [ ] Call the bank #admin
- [ ] Water the plants #home
- [ ] Read a book
- [ ] Plant the bulbs #garden
"""


TABS = "() => window.ordenApp.workspace.tabs.length"

def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)

def panel_words(page: Page) -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "() => [...document.querySelectorAll('.tasks .chosen .task .words')].map((one) => one.textContent.trim())"
    )

def chosen(page: Page) -> str:
    return page.evaluate(  # type: ignore[no-any-return]
        "() => document.querySelector('.tasks .orden-row[aria-pressed=true] .orden-row-label')?.textContent.trim() ?? ''"
    )

def row(page: Page, name: str):  # type: ignore[no-untyped-def]
    return page.locator(".tasks > .orden-row", has=page.locator(f".orden-row-label:text-is('{name}')")).first

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.ordenApp.tasks() }")
    page.evaluate(WRITE, [[[None, ERRANDS]]])
    wait_for(page, "() => window.tasks.rows.of().some((one) => one.task?.text === 'Read a book')", "the rows")
    page.evaluate("window.ordenApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .chosen .task')", "the chosen list in the panel")
    tabs = page.evaluate(TABS)
    say(f"[tabs at the start] {tabs}")

    for name, wanted in (
        ("admin", ["Call the bank"]),
        ("home", ["Water the plants"]),
        ("Tasks", ["Call the bank", "Water the plants", "Read a book", "Plant the bulbs"]),
    ):
        row(page, name).click()
        DRIVE.waited(page, f"() => document.querySelector('.tasks .orden-row[aria-pressed=true] .orden-row-label')?.textContent.trim() === {json.dumps(name)}", f"{name} chosen")
        quiet(page)
        words = sorted(panel_words(page))
        say(f"[{name}] chosen {chosen(page)!r}, list {json.dumps(words)}, tabs {page.evaluate(TABS)}")
        if page.evaluate(TABS) != tabs:
            wrong(f"pressing {name} changed the number of tabs")
        if words != sorted(wanted):
            wrong(f"the panel's list for {name} is {words}, not {sorted(wanted)}")
    shot(page, "01-chosen")

    card = page.locator(".tasks .chosen .task:has(.words:text-is('Call the bank'))")
    box = card.bounding_box()
    if box is None:
        wrong("the bank's card is not drawn")
    else:
        card.click(modifiers=["Control"], position={"x": 4, "y": box["height"] - 4})
        page.locator(".tasks .chosen .task:has(.words:text-is('Read a book')) .words").click(
            modifiers=["Shift"], position={"x": 4, "y": 4}
        )
        picked = page.locator(".tasks .chosen .task.is-picked").count()
        say(f"[picked] {picked}, tabs {page.evaluate(TABS)}")
        if picked != 3:
            wrong(f"Ctrl and Shift selected {picked} of the panel's 3 rows")
        if page.evaluate(TABS) != tabs:
            wrong("selecting in the panel changed the number of tabs")
        shot(page, "01-picked")
        page.locator(".tasks .chosen .task:has(.words:text-is('Water the plants'))").focus()
        page.mouse.click(700, 600)
        DRIVE.waited(
            page,
            "() => !document.querySelector('.tasks .chosen .task:is(.is-picked, .is-on)')",
            "a press past the rows letting them go",
        )

    row(page, "admin").click(modifiers=["Control"])
    if DRIVE.waited(page, f"() => ({TABS})() === {tabs + 1}", "Ctrl and a press opening a tab"):
        if page.evaluate("() => window.ordenApp.workspace.active?.preview === true"):
            wrong("the tab Ctrl and a press opened is a preview")
    row(page, "home").click(button="middle")
    DRIVE.waited(page, f"() => ({TABS})() === {tabs + 2}", "the middle button opening a tab")
    row(page, "garden").click(button="right")
    page.locator(".orden-menu [role=menuitem], [role=menu] [role=menuitem]", has_text="Open in new tab").first.click()
    DRIVE.waited(page, f"() => ({TABS})() === {tabs + 3}", "Open in new tab opening a tab")
    shot(page, "02-opened")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the Tasks panel chooses, and opens a tab only when asked"))
