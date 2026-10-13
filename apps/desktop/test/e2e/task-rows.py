"""Todoist's task row and its scheduler, in the built app.

What this drives, against the real rows store and the real files:

  * A task in Today is its words, the first line of its description, and a meta line:
    the day in the colour of how near it is, the sub-tasks done of all, the comments,
    the labels, the deadline, and where it lives.
  * The row's calendar opens the scheduler beside it; Tomorrow writes tomorrow's date.
  * A phrase typed into the scheduler is read with quick add's grammar, shown, and
    written on Enter.
  * Overdue's Reschedule moves every overdue task at once, as one undo.
  * The row's menu duplicates a task, copies its link (a block name written once) and
    deletes it.
  * The scheduler is a sheet at phone width.

    python apps/desktop/test/e2e/task-rows.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/task-rows/`.
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
  return { today: day(0), yesterday: day(-1), tomorrow: day(1), soon: day(3) }
}"""

ERRANDS = """# Errands

## Calls
- [ ] Call the bank [deadline:: {soon}] #admin ⏫ 📅 {yesterday}
  Their number is on the back of the old card.
  - [x] Find the old card
  - [ ] Find the pin
  - Called once, no answer.
  - Called again.
- [ ] Water the plants 🔁 every 3 days when done 📅 {today}
- [ ] Pay the dentist 📅 {yesterday}
- [ ] Take the vitamins 🔁 every day 📅 {today}
- [ ] Stretch 🔁 every day 📅 {today}
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words)?.task ?? null"


def task(page: Page, words: str) -> dict[str, object] | None:
    return page.evaluate(TASK, words)  # type: ignore[no-any-return]


def seed(page: Page) -> dict[str, str]:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(WRITE, [[["Errands.md", ERRANDS.format(**days)]]])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Pay the dentist')",
        "the seeded rows",
    )
    return days


def open_today(page: Page) -> None:
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "document.querySelector('.view-tab .task')", "Today's rows")
    quiet(page)


def row(page: Page, words: str) -> str:
    return f".view-tab .task:has(.words:text-is('{words}'))"


def the_row(page: Page) -> None:
    bank = row(page, "Call the bank")
    text = page.locator(bank).inner_text()
    say(f"[row] {json.dumps(text, ensure_ascii=False)}")
    for wanted in ["Their number is on the back", "1/2", "#admin", "Errands", "Calls"]:
        if wanted not in text:
            wrong(f"the bank's row does not say {wanted}")
    if page.locator(f"{bank} .meta .bit").count() < 4:
        wrong("the bank's meta line is missing its date, deadline, sub-tasks or comments")
    late = page.locator(f"{bank} .meta .bit").first.evaluate("(bit) => getComputedStyle(bit).color")
    danger = page.evaluate(
        "() => { const probe = document.createElement('span'); probe.style.color = 'var(--danger)';"
        " document.body.append(probe); const colour = getComputedStyle(probe).color; probe.remove(); return colour }"
    )
    say(f"[late colour] {late} (danger {danger})")
    if late != danger:
        wrong("an overdue day is not drawn in the danger tone")
    shot(page, "01-today")


def scheduler(page: Page, days: dict[str, str]) -> None:
    plants = row(page, "Water the plants")
    page.locator(plants).hover()
    page.locator(f"{plants} .act[aria-label='Schedule']").click()
    wait_for(page, "document.querySelector('.scheduler')", "the scheduler")
    shot(page, "02-scheduler")
    labels = page.evaluate(
        "() => [...document.querySelectorAll('.scheduler .quick .nib-row-label')].map((one) => one.textContent)"
    )
    say(f"[quick] {json.dumps(labels)}")
    if "Tomorrow" not in labels:
        wrong("the scheduler has no Tomorrow")
    page.locator(".scheduler .quick .nib-row", has_text="Tomorrow").click()
    wait_for(
        page,
        f"() => ({TASK})('Water the plants')?.due === '{days['tomorrow']}'",
        "the plants moved to tomorrow",
    )
    if page.locator(".scheduler").count():
        wrong("the scheduler stayed up after a day was picked")

    # A phrase, typed.
    page.evaluate("window.tasks.openBuiltin('upcoming')")
    plants = row(page, "Water the plants")
    page.locator(plants).wait_for()
    page.locator(plants).hover()
    page.locator(f"{plants} .act[aria-label='Schedule']").click()
    wait_for(page, "document.activeElement?.matches('.scheduler .field')", "the scheduler's field")
    page.keyboard.type("in 5 days at 9am", delay=10)
    wait_for(page, "document.querySelector('.scheduler .preview')", "what the words say")
    shot(page, "03-typed")
    page.keyboard.press("Enter")
    wait_for(
        page,
        "() => { const t = (" + TASK + ")('Water the plants'); return t?.time === '09:00' }",
        "the typed day and time written",
    )
    found = task(page, "Water the plants") or {}
    if found.get("recurrence") is None:
        wrong("scheduling a repeating task took its repeat away")


def reschedule(page: Page, days: dict[str, str]) -> None:
    open_today(page)
    page.locator(".view-tab .head .act", has_text="Reschedule").click()
    wait_for(page, "document.querySelector('.scheduler')", "the scheduler for what is overdue")
    page.locator(".scheduler .quick .nib-row", has_text="Today").click()
    wait_for(
        page,
        f"() => ['Call the bank', 'Pay the dentist'].every((words) => ({TASK})(words)?.due === '{days['today']}')",
        "every overdue task moved to today",
    )
    page.keyboard.press("Control+z")
    wait_for(
        page,
        f"() => ['Call the bank', 'Pay the dentist'].every((words) => ({TASK})(words)?.due === '{days['yesterday']}')",
        "one undo taking all of them back",
    )


def menu(page: Page) -> None:
    open_today(page)
    dentist = row(page, "Pay the dentist")
    page.locator(dentist).hover()
    page.locator(f"{dentist} .act[aria-label='More']").click()
    wait_for(page, "document.querySelector('.menu [role=menuitem]')", "the row's menu")
    shot(page, "04-menu")
    page.locator(".menu [role=menuitem]", has_text="Duplicate").click()
    wait_for(
        page,
        "() => window.tasks.rows.of().filter((one) => one.task?.text === 'Pay the dentist').length === 2",
        "the dentist duplicated",
    )

    page.locator(dentist).first.hover()
    page.locator(f"{dentist} .act[aria-label='More']").first.click()
    page.locator(".menu [role=menuitem]", has_text="Copy link").click()
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Pay the dentist' && one.task.block)",
        "a block name written for the link",
    )

    page.locator(dentist).first.hover()
    page.locator(f"{dentist} .act[aria-label='More']").first.click()
    page.locator(".menu [role=menuitem]", has_text="Delete").click()
    wait_for(
        page,
        "() => window.tasks.rows.of().filter((one) => one.task?.text === 'Pay the dentist').length === 1",
        "one dentist deleted",
    )


def repeating(page: Page, days: dict[str, str]) -> None:
    """A repeating task skipped from the scheduler, and one done for good from its menu."""
    open_today(page)
    vitamins = row(page, "Take the vitamins")
    page.locator(vitamins).hover()
    page.locator(f"{vitamins} .act[aria-label='Schedule']").click()
    wait_for(page, "document.querySelector('.scheduler')", "the scheduler")
    page.locator(".scheduler .quick .nib-row", has_text="Skip").click()
    wait_for(
        page,
        f"() => ({TASK})('Take the vitamins')?.due === '{days['tomorrow']}' && !({TASK})('Take the vitamins')?.done",
        "Skip moving it to tomorrow, unticked",
    )
    found = task(page, "Take the vitamins") or {}
    if not found.get("recurrence"):
        wrong("Skip took the repeat away")

    stretch = row(page, "Stretch")
    page.locator(stretch).hover()
    page.locator(f"{stretch} .act[aria-label='More']").click()
    page.locator(".menu [role=menuitem]", has_text="Complete forever").click()
    wait_for(
        page,
        "() => { const all = window.tasks.rows.of().filter((one) => one.task?.text === 'Stretch'); return all.length === 1 && all[0].task.done && !all[0].task.recurrence }",
        "Stretch done for good, with no next one",
    )


def comment_button(page: Page) -> None:
    """The row's comment button opens its view with the comment field ready."""
    open_today(page)
    bank = row(page, "Call the bank")
    page.locator(bank).hover()
    page.locator(f"{bank} .act[aria-label='Comment']").click()
    wait_for(page, "document.activeElement?.matches('.sheet .composer')", "the comment field")
    shot(page, "04b-comment")
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.sheet')", "the view put away")


# A phone says it is one in its user agent and under a finger (deviceFor in
# viewport.svelte.ts); the width alone is a narrow desktop window.
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)


def phone(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    DRIVE.open(page)
    seed(page)
    open_today(page)
    shot(page, "05-phone-today")
    page.locator(row(page, "Water the plants")).click(button="right")
    wait_for(page, "document.querySelector('.menu [role=menuitem]')", "the row's menu at phone width")
    page.locator(".menu [role=menuitem]", has_text="Schedule").click()
    wait_for(page, "document.querySelector('.scheduler.sheet')", "the scheduler as a sheet")
    shot(page, "06-phone-scheduler")
    page.close()


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    days = seed(page)
    open_today(page)
    the_row(page)
    scheduler(page, days)
    reschedule(page, days)
    menu(page)
    repeating(page, days)
    comment_button(page)
    page.close()
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the task row and its scheduler held"))
