from __future__ import annotations

import hashlib
import json
import time
import uuid

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()

EMAIL = "account-inbox@example.com"

AGAIN = "() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) }"

PATIENCE = 45

ADD = """async (words) => {
  const tasks = await window.ordenApp.tasks()
  const path = await tasks.rows.inbox()
  const before = (await window.ordenApp.workspace.noteText(path)) ?? ''
  await tasks.writeFile(path, `${before}- [ ] ${words}\\n`)
  return path
}"""

INBOX = """async () => {
  const tasks = await window.ordenApp.tasks()
  return tasks.rows.of().filter((one) => one.task && /orden-inbox/.test(one.path))
    .map((one) => `${one.task.done ? 'x' : ' '} ${one.task.text}`).sort()
}"""

TICK = """async (words) => {
  const tasks = await window.ordenApp.tasks()
  const row = tasks.rows.of().find((one) => one.task?.text === words)
  if (!row) return false
  return tasks.rows.write(row, { task: { done: true } })
}"""

LEGACY = """async (text) => {
  const tasks = await window.ordenApp.tasks()
  const root = window.ordenApp.workspace.activeSpace.root.replace(/[\\\\/]+$/, '')
  await tasks.writeFile(`${root}/.Inbox.md`, text)
  return `${root}/.Inbox.md`
}"""

FILES = """async () => {
  const names = []
  const walk = (node) => { for (const one of node?.children ?? []) { names.push(one.name); walk(one) } }
  walk(window.ordenApp.workspace.tree)
  return names.filter((one) => /inbox/i.test(one))
}"""

THERE = "async (path) => (await window.ordenApp.workspace.noteText(path).catch(() => null)) !== null"


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


def opened(browser, name: str, missing: bool = False) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: wrong(f"[{name}] page error: {error}"))
    page.on(
        "console",
        lambda one: wrong(f"[{name}] {one.text}") if "of the account inbox" in one.text else None,
    )
    page.asked = []  # type: ignore[attr-defined]
    page.on(
        "request",
        lambda one: page.asked.append(one.url) if "/v2/inbox" in one.url else None,  # type: ignore[attr-defined]
    )
    if missing:
        context.route(
            "**/v2/inbox**",
            lambda route: route.fulfill(
                status=404, content_type="application/json", body='{"error":"not found"}'
            ),
        )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.ordenApp?.workspace.activeSpace", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    return page


def inbox(page: Page) -> list[str]:
    return page.evaluate(INBOX)  # type: ignore[no-any-return]


def add(page: Page, words: str) -> str:
    path = page.evaluate(ADD, words)
    page.wait_for_timeout(300)
    return path  # type: ignore[no-any-return]


def signed_in(page: Page, token: str) -> None:
    page.evaluate(f"() => localStorage.setItem('orden:session', {json.dumps(token)})")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.ordenApp?.account.user", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)


def holds(page: Page, name: str, *parts: str) -> list[str]:
    until = time.monotonic() + PATIENCE
    now: list[str] = []
    while time.monotonic() < until:
        now = inbox(page)
        if all(any(one == part or one.endswith(f" {part}") for one in now) for part in parts):
            return now
        page.evaluate(AGAIN)
        page.wait_for_timeout(1000)
    wrong(f"[{name}] the inbox never held {parts}: {now}")
    return now


def same(desk: Page, phone: Page, what: str) -> None:
    for _ in range(PATIENCE):
        if inbox(desk) == inbox(phone):
            say(f"{what}: both hold {inbox(desk)}")
            return
        desk.evaluate(AGAIN)
        phone.evaluate(AGAIN)
        desk.wait_for_timeout(1000)
    wrong(f"{what}: the two disagree: {inbox(desk)} / {inbox(phone)}")


def no_files(page: Page, name: str) -> None:
    seen = page.evaluate(FILES)
    if seen:
        wrong(f"[{name}] the file tree shows {seen}")


def gone(page: Page, path: str, what: str) -> None:
    for _ in range(PATIENCE):
        if not page.evaluate(THERE, path):
            say(f"{what}: {path} is gone")
            return
        page.evaluate(AGAIN)
        page.wait_for_timeout(1000)
    wrong(f"{what}: {path} is still there")


def once(page: Page, name: str) -> None:
    now = inbox(page)
    twice = sorted({one for one in now if now.count(one) > 1})
    if twice:
        wrong(f"[{name}] these are in the inbox more than once: {twice}")


