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
    typed(page, "Pay rent friday p2")
    page.keyboard.press("Enter")
    wait_for(page, f"document.querySelector('{FIELD}')?.value === ''", "the second task added")
    page.keyboard.press("Escape")
    wait_for(page, f"!document.querySelector('{FIELD}')", "quick add put away")

    wait_for(page, "window.ordenApp.tasks", "the todos on the handle")
    todos = page.evaluate(
        """async () => {
          const { todos } = await window.ordenApp.tasks()
          return todos.todos.map((one) => [one.title, one.labels, one.priority, one.start, one.deadline])
        }"""
    )
    say(f"todos: {todos}")
    if len(todos) < 2:
        wrong(f"quick add left {len(todos)} todos, not two")
    first, second = todos[0], todos[1]
    if first[0] != "Call mum tomorrow" or first[1] != ["family"] or first[2] != 3:
        wrong(f"the first todo is {first}, not the words kept with its label and priority")
    if second[0] != "Pay rent" or second[2] != 2:
        wrong(f"the second todo is {second}, not Pay rent with its priority")

    page.evaluate("async () => { const { openTodos } = await window.ordenApp.tasks(); openTodos() }")
    wait_for(
        page,
        "[...document.querySelectorAll('[data-todos-board] [data-todo] .title')].map((one) => one.textContent).join('|').includes('Call mum')",
        "the todo board shows what quick add wrote",
    )
    shot(page, "03-board")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "quick add wrote two todos"))
