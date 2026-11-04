"""A task under each of its labels (#1046), in the built app.

What this drives, against the real rows store and the real files:

  * Display > Grouping > Label on Todos, with a task of two labels: the task stands under
    both, the list and the panel draw, Display still opens, and a reload draws it again.
  * Each layout the choice is carried to draws it: the table, the cards and the board under
    each label, the calendar and the timeline once.
  * Carried out of one label to another, the task swaps that one and keeps the rest, and
    carried to none, it loses that one.
  * The space renamed, the tab goes on showing it, with its layout and no second tab, and
    what was kept for it is under the new name.

    python apps/desktop/test/e2e/todos-labels.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/todos-labels/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NOTE = """# Errands

- [ ] Alpha #a #b 📅 {today}
- [ ] Beta #a
- [ ] Gamma #c
- [ ] Bare
"""

WRITE = """async ([path, text]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TODAY = """() => {
  const at = new Date()
  const two = (v) => String(v).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}"""

TAGS = "() => window.tasks.rows.of().find((one) => one.task?.text.startsWith('Alpha'))?.task.tags ?? null"

# The open tab's view, laid out another way, as its words.
LAID_OUT = """(type) => {
  const tab = window.nibApp.workspace.tabs.find((one) => one.kind === 'view')
  const spec = JSON.parse(tab.doc)
  spec.yaml = spec.yaml.replace(/type: \\w+/, `type: ${type}`)
  tab.note.replace(JSON.stringify(spec), false)
}"""


def handles(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")


def texts(page: Page, selector: str) -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "(selector) => [...document.querySelectorAll(selector)].map((one) => one.textContent.trim())",
        selector,
    )


def display(page: Page, label: str, option: str) -> None:
    page.locator(".view-tab .display-button").first.click()
    wait_for(page, "document.querySelector('.pop .display')", "the Display popover")
    page.locator(f".pop [role=combobox][aria-label='{label}']").click()
    page.locator("[role=listbox] [role=option]", has_text=option).first.click()
    quiet(page)
    page.keyboard.press("Escape")


def under_both(page: Page, where: str) -> None:
    words = texts(page, f"{where} .task .words")
    say(f"[{where}] {json.dumps(words)}")
    if words.count("Alpha") != 2:
        wrong(f"{where} holds Alpha {words.count('Alpha')} times, not under both labels")
    for one in ("Beta", "Gamma", "Bare"):
        if one not in words:
            wrong(f"{where} lost {one}")


def carry(page: Page, source, target) -> None:  # type: ignore[no-untyped-def]
    one = source.bounding_box()
    two = target.bounding_box()
    if not one or not two:
        wrong("nothing to carry")
        return
    x, y = one["x"] + one["width"] / 2, one["y"] + one["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 8, y + 8, steps=3)
    page.mouse.move(two["x"] + two["width"] / 2, two["y"] + two["height"] / 2, steps=12)
    page.mouse.up()
    quiet(page)


def the_grouping(page: Page) -> None:
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .nib-row')", "the Tasks panel")
    page.locator(".tasks .nib-row", has_text="Tasks").first.click(modifiers=["Control"])
    wait_for(page, "document.querySelector('.view-tab .task')", "Todos")
    display(page, "Grouping", "Label")
    wait_for(page, "document.querySelectorAll('.view-tab .head .fold').length >= 3", "the label heads")
    under_both(page, ".view-tab")
    DRIVE.shot(page, "01-under-both")
    # The Display's selects still open, on the list as it now is.
    page.locator(".view-tab .display-button").first.click()
    wait_for(page, "document.querySelector('.pop .display')", "Display once more")
    page.locator(".pop [role=combobox][aria-label='Grouping']").click()
    wait_for(page, "document.querySelector('[role=listbox] [role=option]')", "the select opening")
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    quiet(page)


def after_a_reload(page: Page) -> None:
    page.reload()
    wait_for(page, "window.nibApp?.workspace?.activeSpace", "the app again")
    handles(page)
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.view-tab .task')", "the tab, reloaded")
    wait_for(page, "document.querySelector('.tasks .chosen .task')", "the panel, reloaded")
    under_both(page, ".view-tab")
    under_both(page, ".tasks .chosen")
    DRIVE.shot(page, "02-reloaded")


def carried(page: Page) -> None:
    # The second Alpha is the one under b.
    rows = page.locator(".view-tab [data-item^='row:']:has-text('Alpha')")
    carry(page, rows.nth(1), page.locator(".view-tab .nib-section.head:has-text('c')").first)
    if DRIVE.waited(page, f"() => ({TAGS})()?.join() === 'a,c'", "b swapped for c, a kept"):
        say(f"[carried] {page.evaluate(TAGS)}")
    # Out of a, to no label: c stays.
    rows = page.locator(".view-tab [data-item^='row:']:has-text('Alpha')")
    carry(page, rows.nth(0), page.locator(".view-tab .nib-section.head").last)
    if DRIVE.waited(page, f"() => ({TAGS})()?.join() === 'c'", "a taken off, c kept"):
        say(f"[carried] {page.evaluate(TAGS)}")
    # And back under two, for the layouts.
    page.evaluate(WRITE, ["Errands.md", NOTE.format(today=page.evaluate(TODAY))])
    wait_for(page, f"() => ({TAGS})()?.join() === 'a,b'", "both labels back")
    quiet(page)


def the_layouts(page: Page) -> None:
    for layout, selector, count in (
        ("table", ".view-tab .line:has-text('Alpha')", 2),
        ("cards", ".view-tab .card:has-text('Alpha')", 2),
        ("kanban", ".view-tab .card:has-text('Alpha')", 2),
        ("calendar", ".view-tab :text('Alpha')", 1),
        ("timeline", ".view-tab :text('Alpha')", 1),
    ):
        page.evaluate(LAID_OUT, layout)
        quiet(page)
        drawn = page.locator(selector).count()
        say(f"[{layout}] Alpha drawn {drawn}")
        if drawn < 1 or (layout in ("table", "cards", "kanban") and drawn != count):
            wrong(f"the {layout} draws Alpha {drawn} times, not {count}")
        DRIVE.shot(page, f"03-{layout}")


def renamed(page: Page) -> None:
    page.evaluate(LAID_OUT, "list")
    quiet(page)
    before = len(texts(page, ".view-tab .task .words"))
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          await ws.renameSpace(ws.activeSpace.id, 'Renamed here')
        }"""
    )
    wait_for(page, "window.nibApp.workspace.activeSpace.name.startsWith('Renamed here')", "the new name")
    wait_for(page, "document.querySelector('.view-tab .task')", "the tab's rows under the new name")
    quiet(page)
    spec = page.evaluate(
        "() => JSON.parse(window.nibApp.workspace.tabs.find((one) => one.kind === 'view').doc)"
    )
    name = page.evaluate("window.nibApp.workspace.activeSpace.name")
    after = len(texts(page, ".view-tab .task .words"))
    say(f"[renamed] {spec['space']} {before} -> {after}")
    if spec["space"] != name or name not in spec["yaml"]:
        wrong(f"the tab still asks about {spec['space']!r}: {spec['yaml'][:160]}")
    if after != before:
        wrong(f"the tab shows {after} rows after the rename, not {before}")
    if "task.tags" not in spec["yaml"]:
        wrong("the tab lost its grouping in the rename")
    kept = page.evaluate(
        "(name) => { const all = JSON.parse(localStorage.getItem('nib:todos-views') ?? '{}'); return Object.keys(all) }",
        name,
    )
    say(f"[kept] {kept}")
    if name not in kept or len(kept) != 1:
        wrong(f"what was kept for the space is under {kept}, not {name!r}")
    DRIVE.shot(page, "04-renamed")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    handles(page)
    page.evaluate(WRITE, ["Errands.md", NOTE.format(today=page.evaluate(TODAY))])
    wait_for(page, f"() => ({TAGS})()?.join() === 'a,b'", "the seeded rows")
    the_grouping(page)
    after_a_reload(page)
    carried(page)
    the_layouts(page)
    renamed(page)
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "A task under each of its labels, and a space renamed under it, held"))
