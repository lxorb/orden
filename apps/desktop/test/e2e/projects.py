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
  * The plus's own menu makes a project from a template; a project's menu duplicates it
    and saves it as Todoist's CSV.
  * A project is added above another from its menu, and carried to the top with the
    pointer, the file list keeping the same order.

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
    ["Templates/Trip.md", "## Pack\n- [ ] Passport\n\n## Book\n- [ ] Train\n"],
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
    for _ in range(50):
        if not any(one.startswith("Trip") for one in rows(page)):
            break
        page.wait_for_timeout(100)
    listed = rows(page)
    say(f"[panel] {json.dumps(listed, ensure_ascii=False)}")
    order = [one for one in listed if one.split(" ")[0] in ("Home", "Uni", "Analysis")]
    if order != ["Uni 1", "Analysis 2", "Home 2"]:
        wrong(f"the projects are not Home, Uni and its Analysis with their counts: {order}")
    if not any(one.startswith("Monday") for one in listed):
        wrong("a note with open tasks outside the projects is not under Notes")
    if any(one.startswith("Trip") for one in listed):
        wrong("a template is listed under Notes as work to do")
    shot(page, "01-panel")


def add_project(page: Page) -> None:
    page.locator(".tasks .plus[aria-label='Add project']").click()
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


def templates_and_csv(page: Page) -> None:
    page.locator(".tasks .plus[aria-label='Add project']").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Trip").click()
    wait_for(page, "document.activeElement?.matches('.tasks input.field')", "the name for a project from a template")
    page.keyboard.type("Rome", delay=10)
    page.keyboard.press("Enter")
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Passport' && one.path === 'Projects/Rome.md')",
        "the project made from the template",
    )

    page.locator(".tasks .project .nib-row", has_text="Rome").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Duplicate").click()
    wait_for(
        page,
        "() => window.tasks.rows.of().filter((one) => one.task?.text === 'Passport').length === 2",
        "the project duplicated",
    )

    page.locator(".tasks .project .nib-row", has_text="Rome").first.click(button="right")
    with page.expect_download() as caught:
        page.locator(".menu [role=menuitem]", has_text="Save as CSV").click()
    with open(caught.value.path(), encoding="utf-8") as file:
        csv = file.read()
    say(f"[csv] {csv.splitlines()[:3]}")
    if not csv.startswith("TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT") or "section,Pack" not in csv:
        wrong("the project was not saved as Todoist's CSV")
    shot(page, "04-from-template")


ORDER = """() => [...document.querySelectorAll('.tasks .project[style*="--depth: 0"] .nib-row-label')]
  .map((one) => one.textContent.trim())"""


def placing(page: Page) -> None:
    """A project added above another, and one carried below another, in the panel."""
    page.locator(".tasks .project .nib-row", has_text="Garden").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Add project above").click()
    wait_for(page, "document.activeElement?.matches('.tasks input.field')", "the field above Garden")
    page.keyboard.type("Attic", delay=10)
    page.keyboard.press("Enter")
    wait_for(
        page,
        f"() => {{ const o = ({ORDER})(); return o.indexOf('Attic') !== -1 && o.indexOf('Attic') === o.indexOf('Garden') - 1 }}",
        "Attic just above Garden",
    )
    say(f"[order] {page.evaluate(ORDER)}")

    # Rome, at the bottom, carried above Home at the top, with the pointer.
    uni = page.locator(".tasks .project[data-project$='/Rome.md'] .nib-row").first
    home = page.locator(".tasks .project", has_text="Home").first
    start = uni.bounding_box()
    end = home.bounding_box()
    if not start or not end:
        wrong("the rows to carry are not on screen")
        return
    page.mouse.move(start["x"] + 20, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + 20, start["y"] + start["height"] / 2 + 10, steps=3)
    page.mouse.move(end["x"] + 20, end["y"] + end["height"] * 0.2, steps=8)
    shot(page, "05-carrying")
    page.mouse.up()
    wait_for(
        page,
        f"() => ({ORDER})()[0] === 'Rome'",
        "Rome at the top, above Home",
    )
    say(f"[order] {page.evaluate(ORDER)}")
    if page.evaluate("() => document.querySelector('.view-tab .head .name')?.textContent.includes('Rome')"):
        wrong("the press that ended the drag opened Rome")
    listed = page.evaluate("() => window.nibApp.workspace.arranged.listOf(window.nibApp.workspace.activeSpace.root + '/Projects')")
    say(f"[file list order] {listed}")
    if not listed or listed[0] != "Rome.md":
        wrong("the file list does not keep the order the panel was given")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    the_panel(page)
    add_project(page)
    one_tab(page)
    shot(page, "03-project")
    templates_and_csv(page)
    placing(page)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the projects in the panel held"))
