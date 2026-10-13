"""A project's head and its sections, Todoist's way, in the built app.

What this drives, against the real rows store and the real files:

  * A project's view says what its note says about it under the head, and its note's
    title is no section: the tasks under it have no head.
  * Add section at the end of the list writes a heading; a section's menu renames it,
    moves it down and deletes it with its tasks (asked first), and one undo brings it
    back.
  * A folded section is still folded when the project is opened again.
  * As a board, a project's columns are its sections, with Add section at the end, and
    the project opens as a board again the next time.
  * Renamed from its head, the project's note is renamed and the open view follows it.

    python apps/desktop/test/e2e/sections.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/sections/`.
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


HOME = """# Home
The flat, and the garden.

- [ ] Loose ends

## Kitchen
- [ ] Fix the tap

## Garden
- [ ] Mow the lawn
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

READ = """async (name) => {
  const ws = window.nibApp.workspace
  const found = ws.notes.find((one) => one.name === name)
  return found ? await ws.noteText(found.path) : null
}"""

OPEN = """([path, layout]) => window.tasks.openProject(
  window.nibApp.workspace.activeSpace.name, path, layout ?? undefined)"""


def note(page: Page, name: str = "Home.md") -> str:
    return page.evaluate(READ, name) or ""


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    page.evaluate(WRITE, [[["Projects/Home.md", HOME]]])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Mow the lawn')",
        "the seeded project",
    )


def open_home(page: Page, layout: str | None = None) -> None:
    page.evaluate(OPEN, ["Projects/Home.md", layout])
    wait_for(page, "document.querySelector('.view-tab .task, .view-tab .card')", "the project")
    quiet(page)


def head_and_about(page: Page) -> None:
    open_home(page)
    about = page.locator(".view-tab .about").inner_text()
    say(f"[about] {about}")
    if about != "The flat, and the garden.":
        wrong(f"the project says {about!r} about itself")
    names = [one.lower() for one in page.locator(".view-tab .head .fold").all_inner_texts()]
    say(f"[heads] {names}")
    if any("home" in one for one in names):
        wrong("the note's title is drawn as a section")
    if not any("kitchen" in one for one in names):
        wrong("the Kitchen section has no head")
    shot(page, "01-project")


def sections(page: Page) -> None:
    page.locator(".view-tab .add-section").click()
    page.keyboard.type("Attic", delay=10)
    page.keyboard.press("Enter")
    wait_for(page, f"async () => (await ({READ})('Home.md'))?.includes('## Attic')", "Attic written")
    wait_for(
        page,
        "() => [...document.querySelectorAll('.view-tab .head .fold')].some((one) => one.textContent.includes('Attic'))",
        "the empty section drawn",
    )

    page.locator(".view-tab .head .fold", has_text="Kitchen").click(button="right")
    wait_for(page, "document.querySelector('.menu [role=menuitem]')", "the section's menu")
    shot(page, "02-section-menu")
    page.locator(".menu [role=menuitem]", has_text="Rename").click()
    wait_for(page, "document.activeElement?.matches('.view-tab .head .naming')", "the head's field")
    page.keyboard.press("Control+a")
    page.keyboard.type("Galley", delay=10)
    page.keyboard.press("Enter")
    wait_for(page, f"async () => (await ({READ})('Home.md'))?.includes('## Galley')", "Galley written")
    if "## Kitchen" in note(page):
        wrong(f"the old name stayed: {note(page)!r}")

    page.locator(".view-tab .head .fold", has_text="Galley").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Move down").click()
    wait_for(
        page,
        f"async () => {{ const t = await ({READ})('Home.md'); return t.indexOf('## Garden') < t.indexOf('## Galley') }}",
        "Galley below Garden",
    )

    page.locator(".view-tab .head .fold", has_text="Garden").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Delete").click()
    wait_for(page, "document.querySelector('.prompt, [role=alertdialog], [role=dialog]')", "the question")
    shot(page, "03-delete-asked")
    page.locator("[role=dialog] button, [role=alertdialog] button", has_text="Delete").last.click()
    wait_for(
        page,
        f"async () => !(await ({READ})('Home.md'))?.includes('Mow the lawn')",
        "Garden deleted with its task",
    )
    page.locator(".view-tab .task").first.focus()
    page.keyboard.press("Control+z")
    wait_for(
        page,
        f"async () => (await ({READ})('Home.md'))?.includes('## Garden\\n- [ ] Mow the lawn')",
        "one undo bringing Garden back",
    )
    say(f"[note] {note(page)!r}")