def main() -> int:
    worker = Worker()
    with DRIVE.session(playwright=True) as play:
        worker.start()
        token = worker.account(EMAIL)
        user = worker.query(f"select id from users where email = '{EMAIL}'")[0]["id"]
        other = worker.second(user)
        first, second = DRIVE.browser(play), DRIVE.browser(play)

        desk, phone = opened(first, "desk"), opened(second, "phone")
        path = add(desk, "Desk before signing in")
        say(f"the inbox is read and written at {path}")
        if not path.replace("\\", "/").endswith("/.orden-inbox.md"):
            wrong(f"the inbox is {path!r}")
        holds(desk, "desk", "Desk before signing in")
        no_files(desk, "desk")
        if desk.evaluate(THERE, path.replace(".orden-inbox.md", ".Inbox.md")):
            wrong("adding to the inbox made a .Inbox.md")

        legacy = phone.evaluate(LEGACY, "- [ ] From the old file\n- [x] Done in the old file ✅ 2026-11-01\n")
        holds(phone, "phone", "From the old file", "Done in the old file")
        gone(phone, legacy, "signed out, the old inbox file was moved in")
        no_files(phone, "phone")
        if desk.asked or phone.asked:  # type: ignore[attr-defined]
            wrong("signed out, the inbox went to the account")
        shot(phone, "01-phone-signed-out")

        signed_in(desk, token)
        holds(desk, "desk", "Desk before signing in")
        signed_in(phone, other)
        holds(phone, "phone", "Desk before signing in", "From the old file", "Done in the old file")
        holds(desk, "desk", "From the old file", "Desk before signing in")
        same(desk, phone, "after both joined")
        once(desk, "desk")

        phone.evaluate(TICK, "Desk before signing in")
        holds(desk, "desk", "x Desk before signing in")
        phone.evaluate("() => window.ordenApp.workspace.undoFileAction()")
        holds(phone, "phone", "  Desk before signing in")
        holds(desk, "desk", "  Desk before signing in")
        phone.evaluate(TICK, "Desk before signing in")
        holds(desk, "desk", "x Desk before signing in")
        add(desk, "Desk at once")
        add(phone, "Phone at once")
        holds(desk, "desk", "Phone at once", "Desk at once")
        holds(phone, "phone", "Phone at once", "Desk at once")
        same(desk, phone, "after writing at once")
        shot(desk, "02-desk-at-once")

        desk.context.set_offline(True)
        add(desk, "Written offline")
        desk.evaluate(AGAIN)
        add(phone, "Written online")
        phone.evaluate(AGAIN)
        phone.wait_for_timeout(3000)
        if any("Written offline" in one for one in inbox(phone)):
            wrong("the offline to-do reached the phone while the desk was offline")
        desk.context.set_offline(False)
        holds(phone, "phone", "Written offline", "Written online")
        holds(desk, "desk", "Written offline", "Written online")
        same(desk, phone, "after the desk came back")

        again = desk.evaluate(LEGACY, "- [ ] From the old file\n- [ ] Arrived in an old file late\n")
        holds(desk, "desk", "Arrived in an old file late")
        gone(desk, again, "an old file arriving later was moved in")
        holds(phone, "phone", "Arrived in an old file late")
        once(desk, "desk")

        desk.reload(wait_until="domcontentloaded")
        desk.wait_for_function("() => !!window.ordenApp?.account.user", timeout=60000)
        desk.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
        holds(desk, "desk", "Written offline")
        same(desk, phone, "after a reload")
        once(desk, "desk")
        no_files(desk, "desk")
        shown = desk.evaluate(
            """async () => {
              const tasks = await window.ordenApp.tasks()
              await tasks.openBuiltin('inbox')
              for (let i = 0; i < 100 && !document.querySelector('.view-tab .task'); i++)
                await new Promise((go) => setTimeout(go, 100))
              await new Promise((go) => setTimeout(go, 800))
              return [...document.querySelectorAll('.view-tab .task .words')].map((one) => one.textContent.trim())
            }"""
        )
        say(f"the Inbox view shows {shown}")
        if "Written offline" not in shown or "Arrived in an old file late" not in shown:
            wrong(f"the Inbox view does not show the account inbox: {shown}")
        shot(desk, "03-desk-inbox-view")

        old = opened(first, "old-server", missing=True)
        signed_in(old, token)
        add(old, "Only on this device")
        old.evaluate(AGAIN)
        old.wait_for_timeout(2000)
        kept = inbox(old)
        say(f"against a Worker without the route: {kept}, asked {len(old.asked)} time(s)")  # type: ignore[attr-defined]
        if not any(one.endswith("Only on this device") for one in kept):
            wrong(f"against a Worker without the route the to-do was lost: {kept}")
        old.reload(wait_until="domcontentloaded")
        old.wait_for_function("() => !!window.ordenApp?.account.user", timeout=60000)
        holds(old, "old-server", "Only on this device")

        held = worker.query(f"select count(*) as many from inbox_items where user_id = '{user}'")
        say(f"the account holds the inbox in {held[0]['many']} row(s)")

    return DRIVE.verdict("the inbox is one on every device of the account, and never a file")


if __name__ == "__main__":
    raise SystemExit(main())
