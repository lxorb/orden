"""Todoist's keys, selection and swipes on a view's rows, in the built app.

What this drives, against the real rows store and the real files:

  * j and k walk the rows; e completes the one the keyboard is on, the toast says
    Completed, and its Undo opens it again.
  * Shift+T takes a task's date away.
  * Ctrl and a press selects rows, Shift and a press every row between; the bulk bar
    says how many, and a priority key gives every one of them that priority in one undo.
  * The bulk bar's Move to puts the selected tasks into a project, both notes in one
    write; Escape lets the selection go.
  * v opens the same list of projects for the row the keyboard is on.
  * On a phone a row swiped to the right is completed.

    python apps/desktop/test/e2e/task-keys.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/task-keys/`.
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


DAYS = """() => {
  const day = (n) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const two = (v) => String(v).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }
  return { today: day(0), yesterday: day(-1) }
}"""

ERRANDS = """# Errands

- [ ] Call the bank 📅 {today}
- [ ] Water the plants 📅 {today}
- [ ] Pay the dentist 📅 {today}
- [ ] Buy stamps 📅 {today}
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

TASK = "(words) => window.tasks.rows.of().find((one) => one.task?.text === words) ?? null"


def seed(page: Page) -> dict[str, str]:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days: dict[str, str] = page.evaluate(DAYS)
    page.evaluate(
        WRITE,
        [[["Errands.md", ERRANDS.format(**days)], ["Projects/Home.md", "- [ ] Fix the tap\n"]]],
    )
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Buy stamps')",
        "the seeded rows",
    )
    return days


def open_today(page: Page) -> None:
    page.evaluate("window.tasks.openBuiltin('today')")
    wait_for(page, "document.querySelector('.view-tab .task')", "Today's rows")
    quiet(page)


def row(words: str) -> str:
    return f".view-tab .task:has(.words:text-is('{words}'))"


def focused(page: Page) -> str:
    return page.evaluate(  # type: ignore[no-any-return]
        "() => document.activeElement?.closest('.task')?.querySelector('.words')?.textContent?.trim() ?? ''"
    )


def keys(page: Page, days: dict[str, str]) -> None:
    page.locator(row("Call the bank")).focus()
    page.keyboard.press("j")
    if focused(page) != "Water the plants":
        wrong(f"j went to {focused(page)!r}, not the next row")
    page.keyboard.press("j")
    page.keyboard.press("k")
    if focused(page) != "Water the plants":
        wrong(f"k went to {focused(page)!r}, not the row above")

    page.keyboard.press("j")
    page.keyboard.press("e")
    wait_for(page, f"() => ({TASK})('Pay the dentist')?.task.done === true", "e completing the dentist")
    wait_for(page, "document.querySelector('.toast')?.textContent.includes('Completed')", "the toast")
    shot(page, "01-completed")
    page.locator(".toast .undo").click()
    wait_for(page, f"() => ({TASK})('Pay the dentist')?.task.done === false", "the toast's Undo")

    page.locator(row("Buy stamps")).focus()
    page.keyboard.press("Shift+T")
    wait_for(page, f"() => !({TASK})('Buy stamps')?.task.due", "Shift+T taking the date away")
    page.keyboard.press("Control+z")
    wait_for(
        page, f"() => ({TASK})('Buy stamps')?.task.due === '{days['today']}'", "the date back"
    )


