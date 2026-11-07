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
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

EMAIL = "renamer@example.com"
SPACE = "Notes"
RENAMED = "Renamed"
NOTE = "together.md"
CANVAS = "Board.canvas"
OPENING = "# Together\n\nthe first line\n"

PATIENCE = 40

sockets: dict[str, list[str]] = {}

def request(
    path: str, token: str | None = None, body: dict | None = None, method: str | None = None
):
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
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")

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
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")

def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    sockets[label] = []
    page.on("websocket", lambda ws: sockets[label].append(ws.url))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page

def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")

def opened(page: Page, label: str, note_id: str) -> None:
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )

    listed = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.nibApp.workspace.tree)"
        f"    .includes('/{SPACE}/{NOTE}')"
        "}"
    )
    wait_for(page, listed, f"[{label}] the note to arrive")

    page.evaluate(f"() => window.nibApp.workspace.open('/{SPACE}/{NOTE}')")
    wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
    wait_for(
        page,
        f"() => window.nibApp.rooms.carries({json.dumps(note_id)})",
        f"[{label}] the note to join its room",
    )

def words(page: Page) -> str:
    return page.evaluate(
        "() => { window.nibApp.workspace.flush();"
        " return window.nibApp.workspace.active?.doc ?? '' }"
    )

def type_at(page: Page, at: int, said: str) -> None:
    page.click(".cm-content")
    page.evaluate(
        "(at) => {"
        "  window.nib.dispatch({ selection: { anchor: Math.min(at, window.nib.state.doc.length) } });"
        "  window.nib.focus()"
        "}",
        at,
    )
    page.keyboard.type(said, delay=12)

def crosses(one: Page, two: Page, said: str, label: str) -> None:
    type_at(one, len(words(one)), said)

    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        if said.strip() in words(two):
            say(f"{label}: arrived")
            return
        two.wait_for_timeout(25)

    raise SystemExit(
        f"{label}: never arrived."
        f"\n  the one who typed holds {words(one)!r} and {state(one)}"
        f"\n  the one waiting holds {words(two)!r} and {state(two)}"
    )

def state(page: Page) -> str:
    return page.evaluate(
        "() => {"
        "  const rooms = window.nibApp.rooms;"
        "  return `path ${window.nibApp.workspace.active?.path ?? '-'},"
        " present ${JSON.stringify(rooms.present)}`"
        "}"
    )

def reaches_the_account(token: str, note_id: str, said: str) -> None:
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        held = request(f"/v1/notes/{note_id}", token).get("content") or ""
        if said.strip() in held:
            say("the account has them too")
            return
        time.sleep(0.5)

    held = request(f"/v1/notes/{note_id}", token).get("content") or ""
    raise SystemExit(f"the account never got them. it holds {held!r}")

