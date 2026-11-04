"""Todos: one view of a space's tasks with Todoist's Display over it (#1046), in the built app.

What this drives, against the real rows store and the real files:

  * The Tasks panel has one row for the space's tasks; pressing it opens Todos, grouped
    by when each task is due - Overdue, Today, Tomorrow, Later, No date - with a task
    waiting for its start date and a done one left out.
  * Display says how many of its settings differ from the view as it came; Completed
    tasks brings the done one back and counts one.
  * Grouping by priority and the Board layout make GitHub's columns: a status circle, the
    name and a count badge. A card carried from one column to another writes its priority.
  * Closed and opened again from the panel, Todos comes back as it was left in the space.
  * Reset all puts it back as it came.
  * At phone width Display is a sheet, and a swipe across the board turns to the next
    column.

    python apps/desktop/test/e2e/todos.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/todos/`.
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
  return { yesterday: day(-1), today: day(0), tomorrow: day(1), far: day(20), soon: day(3) }
}"""

ERRANDS = """# Errands

- [ ] Renew passport [deadline:: {yesterday}] 🔺
- [ ] Call the bank #admin [deadline:: {today}] ⏫
- [ ] Water the plants #home [deadline:: {tomorrow}]
- [ ] Book the trip [deadline:: {far}]
- [ ] Read a book
- [ ] Not yet 🛫 {soon}
- [x] Bread ✅ {yesterday}
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words)?.task ?? null"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(WRITE, [[["Errands.md", ERRANDS.format(**days)]]])
    wait_for(page, f"() => !!({TASK})('Read a book')", "the seeded rows")


def texts(page: Page, selector: str) -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "(selector) => [...document.querySelectorAll(selector)].map((one) => one.textContent.trim())",
        selector,
    )


def open_from_panel(page: Page) -> None:
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .nib-row')", "the Tasks panel")
    page.locator(".tasks .nib-row", has_text="Tasks").first.click()
    wait_for(page, "document.querySelector('.view-tab .task, .view-tab .card')", "Todos")
    quiet(page)


def display_label(page: Page) -> str:
    return page.locator(".view-tab .display-button").first.get_attribute("aria-label") or ""


def choose(page: Page, label: str, option: str) -> None:
    page.locator(f".pop [role=combobox][aria-label='{label}']").click()
    page.locator("[role=listbox] [role=option]", has_text=option).first.click()
    quiet(page)


def carry(page: Page, source: str, target: str) -> None:
    one = page.locator(source).first.bounding_box()
    two = page.locator(target).first.bounding_box()
    if not one or not two:
        wrong(f"nothing to carry from {source} to {target}")
        return
    page.mouse.move(one["x"] + one["width"] / 2, one["y"] + one["height"] / 2)
    page.mouse.down()
    page.mouse.move(one["x"] + one["width"] / 2 + 8, one["y"] + one["height"] / 2 + 8, steps=3)
    page.mouse.move(two["x"] + two["width"] / 2, two["y"] + min(60, two["height"] / 2), steps=12)
    page.mouse.up()


def the_one_view(page: Page) -> None:
    open_from_panel(page)
    rows = texts(page, ".tasks .nib-row")
    say(f"[panel] {json.dumps(rows, ensure_ascii=False)}")
    for gone in ("Inbox", "Upcoming", "Completed"):
        if any(one.startswith(gone) for one in rows):
            wrong(f"the panel still has {gone}")
    heads = texts(page, ".view-tab .head .fold")
    say(f"[groups] {json.dumps(heads, ensure_ascii=False)}")
    wanted = ["Overdue", "Today", "Tomorrow", "Later", "No date"]
    if [one.split()[0] if one.split()[0] != "No" else "No date" for one in heads] != wanted:
        wrong(f"Todos is grouped {heads}, not {wanted}")
    words = texts(page, ".view-tab .task .words")
    for unwanted in ("Not yet", "Bread"):
        if unwanted in words:
            wrong(f"Todos holds {unwanted!r}")
    if display_label(page) != "Display":
        wrong(f"Display says {display_label(page)!r} on the view as it came")
    shot(page, "01-todos")


def the_display(page: Page) -> None:
    page.locator(".view-tab .display-button").first.click()
    wait_for(page, "document.querySelector('.pop .display')", "the Display popover")
    shot(page, "02-display")
    page.locator(".pop .nib-setting[role=switch]").first.click()
    wait_for(
        page,
        "[...document.querySelectorAll('.view-tab .task .words')].some((one) => one.textContent.trim() === 'Bread')",
        "Completed tasks bringing Bread back",
    )
    if display_label(page) != "Display: 1":
        wrong(f"Display says {display_label(page)!r} with Completed tasks on")
    choose(page, "Grouping", "Priority")
    page.locator(".pop .nib-segmented [role=radio]", has_text="Board").click()
    wait_for(page, "document.querySelector('.view-tab .column .head.circled .circle')", "the board's heads")
    page.keyboard.press("Escape")
    label = display_label(page)
    say(f"[display] {label}")
    if label != "Display: 3":
        wrong(f"Display says {label!r} with three settings changed")
    columns = texts(page, ".view-tab .column .head .name")
    badges = texts(page, ".view-tab .column .head .count.badge")
    say(f"[columns] {columns} {badges}")
    if len(columns) < 3 or len(badges) != len(columns):
        wrong("the board's columns have no names or no count badges")
    shot(page, "03-board")
    # From the column of no priority to the first one: priority 1.
    carry(
        page,
        ".view-tab .card:has-text('Read a book')",
        ".view-tab .column:has(.head .name:text-is('p1'))",
    )
    if DRIVE.waited(page, f"() => ({TASK})('Read a book')?.priority === 1", "the card carried to p1"):
        shot(page, "04-carried")
    # A card is its words and its meta, nothing under them.
    gap = page.evaluate(
        "(() => { const card = document.querySelector('.view-tab .card'); const face = card?.querySelector('.face');"
        " const meta = face?.querySelector('.line.meta') ?? face?.querySelector('.title');"
        " return card && meta ? card.getBoundingClientRect().bottom - meta.getBoundingClientRect().bottom : 99 })()"
    )
    say(f"[card room under the meta] {gap:.0f}px")
    if gap > 14:
        wrong(f"a task's card leaves {gap:.0f}px empty under its meta line")


def kept(page: Page) -> None:
    page.evaluate(
        "(() => { const ws = window.nibApp.workspace; const tab = ws.tabs.find((one) => one.kind === 'view'); if (tab) ws.close(tab.id) })()"
    )
    wait_for(page, "!document.querySelector('.view-tab')", "Todos closed")
    open_from_panel(page)
    wait_for(page, "document.querySelector('.view-tab .column .head.circled')", "Todos back as a board")
    if display_label(page) != "Display: 3":
        wrong(f"Todos opened again says {display_label(page)!r}")
    page.locator(".view-tab .display-button").first.click()
    wait_for(page, "document.querySelector('.pop .display')", "the Display popover")
    page.locator(".pop .reset").click()
    wait_for(page, "document.querySelector('.view-tab .task')", "Todos as a list again")
    page.keyboard.press("Escape")
    if display_label(page) != "Display":
        wrong(f"Reset all left Display saying {display_label(page)!r}")
    shot(page, "05-reset")


def at_phone_width(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    DRIVE.open(page)
    seed(page)
    page.evaluate("window.tasks.openTodos()")
    wait_for(page, "document.querySelector('.view-tab .task')", "Todos at phone width")
    page.locator(".view-tab .display-button").first.click()
    wait_for(page, "document.querySelector('.sheet .display, [role=dialog] .display')", "Display as a sheet")
    if page.evaluate("!!document.querySelector('.pop .display')"):
        wrong("Display is a popover at phone width, not a sheet")
    shot(page, "06-phone-display")
    page.locator("[role=dialog] .nib-segmented [role=radio]", has_text="Board").click()
    page.keyboard.press("Escape")
    wait_for(page, "document.querySelector('.view-tab .strip .switch')", "the board's pages")
    first = texts(page, ".view-tab .strip .switch[aria-selected=true]")
    box = page.locator(".view-tab .one").first.bounding_box()
    if box:
        y = box["y"] + 120
        page.evaluate(
            """([x0, x1, y]) => {
              const one = document.querySelector('.view-tab .one')
              const at = (type, x) => one.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y }))
              at('pointerdown', x0); at('pointerup', x1)
            }""",
            [box["x"] + box["width"] - 30, box["x"] + 30, y],
        )
    quiet(page)
    second = texts(page, ".view-tab .strip .switch[aria-selected=true]")
    say(f"[phone pages] {first} -> {second}")
    if first == second:
        wrong("a swipe across the phone's board did not turn to the next column")
    shot(page, "07-phone-board")
    page.close()


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    seed(page)
    the_one_view(page)
    the_display(page)
    kept(page)
    page.close()
    at_phone_width(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Todos, its Display, its board and its phone pages held"))
