from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
BUDGET = 2400
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

EMAIL = "two-hands@example.com"
SPACE = "Two hands"
OPENING = "# Plan\n\nthe line both of them start from\n"

PATIENCE = 60

V2 = "--v2" in sys.argv

RULES = ("v2",) if V2 else ("both", "newest", "ask")

IN_ROOM = (
    "(id) => [...window.nibApp.rooms.carried.values()].some((one) => one.room.settled)"
    if V2
    else "(id) => window.nibApp.rooms.carries(id)"
)

COPY = "(from another device"
SIDES = ("one", "two")
WAYS = ("network", "restart", "noroom")

wrong: list[str] = []

def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)

def request(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    try:
        with urllib.request.urlopen(call, timeout=30) as answer:
            return json.loads(answer.read() or b"null")
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self) -> str:  # type: ignore[override]
        return super().account(EMAIL)

def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(60)

    raise SystemExit(f"gave up waiting for {what}")

def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")

    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("console", lambda message: heard(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.account.user", f"[{label}] the account")
    return page

def heard(label: str, message) -> None:
    text = message.text[:400]
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {text}")
    elif text.startswith("nib/"):
        say(f"[{label}] {text}")

def settled(page: Page, what: str) -> None:
    wait_for(page, "() => window.nibApp.sync.status !== 'syncing'", f"{what} to settle")
    page.wait_for_timeout(1200)

def tree(page: Page) -> list[str]:
    return page.evaluate(
        "() => { const walk = (e) => e ? [e.path, ...(e.children ?? []).flatMap(walk)] : [];"
        " return walk(window.nibApp.workspace.tree) }"
    )

def notes_here(page: Page, about: str) -> dict[str, str]:
    return page.evaluate(
        """async (about) => {
          const ws = window.nibApp.workspace
          const out = {}
          for (const note of ws.notes) {
            if (!note.name.startsWith(about)) continue
            out[note.name] = (await ws.noteText(note.path)) ?? ''
          }
          return out
        }""",
        about,
    )

def history_here(page: Page, about: str) -> list[str]:
    return page.evaluate(
        """(about) => new Promise((resolve, reject) => {
          // The browser's own store, where a version this device kept lives; see
          // `snapshots` in src/lib/web/store.ts. Read here rather than through the
          // app because the history sheet reads it with a command a page cannot
          // call, and what is being checked is that the words are on the device.
          const open = indexedDB.open('nib')
          open.onerror = () => reject(new Error('no store'))
          open.onsuccess = () => {
            const rows = open.result.transaction('snapshots').objectStore('snapshots').getAll()
            rows.onerror = () => reject(new Error('no versions'))
            rows.onsuccess = () => {
              resolve(
                rows.result
                  .filter((row) => String(row.notePath ?? '').includes(about))
                  .map((row) => String(row.content ?? '')),
              )
            }
          }
        })""",
        about,
    )

def clashes_here(page: Page, about: str) -> list[str]:
    if V2:
        return page.evaluate(
            """(about) => (window.nibApp.sync.engine?.heldNotes ?? [])
              .filter((one) => one.name.startsWith(about))
              .map((one) => String(one.theirs?.excerpt?.text ?? ''))""",
            about,
        )
    return page.evaluate(
        """(about) => {
          try {
            const held = JSON.parse(localStorage.getItem('orden:sync-log') ?? '{}')
            return (held.clashes ?? [])
              .filter((one) => String(one.path ?? '').includes(about))
              .map((one) => String(one.theirs ?? ''))
          } catch {
            return []
          }
        }""",
        about,
    )

def notes_there(token: str, space_id: str, about: str) -> dict[str, str]:
    page = request(f"/v1/spaces/{space_id}/changes?since=0", token)
    out: dict[str, str] = {}
    for one in page.get("notes", []):
        if one.get("deleted") or not one["path"].startswith(about):
            continue
        held = request(f"/v1/notes/{one['id']}", token)
        out[one["path"]] = held.get("content", "")

    return out

def write_line(page: Page, said: str) -> None:
    page.evaluate(
        "(text) => { const view = window.nib;"
        " view.dispatch({ changes: { from: view.state.doc.length, insert: text } }) }",
        said,
    )
    page.wait_for_timeout(400)
    page.evaluate(
        "async () => { await window.nibApp.workspace.writeNow() }"
    )
    page.wait_for_timeout(900)

def open_note(page: Page, name: str) -> bool:
    return bool(
        page.evaluate(
            """async ([space, name]) => {
              const ws = window.nibApp.workspace
              const found = ws.spaces.find((one) => one.name === space)
              if (!found) return false
              if (ws.activeSpaceId !== found.id) await ws.selectSpace(found.id)
              await ws.loadTree()
              const note = ws.notes.find((one) => one.name === name)
              if (!note) return false
              await ws.openEntry(note.path, { activate: true })
              return true
            }""",
            [SPACE, name],
        )
    )

def close_note(page: Page) -> None:
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )

def refuse_sockets(page: Page) -> None:
    page.evaluate(
        """() => {
          const Refused = class {
            constructor() {
              this.readyState = 3
              setTimeout(() => this.onclose?.({ code: 1006 }), 0)
            }
            send() {}
            close() {}
          }
          Refused.OPEN = 1
          Refused.CLOSED = 3
          window.WebSocket = Refused
        }"""
    )

def note_id(page: Page, name: str) -> str | None:
    return page.evaluate(
        """([space, name]) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name === name)
          return note ? (window.nibApp.sync.tracked(note.path)?.id ?? null) : null
        }""",
        [SPACE, name],
    )

def run_case(browser: Browser, token: str, space_id: str, rule: str, away: str, how: str) -> None:
    name = f"Plan {rule} {away} {how}.md"
    about = f"Plan {rule} {away} {how}"
    label = f"{rule}/{away}/{how}"
    say(f"--- the rule is {rule!r}, machine {away} goes away by {how} ---")

    made = request(
        f"/v1/spaces/{space_id}/notes", token, {"path": f"{name}", "content": OPENING}
    )
    if not made.get("note"):
        failed(f"[{label}] the note could not be made: {made}")
        return

    pages: dict[str, Page] = {}
    for which in SIDES:
        page = signed_in(browser, token, f"{label}/{which}")
        if not V2:
            page.evaluate("(rule) => window.nibApp.modes.setConflicts(rule)", rule)
        elif page.evaluate("() => window.nibApp.sync.version") != 2:
            failed(f"[{label}/{which}] the account is on v2 and this machine started v1")
        wait_for(
            page,
            f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
            f"[{label}/{which}] the space",
        )
        settled(page, f"[{label}/{which}] the first pass")
        if not open_note(page, name):
            failed(f"[{label}/{which}] never got the note")
            for one in pages.values():
                one.context.close()
            page.context.close()
            return

        pages[which] = page

    first, second = pages["one"], pages["two"]
    held = note_id(first, name)
    if not held:
        failed(f"[{label}] the first machine does not know the note's id")
    else:
        for which, page in pages.items():
            wait_for(
                page,
                f"() => ({IN_ROOM})({json.dumps(held)})",
                f"[{label}/{which}] the note to join its room",
            )

    gone = pages[away]
    stays = pages["two" if away == "one" else "one"]

    if how == "noroom":
        refuse_sockets(gone)
        close_note(gone)
        gone.wait_for_timeout(600)
        if not open_note(gone, name):
            failed(f"[{label}] the note is not there with its room refused")
            for one in pages.values():
                one.context.close()
            return
        gone.wait_for_timeout(1500)
    else:
        DRIVE.preload(gone, harness.WORKER_DIST)
        gone.context.set_offline(True)
        gone.wait_for_timeout(600)

    away_line = f"written on machine {away} while away, rule {rule}"
    stays_line = f"written on the other machine, rule {rule}"
    if V2:
        away_line = f"Machine {away}, from the train: the platform moved to track nine."
        stays_line = "Meanwhile at the desk we drafted the budget for spring."
    write_line(gone, f"\n{away_line}\n")
    write_line(stays, f"\n{stays_line}\n")

    if how == "restart":
        close_note(gone)
        gone.wait_for_timeout(1000)
        say(
            f"[{label}] the note is closed on machine {away}:"
            f" in its room={gone.evaluate(f'() => ({IN_ROOM})({json.dumps(held)})')}"
            f" open={gone.evaluate('() => window.nibApp.workspace.openNotes.length')}"
        )

    for which, page in pages.items():
        say(
            f"[{label}/{which}] while apart: in its room={page.evaluate(f'() => ({IN_ROOM})({json.dumps(held)})')}"
            f" words={json.dumps(read_words(page))[:150]}"
        )

    settled(stays, f"[{label}] the machine that stayed")

    if how != "noroom":
        gone.context.set_offline(False)
        gone.wait_for_timeout(1500)

    if how == "restart":
        if not open_note(gone, name):
            failed(f"[{label}] the note is not there after being closed")
            for one in pages.values():
                one.context.close()
            return
        gone.wait_for_timeout(4000)

    gone.evaluate("() => window.nibApp.sync.nudge()")
    gone.wait_for_timeout(7000)
    settled(gone, f"[{label}] the machine that came back")

    stays.evaluate("() => window.nibApp.sync.nudge()")
    stays.wait_for_timeout(5000)
    settled(stays, f"[{label}] the machine that stayed, after")

    after_line = f"and one more line after all that, rule {rule}"
    write_line(stays, f"\n{after_line}\n")
    stays.wait_for_timeout(3000)

    for page in (gone, stays):
        page.evaluate("() => window.nibApp.sync.nudge()")
        page.wait_for_timeout(4000)
        settled(page, f"[{label}] the last pass")

    stayed = "two" if away == "one" else "one"
    typed = {
        "the words written while away": (away_line, away),
        "the other machine's words": (stays_line, stayed),
        "the line typed after all that": (after_line, stayed),
    }

    words: dict[str, str] = {}
    kept: dict[str, str] = {}
    waiting: dict[str, list[str]] = {}
    for which, page in pages.items():
        page.evaluate("async () => window.nibApp.workspace.loadTree()")
        page.wait_for_timeout(1200)
        held_here = notes_here(page, about)
        say(f"[{label}/{which}] holds {sorted(held_here)}")
        for one, said in held_here.items():
            say(f"[{label}/{which}]   {one}: {json.dumps(said)[:170]}")

        words[which] = " ".join(held_here.values())
        waiting[which] = clashes_here(page, about)
        kept[which] = " ".join([*history_here(page, about), *waiting[which]])
        page.screenshot(path=str(SHOTS / f"{rule}-{away}-{how}-{which}.png"))

    there = notes_there(token, space_id, about)
    say(f"[{label}] the account holds {sorted(there)}")
    account = " ".join(there.values())

    for what, (line, who) in typed.items():
        if line not in words[who] and line not in kept[who]:
            failed(f"[{label}] {what} are gone from machine {who}, which typed them")

        if rule == "v2":
            if waiting["one"] or waiting["two"]:
                continue
            if line not in account:
                failed(f"[{label}] the account lost {what}")
            for which in SIDES:
                if line not in words[which]:
                    failed(f"[{label}] machine {which} lost {what}")
            continue

        if rule != "both":
            continue

        if line not in account:
            failed(f"[{label}] the account lost {what}")
        for which in SIDES:
            if line not in words[which]:
                failed(f"[{label}] machine {which} lost {what}")

    if rule == "both":
        copies = [one for one in there if one != name]
        say(f"[{label}] the copy beside the note is {copies}")
        if words["one"] != words["two"] and not copies:
            failed(f"[{label}] the two machines disagree and no copy was kept beside the note")

    if rule == "v2":
        if waiting["one"] or waiting["two"]:
            failed(f"[{label}] the question came up over two lines added side by side")
        copies = [one for one in [*there, *notes_here(gone, about), *notes_here(stays, about)] if COPY in one]
        if copies:
            failed(f"[{label}] a copy was made beside the note under v2: {copies}")
        say(f"[{label}] held for the question: one={len(waiting['one'])} two={len(waiting['two'])}")

    if rule == "ask":
        say(f"[{label}] waiting in the pane: one={len(waiting['one'])} two={len(waiting['two'])}")
        if words["one"] != words["two"] and not waiting["one"] and not waiting["two"]:
            failed(f"[{label}] the two machines disagree and the pane is not waiting on anything")

    for which, page in pages.items():
        said = page.evaluate(
            "() => ({ status: window.nibApp.sync.status,"
            " lastError: window.nibApp.sync.lastError ?? null })"
        )
        say(f"[{label}/{which}] sync says {json.dumps(said)}")
        if said["status"] == "error":
            failed(f"[{label}/{which}] sync is in error: {json.dumps(said)}")

    for page in pages.values():
        page.context.close()

def read_words(page: Page) -> str:
    return page.evaluate(
        "() => { window.nibApp.workspace.flush(); return window.nibApp.workspace.active?.doc ?? '' }"
    )

def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account()
        if V2:
            worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")

        owner = signed_in(browser, token, "owner")
        wait_for(owner, "() => !!window.nibApp.workspace.activeSpace", "a space")
        owner.evaluate(
            "async (name) => { const ws = window.nibApp.workspace; await ws.addSpace(name);"
            " const space = ws.spaces.find((one) => one.name === name);"
            " await ws.selectSpace(space.id) }",
            SPACE,
        )
        space_id = wait_for(
            owner,
            "() => window.nibApp.sync.remoteIdFor(window.nibApp.workspace.activeSpace.root)",
            "the space to reach the account",
        )
        settled(owner, "the first push")
        say(f"the space is {space_id} on the account")
        owner.context.close()

        words = [one for one in sys.argv[1:] if not one.startswith("--")]
        only = words[0] if words else ""
        for rule in RULES:
            for away in SIDES:
                for how in WAYS:
                    if only and only not in f"{rule}/{away}/{how}":
                        continue
                    try:
                        run_case(browser, token, space_id, rule, away, how)
                    except SystemExit as gave_up:
                        failed(f"[{rule}/{away}/{how}] gave up: {gave_up}")

    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1

    print("\nevery case kept every line somebody typed", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
