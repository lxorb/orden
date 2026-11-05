"""Todos is one list of every space (#1153), in the built app.

What this drives, against the real rows store and the real files:

  * Two spaces, each with a task in a note. The Tasks panel on the right lists both from
    either space, and a switch leaves the list as it was.
  * A task from the panel's add row lands in the reader's one inbox, the first space's,
    while the other space is open.
  * A task of the first space, ticked in the panel while the second is open, is ticked in
    its own note; opened from its place, it is shown in its own space.

    python apps/desktop/test/e2e/global-todos.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/global-todos/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

ARRANGE = """async () => {
  const ws = window.nibApp.workspace
  const notes = ws.activeSpace
  const write = (root, path, text) => window.tasks.writeFile(`${root.replace(/[\\\\/]+$/, '')}/${path}`, text)
  await write(notes.root, 'Errands.md', '# Errands\\n\\n- [ ] Call the bank\\n')
  const home = await ws.addSpace('Home')
  await write(home.root, 'Garden.md', '# Garden\\n\\n- [ ] Water the plants\\n')
  await ws.showSpace(home.id)
  await ws.loadTree()
  return { notes: notes.id, home: home.id, first: notes.name, firstRoot: notes.root }
}"""

LISTED = "() => [...document.querySelectorAll('.tasks .chosen .task .words')].map((one) => one.textContent.trim()).sort()"


def listed(page: Page) -> list[str]:
    return page.evaluate(LISTED)  # type: ignore[no-any-return]


def both(page: Page, where: str, more: list[str] | None = None) -> None:
    wanted = sorted(["Call the bank", "Water the plants", *(more or [])])
    DRIVE.waited(page, f"() => JSON.stringify(({LISTED})()) === {json.dumps(json.dumps(wanted, separators=(',', ':')))}", f"both spaces' tasks {where}")
    quiet(page)
    words = listed(page)
    say(f"[{where}] {json.dumps(words)}")
    if words != wanted:
        wrong(f"the panel lists {words} {where}, not {wanted}")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    ids = page.evaluate(ARRANGE)
    wait_for(
        page,
        "() => ['Call the bank', 'Water the plants'].every((text) => window.tasks.rows.of().some((one) => one.task?.text === text))",
        "both spaces' rows",
    )
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .chosen .task')", "the list in the panel")
    both(page, "from Home")
    DRIVE.shot(page, "01-from-home")

    page.evaluate(f"() => window.nibApp.workspace.showSpace({json.dumps(ids['notes'])})")
    wait_for(page, f"() => window.nibApp.workspace.activeSpace?.id === {json.dumps(ids['notes'])}", "the first space")
    both(page, f"from {ids['first']}")
    page.evaluate(f"() => window.nibApp.workspace.showSpace({json.dumps(ids['home'])})")
    wait_for(page, f"() => window.nibApp.workspace.activeSpace?.id === {json.dumps(ids['home'])}", "Home again")
    both(page, "from Home again")

    page.locator(".tasks > .nib-row.adder").click()
    field = ".sheet .quick input.field"
    if DRIVE.waited(page, f"!!document.querySelector('{field}')", "quick add from the panel"):
        page.keyboard.type("Pay the rent", delay=15)
        page.keyboard.press("Enter")
        page.keyboard.press("Escape")
    DRIVE.waited(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Pay the rent')",
        "the new task's row",
    )
    landed = page.evaluate(
        "() => window.tasks.rows.of().filter((one) => one.task?.text === 'Pay the rent').map((one) => `${one.space}/${one.path}`)"
    )
    say(f"[added] {landed}")
    if landed != [f"{ids['first']}/.Inbox.md"]:
        wrong(f"the task from the panel landed in {landed}, not the first space's inbox")
    both(page, "after the add", ["Pay the rent"])
    DRIVE.shot(page, "02-added")

    card = page.locator(".tasks .chosen .task:has(.words:text-is('Call the bank'))")
    card.locator(".box[role=checkbox]").first.click()
    root = ids["firstRoot"].rstrip("/\\")
    DRIVE.waited(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Call the bank' && one.task.done)",
        "the first space's task ticked from Home",
    )
    text = page.evaluate(f"async () => await window.nibApp.workspace.noteText({json.dumps(root + '/Errands.md')})")
    say(f"[ticked] {text!r}")
    if "- [x] Call the bank" not in (text or ""):
        wrong("ticking the first space's task from Home did not write its note")
    if page.evaluate("() => window.nibApp.workspace.activeSpace?.name") != "Home":
        wrong("ticking a task of another space switched the space")
    DRIVE.shot(page, "03-ticked")

    page.locator(".tasks .chosen .task:has(.words:text-is('Pay the rent')) button.where").click()
    DRIVE.waited(
        page,
        f"() => window.nibApp.workspace.activeSpace?.name === {json.dumps(ids['first'])}",
        "the task's own space, opened from its place",
    )
    DRIVE.waited(
        page,
        "() => window.nibApp.workspace.tabs.some((one) => /Inbox/.test(one.path ?? ''))",
        "the task's inbox open",
    )
    say(f"[opened] {page.evaluate('() => window.nibApp.workspace.activeSpace?.name')}")
    after = listed(page)
    say(f"[after opening it] {json.dumps(after)}")
    if after != ["Pay the rent", "Water the plants"]:
        wrong(f"the panel lists {after} after opening the task, not the same list as before")
    DRIVE.shot(page, "04-opened")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Todos is one list of every space"))
