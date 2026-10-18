"""A to-do's date is the day it can be started, and only a deadline is late (#371).

In the built app, in a space of nib's own:

  * A start date still to come keeps a task out of Today and the Inbox, and in Upcoming
    on that day.
  * A start date that has come puts the task in Today and says nothing under it - an
    old `📅` included, which a space of nib's own wrote as its date and reads as a start.
  * Only a deadline past makes a task overdue: it is the one in Today's Overdue, with its
    deadline said under it in the danger tone, and the panel's Today count turns red.
  * A date picked for a task with none is written as `🛫`; one picked for an old `📅`
    moves that `📅` in place.

A vault's `📅`, which is a deadline, is the rows' and the editor's unit tests: the web
app this drives has no `.obsidian` to find.

Run it from the repository root:

    python apps/desktop/test/e2e/task-dates.py
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

DAYS = """() => {
  const day = (n) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const two = (v) => String(v).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }
  return { today: day(0), yesterday: day(-1), tomorrow: day(1), later: day(4) }
}"""

ERRANDS = """# Errands

- [ ] Old date 📅 {yesterday}
- [ ] Not yet 🛫 {later}
- [ ] Late deadline [deadline:: {yesterday}]
- [ ] Begun, due soon [deadline:: {later}] 🛫 {yesterday}
- [ ] Undated
"""

INBOX = """- [ ] Inbox now
- [ ] Inbox later 🛫 {later}
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words)?.task ?? null"


def words_in(page: Page, selector: str = ".view-tab .task .words") -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "(selector) => [...document.querySelectorAll(selector)].map((one) => one.textContent.trim())",
        selector,
    )


def open_builtin(page: Page, name: str) -> None:
    page.evaluate(f"window.tasks.openBuiltin('{name}')")
    wait_for(page, "document.querySelector('.view-tab .list, .view-tab .upcoming')", f"the {name} view")
    quiet(page)


def row(words: str) -> str:
    return f".view-tab .task:has(.words:text-is('{words}'))"


def meta_of(page: Page, words: str) -> list[str]:
    """What a row says under its words: each bit of its meta line, `late` before one in
    the danger tone."""
    return page.evaluate(  # type: ignore[no-any-return]
        """(words) => {
          const task = [...document.querySelectorAll('.view-tab .task')]
            .find((one) => one.querySelector('.words')?.textContent.trim() === words)
          return [...(task?.querySelectorAll('.meta .bit') ?? [])]
            .map((one) => `${one.classList.contains('late') ? 'late ' : ''}${one.textContent.trim()}`)
        }""",
        words,
    )


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(
        WRITE, [[["Errands.md", ERRANDS.format(**days)], ["Inbox.md", INBOX.format(**days)]]]
    )
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Inbox later')",
        "the seeded rows",
    )

    # ── Today ────────────────────────────────────────────────────────
    open_builtin(page, "today")
    today = words_in(page)
    say(f"[today] {json.dumps(today)}")
    for wanted in ("Old date", "Late deadline", "Begun, due soon"):
        if wanted not in today:
            wrong(f"Today does not hold {wanted!r}, whose start date has come")
    for unwanted in ("Not yet", "Undated", "Inbox later"):
        if unwanted in today:
            wrong(f"Today holds {unwanted!r}")
    late = page.evaluate(
        "() => [...document.querySelectorAll('.view-tab .item')].reduce((got, one) => {"
        "  if (one.dataset.item?.startsWith('head:')) got.group = one.dataset.item;"
        "  const words = one.querySelector('.task .words')?.textContent.trim();"
        "  if (words && got.group === 'head:true') got.late.push(words);"
        "  return got }, { group: null, late: [] }).late"
    )
    say(f"[today, overdue] {json.dumps(late)}")
    if late != ["Late deadline"]:
        wrong(f"overdue is {late}, not the one task whose deadline has passed")
    under_old = meta_of(page, "Old date")
    if under_old:
        wrong(f"a start date that has come is still said under the task: {under_old}")
    under_begun = meta_of(page, "Begun, due soon")
    say(f"[under 'Begun, due soon'] {json.dumps(under_begun)}")
    if len(under_begun) != 1 or under_begun[0].startswith("late"):
        wrong(f"under a started task with a deadline to come is {under_begun}, not its deadline")
    under_late = meta_of(page, "Late deadline")
    if not under_late or not under_late[0].startswith("late"):
        wrong(f"a deadline past is not said in the danger tone: {under_late}")
    DRIVE.shot(page, "01-today")

    # ── Upcoming, and the Inbox ──────────────────────────────────────
    open_builtin(page, "upcoming")
    upcoming = words_in(page)
    say(f"[upcoming] {json.dumps(upcoming)}")
    if "Not yet" not in upcoming:
        wrong("Upcoming does not hold a task on the day it starts")
    DRIVE.shot(page, "02-upcoming")

    open_builtin(page, "inbox")
    inbox = words_in(page)
    say(f"[inbox] {json.dumps(inbox)}")
    if "Inbox now" not in inbox or "Inbox later" in inbox:
        wrong(f"the Inbox is {inbox}: a start date to come should keep a task out of it")

    # ── The panel ────────────────────────────────────────────────────
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .nib-row')", "the Tasks panel")
    if not page.evaluate("!!document.querySelector('.tasks .nib-row-meta.late')"):
        wrong("Today's count is not in the danger tone while a deadline has passed")

    # ── A date picked ────────────────────────────────────────────────
    open_builtin(page, "today")
    for words, field in (("Late deadline", "start"), ("Old date", "due")):
        page.locator(row(words)).hover()
        page.locator(f"{row(words)} .act[aria-label='Schedule']").click()
        wait_for(page, "document.querySelector('.scheduler')", "the scheduler")
        page.locator(".scheduler .quick .nib-row", has_text="Tomorrow").click()
        try:
            wait_for(
                page,
                f"() => ({TASK})({json.dumps(words)})?.{field} === '{days['tomorrow']}'",
                f"{words!r} to start tomorrow, written as its {field}",
                10,
            )
            say(f"a date picked for {words!r} is written as its {field}")
        except SystemExit as gave_up:
            wrong(str(gave_up))
        open_builtin(page, "upcoming")
        open_builtin(page, "today")
    late_one = page.evaluate(TASK, "Late deadline") or {}
    if late_one.get("due") is not None:
        wrong("a date picked for a task with a deadline only was written as a 📅")


if __name__ == "__main__":
    raise SystemExit(
        DRIVE.run(drive, "a start date hides a task until it comes, and only a deadline is late")
    )
