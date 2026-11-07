from __future__ import annotations

import json
import sys
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()
PATIENCE = 60

OWNER = "owner-v2@example.com"
ALONE = "alone-v2@example.com"
SPACE = "Solo"
ITEM = "one.md"
OPENING = "# One note\n\nshared on its own\n"
TYPED = "typed on v2 "

wrong: list[str] = []

def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)

class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)

def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")

def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account.user", f"[{label}] the account")
    if page.evaluate("() => window.ordenApp.sync.version") != 2:
        failed(f"[{label}] started v1 on an account on v2")
    return page

def words(page: Page) -> str:
    return page.evaluate(
        "() => { window.ordenApp.workspace.flush(); return window.ordenApp.workspace.active?.doc ?? '' }"
    )

def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        owner_token = worker.account(OWNER)
        alone_token = worker.account(ALONE)
        worker.sql(f"update users set sync_version = 2 where email in ('{OWNER}', '{ALONE}')")

        space = worker.request("/v1/spaces", token=owner_token, body={"name": SPACE})["space"]
        note = worker.request(
            f"/v1/spaces/{space['id']}/notes",
            token=owner_token,
            body={"path": ITEM, "content": OPENING},
        )["note"]
        say(f"the owner holds {SPACE}/{ITEM} as {note['id']}")

        owner = signed_in(browser, owner_token, "owner")
        wait_for(
            owner,
            f"() => window.ordenApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
            "[owner] the space",
        )
        owner.evaluate(
            "(name) => { const ws = window.ordenApp.workspace;"
            " const space = ws.spaces.find((one) => one.name === name); ws.showSpace(space.id) }",
            SPACE,
        )
        path = f"/{SPACE}/{ITEM}"
        listed = (
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            f"  return walk(window.ordenApp.workspace.tree).includes({json.dumps(path)})"
            "}"
        )
        wait_for(owner, listed, "[owner] the note in the tree")
        owner.evaluate("(path) => window.ordenApp.workspace.openEntry(path)", path)
        wait_for(owner, "() => !!document.querySelector('.cm-content')", "[owner] the editor")
        epoch = 0
        until = time.monotonic() + PATIENCE
        while time.monotonic() < until and epoch < 1:
            rows = worker.query(f"select epoch from notes where id = '{note['id']}'")
            epoch = int(rows[0]["epoch"]) if rows else 0
            owner.wait_for_timeout(250)
        if epoch < 1:
            failed("the owner's v2 never put the note on an epoch")
        else:
            say(f"the owner's note is on epoch {epoch}")

        now = int(time.time() * 1000)
        worker.sql(
            "insert into space_members (space_id, email, item, role, joined_at, created_at)"
            f" values ('{space['id']}', '{ALONE}', '{note['id']}', 'write', {now}, {now})"
        )

        alone = signed_in(browser, alone_token, "alone")
        wait_for(alone, "() => window.ordenApp.sharedWithYou.items.length === 1", "[alone] the shared file")
        alone.evaluate("() => window.ordenApp.sharedWithYou.open(window.ordenApp.sharedWithYou.items[0])")
        wait_for(alone, "() => !!window.ordenApp.workspace.active?.note.shared", "[alone] the shared tab")
        wait_for(
            alone,
            f"() => window.ordenApp.rooms.carries({json.dumps(note['id'])})",
            "[alone] the shared note to join its room",
        )
        say("the shared note is in its room under v2")

        alone.click(".cm-content")
        alone.evaluate("() => { window.orden.dispatch({ selection: { anchor: 0 } }); window.orden.focus() }")
        alone.keyboard.type(TYPED, delay=12)

        try:
            until = time.monotonic() + PATIENCE
            while TYPED not in words(owner):
                if time.monotonic() > until:
                    raise SystemExit("[owner] never saw the words live")
                owner.wait_for_timeout(100)
            say("the owner sees the words live")
        except SystemExit as gave_up:
            failed(str(gave_up))
        alone.screenshot(path=str(SHOTS / "shared-v2-alone.png"))
        owner.screenshot(path=str(SHOTS / "shared-v2-owner.png"))

        kept = ""
        until = time.monotonic() + PATIENCE
        while time.monotonic() < until and TYPED not in kept:
            kept = worker.request(f"/v1/notes/{note['id']}", token=owner_token).get("content", "")
            owner.wait_for_timeout(500)
        if TYPED not in kept:
            failed(f"the account never kept what was typed: {kept!r}")
        else:
            say("the account keeps what was typed")

        if words(alone).count(TYPED) != 1:
            failed(f"the shared tab holds {words(alone)!r}")

    if wrong:
        print("\nFAILED", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\na note shared on its own carries and keeps its words with both sides on v2", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
