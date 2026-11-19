from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
TITLES = ["Pick one", "Pick two", "Pick three", "Pick four"]
def picked(page: Page, scope: str) -> list[str]:
    return page.evaluate(f"() => [...document.querySelectorAll('{scope} [data-todo].is-picked .title')].map((one) => one.textContent.trim())")  # type: ignore[no-any-return]
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
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    page.wait_for_selector("[data-todos-board] [data-todos-column]")
    for mod in ["Control", "Alt"]:
        picks(page, "[data-todos-board]", mod)
raise SystemExit(DRIVE.run(drive))
