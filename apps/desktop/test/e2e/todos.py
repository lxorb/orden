import hashlib
import json
import time
import uuid
from playwright.sync_api import Browser, Page
import harness
from harness import Drive
from settling import quiet

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = harness.worker_origin()
EMAIL = "todos@example.com"
PATIENCE = 30
TITLES = "() => [...document.querySelectorAll('[data-todos-panel] [data-todo] .title')].map((one) => one.textContent.trim())"
BOARD = """() => [...document.querySelectorAll('[data-todos-board] [data-todos-column]')].map((column) => [
  column.querySelector('h2').firstChild.textContent.trim(),
  [...column.querySelectorAll('[data-todo] .title')].map((one) => one.textContent.trim()),
])"""
HELD = "() => window.ordenApp.tasks().then(({ todos }) => todos.todos.map((one) => [one.title, one.done, one.labels, one.subtasks.length]))"
TITLE_RING = """() => {
  const style = getComputedStyle(document.querySelector('[data-todos-panel] [data-todo-editor] input[aria-label="Title"]'))
  return {
    shadow: style.boxShadow,
    outline: style.outlineStyle,
    borders: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
    pad: parseFloat(style.paddingLeft),
  }
}"""
AGAIN = "() => window.ordenApp.tasks().then(({ todos }) => todos.exchange())"
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
    def second(self, user: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        self.sql(harness.session_row(digest, user, now))
        return token
def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)
def opened(browser: Browser, name: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: wrong(f"[{name}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.ordenApp?.workspace.activeSpace", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    return page
def signed_in(page: Page, token: str) -> None:
    page.evaluate(f"() => localStorage.setItem('orden:session', {json.dumps(token)})")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.ordenApp?.account.user", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
def panel(page: Page) -> None:
    page.evaluate("window.ordenApp.workspace.showPanel('tasks')")
    page.wait_for_selector("[data-todos-panel] [data-todos-add]")
def add(page: Page, title: str) -> None:
    field = page.locator("[data-todos-panel] [data-todos-add]")
    field.fill(title)
    field.press("Enter")
    page.wait_for_function(f"() => [...document.querySelectorAll('[data-todos-panel] [data-todo] .title')].some((one) => one.textContent.trim() === {json.dumps(title)})")
def titles(page: Page) -> list[str]:
    return page.evaluate(TITLES)  # type: ignore[no-any-return]
def held(page: Page) -> list[list[object]]:
    return page.evaluate(HELD)  # type: ignore[no-any-return]
def holds(page: Page, name: str, *wanted: str) -> None:
    until = time.monotonic() + PATIENCE
    now: list[str] = []
    while time.monotonic() < until:
        now = [str(one[0]) for one in held(page)]
        if all(part in now for part in wanted):
            return
        page.evaluate(AGAIN)
        page.wait_for_timeout(1000)
    wrong(f"[{name}] the todos never held {wanted}: {now}")
def open_editor(page: Page, title: str) -> None:
    page.locator("[data-todos-panel] [data-todo] .body", has_text=title).first.click()
    page.wait_for_selector("[data-todos-panel] [data-todo-editor]")
def label(page: Page, title: str, name: str) -> None:
    open_editor(page, title)
    field = page.locator("[data-todos-panel] [data-todo-editor] input[aria-label='Add label']")
    field.fill(name)
    field.press("Enter")
    page.wait_for_function(f"() => [...document.querySelectorAll('[data-todos-panel] [data-todo-editor] .chip')].some((one) => one.textContent.includes({json.dumps(name)}))")
    page.locator("[data-todos-panel] [data-todo-editor] .close").click()
def delete(page: Page, scope: str, title: str) -> None:
    page.locator(f"{scope} [data-todo] .body", has_text=title).first.click()
    page.locator(f"{scope} [data-todo-editor] button", has_text="Delete todo").click()
    page.wait_for_function(f"() => !document.querySelector('{scope} [data-todo-editor]') && ![...document.querySelectorAll('{scope} [data-todo] .title')].some((one) => one.textContent.trim() === {json.dumps(title)})")
    if title in [str(one[0]) for one in held(page)]:
        wrong(f"Delete todo in {scope} kept {title}")
def lacks(page: Page, name: str, title: str) -> None:
    until = time.monotonic() + PATIENCE
    now: list[str] = []
    while time.monotonic() < until:
        now = [str(one[0]) for one in held(page)]
        if title not in now:
            return
        page.evaluate(AGAIN)
        page.wait_for_timeout(1000)
    wrong(f"[{name}] the todos still hold {title}: {now}")
def gone_from(page: Page, scope: str, *wanted: str) -> None:
    page.wait_for_function(f"(wanted) => ![...document.querySelectorAll('{scope} [data-todo] .title')].some((one) => wanted.includes(one.textContent.trim()))", arg=list(wanted))
    left = [str(one[0]) for one in held(page)]
    if any(one in left for one in wanted):
        wrong(f"{wanted} are still held: {left}")
def row_acts(page: Page, scope: str) -> None:
    for title in ["Menu away", "Key away", "Pick one", "Pick two"]:
        add(page, title)
    row = lambda title: page.locator(f"{scope} [data-todo]", has_text=title).first
    row("Menu away").locator(".body").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Delete").first.click()
    gone_from(page, scope, "Menu away")
    row("Key away").locator(".body").focus()
    page.keyboard.press("Delete")
    gone_from(page, scope, "Key away")
    row("Pick one").locator(".body").click(modifiers=["Alt"])
    row("Pick two").locator(".body").click(modifiers=["Alt"])
    if page.locator(f"{scope} [data-todo].is-picked").count() != 2:
        wrong("an alt click does not pick a todo row")
    shot(page, "08-picked")
    page.keyboard.press("Delete")
    page.locator("[role=dialog] button[type=submit]", has_text="Delete").click()
    gone_from(page, scope, "Pick one", "Pick two")
def pick_label(page: Page, scope: str, name: str) -> None:
    page.locator(f"{scope} [data-todos-label]").click()
    page.locator("[role=listbox][aria-label='Label'] .search").fill(name)
    page.locator("[role=listbox][aria-label='Label'] [role=option]", has_text=name).first.click()
def sheet_controls(page: Page) -> None:
    sheet = "[data-todos-panel] [data-todo-editor]"
    if page.locator(f"{sheet} select, {sheet} input[type=date], {sheet} input[type=time]").count():
        wrong("the todo sheet draws a native dropdown or date input")
    page.locator(f"{sheet} input[aria-label='Title']").focus()
    ring = page.evaluate(TITLE_RING)
    if ring["shadow"] != "none" or ring["outline"] != "none" or len(set(ring["borders"])) != 1 or ring["pad"] < 4:
        wrong(f"the title field in focus draws {ring}")
    shot(page, "05-sheet-title")
    if page.locator(f"{sheet} [aria-label='Space']").count():
        wrong("the todo sheet still offers a space")
    page.locator(f"{sheet} [role=combobox][aria-label='Priority']").click()
    page.wait_for_selector("[role=listbox][aria-label='Priority'] [role=option]")
    shot(page, "06-sheet-priority")
    page.keyboard.press("Escape")
    page.wait_for_selector("[role=listbox][aria-label='Priority']", state="detached")
    page.locator(f"{sheet} [aria-label='Choose a date']").first.click()
    page.wait_for_selector("[role=dialog][aria-label='Start date'] [role=grid]")
    shot(page, "07-sheet-calendar")
    page.keyboard.press("Escape")
    page.wait_for_selector("[role=dialog][aria-label='Start date']", state="detached")
    say("the todo sheet uses the app dropdown and date picker, and its title has one focus outline")
INSIDE = """(selector) => {
  const menu = document.querySelector(selector)
  if (!menu) return 'not open'
  const box = menu.getBoundingClientRect()
  if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) return `outside the window: ${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)} in ${innerWidth}x${innerHeight}`
  const corners = [[box.left + 3, box.top + 3], [box.right - 3, box.top + 3], [box.left + 3, box.bottom - 3], [box.right - 3, box.bottom - 3]]
  const under = corners.filter(([x, y]) => !menu.contains(document.elementFromPoint(x, y)))
  return under.length ? `under ${under.map(([x, y]) => document.elementFromPoint(x, y)?.className || document.elementFromPoint(x, y)?.tagName).join(', ')}` : ''
}"""
RING = "(selector) => { const one = document.querySelector(selector); one.focus({ focusVisible: true }); return getComputedStyle(one).outlineStyle }"
def inside(page: Page, selector: str, what: str, tag: str) -> None:
    said = page.evaluate(INSIDE, selector)
    if said:
        wrong(f"[{tag}] the {what} is {said}")
def menus_inside(page: Page, tag: str) -> None:
    body = page.locator("[data-todos-panel]").bounding_box() or {}
    page.mouse.move(body["x"] + body["width"] / 2, body["y"] + body["height"] / 2)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(200)
    page.locator("[data-todos-panel] [data-todos-label]").click()
    page.wait_for_selector("[role=listbox][aria-label='Label']")
    inside(page, "[role=listbox][aria-label='Label']", "label menu", tag)
    shot(page, f"08-{tag}-label-menu")
    page.locator("[data-todos-panel] [data-todos-label]").click()
    page.wait_for_selector("[role=listbox][aria-label='Label']", state="detached")
    if not page.locator("[data-todos-panel] [data-todo-editor]").count():
        open_editor(page, "Read a book")
    sheet = "[data-todos-panel] [data-todo-editor]"
    page.locator(f"{sheet} [role=combobox][aria-label='Priority']").click()
    page.wait_for_selector("[role=listbox][aria-label='Priority'] [role=option]")
    inside(page, "[role=listbox][aria-label='Priority']", "Priority dropdown", tag)
    page.keyboard.press("Escape")
    page.locator(f"{sheet} [aria-label='Choose a date']").first.click()
    page.wait_for_selector("[role=dialog][aria-label='Start date'] [role=grid]")
    inside(page, "[role=dialog][aria-label='Start date']", "date popup", tag)
    page.keyboard.press("Escape")
    page.locator(f"{sheet} .close").click()
    say(f"[{tag}] the label menu, the Priority dropdown and the date popup stay in the window and on top")
def no_ring(page: Page) -> None:
    chips = ["[data-todos-panel] [data-todos-label]", "[data-todos-panel] [data-todos-show-done]"]
    page.locator(chips[0]).click()
    page.locator(chips[0]).click()
    page.locator(chips[1]).click()
    page.locator(chips[1]).click()
    rings = {one: page.evaluate(RING, one) for one in chips}
    if not page.locator("[data-todos-panel] [data-todo-editor]").count():
        open_editor(page, "Read a book")
    priority = "[data-todos-panel] [data-todo-editor] [role=combobox][aria-label='Priority']"
    page.locator(priority).click()
    page.locator(priority).click()
    rings[priority] = page.evaluate(RING, priority)
    if any(one != "none" for one in rings.values()):
        wrong(f"a press with the pointer left a focus ring: {rings}")
    page.locator("[data-todos-panel] [data-todo-editor] .close").click()
    page.locator(chips[1]).click()
    page.locator(chips[1]).click()
    page.keyboard.press("Tab")
    keyed = page.evaluate("() => [document.activeElement.tagName, getComputedStyle(document.activeElement).outlineStyle]")
    if keyed[1] != "solid":
        wrong(f"a control reached with Tab shows no ring: {keyed}")
    say("a pointer press leaves no focus ring and Tab still shows one")
def main() -> int:
    worker = Worker()
    with DRIVE.session(playwright=True) as play:
        worker.start()
        token = worker.account(EMAIL)
        user = worker.query(f"select id from users where email = '{EMAIL}'")[0]["id"]
        other = worker.second(user)
        first, second = DRIVE.browser(play), DRIVE.browser(play)
        desk = opened(first, "desk")
        panel(desk)
        add(desk, "Call the bank")
        add(desk, "Water the plants")
        add(desk, "Read a book")
        add(desk, "Plant the tulips")
        say(f"panel: {titles(desk)}")
        if titles(desk) != ["Call the bank", "Water the plants", "Read a book", "Plant the tulips"]:
            wrong(f"the panel lists {titles(desk)}")
        label(desk, "Call the bank", "admin")
        label(desk, "Water the plants", "home")
        open_editor(desk, "Plant the tulips")
        start = desk.locator("[data-todos-panel] [data-todo-editor] input[aria-label='Start date']")
        start.fill("2099-01-01")
        start.press("Enter")
        desk.wait_for_function("() => ![...document.querySelectorAll('[data-todos-panel] [data-todo] .title')].some((one) => one.textContent.includes('Plant the tulips'))")
        say("a start date in the future hides the todo")
        open_editor(desk, "Read a book")
        sub = desk.locator("[data-todos-panel] [data-todo-editor] input[aria-label='Add subtask']")
        sub.fill("Chapter one")
        sub.press("Enter")
        desk.wait_for_selector("[data-todos-panel] [data-todo-editor] li")
        sheet_controls(desk)
        desk.locator("[data-todos-panel] [data-todo-editor] .close").click()
        shot(desk, "01-panel")
        pick_label(desk, "[data-todos-panel]", "admin")
        desk.wait_for_function("() => document.querySelectorAll('[data-todos-panel] [data-todo]').length === 1")
        if titles(desk) != ["Call the bank"]:
            wrong(f"the admin label shows {titles(desk)}")
        say("the label dropdown narrows the panel")
        shot(desk, "02-panel-label")
        desk.locator("[data-todos-panel] [data-todos-label]").click()
        desk.locator("[role=listbox][aria-label='Label'] [role=option]", has_text="All labels").click()
        desk.wait_for_function("() => document.querySelectorAll('[data-todos-panel] [data-todo]').length === 3")
        add(desk, "Throw this away")
        delete(desk, "[data-todos-panel]", "Throw this away")
        say("Delete todo in the panel deletes it")
        desk.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
        desk.wait_for_selector("[data-todos-board] [data-todos-column]")
        board = desk.evaluate(BOARD)
        say(f"board: {board}")
        if [one[0] for one in board] != ["admin", "home", "No label"]:
            wrong(f"the board columns are {board}")
        desk.locator("[data-todos-board] [data-todos-sort] [role=combobox]").click()
        desk.locator("[role=listbox] [role=option]", has_text="Priority").click()
        desk.wait_for_function("() => document.querySelector('[data-todos-board] [data-todos-sort] [role=combobox]').textContent.includes('Priority')")
        shot(desk, "03-board")
        desk.locator("[data-todos-board] [data-todo] .tick").first.check()
        desk.wait_for_function("() => document.querySelector('[data-todos-board] [data-todo].done')")
        say("a todo ticked on the board is done")
        field = desk.locator("[data-todos-board] [data-todos-add]")
        field.fill("Throw this away too")
        field.press("Enter")
        desk.wait_for_function("() => [...document.querySelectorAll('[data-todos-board] [data-todo] .title')].some((one) => one.textContent.trim() === 'Throw this away too')")
        delete(desk, "[data-todos-board]", "Throw this away too")
        say("Delete todo on the board deletes it")
        row_acts(desk, "[data-todos-panel]")
        say("a todo row deletes from its menu, by the Delete key, and with others picked")
        signed_in(desk, token)
        holds(desk, "desk", "Call the bank", "Water the plants", "Read a book", "Plant the tulips")
        say("signed in, the local todos went into the account")
        phone = opened(second, "phone")
        signed_in(phone, other)
        holds(phone, "phone", "Call the bank", "Water the plants", "Read a book", "Plant the tulips")
        mine = {str(one[0]): one for one in held(phone)}
        if mine["Read a book"][3] != 1 or mine["Call the bank"][2] != ["admin"]:
            wrong(f"the phone misses details: {mine}")
        say("a second device of the same user sees the todos with their labels and subtasks")
        panel(phone)
        add(phone, "From the phone")
        holds(desk, "desk", "From the phone")
        delete(phone, "[data-todos-panel]", "From the phone")
        lacks(desk, "desk", "From the phone")
        say("a todo deleted on the phone is gone on the desk")
        shot(phone, "04-phone")
        label(desk, "Read a book", "Quaestur and a rather long label name")
        for one in range(14):
            add(desk, f"Filler todo {one + 1}")
        menus_inside(desk, "wide")
        desk.set_viewport_size({"width": 900, "height": 700})
        desk.wait_for_timeout(300)
        menus_inside(desk, "narrow")
        no_ring(desk)
    return DRIVE.verdict("todos are per user, belong to no space, filter by label, and have a board in their own tab")
raise SystemExit(main())
