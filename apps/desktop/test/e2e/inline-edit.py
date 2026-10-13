"""Todoist's inline editor, in the built app: adding where Add task is pressed, and
changing a task in its own field.

What this drives, against the real files:

  * Add task at the end of a project's section opens quick add's field there, and what
    is typed lands under that section's heading, read for its fields; the field stays
    up for the next.
  * Several lines pasted ask whether they are one task or one each; one each writes them
    all.
  * The pencil, and Ctrl+E, change a task in its own field: new words and a day are
    written to its line, as one edit.

    python apps/desktop/test/e2e/inline-edit.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/inline-edit/`.
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


HOME = """- [ ] Fix the tap

## Garden
- [ ] Mow the lawn
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words) ?? null"


def found(page: Page, words: str) -> dict[str, object] | None:
    return page.evaluate(TASK, words)  # type: ignore[no-any-return]


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    page.evaluate(WRITE, [[["Projects/Home.md", HOME]]])
    wait_for(page, f"() => !!({TASK})('Mow the lawn')", "the seeded rows")
    page.evaluate("window.tasks.openProject(window.nibApp.workspace.activeSpace.name, 'Projects/Home.md')")
    wait_for(page, "document.querySelector('.view-tab .task')", "the project's tasks")
    quiet(page)


def add_in_place(page: Page) -> None:
    adders = page.locator(".view-tab .add-row .adder")
    adders.last.click()
    wait_for(page, "document.activeElement?.matches('.view-tab .editor .quick input.field')", "the field in place")
    page.keyboard.type("Plant tulips tomorrow p2", delay=10)
    page.keyboard.press("Enter")
    wait_for(page, f"() => !!({TASK})('Plant tulips')", "the task in the note")
    tulips = found(page, "Plant tulips") or {}
    task = tulips.get("task") or {}
    if isinstance(task, dict):
        if task.get("section") != ["Garden"]:
            wrong(f"the task did not land under its section: {task.get('section')}")
        if task.get("priority") != 2 or not task.get("due"):
            wrong("the words were not read for their priority and day")
    if not page.locator(".view-tab .editor").count():
        wrong("the field went away after a task was added")
    shot(page, "01-added")

    # Several lines pasted at once.
    page.evaluate(
        """() => {
          const field = document.querySelector('.view-tab .editor .quick input.field')
          const data = new DataTransfer()
          data.setData('text/plain', '- Rake leaves\\n- Water roses\\n- Buy seeds')
          field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        }"""
    )
    wait_for(page, "document.querySelector('.view-tab .editor .pasted')", "the question about the lines")
    shot(page, "02-pasted")
    page.locator(".view-tab .editor .pasted .add").click()
    wait_for(
        page,
        f"() => ['Rake leaves', 'Water roses', 'Buy seeds'].every((words) => !!({TASK})(words))",
        "one task a line",
    )
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.view-tab .editor')", "the field put away")


def edit_in_place(page: Page) -> None:
    tap = ".view-tab .task:has(.words:text-is('Fix the tap'))"
    page.locator(tap).hover()
    page.locator(f"{tap} .act[aria-label='Edit']").click()
    wait_for(page, "document.activeElement?.matches('.view-tab .editor .quick input.field')", "the task's own field")
    value = page.locator(".view-tab .editor .quick input.field").input_value()
    if value != "Fix the tap":
        wrong(f"the field does not hold the task's words: {value!r}")
    page.keyboard.press("Control+a")
    page.keyboard.type("Fix the kitchen tap friday", delay=10)
    shot(page, "03-editing")
    page.keyboard.press("Enter")
    wait_for(page, f"() => !!({TASK})('Fix the kitchen tap')", "the new words written")
    task = (found(page, "Fix the kitchen tap") or {}).get("task") or {}
    if isinstance(task, dict) and not task.get("due"):
        wrong("the day typed into the field was not written")
    wait_for(page, "!document.querySelector('.view-tab .editor')", "the field put away after saving")

    # Ctrl+E on the row the keyboard is on.
    lawn = ".view-tab .task:has(.words:text-is('Mow the lawn'))"
    page.locator(lawn).focus()
    page.keyboard.press("Control+e")
    wait_for(page, "document.activeElement?.matches('.view-tab .editor .quick input.field')", "Ctrl+E's field")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.view-tab .editor')", "Escape putting it away")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    add_in_place(page)
    edit_in_place(page)
    shot(page, "04-done")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the inline editor held"))
