"""Todoist's Display menu and its Upcoming, in the built app.

What this drives, against the real files:

  * A view of tasks wears Todoist's head: its name, the search, Display and the plus,
    and none of a database's tools.
  * Display groups Today by priority, keeps done tasks in it, and narrows it to a label.
  * Upcoming has what is overdue on top, then every day from today, an empty one too,
    each with its head and its add row; a day pressed on the strip is scrolled to.

    python apps/desktop/test/e2e/display.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/display/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


DAYS = """() => {
  const day = (n) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const two = (v) => String(v).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }
  return { today: day(0), yesterday: day(-1), later: day(9) }
}"""

ERRANDS = """# Errands

- [ ] Call the bank #admin 🔺 📅 {today}
- [ ] Water the plants 📅 {today}
- [ ] Pay rent #admin ⏫ 📅 {yesterday}
- [x] Bread ✅ {today} 📅 {today}
- [ ] Dentist 📅 {later}
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

WORDS = "() => [...document.querySelectorAll('.view-tab .task .words')].map((one) => one.textContent.trim())"
HEADS = "() => [...document.querySelectorAll('.view-tab .head .fold')].map((one) => one.textContent.trim())"


def seed(page: Page) -> dict[str, str]:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(WRITE, [[["Errands.md", ERRANDS.format(**days)]]])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Dentist')",
        "the seeded rows",
    )
    return days


def display(page: Page) -> None:
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "document.querySelector('.view-tab .task')", "Today")
    if page.locator(".view-tab [aria-label='Filter']").count():
        wrong("Today still wears a database's filter")
    page.locator(".view-tab [aria-label='Display']").click()
    wait_for(page, "document.querySelector('.view-tab .display')", "the Display menu")
    shot(page, "01-display")

    page.locator(".view-tab .display .pair", has_text="Group").locator("button").first.click()
    page.locator("[role=option]", has_text="Priority").first.click()
    wait_for(page, f"() => ({HEADS})().some((one) => one.startsWith('p1'))", "Today grouped by priority")
    say(f"[heads] {json.dumps(page.evaluate(HEADS))}")

    page.locator(".view-tab .display [role=switch]").click()
    wait_for(page, f"() => ({WORDS})().includes('Bread')", "the done task kept in the view")

    page.locator(".view-tab .display .pair", has_text="Label").locator("button").first.click()
    page.locator("[role=option]", has_text="#admin").first.click()
    wait_for(
        page,
        f"() => {{ const w = ({WORDS})(); return w.length === 2 && w.includes('Pay rent') }}",
        "Today narrowed to a label",
    )
    shot(page, "02-narrowed")
    page.keyboard.press("Escape")


def upcoming(page: Page, days: dict[str, str]) -> None:
    page.evaluate("window.tasks.openBuiltin('upcoming')")
    wait_for(page, "document.querySelector('.view-tab .upcoming .task')", "Upcoming")
    heads = page.evaluate(HEADS)
    say(f"[upcoming heads] {json.dumps(heads[:6], ensure_ascii=False)}")
    if not heads or not heads[0].startswith("Overdue"):
        wrong("Upcoming does not start with what is overdue")
    if len(heads) < 8:
        wrong("Upcoming does not draw the days nothing is due on")
    adds = page.locator(".view-tab .upcoming .add-row").count()
    if adds < 6:
        wrong(f"the empty days have no add row ({adds})")
    shot(page, "03-upcoming")

    # Shift and an arrow walk the strip a week at a time.
    first = "() => document.querySelector('.view-tab .strip .day .number')?.textContent"
    before = page.evaluate(first)
    page.locator(".view-tab .upcoming .task").first.focus()
    page.keyboard.press("Shift+ArrowRight")
    wait_for(page, f"() => ({first})() !== '{before}'", "the strip a week on")
    page.keyboard.press("Shift+ArrowLeft")
    wait_for(page, f"() => ({first})() === '{before}'", "the strip back")


COLUMNS = "() => [...document.querySelectorAll('.view-tab .board .column .head .name')].map((one) => one.textContent.trim())"


def upcoming_board(page: Page, days: dict[str, str]) -> None:
    page.locator(".view-tab [aria-label='Display']").click()
    wait_for(page, "document.querySelector('.view-tab .display')", "the Display menu")
    page.locator(".view-tab .display [role=radio]", has_text="Board").click()
    page.keyboard.press("Escape")
    wait_for(page, "document.querySelector('.view-tab .upcoming .board .column')", "Upcoming as a board")
    columns = page.evaluate(COLUMNS)
    say(f"[columns] {json.dumps(columns[:4], ensure_ascii=False)} ... {len(columns)}")
    if not columns or not columns[0].startswith("Overdue"):
        wrong("the board does not start with what is overdue")
    if len(columns) != 15:
        wrong(f"the board does not have a column for each of two weeks ({len(columns)})")
    shot(page, "04-upcoming-board")

    # A card carried to the column of the day after tomorrow is given that day.
    water = page.locator(".view-tab .board .card", has_text="Water the plants").bounding_box()
    third = page.locator(".view-tab .board .column").nth(3).bounding_box()
    if water and third:
        page.mouse.move(water["x"] + 20, water["y"] + 10)
        page.mouse.down()
        page.mouse.move(water["x"] + 40, water["y"] + 20, steps=4)
        page.mouse.move(third["x"] + 60, third["y"] + 120, steps=10)
        page.mouse.up()
        wait_for(
            page,
            "() => { const t = window.tasks.rows.of().find((one) => one.task?.text === 'Water the plants')?.task; const d = new Date(); d.setDate(d.getDate() + 2); const two = (v) => String(v).padStart(2, '0'); return t?.due === `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` }",
            "the card given its column's day",
        )

    before = page.evaluate(COLUMNS)[1]
    page.locator(".view-tab .strip [aria-label='Forward']").click()
    page.wait_for_timeout(500)
    strip = page.evaluate("() => document.querySelector('.view-tab .strip .day .number')?.textContent")
    say(f"[after forward] {json.dumps(page.evaluate(COLUMNS)[:3], ensure_ascii=False)} strip {strip}")
    wait_for(page, f"() => ({COLUMNS})()[1] !== {json.dumps(before)}", "the columns a week on")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    days = seed(page)
    display(page)
    upcoming(page, days)
    upcoming_board(page, days)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the Display menu and Upcoming held"))
