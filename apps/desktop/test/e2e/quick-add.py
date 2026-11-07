from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for, shot = DRIVE.say, DRIVE.wrong, DRIVE.wait_for, DRIVE.shot

FIELD = ".sheet .quick input.field"
CHIPS = "() => [...document.querySelectorAll('.sheet .quick [data-chip]')].map((one) => one.textContent)"

def chips(page: Page) -> list[str]:
    return page.evaluate(CHIPS)  # type: ignore[no-any-return]

def typed(page: Page, words: str) -> None:
    page.locator(FIELD).fill("")
    page.keyboard.type(words, delay=15)
    page.wait_for_timeout(150)

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n\n## Today\n\n## Later\n")
    page.evaluate(
        "async () => (await window.nibApp.tasks()).makeList(window.nibApp.workspace.notes.find((one) => one.name === 'Plan.md').path)"
    )
    DRIVE.open_note(page, "Plan")

    page.keyboard.press("Control+o")
    wait_for(page, "!!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("add task", delay=15)
    wait_for(
        page,
        "[...document.querySelectorAll('.palette .orden-row')].some((one) => one.textContent.includes('Add task'))",
        "the Add task row",
    )
    page.keyboard.press("Enter")
    wait_for(page, f"!!document.querySelector('{FIELD}')", "the quick add field")
    if page.evaluate("() => document.activeElement?.matches('.quick input.field')") is not True:
        wrong("the quick add field did not take the keyboard")

    typed(page, "Call mum tomorrow #family p1")
    said = chips(page)
    say(f"chips: {said}")
    if said != ["tomorrow", "#family", "p1"]:
        wrong(f"the chips are {said}, not tomorrow, #family and p1")
    shot(page, "01-chips")

    box = page.locator(".sheet .quick [data-chip='when']").bounding_box()
    if box is None:
        wrong("the day's chip is not on screen")
    else:
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(150)
        said = chips(page)
        say(f"after the press: {said}")
        if "tomorrow" in said:
            wrong("the pressed chip is still a chip")
        if page.locator(".sheet .quick .controls .control.set").count() == 0:
            wrong("the priority control does not show p1")
    shot(page, "02-words-again")

    page.keyboard.press("End")
    page.keyboard.press("Enter")
    wait_for(page, f"document.querySelector('{FIELD}')?.value === ''", "the field empty again")

    typed(page, "Water the plants #fa")
    wait_for(page, "document.querySelector('.sheet .quick .suggest [role=option]')", "a label offered")
    offered = page.locator(".sheet .quick .suggest [role=option]").all_inner_texts()
    say(f"[labels offered] {offered}")
    if not any("family" in one for one in offered):
        wrong("the label typed before is not offered")
    shot(page, "02b-suggest")
    page.keyboard.press("Tab")
    wait_for(page, f"document.querySelector('{FIELD}')?.value === 'Water the plants #family '", "the label taken")
    page.keyboard.type(">Pl", delay=15)
    wait_for(
        page,
        "[...document.querySelectorAll('.sheet .quick .suggest [role=option]')].some((one) => one.textContent.includes('Plan'))",
        "the note offered",
    )
    page.keyboard.press("Enter")
    wait_for(page, f"document.querySelector('{FIELD}')?.value.endsWith('>Plan ')", "the note taken, not the task added")
    page.keyboard.press("Backspace")
    page.keyboard.type("/To", delay=15)
    wait_for(
        page,
        "[...document.querySelectorAll('.sheet .quick .suggest [role=option]')].some((one) => one.textContent.includes('Today'))",
        "the note's heading offered",
    )
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.sheet .quick .suggest')", "the suggestions put away, the field kept")
    if not page.locator(FIELD).count():
        wrong("Escape over the suggestions closed quick add")
    page.locator(FIELD).fill("")

    typed(page, "Pay rent friday p2")
    page.keyboard.press("Enter")
    wait_for(page, f"document.querySelector('{FIELD}')?.value === ''", "the second task added")
    page.keyboard.press("Escape")
    wait_for(page, f"!document.querySelector('{FIELD}')", "quick add put away")

    wait_for(page, "window.nibApp.tasks", "the rows on the handle")
    inbox = page.evaluate(
        """async () => {
          const { rows } = await window.nibApp.tasks()
          const path = await rows.inbox()
          await window.nibApp.workspace.openEntry(path, { activate: true })
          return path
        }"""
    )
    say(f"inbox: {inbox}")
    if not inbox or not inbox.replace("\\", "/").endswith("/.Inbox.md"):
        wrong(f"the inbox is {inbox!r}, not Orden's own .Inbox.md")
    wait_for(
        page,
        f"window.nibApp.workspace.active?.path === {json.dumps(inbox)} && document.querySelector('.cm-content')",
        "the inbox open",
    )
    DRIVE.settled(page)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    say(f"Inbox: {text!r}")
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines or lines[0] != "- [ ] Call mum tomorrow #family 🔺":
        wrong(f"the first task is {lines[:1]}, not the words kept and the priority written")
    if len(lines) < 2 or not lines[1].startswith("- [ ] Pay rent ⏫ 🛫 "):
        wrong(f"the second task is {lines[1:2]}, not Pay rent with its day and priority")

    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: 0 } }); view.focus() }"
    )
    wait_for(page, "document.querySelectorAll('.orden-task-chips').length === 1", "the chips in the note")
    drawn = page.evaluate("() => document.querySelector('.orden-task-chips').textContent")
    words = page.evaluate("() => document.querySelectorAll('.cm-line')[1].textContent")
    say(f"the second task reads {words!r}")
    if not drawn.endswith("⏫") or "📅" in words:
        wrong(f"the second task's fields are not hidden behind its chips: {words!r}")
    shot(page, "03-inbox")

    DRIVE.seed(page, "# Board\n\n```tasks\nnot done\nsort by priority\n```\n")
    DRIVE.open_note(page, "Board")
    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: 0 } }); view.focus() }"
    )
    wait_for(
        page,
        "document.querySelectorAll('.orden-query-block input[data-task]').length === 2",
        "the tasks fence's two rows",
    )
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.orden-query-block .orden-row')].map((one) => one.textContent)"
    )
    say(f"the tasks fence: {rows}")
    if rows != ["Call mum tomorrow", "Pay rent"]:
        wrong(f"the fence answered {rows}, not the two open tasks by priority")
    shot(page, "04-tasks-fence")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "quick add wrote two tasks into the inbox"))
