import json
from playwright.sync_api import Page
from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)
THESIS = "---\nstatus: Doing\n---\n# Thesis\n"
GARDEN = "---\nstatus: To do\n---\n# Garden\n"
INTRO = '---\nproject: "[[Thesis]]"\nhours: 3\n---\n# Intro\n'
DATA = '---\nproject: "[[Thesis]]"\nhours: 5\n---\n# Data\n'
BEDS = '---\nproject: "[[Garden]]"\nhours: 2\n---\n# Beds\n'
BASE = """filters: 'file.inFolder("Projects")'
formulas:
  Tasks: 'file.backlinks.filter(list(value.asFile().properties.project).contains(file))'
  Tasks_count: list(formula.Tasks).length
orden:
  properties:
    status:
      options:
        - { value: To do, tone: '1' }
        - { value: Doing, tone: '5' }
        - { value: Done, tone: '4' }
  buttons:
    Done:
      set: { status: Done }
  automations:
    - when: { property: status, is: Done }
      set: { finished: "{{date}}" }
views:
  - type: table
    name: All
    order: [file.name, note.status, formula.Tasks_count, button.Done]
    orden:
      lines: 2
      freeze: 1
      colour: 'if(status == "Done", "4", null)'
  - type: form
    name: New
    order: [file.name, note.status]
"""
WRITE = """async ([files]) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""
ROW = "(path) => window.tasks.rows.of().find((one) => one.path === path)"
def note(page: Page, path: str) -> dict[str, object]:
    return page.evaluate(f"({ROW})({json.dumps(path)})?.note ?? null")  # type: ignore[no-any-return]
def seed(page: Page) -> None:
    wait_for(page, "window.ordenApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.ordenApp.tasks() }")
    files = [
        ["Projects/Thesis.md", THESIS],
        ["Projects/Garden.md", GARDEN],
        ["Tasks/Intro.md", INTRO],
        ["Tasks/Data.md", DATA],
        ["Tasks/Beds.md", BEDS],
        ["Projects.base", BASE],
    ]
    page.evaluate(WRITE, [files])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.path === 'Tasks/Beds.md')",
        "the seeded rows",
    )
def open_view(page: Page, view: str) -> None:
    page.evaluate(
        """async (view) => {
          const ws = window.ordenApp.workspace
          for (const tab of ws.tabs.filter((one) => one.kind === 'view' && one.path)) await ws.closeAsking(tab.id)
          const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
          window.tasks.openBaseFile(`${root}/Projects.base`, {}, view)
        }""",
        view,
    )
    wait_for(
        page,
        f"document.querySelector('.view-tab .head .tab.on .words')?.textContent.trim() === {json.dumps(view)}",
        f"the {view} view of Projects.base",
    )
    quiet(page)
def cell(page: Page, row: str, column: int) -> str:
    return page.evaluate(  # type: ignore[no-any-return]
        """([row, column]) => {
          const line = [...document.querySelectorAll('.view-tab .line')].find((one) => one.textContent.includes(row))
          return line?.querySelectorAll('.cell')[column]?.textContent.trim() ?? null
        }""",
        [row, column],
    )
def the_rollup(page: Page) -> None:
    open_view(page, "All")
    if not DRIVE.waited(
        page,
        "() => [...document.querySelectorAll('.view-tab .line')].some((one) => one.textContent.includes('Thesis'))",
        "the projects in the table",
    ):
        return
    thesis, garden = cell(page, "Thesis", 2), cell(page, "Garden", 2)
    say(f"[rollup] Thesis {thesis}, Garden {garden}")
    if thesis != "2" or garden != "1":
        wrong(f"the rollup counts {thesis} and {garden} tasks, not 2 and 1")
    if not page.evaluate("!!document.querySelector('.view-tab .table.wraps .head.stuck')"):
        wrong("the table is not two lines tall with its first column frozen")
    shot(page, "01-rollup")
HEAD_WIDTH = "() => Math.round(document.querySelector('.view-tab .heads .head:nth-child(2)')?.getBoundingClientRect().width ?? -1)"
def the_cancelled_resize(page: Page) -> None:
    open_view(page, "All")
    before = page.evaluate(HEAD_WIDTH)
    grip = page.locator(".view-tab .heads .head:nth-child(2) .grip").first.bounding_box()
    if not grip:
        wrong("[cancel] the column has no grip to drag")
        return
    x, y = grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 90, y, steps=6)
    stretched = page.evaluate(HEAD_WIDTH)
    page.evaluate("() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))")
    page.wait_for_timeout(200)
    cancelled = page.evaluate(HEAD_WIDTH)
    page.mouse.move(x + 200, y, steps=6)
    page.mouse.up()
    page.wait_for_timeout(600)
    after = page.evaluate(HEAD_WIDTH)
    say(f"[cancel] the column was {before}, stretched to {stretched}, {cancelled} once cancelled, {after} after the button came up")
    shot(page, "03-resize-cancelled")
    if stretched <= before:
        wrong(f"[cancel] the drag did not stretch the column: {before} -> {stretched}")
    if cancelled != before or after != before:
        wrong(f"[cancel] a cancelled resize was kept: {before} -> {cancelled} -> {after}")
def the_button(page: Page) -> None:
    page.locator(".view-tab .line:has-text('Thesis') .press").click()
    if not DRIVE.waited(
        page,
        "() => window.tasks.rows.of().find((one) => one.path === 'Projects/Thesis.md')?.note.status === 'Done'",
        "the button to write status: Done",
    ):
        return
    if not DRIVE.waited(
        page,
        "() => !!window.tasks.rows.of().find((one) => one.path === 'Projects/Thesis.md')?.note.finished",
        "the automation to write the day it was finished",
    ):
        return
    say(f"[button] {json.dumps(note(page, 'Projects/Thesis.md'), ensure_ascii=False)}")
    if not page.evaluate("!!document.querySelector('.view-tab .line.toned')"):
        wrong("the row that is Done is not in its conditional colour")
    shot(page, "02-button")
    page.locator(".view-tab .line:has-text('Garden') .cell").first.click()
    page.keyboard.press("Control+z")
    if DRIVE.waited(
        page,
        "() => window.tasks.rows.of().find((one) => one.path === 'Projects/Thesis.md')?.note.status === 'Doing'",
        "one Ctrl+Z to take the press back",
    ):
        after = note(page, "Projects/Thesis.md") or {}
        if "finished" in after:
            wrong("the automation's write stayed after the undo: it was not one undo with the press")
        say(f"[undo] {json.dumps(after, ensure_ascii=False)}")
def menu_row(page: Page, label: str) -> None:
    page.locator(f".menu [role=menuitem]:has-text({json.dumps(label)})").first.click()
def more_row(page: Page, label: str) -> None:
    page.locator(".view-tab .head [aria-label=Settings]").first.click()
    page.locator(f".pop[role=dialog] .settings .orden-row:has-text({json.dumps(label)})").first.click()
def the_builders(page: Page) -> None:
    open_view(page, "All")
    page.locator(".view-tab .heads .head:has-text('status')").first.click(button="right")
    menu_row(page, "Options")
    wait_for(page, "document.querySelectorAll('.pop[role=dialog] .tone').length === 3", "the status options")
    shot(page, "05-options")
    page.keyboard.press("Escape")
    for label, name in [("Automations", "06-automations"), ("Colour", "07-colour")]:
        more_row(page, label)
        wait_for(page, "document.querySelector('.pop[role=dialog]')", f"the {label} layer")
        shot(page, name)
        page.keyboard.press("Escape")
        wait_for(page, "!document.querySelector('.pop[role=dialog]')", f"the {label} layer shut")
    page.locator(".view-tab .heads .head:has-text('Tasks_count')").first.click(button="right")
    menu_row(page, "Add a column")
    wait_for(page, "document.querySelector('[role=menu].menu')?.getAttribute('aria-label') === 'Add a column'", "the columns to add")
    quiet(page)
    menu_row(page, "Rollup")
    wait_for(page, "document.querySelector('.pop[role=dialog] .rows')", "the rollup picker")
    shot(page, "08-rollup-picker")
    page.keyboard.press("Escape")
    more_row(page, "Lock view")
    wait_for(page, "document.querySelector('.view-tab .lock')", "the padlock of a locked view")
    page.locator(".view-tab .heads .head:has-text('status') .name").first.click()
    wait_for(page, "document.querySelector('.view-tab .lock.shake')", "the padlock answering a change")
    if page.evaluate("!!document.querySelector('.view-tab .head .arrow')"):
        wrong("a locked view was sorted")
    shot(page, "09-locked")
    page.locator(".view-tab .lock").click()
    wait_for(page, "!document.querySelector('.view-tab .lock')", "the view unlocked")
IN_SIGHT = """() => {
  const pop = document.querySelector('.pop[role=dialog]')
  if (!pop) return null
  const box = pop.getBoundingClientRect()
  const corners = [[box.left + 3, box.top + 3], [box.right - 3, box.top + 3], [box.left + 3, box.bottom - 3], [box.right - 3, box.bottom - 3]]
  return {
    box: [box.left, box.top, box.right, box.bottom].map(Math.round),
    inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    hidden: corners.filter(([x, y]) => !pop.contains(document.elementFromPoint(x, y))).length,
  }
}"""
def the_popovers_in_sight(page: Page) -> None:
    page.set_viewport_size({"width": 700, "height": 560})
    open_view(page, "All")
    labels = page.evaluate("() => [...document.querySelectorAll('.view-tab .head [data-opens-popover]')].map((one) => one.getAttribute('aria-label') ?? one.textContent.trim())")
    if len(labels) < 3:
        wrong(f"[sight] the toolbar has {labels}, not filter, sort and settings")
    for at, label in enumerate(labels):
        page.locator(".view-tab .head [data-opens-popover]").nth(at).click()
        if not DRIVE.waited(page, "document.querySelector('.pop[role=dialog]')", f"the {label} popover"):
            continue
        quiet(page)
        seen = page.evaluate(IN_SIGHT)
        say(f"[sight] {label} at {seen['box']} in {page.viewport_size}, {seen['hidden']} corners covered")
        if not seen["inside"] or seen["hidden"]:
            shot(page, f"12-out-of-sight-{at}")
            wrong(f"[sight] the {label} popover at {seen['box']} is not wholly in the window and on top")
        page.keyboard.press("Escape")
        wait_for(page, "!document.querySelector('.pop[role=dialog]')", f"the {label} popover shut")
    page.set_viewport_size({"width": 1280, "height": 820})
def the_form(page: Page) -> None:
    open_view(page, "New")
    wait_for(page, "document.querySelector('.view-tab form.form')", "the form")
    page.locator(".view-tab form.form .title").fill("Orchard")
    page.locator(".view-tab form.form .field").first.locator("button").click()
    page.locator("[role=listbox] [role=option]:has-text('Doing')").first.click()
    wait_for(page, "!document.querySelector('[role=listbox]')", "the choice made and its list shut")
    shot(page, "10-form-filled")
    page.locator(".view-tab form.form button[type=submit]").click()
    if not DRIVE.waited(
        page,
        "() => window.tasks.rows.of().find((one) => one.path === 'Projects/Orchard.md')?.note.status === 'Doing'",
        "the form to make Projects/Orchard.md with status: Doing",
    ):
        return
    DRIVE.waited(page, "document.querySelector('.view-tab form.form .title')?.value === ''", "the form to empty itself after sending")
    shot(page, "11-form-sent")
def drive(browser) -> None:  # type: ignore[no-untyped-def]
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    page.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-bases']))")
    DRIVE.open(page)
    seed(page)
    the_rollup(page)
    the_cancelled_resize(page)
    the_button(page)
    the_builders(page)
    the_popovers_in_sight(page)
    the_form(page)
    page.close()
raise SystemExit(DRIVE.run(drive, "a rollup counted, a button set a property, a form made a note"))
