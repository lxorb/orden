import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PANEL = "[data-todos-panel]"
BOARD = "[data-todos-board]"
PHONE_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
HELD = "() => window.ordenApp.tasks().then(({ todos }) => Object.fromEntries(todos.todos.map((one) => [one.title, { labels: one.labels, priority: one.priority, done: one.done, description: one.description, deadline: one.deadline }])))"
BOARD_HELD = "() => window.ordenApp.tasks().then(({ todos }) => todos.board)"
COLUMNS = f"() => [...document.querySelectorAll('{BOARD} [data-todos-column]')].map((one) => one.querySelector('h2 .name').textContent.trim())"
def titles(page: Page, scope: str, column: str | None = None) -> list[str]:
    inside = f"{scope} [data-todos-column][data-key={json.dumps(column)}]" if column is not None else scope
    return page.evaluate(f"() => [...document.querySelectorAll({json.dumps(inside + ' [data-todo] .title')})].map((one) => one.textContent.trim())")  # type: ignore[no-any-return]
def held(page: Page) -> dict:
    return page.evaluate(HELD)  # type: ignore[no-any-return]
def card(page: Page, scope: str, title: str):
    found = page.locator(f"{scope} [data-todo-card]", has=page.locator(".title", has_text=title)).first
    found.scroll_into_view_if_needed()
    return found
def settle(page: Page) -> None:
    page.wait_for_timeout(350)
def drag(page: Page, start: dict, end: tuple[float, float], name: str | None = None) -> None:
    page.mouse.move(start["x"] + 30, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + 34, start["y"] + start["height"] / 2 + 6, steps=3)
    page.mouse.move(end[0], end[1], steps=12)
    page.mouse.move(end[0], end[1] + 1)
    page.wait_for_timeout(250)
    if name:
        DRIVE.shot(page, name)
    page.mouse.up()
    settle(page)
def onto(page: Page, scope: str, moving: str, under: str, where: float, name: str | None = None) -> None:
    start = card(page, scope, moving).bounding_box()
    end = card(page, scope, under).bounding_box()
    if not start or not end:
        wrong(f"no card for {moving} or {under}")
        return
    drag(page, start, (end["x"] + 40, end["y"] + end["height"] * where), name)
def add(page: Page, title: str) -> None:
    field = page.locator(f"{PANEL} [data-todos-add]")
    field.fill(title)
    field.press("Enter")
    wait_for(page, f"[...document.querySelectorAll('{PANEL} [data-todo] .title')].some((one) => one.textContent.trim() === {json.dumps(title)})", title)
def patch(page: Page, title: str, change: dict) -> None:
    page.evaluate(
        "([title, change]) => window.ordenApp.tasks().then(({ todos }) => todos.update(todos.todos.find((one) => one.title === title).id, change))",
        [title, change],
    )