def folds(page: Page) -> None:
    page.locator(".view-tab .head .fold", has_text="Galley").click()
    wait_for(page, "!document.querySelector('.view-tab .task:has(.words)') || ![...document.querySelectorAll('.view-tab .task .words')].some((one) => one.textContent.trim() === 'Fix the tap')", "Galley folded")
    page.evaluate("() => { const ws = window.nibApp.workspace; ws.close(ws.activeTabId) }")
    open_home(page)
    folded = page.evaluate(
        "() => document.querySelector('.view-tab .head .fold[aria-expanded=false]')?.textContent ?? ''"
    )
    say(f"[folded] {folded!r}")
    if "Galley" not in folded:
        wrong("the folded section opened again")
    page.locator(".view-tab .head .fold", has_text="Galley").click()


def board(page: Page) -> None:
    open_home(page, "kanban")
    wait_for(page, "document.querySelector('.view-tab .board .column')", "the board")
    names = [one.lower() for one in page.locator(".view-tab .board .column .head .name").all_inner_texts()]
    say(f"[columns] {names}")
    if "home" in names or not {"galley", "garden", "attic"} <= set(names):
        wrong("the board's columns are not the project's sections")
    if not page.locator(".view-tab .add-column").count():
        wrong("the board has no Add section")
    shot(page, "04-board")

    # The Attic's column carried by its head to before Garden's: its section moves up the note.
    attic = page.locator(".view-tab .board .column[data-section='Attic'] .head").bounding_box()
    garden = page.locator(".view-tab .board .column[data-section='Garden']").bounding_box()
    if not attic or not garden:
        wrong("the columns to carry are not on screen")
    else:
        page.mouse.move(attic["x"] + 30, attic["y"] + attic["height"] / 2)
        page.mouse.down()
        page.mouse.move(attic["x"] + 40, attic["y"] + attic["height"] / 2, steps=3)
        page.mouse.move(garden["x"] + 20, garden["y"] + 60, steps=10)
        shot(page, "04b-carrying-column")
        page.mouse.up()
        wait_for(
            page,
            f"async () => {{ const t = await ({READ})('Home.md'); return t.indexOf('## Attic') < t.indexOf('## Garden') }}",
            "Attic's section before Garden's in the note",
        )
        names = [one.lower() for one in page.locator(".view-tab .board .column .head .name").all_inner_texts()]
        say(f"[columns after] {names}")
    page.evaluate("() => { const ws = window.nibApp.workspace; ws.close(ws.activeTabId) }")
    open_home(page)
    if not page.locator(".view-tab .board").count():
        wrong("the project did not open as the board it was left as")
    page.evaluate(OPEN, ["Projects/Home.md", "list"])
    wait_for(page, "document.querySelector('.view-tab .list')", "the list again")


def rename(page: Page) -> None:
    page.locator(".view-tab .name").first.click()
    page.locator(".menu [role=menuitem]", has_text="Rename").first.click()
    wait_for(page, "document.activeElement?.matches('.view-tab .rename')", "the name's field")
    page.keyboard.press("Control+a")
    page.keyboard.type("House", delay=10)
    page.keyboard.press("Enter")
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Fix the tap' && one.path === 'Projects/House.md')",
        "the note renamed",
    )
    wait_for(
        page,
        "() => [...document.querySelectorAll('.view-tab .task .words')].some((one) => one.textContent.trim() === 'Fix the tap')",
        "the open view following the note",
    )
    wait_for(page, f"async () => (await ({READ})('House.md'))?.startsWith('# House')", "the title renamed")
    wait_for(page, "document.querySelector('.view-tab .about')?.textContent === 'The flat, and the garden.'", "the about line")
    wait_for(
        page,
        "() => [...document.querySelectorAll('.view-tab .head .fold')].some((one) => one.textContent.includes('Attic'))",
        "the sections of the renamed note",
    )
    shot(page, "05-renamed")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    head_and_about(page)
    sections(page)
    folds(page)
    board(page)
    rename(page)
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the project's head and its sections held"))
