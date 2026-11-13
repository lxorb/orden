from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from todos import TASK, open_from_panel

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SEED = """async () => {
  window.tasks = await window.ordenApp.tasks()
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  const inbox = await window.tasks.rows.inbox()
  await window.tasks.writeFile(inbox, '- [ ] Post the letter\\n')
  await window.tasks.writeFile(`${root}/Meeting.md`, '# Meeting\\n\\n- [ ] Ask about the budget\\n')
  await window.tasks.writeFile(`${root}/Projects/Notes.md`, '- [ ] Not a todo either\\n')
  await ws.loadTree()
  return inbox
}"""

TEXT = "async (path) => await window.ordenApp.workspace.noteText(path)"

WORDS = "() => [...document.querySelectorAll('.view-tab .task .words')].map((one) => one.textContent.trim())"

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.tasks", "the views on the handle")
    inbox: str = page.evaluate(SEED)
    wait_for(page, f"() => !!({TASK})('Post the letter')", "the inbox's todo")
    page.wait_for_timeout(500)
    for words in ("Ask about the budget", "Not a todo either"):
        if page.evaluate(TASK, words) is not None:
            wrong(f"the checkbox {words!r} of a note is a todo")

    open_from_panel(page)
    shown = page.evaluate(WORDS)
    say(f"[todos] {json.dumps(shown)}")
    if shown != ["Post the letter"]:
        wrong(f"Todos shows {shown}, not the inbox's one todo")

    DRIVE.open_note(page, "Meeting")
    wait_for(page, "!!document.querySelector('.orden-checkbox')", "the note's checkbox")
    page.locator(".orden-checkbox").first.dispatch_event("mousedown")
    wait_for(page, f"() => window.orden.state.doc.toString().includes('- [x] Ask')", "the box ticked")
    page.wait_for_timeout(800)
    text = page.evaluate("() => window.orden.state.doc.toString()")
    say(f"[meeting] {text!r}")
    if "- [x] Ask about the budget\n" not in text or "✅" in text:
        wrong(f"ticking the note's checkbox changed more than its box: {text!r}")
    if page.evaluate(TASK, "Ask about the budget") is not None:
        wrong("the ticked checkbox became a todo")

    open_from_panel(page)
    card = page.locator(".view-tab .task:has(.words:text-is('Post the letter'))")
    card.locator(".box[role=checkbox]").first.click()
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Post the letter' && one.task.done && one.task.completed)",
        "the todo done, with its date",
    )
    inbox_text = page.evaluate(TEXT, inbox)
    say(f"[inbox] {inbox_text!r}")
    if "- [x] Post the letter" not in (inbox_text or ""):
        wrong(f"ticking a todo did not tick it in the inbox: {inbox_text!r}")
    done = page.evaluate(TASK, "Post the letter")
    today = page.evaluate("() => { const at = new Date(); const two = (v) => String(v).padStart(2, '0'); return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}` }")
    if not done or done.get("completed") != today:
        wrong(f"the todo's done date is {done and done.get('completed')}, not {today}")
    DRIVE.shot(page, "01-ticked")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a checkbox in a note is a checkbox, and a todo of the inbox is ticked there"))