def lifted_while_dragging(page: Page, scope: str, moving: str, under: str) -> None:
    start = card(page, scope, moving).bounding_box()
    end = card(page, scope, under).bounding_box()
    if not start or not end:
        return
    page.mouse.move(start["x"] + 30, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(end["x"] + 40, end["y"] + end["height"] * 0.8, steps=12)
    page.wait_for_timeout(250)
    lifted = page.evaluate(f"() => [...document.querySelectorAll('{scope} [data-todo].is-lifted .title')].map((one) => one.textContent.trim())")
    order = titles(page, scope)
    page.keyboard.press("Escape")
    page.mouse.up()
    settle(page)
    say(f"mid drag: lifted {lifted}, order {order}")
    if lifted != [moving]:
        wrong(f"the carried todo is not shown lifted in its place: {lifted}")
    if order.index(moving) <= order.index(under):
        wrong(f"the list did not open a place below {under} while carrying {moving}: {order}")
def panel(page: Page, tag: str) -> None:
    page.wait_for_selector(f"{PANEL} [data-todos-add]")
    for title in ["Call the bank", "Water the plants", "Read a book", "Pay the rent"]:
        add(page, title)
    patch(page, "Call the bank", {"deadline": page.evaluate("() => { const d = new Date(); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10) }")})
    patch(page, "Water the plants", {"deadline": page.evaluate("() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) }")})
    page.locator(f"{PANEL} [data-todo-card]").first.hover()
    DRIVE.shot(page, f"{tag}01-panel-cards")
    style = page.evaluate(f"""() => {{
      const one = getComputedStyle(document.querySelector('{PANEL} [data-todo]'))
      return {{ radius: parseFloat(one.borderTopLeftRadius), border: one.borderTopStyle, background: one.backgroundColor }}
    }}""")
    say(f"a panel card: {style}")
    if style["radius"] < 4 or style["border"] != "solid":
        wrong(f"the panel's todos are not cards: {style}")
    words = page.evaluate(f"() => [...document.querySelectorAll('{PANEL} [data-todo] .deadline')].map((one) => [one.textContent.trim(), one.classList.contains('late')])")
    say(f"deadlines: {words}")
    if not any(late for _, late in words) or any(word[0:2] == "20" for word, _ in words) or not any(word == "Tomorrow" for word, _ in words):
        wrong(f"the deadlines do not read as words with the late one marked: {words}")
    lifted_while_dragging(page, PANEL, "Call the bank", "Read a book")
    before = titles(page, PANEL)
    onto(page, PANEL, before[0], before[2], 0.8, f"{tag}02-panel-carrying")
    now = titles(page, PANEL)
    say(f"panel after a drag: {before} -> {now}")
    if now.index(before[0]) != 2:
        wrong(f"{before[0]} let go below {before[2]} stands at {now}")
    if page.evaluate("() => JSON.parse(localStorage.getItem('orden:todos-shown') || '{}').sort") != "manual":
        wrong("a drag in the panel did not turn the sort to manual")
    page.locator(f"{PANEL} [data-todo]", has_text="Read a book").locator(".tick").check()
    wait_for(page, f"![...document.querySelectorAll('{PANEL} [data-todo] .title')].some((one) => one.textContent.trim() === 'Read a book')", "the ticked todo leaving")
    wait_for(page, "[...document.querySelectorAll('[data-notices] button')].some((one) => one.textContent.trim() === 'Undo')", "the undo toast")
    DRIVE.shot(page, f"{tag}03-ticked-undo")
    page.locator("[data-notices] button", has_text="Undo").click()
    wait_for(page, f"[...document.querySelectorAll('{PANEL} [data-todo] .title')].some((one) => one.textContent.trim() === 'Read a book')", "Undo bringing the todo back")
    if held(page)["Read a book"]["done"]:
        wrong("Undo left the todo done")
    page.locator(f"{PANEL} [data-todo]", has_text="Pay the rent").locator(".tick").check()
    wait_for(page, f"![...document.querySelectorAll('{PANEL} [data-todo] .title')].some((one) => one.textContent.trim() === 'Pay the rent')", "a done todo hidden")
    page.locator(f"{PANEL} [data-todos-show-done]").click()
    wait_for(page, f"document.querySelector('{PANEL} [data-todo].done')", "Show done showing it")
    DRIVE.shot(page, f"{tag}04-show-done")
    page.locator(f"{PANEL} [data-todos-show-done]").click()
    order = titles(page, PANEL)
    page.locator(f"{PANEL} [data-todo]", has_text=order[0]).locator(".body").focus()
    page.keyboard.press("Alt+ArrowDown")
    wait_for(page, f"[...document.querySelectorAll('{PANEL} [data-todo] .title')].map((one) => one.textContent.trim()).indexOf({json.dumps(order[0])}) === 1", "Alt+ArrowDown moving the todo one down")
    page.locator(f"{PANEL} [data-todo]", has_text=order[1]).locator(".body").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Delete").first.click()
    wait_for(page, f"![...document.querySelectorAll('{PANEL} [data-todo] .title')].some((one) => one.textContent.trim() === {json.dumps(order[1])})", "the todo deleted from its menu")
    page.locator("[data-notices] button", has_text="Undo").click()
    wait_for(page, f"[...document.querySelectorAll('{PANEL} [data-todo] .title')].some((one) => one.textContent.trim() === {json.dumps(order[1])})", "Undo bringing the deleted todo back")
    say("the panel: cards, day words, a drag reorders, a tick leaves with an undo, Show done, Alt+ArrowDown, a delete undone")
def notes(page: Page) -> None:
    DRIVE.seed(page, "# Groceries\n\nmilk\n")
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    wait_for(page, "[...document.querySelectorAll('aside:not(.right) .row')].some((one) => one.textContent.includes('Groceries'))", "the note in the tree")
def note_onto(page: Page) -> None:
    start = page.locator("aside:not(.right) .row", has_text="Groceries").first.bounding_box()
    end = card(page, PANEL, "Water the plants").bounding_box()
    if not start or not end:
        wrong("no tree row or todo card")
        return
    page.evaluate("() => { window.__seen = []; for (const kind of ['dragstart', 'dragover', 'drop', 'dragend']) addEventListener(kind, (e) => { if (window.__seen.length < 60 && (kind !== 'dragover' || window.__seen.at(-1)?.[1] !== e.target?.className?.toString?.().slice(0, 40))) window.__seen.push([kind, e.target?.className?.toString?.().slice(0, 40), e.clientX, e.clientY]) }, true) }")
    say(f"card at {end}")
    drag(page, start, (end["x"] + end["width"] / 2, end["y"] + end["height"] / 2))
    say(f"events: {page.evaluate('() => window.__seen')}")
    say(f"held: {held(page).get('Water the plants')}")
    wait_for(page, f"document.querySelector('{PANEL} [data-todo] .act.note')", "the note's chip on the todo")
    if "[[Groceries]]" not in held(page)["Water the plants"]["description"]:
        wrong(f"the note dropped on a todo is not linked: {held(page)['Water the plants']}")
    say("a note dropped from the tree onto a todo links it, and the card shows the note")

def into_note(page: Page) -> None:
    DRIVE.open_note(page, "Groceries")
    page.wait_for_selector(".cm-content")
    page.wait_for_timeout(400)
    start = card(page, PANEL, "Read a book").bounding_box()
    end = page.locator(".cm-content .cm-line").last.bounding_box()
    if not start or not end:
        wrong("no card or no note")
        return
    drag(page, start, (end["x"] + end["width"] - 4, end["y"] + end["height"] / 2))
    page.wait_for_timeout(400)
    text = page.evaluate("() => window.ordenApp.workspace.active?.doc ?? ''")
    say(f"the note after a todo was let go in it: {text!r}")
    if "Read a book" not in text:
        wrong(f"a todo let go in a note left {text!r}")
    if "[ ]" in text:
        wrong("a todo let go in a note became a task line in it")
def board(page: Page, tag: str) -> None:
    page.evaluate("() => window.ordenApp.workspace.closePanel('right')")
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    page.wait_for_selector(f"{BOARD} [data-todos-column]")
    for title, labels in [("Call the bank", ["admin"]), ("Water the plants", ["home"]), ("Read a book", ["home"])]:
        patch(page, title, {"labels": labels})
    wait_for(page, f"document.querySelectorAll('{BOARD} [data-todos-column]').length >= 3", "the label columns")
    settle(page)
    DRIVE.shot(page, f"{tag}05-board")
    before = page.evaluate(COLUMNS)
    head = page.locator(f"{BOARD} [data-todos-column]").nth(len(before) - 1).locator("h2 .name").bounding_box()
    first = page.locator(f"{BOARD} [data-todos-column]").first.bounding_box()
    if head and first:
        drag(page, head, (first["x"] + 12, first["y"] + 20), f"{tag}07-column-carrying")
    after = page.evaluate(COLUMNS)
    kept = page.evaluate(BOARD_HELD)
    say(f"columns {before} -> {after}, kept {kept['columns']['label']}")
    if after[0] != before[-1]:
        wrong(f"the last column dragged to the front stands at {after}")
    start = card(page, BOARD, "Call the bank").bounding_box()
    end = page.locator(f"{BOARD} [data-todos-column][data-key='home'] [data-todo-card]").last.bounding_box()
    if start and end:
        drag(page, start, (end["x"] + 40, end["y"] + end["height"] * 0.8), f"{tag}06-board-carrying")
    page.wait_for_timeout(600)
    labels = held(page)["Call the bank"]["labels"]
    say(f"after a drag to home: {labels}, home holds {titles(page, BOARD, 'home')}")
    if labels != ["home"]:
        wrong(f"a todo dragged from admin to home carries {labels}")
    page.locator(f"{BOARD} [data-todos-column][data-key='home'] h2").hover()
    page.locator(f"{BOARD} [data-todos-column][data-key='home'] [data-todos-column-add]").click()
    field = page.locator(f"{BOARD} [data-todos-column-field]")
    field.fill("Buy soil")
    field.press("Enter")
    wait_for(page, f"[...document.querySelectorAll('{BOARD} [data-todos-column][data-key=home] [data-todo] .title')].some((one) => one.textContent.trim() === 'Buy soil')", "the todo added in the column")
    if held(page)["Buy soil"]["labels"] != ["home"]:
        wrong(f"a todo added with the column's + has {held(page)['Buy soil']}")
    field.press("Escape")
    page.locator(f"{BOARD} [data-todos-group] [role=combobox]").click()
    page.locator("[role=listbox] [role=option]", has_text="Priority").click()
    wait_for(page, f"[...document.querySelectorAll('{BOARD} [data-todos-column] h2 .name')].some((one) => one.textContent.trim() === 'High')", "the priority columns")
    settle(page)
    start = card(page, BOARD, "Read a book").bounding_box()
    high = page.locator(f"{BOARD} [data-todos-column][data-key='3'] ul").bounding_box()
    say(f"Read a book at {start}, High at {high}")
    page.evaluate("() => { window.__seen = []; for (const kind of ['dragstart', 'dragover', 'drop', 'dragend']) addEventListener(kind, (e) => { if (window.__seen.length < 60 && (kind !== 'dragover' || window.__seen.at(-1)?.[1] !== e.target?.className?.toString?.().slice(0, 40))) window.__seen.push([kind, e.target?.className?.toString?.().slice(0, 40), e.clientX, e.clientY, e.defaultPrevented]) }, true) }")
    if start and high:
        drag(page, start, (high["x"] + 40, high["y"] + 20))
    say(f"events: {page.evaluate('() => window.__seen')}")
    page.wait_for_timeout(600)
    if held(page)["Read a book"]["priority"] != 3:
        wrong(f"a todo dragged to High has {held(page)['Read a book']}")
    page.locator(f"{BOARD} [data-todos-column][data-key='2'] h2").hover()
    page.locator(f"{BOARD} [data-todos-column][data-key='2'] [data-todos-column-add]").click()
    field.fill("Fix the bike")
    field.press("Enter")
    wait_for(page, f"[...document.querySelectorAll('{BOARD} [data-todo] .title')].some((one) => one.textContent.trim() === 'Fix the bike')", "the todo added under Medium")
    if held(page)["Fix the bike"]["priority"] != 2:
        wrong(f"the + of Medium made {held(page)['Fix the bike']}")
    DRIVE.shot(page, f"{tag}08-board-priority")
    page.locator(f"{BOARD} [data-todos-group] [role=combobox]").click()
    page.locator("[role=listbox] [role=option]", has_text="Deadline").click()
    wait_for(page, f"document.querySelector('{BOARD} [data-todos-column][data-key=today]')", "the deadline columns")
    settle(page)
    start = card(page, BOARD, "Fix the bike").bounding_box()
    strip = page.locator(f"{BOARD} .columns").bounding_box()
    if start and strip:
        scrolled = page.evaluate(f"() => document.querySelector('{BOARD} .columns').scrollLeft")
        page.mouse.move(start["x"] + 30, start["y"] + start["height"] / 2)
        page.mouse.down()
        page.mouse.move(start["x"] + 36, start["y"] + start["height"] / 2 + 6, steps=3)
        page.mouse.move(strip["x"] + 12, strip["y"] + 120, steps=10)
        page.wait_for_timeout(1500)
        rolled = page.evaluate(f"() => document.querySelector('{BOARD} .columns').scrollLeft")
        say(f"held at the left edge, the columns scrolled from {scrolled} to {rolled}")
        if rolled >= scrolled:
            wrong(f"holding a todo at the board's edge did not scroll it: {scrolled} -> {rolled}")
        today = page.locator(f"{BOARD} [data-todos-column][data-key='today'] ul").bounding_box()
        if today:
            page.mouse.move(today["x"] + 40, today["y"] + 20, steps=8)
            page.mouse.move(today["x"] + 40, today["y"] + 21)
            page.wait_for_timeout(250)
        page.mouse.up()
        settle(page)
    page.wait_for_timeout(600)
    if held(page)["Fix the bike"]["deadline"] != page.evaluate("() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }"):
        wrong(f"a todo dragged to Today has {held(page)['Fix the bike']}")
    page.locator(f"{BOARD} [data-todos-group] [role=combobox]").click()
    offered = page.evaluate("() => [...document.querySelectorAll('[role=listbox] [role=option]')].map((one) => one.textContent.trim())")
    if "Space" in offered:
        wrong(f"the board still offers to group by space: {offered}")
    page.locator("[role=listbox] [role=option]", has_text="Priority").click()
    wait_for(page, f"[...document.querySelectorAll('{BOARD} [data-todos-column] h2 .name')].some((one) => one.textContent.trim() === 'No priority')", "the priority columns")
    kept = page.evaluate(BOARD_HELD)
    if kept["grouping"] != "priority":
        wrong(f"the grouping is not kept in the board: {kept}")
    patch(page, "Fix the bike", {"start": "2099-01-01"})
    wait_for(page, f"![...document.querySelectorAll('{BOARD} [data-todo] .title')].some((one) => one.textContent.trim() === 'Fix the bike')", "a todo that starts later hidden")
    page.locator(f"{BOARD} [data-todos-any-start]").click()
    wait_for(page, f"[...document.querySelectorAll('{BOARD} [data-todo] .title')].some((one) => one.textContent.trim() === 'Fix the bike')", "Ignore start date showing it")
    if not page.evaluate(BOARD_HELD)["anyStart"]:
        wrong("Ignore start date is not kept in the board")
    page.locator(f"{BOARD} [data-todos-show-done]").click()
    wait_for(page, f"document.querySelector('{BOARD} [data-todo].done')", "Show done on the board")
    DRIVE.shot(page, f"{tag}09-board-priority-done")
    page.locator(f"{BOARD} [data-todos-show-done]").click()
    page.locator(f"{BOARD} [data-todos-group] [role=combobox]").click()
    page.locator("[role=listbox] [role=option]", has_text="Label").click()
    wait_for(page, f"document.querySelector('{BOARD} [data-todos-column][data-key=home]')", "the label columns again")
    page.wait_for_timeout(600)
    card(page, BOARD, "Water the plants").hover()
    if not page.locator(f"{BOARD} [data-todo-ai]").first.is_visible():
        wrong("no Do with AI on a card")
    say("the board: drags change label, priority and deadline, columns move and are kept, + adds into a column, groupings, Ignore start date, Show done")
def desk(browser: Browser, dark: bool) -> None:
    tag = "dark-" if dark else ""
    context = DRIVE.context(browser, viewport={"width": 1280, "height": 820}, color_scheme="dark" if dark else "light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    notes(page)
    page.evaluate("() => { const ws = window.ordenApp.workspace; ws.movePanel('tasks', 'right'); ws.showPanel('tasks'); if (ws.openOn('left') !== 'tree') ws.showPanel('tree') }")
    panel(page, tag)
    if not dark:
        note_onto(page)
        into_note(page)
    board(page, tag)
    context.close()
def phone(browser: Browser, dark: bool) -> None:
    tag = "phone-dark-" if dark else "phone-"
    context = DRIVE.context(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="dark" if dark else "light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    page.evaluate("window.ordenApp.workspace.showPanel('tasks')")
    page.wait_for_selector(f"{PANEL} [data-todos-add]")
    for title in ["Milk", "Eggs", "Bread"]:
        add(page, title)
    DRIVE.shot(page, f"{tag}01-panel")
    before = titles(page, PANEL)
    start = card(page, PANEL, before[0]).bounding_box()
    end = card(page, PANEL, before[2]).bounding_box()
    if start and end:
        cdp = context.new_cdp_session(page)
        x, y = start["x"] + 60, start["y"] + start["height"] / 2
        touch = lambda kind, at_x, at_y: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": at_x, "y": at_y}]})
        touch("touchStart", x, y)
        page.wait_for_timeout(350)
        to = end["y"] + end["height"] * 0.8
        for step in range(1, 11):
            touch("touchMove", x, y + (to - y) * step / 10)
            page.wait_for_timeout(30)
        page.wait_for_timeout(200)
        DRIVE.shot(page, f"{tag}02-lifted")
        if not page.locator(".carried [data-todo]").count():
            wrong("[phone] a held todo was not lifted")
        pulled = page.evaluate("() => window.ordenApp.pull.at")
        if pulled:
            wrong(f"[phone] carrying a todo down pulled the list to refresh ({pulled})")
        touch("touchEnd", x, to)
        settle(page)
    now = titles(page, PANEL)
    say(f"[phone] after a held drag: {before} -> {now}")
    if now.index(before[0]) != 2:
        wrong(f"[phone] {before[0]} carried below {before[2]} stands at {now}")
    context.close()
def drive(browser: Browser) -> None:
    desk(browser, False)
    desk(browser, True)
    phone(browser, False)
    phone(browser, True)
raise SystemExit(DRIVE.run(drive, "todos drag like the file tree: reorder, columns, groupings, a note onto a todo, held on a phone"))