def selection(page: Page) -> None:
    open_today(page)
    page.locator(f"{row('Call the bank')} .words").click(modifiers=["Control"])
    page.locator(f"{row('Pay the dentist')} .words").click(modifiers=["Shift"])
    wait_for(page, "document.querySelector('.view-tab [role=toolbar]')", "the bulk bar")
    count = page.locator(".view-tab [role=toolbar] .count").inner_text()
    say(f"[bar] {count}")
    if "3" not in count:
        wrong(f"the bar says {count!r}, not three selected")
    if page.locator(".task-sheet, .nib-screen").count():
        wrong("a press with Ctrl or Shift opened the task")
    shot(page, "02-selected")

    page.keyboard.press("2")
    wait_for(
        page,
        f"() => ['Call the bank', 'Water the plants', 'Pay the dentist'].every((w) => ({TASK})(w)?.task.priority === 2)",
        "every selected task at priority 2",
    )
    if (page.evaluate(f"({TASK})('Buy stamps')?.task.priority") or 4) == 2:
        wrong("a task not selected took the priority")
    page.keyboard.press("Control+z")
    wait_for(
        page,
        f"() => ['Call the bank', 'Water the plants', 'Pay the dentist'].every((w) => ({TASK})(w)?.task.priority !== 2)",
        "one undo taking all three back",
    )

    page.locator(".view-tab [role=toolbar] button[aria-label='Move to']").click()
    wait_for(page, "document.querySelector('.menu [role=menuitem]')", "the projects")
    shot(page, "03-move-to")
    page.locator(".menu [role=menuitem]", has_text="Home").click()
    wait_for(
        page,
        f"() => ['Call the bank', 'Water the plants', 'Pay the dentist'].every((w) => ({TASK})(w)?.path === 'Projects/Home.md')",
        "the three moved into Home",
    )
    if page.evaluate(f"({TASK})('Buy stamps')?.path") != "Errands.md":
        wrong("a task not selected moved")
    page.keyboard.press("Control+z")
    wait_for(
        page,
        f"() => ['Call the bank', 'Water the plants', 'Pay the dentist'].every((w) => ({TASK})(w)?.path === 'Errands.md')",
        "one undo bringing them back",
    )

    open_today(page)
    page.locator(f"{row('Buy stamps')} .words").click(modifiers=["Control"])
    wait_for(page, "document.querySelector('.view-tab [role=toolbar]')", "the bar for one")
    page.locator(row("Buy stamps")).focus()
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.view-tab [role=toolbar]')", "Escape letting it go")

    page.keyboard.press("v")
    wait_for(page, "document.querySelector('.menu [role=menuitem]')", "v's projects")
    items = page.locator(".menu [role=menuitem]").all_inner_texts()
    say(f"[v] {items}")
    if not any("Inbox" in one for one in items) or not any("Home" in one for one in items):
        wrong("v does not offer the Inbox and the projects")
    page.keyboard.press("Escape")


PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

SWIPE = """([words, by, lift]) => {
  const node = [...document.querySelectorAll('.view-tab .task')].find(
    (one) => one.querySelector('.words')?.textContent.trim() === words,
  )
  const box = node.getBoundingClientRect()
  const y = box.top + box.height / 2
  const at = (x) => new Touch({ identifier: 1, target: node, clientX: x, clientY: y })
  const fire = (type, x) => node.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: type === 'touchend' ? [] : [at(x)], changedTouches: [at(x)],
  }))
  const start = box.left + 60
  fire('touchstart', start)
  for (let step = 1; step <= 8; step++) fire('touchmove', start + (by * step) / 8)
  if (lift) fire('touchend', start + by)
  else window.lift = () => fire('touchend', start + by)
}"""


def phone(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    DRIVE.open(page)
    seed(page)
    open_today(page)
    page.evaluate(SWIPE, ["Water the plants", 200, False])
    wait_for(page, "document.querySelector('.view-tab .swipe.is-ready')", "the row over what it will do")
    shot(page, "04-phone-swiping")
    page.evaluate("window.lift()")
    wait_for(page, f"() => ({TASK})('Water the plants')?.task.done === true", "a swipe to the right completing it")
    page.evaluate(SWIPE, ["Call the bank", -200, True])
    wait_for(page, "document.querySelector('.scheduler')", "a swipe to the left scheduling it")
    shot(page, "05-phone-swiped")
    page.close()


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    days = seed(page)
    open_today(page)
    keys(page, days)
    selection(page)
    page.close()
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the keys, the selection and the swipes held"))
