from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet
from todos import DAYS, TASK, open_from_panel, seed

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

GROUP_OF = """(words) => {
  const heads = [...document.querySelectorAll('.view-tab .head .fold, .view-tab .task .words')]
  let group = null
  for (const one of heads) {
    if (one.matches('.fold')) group = one.textContent.trim().split(/\\s+/)[0]
    else if (one.textContent.trim() === words) return group
  }
  return null
}"""

def added(page: Page, index: int, words: str) -> None:
    page.locator(".view-tab .add-row .adder").nth(index).click()
    field = ".view-tab .add-row .quick input.field"
    if not DRIVE.waited(page, f"!!document.querySelector('{field}')", f"the add row's editor for {words}"):
        return
    page.keyboard.type(words, delay=15)
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")
    DRIVE.waited(page, f"() => !!({TASK})({json.dumps(words)})", f"the row of {words}")
    quiet(page)

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 1000})
    DRIVE.open(page)
    seed(page)
    days: dict[str, str] = page.evaluate(DAYS)
    open_from_panel(page)
    wanted = {
        "Pay the rent": ("Today", days["today"]),
        "Buy milk": ("Today", days["today"]),
        "Fix the bike": ("Tomorrow", days["tomorrow"]),
        "Paint the fence": ("Later", days["later"]),
    }
    for index, words in enumerate(wanted):
        added(page, index, words)
    for words, (group, deadline) in wanted.items():
        task = page.evaluate(TASK, words)
        shown = page.evaluate(GROUP_OF, words)
        say(f"[{words}] deadline {task and task.get('deadline')}, shown under {shown}")
        if not task or task.get("deadline") != deadline:
            wrong(f"{words!r} was added with deadline {task and task.get('deadline')}, not {deadline}")
        if shown != group:
            wrong(f"{words!r} shows under {shown}, not {group}")
    DRIVE.shot(page, "01-added")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a task added in a group of Todos stays in view"))
