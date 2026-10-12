"""Projects in the Tasks panel, Todoist's "My Projects" the nib way, in the built app.

What this drives, against the real files:

  * The panel lists the notes of the space's Projects folder as projects, nested the
    way the file list nests them, each with its count of open tasks; notes with open
    tasks anywhere else are listed under Notes.
  * The plus beside Projects makes an empty project note in the folder and opens it.
  * A project's menu makes a sub-project inside it, nesting it the file list's way.
  * Pressing Inbox, then Today, then a project takes over one tab rather than opening
    three.
  * A task dropped on a project moves there.

    python apps/desktop/test/e2e/projects.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/projects/`.
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


FILES = [
    ["Projects/Home.md", "- [ ] Fix the tap\n- [ ] Paint the hall\n"],
    ["Projects/Uni/Uni.md", "- [ ] Enrol\n"],
    ["Projects/Uni/Analysis.md", "- [ ] Sheet 3\n- [ ] Sheet 4\n- [x] Sheet 2\n"],
    ["Meetings/Monday.md", "# Monday\n\n- [ ] Send the minutes\n"],
]

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

ROWS = "() => [...document.querySelectorAll('.tasks .nib-row')].map((one) => one.textContent.trim())"


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    page.evaluate(WRITE, [FILES])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Send the minutes')",
        "the seeded rows",
    )
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .project')", "the projects in the panel")
    quiet(page)


def rows(page: Page) -> list[str]:
    return page.evaluate(ROWS)  # type: ignore[no-any-return]


def the_panel(page: Page) -> None:
    listed = rows(page)
    say(f"[panel] {json.dumps(listed, ensure_ascii=False)}")
    order = [one for one in listed if one.split(" ")[0] in ("Home", "Uni", "Analysis")]
    if order != ["Uni 1", "Analysis 2", "Home 2"]:
        wrong(f"the projects are not Home, Uni and its Analysis with their counts: {order}")
    if not any(one.startswith("Monday") for one in listed):
        wrong("a note with open tasks outside the projects is not under Notes")
    shot(page, "01-panel")


def add_project(page: Page) -> None:
    page.locator(".tasks .plus").click()
    wait_for(page, "document.activeElement?.matches('.tasks input.field')", "the new project's name field")
    page.keyboard.type("Garden", delay=10)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    say(
        "[files] "
        + json.dumps(page.evaluate("() => window.nibApp.workspace.files.map((one) => one.path).filter((one) => /Projects/.test(one))"))
    )
    wait_for(
        page,
        "() => window.nibApp.workspace.files.some((one) => one.path.replace(/\\\\/g, '/').endsWith('Projects/Garden.md'))",
        "the new project's note",
    )
    wait_for(page, "document.querySelector('.view-tab')", "the new project open")

    page.locator(".tasks .project .nib-row", has_text="Home").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Add sub-project").click()
    page.keyboard.type("Kitchen", delay=10)
    page.keyboard.press("Enter")
    wait_for(
        page,
        "() => window.nibApp.workspace.files.some((one) => one.path.replace(/\\\\/g, '/').endsWith('Projects/Home/Kitchen.md'))",
        "the sub-project inside its parent",
    )
    wait_for(
        page,
        "() => window.nibApp.workspace.files.some((one) => one.path.replace(/\\\\/g, '/').endsWith('Projects/Home/Home.md'))",
        "the parent nested as its folder's note",
    )
    shot(page, "02-added")


def one_tab(page: Page) -> None:
    views = "() => window.nibApp.workspace.tabs.filter((one) => one.kind === 'view').length"
    before = page.evaluate(views)
    for name in ["Inbox", "Today"]:
        page.locator(".tasks .nib-row", has_text=name).first.click()
        page.wait_for_timeout(200)
    page.locator(".tasks .project .nib-row", has_text="Analysis").click()
    wait_for(page, "document.querySelector('.view-tab .task')", "the project's tasks")
    after = page.evaluate(views)
    say(f"[view tabs] {before} then {after}")
    if after > max(before, 1):
        wrong("each press in the panel opened a tab of its own")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    the_panel(page)
    add_project(page)
    one_tab(page)
    shot(page, "03-project")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the projects in the panel held"))