def restores_a_canvas(browser: Browser, token: str, failures: list[str]) -> None:
    page = signed_in(browser, token, "restored")

    wait_for(
        page,
        "() => window.nibApp.workspace.spaces.some("
        f"  (one) => one.name === {json.dumps(RENAMED)})",
        "[restored] the account’s space to arrive",
    )
    page.evaluate(
        "async () => {"
        "  const workspace = window.nibApp.workspace;"
        f"  const space = workspace.spaces.find((one) => one.name === {json.dumps(RENAMED)});"
        "  await workspace.showSpace(space.id)"
        "}"
    )

    looking = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        f"  return walk(window.nibApp.workspace.tree).find((path) => path.endsWith('/{CANVAS}')) ?? ''"
        "}"
    )

    until = time.monotonic() + PATIENCE
    board = ""
    while time.monotonic() < until:
        board = page.evaluate(looking)
        if board:
            break
        page.wait_for_timeout(100)

    if not board:
        seen = page.evaluate(
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            "  return JSON.stringify({"
            "    spaces: window.nibApp.workspace.spaces.map((one) => one.root),"
            "    active: window.nibApp.workspace.activeSpaceId,"
            "    tree: walk(window.nibApp.workspace.tree)"
            "  })"
            "}"
        )
        failures.append(f"the canvas never came down to a fresh browser: {seen}")
        return

    say(f"[restored] the canvas came down as {board}")

    page.evaluate(f"async () => {{ await window.nibApp.workspace.openEntry({json.dumps(board)}) }}")
    wait_for(
        page,
        f"() => window.nibApp.workspace.active?.path === {json.dumps(board)}"
        " && window.nibApp.workspace.active?.kind === 'canvas'",
        "[restored] the canvas to open as one",
    )

    wait_for(
        page,
        "() => (localStorage.getItem('orden:workspace') ?? '').includes"
        f"({json.dumps(CANVAS)})",
        "[restored] the session to be written down",
    )

    page.evaluate(
        "() => {"
        "  const held = JSON.parse(localStorage.getItem('orden:workspace'));"
        "  const walk = (value) => {"
        "    if (Array.isArray(value)) { value.forEach(walk); return }"
        "    if (!value || typeof value !== 'object') return;"
        "    if (typeof value.path === 'string' && value.path.endsWith('.canvas') && value.kind) {"
        "      value.kind = 'note'"
        "    }"
        "    Object.values(value).forEach(walk)"
        "  };"
        "  walk(held);"
        "  localStorage.setItem('orden:workspace', JSON.stringify(held))"
        "}"
    )

    page.reload(wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp", "[restored] the app to start again")
    wait_for(
        page,
        f"() => !!window.nibApp.workspace.documents.find((one) => one.path === {json.dumps(board)})",
        "[restored] the canvas tab to come back",
    )

    kind = page.evaluate(
        "() => window.nibApp.workspace.documents.find("
        f"  (one) => one.path === {json.dumps(board)}).kind"
    )
    if kind != "canvas":
        failures.append(f"a canvas came back from the session as {kind!r}")
    else:
        say("a canvas whose entry said otherwise still comes back as a canvas")

    page.screenshot(path=str(SHOTS / "space-rename-restored.png"))

def main() -> int:
    worker = Worker()
    failures: list[str] = []

    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
        worker.start()

        token = worker.account()
        space = request("/v1/spaces", token, {"name": SPACE})["space"]
        note = request(
            f"/v1/spaces/{space['id']}/notes", token, {"path": NOTE, "content": OPENING}
        )["note"]
        note_id = note["id"]
        request(f"/v1/spaces/{space['id']}/notes", token, {"path": CANVAS, "content": "{}"})
        say(f"the account holds {SPACE}/{NOTE} as {note_id}, and {SPACE}/{CANVAS} beside it")

        one = signed_in(browser, token, "one")
        opened(one, "one", note_id)
        two = signed_in(browser, token, "two")
        opened(two, "two", note_id)
        say("both browsers are in the room")

        crosses(one, two, "\nbefore the rename\n", "before the rename, one to two")

        which = one.evaluate(
            "() => window.nibApp.workspace.spaces.find("
            f"  (one) => one.name === {json.dumps(SPACE)}).id"
        )
        one.evaluate(
            "async ([id, name]) => {"
            "  const workspace = window.nibApp.workspace;"
            "  const space = workspace.spaces.find((one) => one.id === id);"
            "  const from = space.root;"
            "  await workspace.renameSpace(id, name);"
            "  await window.nibApp.sync.renamed(from, space.root, space.name)"
            "}",
            [which, RENAMED],
        )
        wait_for(
            one,
            "() => window.nibApp.workspace.spaces.some("
            f"  (one) => one.name === {json.dumps(RENAMED)})",
            "[one] the space to be renamed",
        )
        moved = one.evaluate("() => window.nibApp.workspace.active?.path ?? ''")
        say(f"the space is renamed and the open note is now at {moved}")
        say(f"the renamer has opened {len(sockets['one'])} room sockets so far")
        if f"/{RENAMED}/" not in moved:
            failures.append(f"the open note was not moved with its space: {moved!r}")

        try:
            wait_for(
                one,
                f"() => window.nibApp.rooms.carries({json.dumps(note_id)})",
                "the renamed note to be in its room again",
            )
        except SystemExit:
            failures.append("the renamed note left its room")

        crosses(one, two, "\nafter the rename\n", "after the rename, one to two")
        crosses(two, one, "\nand back again\n", "after the rename, two to one")

        until = time.monotonic() + PATIENCE
        while time.monotonic() < until:
            if words(one) == words(two):
                break
            one.wait_for_timeout(25)

        here, over_there = words(one), words(two)
        if here != over_there:
            failures.append(f"the two never agreed:\n{here!r}\n{over_there!r}")
        else:
            say("both browsers hold the same words")

        for expected in ("before the rename", "after the rename", "and back again"):
            if expected not in here:
                failures.append(f"{expected!r} was lost")

        reaches_the_account(token, note_id, "after the rename")

        one.screenshot(path=str(SHOTS / "space-rename-one.png"))
        two.screenshot(path=str(SHOTS / "space-rename-two.png"))

        restores_a_canvas(browser, token, failures)

    if failures:
        print("\nFAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("\nPASSED: a space rename leaves the note writing in both directions")
    return 0

if __name__ == "__main__":
    sys.exit(main())
