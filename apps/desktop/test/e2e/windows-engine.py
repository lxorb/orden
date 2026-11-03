"""One engine across a device's windows (H2-DESKTOP-1, 2, 3): two pages on one origin, signed
in on sync v2, with the real Worker. Exactly one runs the engine. What the other types and
makes reaches the account through it, nothing arrives twice, and when the first closes the
other takes the engine over and goes on.

    python apps/desktop/test/e2e/windows-engine.py
"""

from __future__ import annotations

import json
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
ORIGIN = harness.worker_origin()
PATIENCE = 60
EMAIL = "windows-v2@example.com"
SPACE = "Two"
ITEM = "both.md"

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


def type_at_end(page: Page, words: str) -> None:
    page.bring_to_front()
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(words, delay=5)


def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(EMAIL)
        worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")
        space = worker.request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        note = worker.request(
            f"/v1/spaces/{space['id']}/notes",
            token=token,
            body={"path": ITEM, "content": "# Both\n\nbase line\n"},
        )["note"]

        context = browser.new_context(viewport={"width": 1100, "height": 700})
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

        def window(label: str) -> Page:
            page = context.new_page()
            page.set_default_timeout(30000)
            page.on("pageerror", lambda error: failed(f"[{label}] page error: {error}"))
            page.goto(ORIGIN, wait_until="domcontentloaded")
            wait_for(page, "() => !!window.nibApp?.account.user", f"[{label}] the account")
            wait_for(
                page,
                f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
                f"[{label}] the space",
            )
            page.evaluate(
                "(name) => { const ws = window.nibApp.workspace;"
                " ws.showSpace(ws.spaces.find((one) => one.name === name).id) }",
                SPACE,
            )
            return page

        a = window("A")
        path = f"/{SPACE}/{ITEM}"
        listed = (
            "() => { const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : []);"
            f" return walk(window.nibApp.workspace.tree).includes({json.dumps(path)}) }}"
        )
        wait_for(a, listed, "[A] the note")
        wait_for(a, "() => !!window.nibApp.sync.engine?.engine", "[A] the engine")
        b = window("B")
        wait_for(b, listed, "[B] the note")

        engines = "() => !!window.nibApp.sync.engine?.engine"
        if b.evaluate(engines):
            failed("the second window runs an engine as well")
        wait_for(b, "() => window.nibApp.sync.status !== 'off'", "[B] the light said over")
        wait_for(
            b,
            f"() => window.nibApp.sync.remoteIdFor({json.dumps('/' + SPACE)}) === {json.dumps(space['id'])}",
            "[B] which space is which, from the engine's window",
        )
        say("one engine, and the other window hears the light and the rows")

        for page in (a, b):
            page.evaluate("(p) => window.nibApp.workspace.openEntry(p)", path)
            wait_for(page, "() => !!document.querySelector('.cm-content')", "the editor")

        def account() -> str:
            return worker.request(f"/v1/notes/{note['id']}", token=token).get("content", "")

        def on_account(words: str, patience: int = PATIENCE) -> bool:
            until = time.monotonic() + patience
            while time.monotonic() < until:
                if words in account():
                    return True
                a.wait_for_timeout(250) if not a.is_closed() else b.wait_for_timeout(250)
            return False

        type_at_end(b, "FROM-B ")
        if not on_account("FROM-B"):
            failed(f"what the second window typed never reached the account: {account()!r}")
        wait_for(a, "() => window.nibApp.workspace.active.note.latest.includes('FROM-B')", "[A] B's words")
        type_at_end(a, "FROM-A ")
        if not on_account("FROM-A"):
            failed(f"what the engine's window typed never reached the account: {account()!r}")
        wait_for(b, "() => window.nibApp.workspace.active.note.latest.includes('FROM-A')", "[B] A's words")
        if "FROM-B" not in account():
            failed(f"B's words went when A's arrived: {account()!r}")
        say(f"both typed: {account()!r}")

        # A note made in the window with no engine is one note, whichever way it comes.
        b.bring_to_front()
        # Said by hand as an operation: a browser has no folder watch, and `createNote` leaves
        # a new file to the desktop's watch, which is the same `created` a second time there.
        b.evaluate(
            "async (f) => { const ws = window.nibApp.workspace;"
            " await ws.createNote(f, 'Fresh one.md');"
            " await ws.fileCame(f + '/Fresh one.md', 'file');"
            " await ws.fileCame(f + '/Fresh one.md', 'file') }",
            f"/{SPACE}",
        )
        made = (
            "() => [...window.nibApp.sync.engine.engine.core.spaces.values()]"
            ".flatMap((one) => [...one.entries.values()])"
            ".filter((one) => one.name.startsWith('Fresh') && !one.deleted && one.seq !== null)"
            ".map((one) => one.name)"
        )
        wait_for(a, f"() => ({made})().length > 0", "[A] the note made in B, on the account")
        a.wait_for_timeout(4000)
        fresh = a.evaluate(made)
        say(f"made in B, on the account: {fresh}")
        if len(fresh) != 1:
            failed(f"a note made in B is on the account as {fresh}")

        # The engine's window goes; the other takes it over and goes on.
        a.close(run_before_unload=True)
        wait_for(b, engines, "[B] the engine, handed over")
        say("the first window closed, the second runs the engine")
        # Making the note above put its tab in front.
        b.evaluate("(p) => window.nibApp.workspace.openEntry(p)", path)
        wait_for(b, "() => window.nibApp.workspace.active.note.latest.includes('FROM-A')", "[B] the note")
        type_at_end(b, "AFTER-HANDOVER ")
        if not on_account("AFTER-HANDOVER"):
            failed(f"after the hand-over nothing reached the account: {account()!r}")
        for words in ("FROM-A", "FROM-B", "AFTER-HANDOVER"):
            if words not in account():
                failed(f"{words} is gone: {account()!r}")
        say(f"at the end: {account()!r}")
        context.close()
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
