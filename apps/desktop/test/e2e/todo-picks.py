from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
TITLES = ["Pick one", "Pick two", "Pick three", "Pick four"]
def picked(page: Page, scope: str) -> list[str]:
    return page.evaluate(f"() => [...document.querySelectorAll('{scope} [data-todo]')].filter((one) => one.querySelector('.orden-said')?.textContent === 'Selected').map((one) => one.querySelector('.title').textContent.trim())")  # type: ignore[no-any-return]
def body(page: Page, scope: str, title: str):
    return page.locator(f"{scope} [data-todo]", has_text=title).first.locator(".title")
def picks(page: Page, scope: str, mod: str) -> None:
    page.keyboard.press("Escape")
    body(page, scope, "Pick one").click(modifiers=[mod])
    body(page, scope, "Pick three").click(modifiers=[mod])
    now = picked(page, scope)
    say(f"{scope} {mod} click picks {now}")
    if sorted(now) != ["Pick one", "Pick three"]:
        wrong(f"{mod} click in {scope} picks {now}")
    body(page, scope, "Pick one").click()
    body(page, scope, "Pick one").click()
    body(page, scope, "Pick two").click(modifiers=["Shift"])
    body(page, scope, "Pick four").click(modifiers=["Shift"])
    now = picked(page, scope)
    say(f"{scope} shift click picks {now}")
    if len(now) < 3:
        wrong(f"shift click in {scope} picks {now}")
def clears(page: Page, scope: str) -> None:
    body(page, scope, "Pick one").click(modifiers=["Control"])
    body(page, scope, "Pick two").click(modifiers=["Control"])
    page.mouse.click(5, 5)
    page.keyboard.press("Escape")
    if picked(page, scope):
        wrong(f"Escape left {picked(page, scope)} picked in {scope}")
    body(page, scope, "Pick one").click(modifiers=["Control"])
    body(page, scope, "Pick three").click()
    if picked(page, scope) not in ([], ["Pick three"]):
        wrong(f"a plain click in {scope} left {picked(page, scope)} picked")
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    body(page, scope, "Pick one").click(modifiers=["Control"])
    page.keyboard.press("Shift+ArrowDown")
    page.keyboard.press("Shift+ArrowDown")
    if len(picked(page, scope)) != 3:
        wrong(f"Shift+ArrowDown in {scope} picks {picked(page, scope)}")
    page.keyboard.press("Control+a")
    if len(picked(page, scope)) != len(TITLES):
        wrong(f"Ctrl+A in {scope} picks {picked(page, scope)}")
    body(page, scope, "Pick one").click(button="right")
    page.wait_for_selector("[role=menu]")
    said = page.evaluate("() => document.querySelector('[role=menu]').textContent")
    page.keyboard.press("Escape")
    if f"Delete {len(TITLES)} todos" not in said:
        wrong(f"the menu of {len(TITLES)} picked todos in {scope} says {said}")
    page.keyboard.press("Escape")
    say(f"{scope}: Escape clears, Shift+ArrowDown and Ctrl+A pick, the menu counts the picked")
def ticks(page: Page, scope: str) -> None:
    page.mouse.click(5, 5)
    page.keyboard.press("Escape")
    body(page, scope, "Pick two").click(modifiers=["Control"])
    body(page, scope, "Pick three").click(modifiers=["Control"])
    page.locator(f"{scope} [data-todo]", has_text="Pick two").first.locator(".tick").check()
    wait_for(page, "window.ordenApp.tasks().then(({ todos }) => todos.todos.filter((one) => one.done).length === 2)", "two done")
    page.locator("button", has_text="Undo").first.click()
    wait_for(page, "window.ordenApp.tasks().then(({ todos }) => todos.todos.every((one) => !one.done))", "all back")
    say(f"{scope}: ticking a picked todo ticks both and one Undo takes both back")
def carried(page: Page) -> None:
    scope = "[data-todos-board]"
    page.evaluate("() => window.ordenApp.tasks().then(({ todos }) => todos.update(todos.todos.find((one) => one.title === 'Pick four').id, { labels: ['work'] }))")
    page.wait_for_selector(f"{scope} [data-todos-column][data-key='work']")
    page.mouse.click(5, 5)
    page.keyboard.press("Escape")
    body(page, scope, "Pick one").click(modifiers=["Control"])
    body(page, scope, "Pick two").click(modifiers=["Control"])
    start = page.locator(f"{scope} [data-todo-card]", has_text="Pick one").first.bounding_box() or {}
    end = page.locator(f"{scope} [data-todos-column][data-key='work']").bounding_box() or {}
    page.mouse.move(start["x"] + 30, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + 34, start["y"] + start["height"] / 2 + 6, steps=3)
    page.mouse.move(end["x"] + 40, end["y"] + end["height"] - 10, steps=12)
    page.wait_for_timeout(300)
    page.mouse.up()
    page.wait_for_timeout(600)
    held = page.evaluate("() => window.ordenApp.tasks().then(({ todos }) => Object.fromEntries(todos.todos.map((one) => [one.title, one.labels])))")
    say(f"two picked carried into work: {held}")
    if held.get("Pick one") != ["work"] or held.get("Pick two") != ["work"]:
        wrong(f"the picked todos did not go into work together: {held}")
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    page.evaluate("window.ordenApp.workspace.showPanel('tasks')")
    page.wait_for_selector("[data-todos-panel] [data-todos-add]")
    for title in TITLES:
        field = page.locator("[data-todos-panel] [data-todos-add]")
        field.fill(title)
        field.press("Enter")
        wait_for(page, f"[...document.querySelectorAll('[data-todos-panel] [data-todo] .title')].some((one) => one.textContent.trim() === '{title}')", title)
    for mod in ["Control", "Alt"]:
        picks(page, "[data-todos-panel]", mod)
    clears(page, "[data-todos-panel]")
    ticks(page, "[data-todos-panel]")
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    page.wait_for_selector("[data-todos-board] [data-todos-column]")
    for mod in ["Control", "Alt"]:
        picks(page, "[data-todos-board]", mod)
    clears(page, "[data-todos-board]")
    ticks(page, "[data-todos-board]")
    carried(page)
raise SystemExit(DRIVE.run(drive))
