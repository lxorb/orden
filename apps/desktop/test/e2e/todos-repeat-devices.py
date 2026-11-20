import hashlib
import json
import time
import uuid
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
ORIGIN = harness.worker_origin()
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
    def account(self, email: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(f"insert into users (id, email, name, created_at) values ('{user}', '{email}', 'Emil', {now});" + harness.session_row(digest, user, now))
        return token
HELD = "() => window.ordenApp.tasks().then(({ todos }) => todos.todos.filter((one) => one.title === 'Pay rent').map((one) => [one.done, one.start, one.repeat]).sort())"
EXCHANGE = "() => window.ordenApp.tasks().then(({ todos }) => todos.exchange())"
def device(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.ordenApp?.account.user", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    page.evaluate("window.ordenApp.workspace.showPanel('tasks')")
    page.wait_for_selector("[data-todos-panel] [data-todos-add]")
    return page
def settle(*pages: Page) -> None:
    for _ in range(3):
        for page in pages:
            page.evaluate(EXCHANGE)
            page.wait_for_timeout(1500)
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account("two-devices@example.com")
        a = device(browser, token, "a")
        b = device(browser, token, "b")
        a.evaluate("() => window.ordenApp.tasks().then(({ todos }) => todos.add({ title: 'Pay rent', start: '2026-11-15', repeat: 'every month' }))")
        settle(a, b)
        b.wait_for_function("() => window.ordenApp.tasks().then(({ todos }) => todos.todos.some((one) => one.title === 'Pay rent'))", timeout=30000)
        say(f"both have it: a {a.evaluate(HELD)} b {b.evaluate(HELD)}")
        DRIVE.preload(a, harness.WORKER_DIST)
        DRIVE.preload(b, harness.WORKER_DIST)
        a.context.set_offline(True)
        b.context.set_offline(True)
        for page in (a, b):
            page.locator("[data-todos-panel] [data-todo]", has_text="Pay rent").first.locator("[aria-label=Done]").click()
            page.wait_for_timeout(1500)
        say(f"offline ticks: a {a.evaluate(HELD)} b {b.evaluate(HELD)}")
        a.context.set_offline(False)
        b.context.set_offline(False)
        a.wait_for_timeout(1500)
        settle(a, b)
        ha, hb = a.evaluate(HELD), b.evaluate(HELD)
        say(f"after sync: a {ha} b {hb}")
        live = [one for one in ha if not one[0]]
        done = [one for one in ha if one[0]]
        if ha != hb:
            DRIVE.wrong(f"the two devices disagree after syncing: {ha} and {hb}")
        if len(done) > 1:
            DRIVE.wrong(f"one month paid on two devices offline left {len(done)} done copies: {ha}")
        if len(live) != 1 or live[0][1] != "2026-12-15":
            DRIVE.wrong(f"the repeating todo is not there once, one month on: {live}")
    return DRIVE.verdict("a repeating todo ticked for the same month on two devices offline leaves one done copy and moves on once")
raise SystemExit(main())
