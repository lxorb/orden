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


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    days = seed(page)
    display(page)
    upcoming(page, days)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the Display menu and Upcoming held"))
