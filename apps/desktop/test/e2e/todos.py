from __future__ import annotations

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
HELD = "() => window.ordenApp.tasks().then(({ todos }) => todos.todos.map((one) => [one.title, one.done, one.labels, one.space, one.subtasks.length]))"
AGAIN = "() => window.ordenApp.tasks().then(({ todos }) => todos.exchange())"


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)

    def second(self, user: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )
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


def pick_label(page: Page, scope: str, name: str) -> None:
    page.locator(f"{scope} [data-todos-label]").click()
    page.locator(f"{scope} .search").fill(name)
    page.locator(f"{scope} [role=option]", has_text=name).first.click()


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
        add(desk, "Starts next week")
        say(f"panel: {titles(desk)}")
        if titles(desk) != ["Call the bank", "Water the plants", "Read a book", "Starts next week"]:
            wrong(f"the panel lists {titles(desk)}")

        label(desk, "Call the bank", "admin")
        label(desk, "Water the plants", "home")
        open_editor(desk, "Starts next week")
        desk.locator("[data-todos-panel] [data-todo-editor] input[type=date]").first.fill("2099-01-01")
        desk.wait_for_function("() => ![...document.querySelectorAll('[data-todos-panel] [data-todo] .title')].some((one) => one.textContent.includes('Starts next week'))")
        say("a start date in the future hides the todo")
        open_editor(desk, "Read a book")
        sub = desk.locator("[data-todos-panel] [data-todo-editor] input[aria-label='Add subtask']")
        sub.fill("Chapter one")
        sub.press("Enter")
        desk.wait_for_selector("[data-todos-panel] [data-todo-editor] li")
        desk.locator("[data-todos-panel] [data-todo-editor] .close").click()
        shot(desk, "01-panel")

        pick_label(desk, "[data-todos-panel]", "admin")
        desk.wait_for_function("() => document.querySelectorAll('[data-todos-panel] [data-todo]').length === 1")
        if titles(desk) != ["Call the bank"]:
            wrong(f"the admin label shows {titles(desk)}")
        say("the label dropdown narrows the panel")
        shot(desk, "02-panel-label")
        desk.locator("[data-todos-panel] [data-todos-label]").click()
        desk.locator("[data-todos-panel] [role=option]", has_text="All labels").click()
        desk.wait_for_function("() => document.querySelectorAll('[data-todos-panel] [data-todo]').length === 3")

        desk.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
        desk.wait_for_selector("[data-todos-board] [data-todos-column]")
        board = desk.evaluate(BOARD)
        say(f"board: {board}")
        if [one[0] for one in board] != ["admin", "home", "No label"]:
            wrong(f"the board columns are {board}")
        desk.select_option("[data-todos-board] [data-todos-sort]", "priority")
        shot(desk, "03-board")

        desk.locator("[data-todos-board] [data-todo] .tick").first.check()
        desk.wait_for_function("() => document.querySelector('[data-todos-board] [data-todo].done')")
        say("a todo ticked on the board is done")

        signed_in(desk, token)
        holds(desk, "desk", "Call the bank", "Water the plants", "Read a book", "Starts next week")
        say("signed in, the local todos went into the account")
        phone = opened(second, "phone")
        signed_in(phone, other)
        holds(phone, "phone", "Call the bank", "Water the plants", "Read a book", "Starts next week")
        mine = {str(one[0]): one for one in held(phone)}
        if mine["Read a book"][4] != 1 or mine["Call the bank"][2] != ["admin"]:
            wrong(f"the phone misses details: {mine}")
        say("a second device of the same user sees the todos with their labels and subtasks")
        panel(phone)
        add(phone, "From the phone")
        holds(desk, "desk", "From the phone")
        shot(phone, "04-phone")
    return DRIVE.verdict("todos are per user, filtered by space and label, and a board in their own tab")


if __name__ == "__main__":
    raise SystemExit(main())
