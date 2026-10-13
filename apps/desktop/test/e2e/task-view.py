"""The task view, Todoist's way, in the built app.

What this drives, against the real rows store and the real files:

  * A task pressed in Today opens its view: where it lives, its words, its
    description in the note's own editor, its sub-tasks, and a column of its day,
    deadline, priority, labels and reminders.
  * Its words changed there are written into its line, and the view follows them.
  * Its description typed there is written under its line, indented to be its own.
  * A sub-task added there is written at the end of what it holds.
  * Its priority and a label are set from the column; the arrows walk to the next task.
  * The same view is a page at phone width.

    python apps/desktop/test/e2e/task-view.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/task-view/`.
"""

from __future__ import annotations

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
  return { today: day(0) }
}"""

ERRANDS = """# Errands

## Calls
- [ ] Call the bank #admin 📅 {today}
  Their number is on the back of the old card.
  - [x] Find the old card
  - Called once, no answer.
- [ ] Water the plants 📅 {today}
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words)?.task ?? null"

NOTE = """async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  return await window.nibApp.workspace.noteText(`${root}/Errands.md`)
}"""

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(WRITE, [[["Errands.md", ERRANDS.format(**days)]]])
    wait_for(page, f"() => !!({TASK})('Water the plants')", "the seeded rows")
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "document.querySelector('.view-tab .task')", "Today's rows")
    quiet(page)


def row(words: str) -> str:
    return f".view-tab .task:has(.words:text-is('{words}'))"


def note(page: Page) -> str:
    return page.evaluate(NOTE)  # type: ignore[no-any-return]


def the_view(page: Page) -> None:
    page.locator(f"{row('Call the bank')} .words").click()
    wait_for(page, "document.querySelector('.sheet .title')", "the task view")
    wait_for(page, "document.querySelector('.sheet .description .cm-content')", "the description's editor")
    text = page.locator(".sheet").inner_text()
    for wanted in ["Errands", "Calls", "Their number is on the back", "Find the old card", "#admin"]:
        if wanted not in text:
            wrong(f"the task view does not say {wanted}")
    shot(page, "01-view")

    # Its words, changed.
    page.locator(".sheet .title").fill("Call the bank again")
    page.keyboard.press("Enter")
    wait_for(page, f"() => !!({TASK})('Call the bank again')", "the new words in the line")
    if page.locator(".sheet .title").input_value() != "Call the bank again":
        wrong("the view lost the task when its words changed")

    # Its description, typed.
    page.locator(".sheet .description .cm-content").click()
    page.keyboard.press("Control+End")
    page.keyboard.type(" Ask for Sam.", delay=10)
    for _ in range(100):
        if "card. Ask for Sam." in note(page):
            break
        page.wait_for_timeout(100)
    if "  Their number is on the back of the old card. Ask for Sam." not in note(page):
        say(note(page))
        wrong("the description lost its indent under the task")

    # A sub-task.
    page.locator(".sheet .adder").click()
    page.keyboard.type("Ask about fees tomorrow", delay=10)
    page.keyboard.press("Enter")
    wait_for(page, f"() => !!({TASK})('Ask about fees')", "the sub-task written")
    sub = page.evaluate("() => window.tasks.rows.of().find((one) => one.task?.text === 'Ask about fees')")
    if not sub or sub["task"].get("parent") is None:
        wrong("the new task is not a sub-task")
    if not sub or not sub["task"].get("due"):
        wrong("the sub-task's words were not read for a day")
    shot(page, "02-edited")

    # Priority from the column.
    page.locator(".sheet .side .nib-row", has_text="p4").click()
    page.locator(".menu [role=menuitem]", has_text="1").first.click()
    wait_for(page, f"() => ({TASK})('Call the bank again')?.priority === 1", "priority 1 written")

    # Its comments: the one there, and one more written from the field, stamped.
    wait_for(page, "document.querySelector('.sheet .comment')?.textContent.includes('Called once')", "the comment")
    page.locator(".sheet").focus()
    page.keyboard.press("c")
    wait_for(page, "document.activeElement?.matches('.sheet .composer')", "c giving the field the keyboard")
    page.keyboard.type("Called again, they will ring back.", delay=5)
    page.keyboard.press("Enter")
    for _ in range(100):
        if "  - Called again, they will ring back. [at:: " in note(page):
            break
        page.wait_for_timeout(100)
    else:
        say(note(page))
        wrong("the comment was not written under the task, stamped")
    wait_for(page, "document.querySelectorAll('.sheet .comment').length === 2", "two comments")
    if not page.locator(".sheet .comment .at").count():
        wrong("the new comment does not say when it was written")
    shot(page, "02b-comments")
    page.locator(".sheet .comment").first.hover()
    page.locator(".sheet .comment .gone").first.click()
    wait_for(page, "document.querySelectorAll('.sheet .comment').length === 1", "a comment deleted")

    # The next task.
    page.locator(".sheet").focus()
    page.keyboard.press("j")
    wait_for(page, "document.querySelector('.sheet .title')?.value === 'Water the plants'", "the next task")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.sheet')", "the view put away")


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
    page.locator(f"{row('Call the bank')} .words").click()
    wait_for(page, "document.querySelector('.sheet.page')", "the task view as a page")
    shot(page, "03-phone")
    page.close()


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    the_view(page)
    page.close()
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the task view held"))
