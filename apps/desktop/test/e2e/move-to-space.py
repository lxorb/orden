"""A note moved to another space is moved, not copied (#413).

Emil: "moving a note to a different space just copies it (after choosing move in the
right click menu)". Against the real Worker, signed in, on sync v2 (and v1 with --v1):
a note, a folder, a canvas and a page note in Home, each moved to Work the way the row's
Move does it (`workspace.moveMany`), and then:

    Home no longer has it and Work does, on this device's disk
    the account agrees, once sync has been round
    a relaunch of the same device still agrees
    a second device signing in agrees
    a move back to Home and one Ctrl+Z put all of it in Work again, on the disk and
    the account

The note is open and typed in before the move, and typed in again after it, in the tab
that followed it. The room settled the words typed before the move under the name the
socket gave, the tree's delete came under the session's, and the delete was refused as
somebody else's edit: the note stayed in Home (#413). The harness signs in with a session
no device is bound to, which is that case.

    python apps/desktop/test/e2e/move-to-space.py [--v1]
"""

from __future__ import annotations

import json
import sys
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = harness.worker_origin()
OWNER = "mover@example.com"
V1 = "--v1" in sys.argv
PATIENCE = 60

BLANK_CANVAS = '{"nodes":[],"edges":[]}'
BLANK_PAGES = '{"nodes":[{"id":"p1","type":"group","x":-397,"y":0,"width":794,"height":1123,"label":"Page 1"}],"edges":[],"nib":{"version":1,"pages":[{"id":"p1","paper":"a4","pattern":"blank"}]}}'
FILES = {
    "Plan.md": "# Plan\n\nThe plan.\n",
    "Trip/Trip.md": "# Trip\n\nThe trip.\n",
    "Trip/Map.md": "# Map\n\nThe map.\n",
    "Board.canvas": BLANK_CANVAS,
    "Lecture.pages": BLANK_PAGES,
}
MOVED = ["Plan.md", "Trip", "Board.canvas", "Lecture.pages"]

FILES_OF = """(name) => {
  const ws = window.nibApp.workspace
  const space = ws.spaces.find((one) => one.name === name)
  if (!space) return null
  if (ws.activeSpace?.id !== space.id) return null
  const out = []
  const walk = (entry) => {
    for (const child of entry.children ?? []) {
      out.push(child.path.slice(space.root.length + 1))
      if (child.is_dir) walk(child)
    }
  }
  if (ws.tree) walk(ws.tree)
  return out.sort()
}"""


def wait(page: Page, script: str, what: str, arg: object = None, patience: float = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(250)
    raise SystemExit(f"gave up waiting for {what}")


def device(browser: Browser, label: str, token: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait(page, "() => !!window.nibApp?.workspace?.activeSpace", f"[{label}] the app")
    return page


def shown(page: Page, name: str) -> list[str]:
    """The files of space `name`, with that space on screen."""
    page.evaluate(
        "async (name) => { const ws = window.nibApp.workspace; const s = ws.spaces.find((o) => o.name === name);"
        " if (s && ws.activeSpace?.id !== s.id) await ws.showSpace(s.id); await ws.loadTree() }",
        name,
    )
    return list(page.evaluate(FILES_OF, name) or [])


def on_account(worker: harness.Worker, space: str) -> list[str]:
    rows = worker.query(
        f"select path from notes where space_id = '{space}' and deleted = 0 order by path"
    )
    return [str(row["path"]) for row in rows]


def holds(listed: list[str], name: str) -> bool:
    return any(one == name or one.startswith(f"{name}/") for one in listed)


def check(label: str, home: list[str], work: list[str]) -> None:
    for name in MOVED:
        if holds(home, name):
            wrong(f"[{label}] Home still has {name}: {home}")
        if not holds(work, name):
            wrong(f"[{label}] Work does not have {name}: {work}")
    say(f"[{label}] Home {home}, Work {work}")


def drive(browser: Browser, worker: harness.Worker, token: str, ids: dict[str, str]) -> None:
    desk = device(browser, "desk", token)
    wait(desk, "() => window.nibApp.workspace.spaces.length >= 2", "[desk] both spaces")
    wait(
        desk,
        "(n) => window.nibApp.workspace.spaces.some((s) => s.name === 'Home')",
        "[desk] Home",
    )
    until = time.monotonic() + PATIENCE
    while len(shown(desk, "Home")) < len(FILES) + 1 and time.monotonic() < until:
        desk.wait_for_timeout(500)
    say(f"[desk] Home holds {shown(desk, 'Home')}")

    work_root = desk.evaluate("() => window.nibApp.workspace.spaces.find((s) => s.name === 'Work').root")
    home_root = desk.evaluate("() => window.nibApp.workspace.spaces.find((s) => s.name === 'Home').root")
    shown(desk, "Home")
    # The note somebody moves is the note they are reading: open, typed into, and in
    # its room, as the row's menu would find it.
    desk.evaluate("async (path) => { await window.nibApp.workspace.open(path) }", f"{home_root}/Plan.md")
    wait(desk, "() => !!document.querySelector('.cm-content')", "[desk] Plan open")
    desk.locator(".cm-content").first.click()
    desk.keyboard.press("Control+End")
    desk.keyboard.type(" Typed before the move.")
    desk.wait_for_timeout(3000)
    # All four at once, as a selection's Move does it: one move, and one Ctrl+Z.
    desk.evaluate(
        "async ([from, into]) => { await window.nibApp.workspace.moveMany(from, into) }",
        [[f"{home_root}/{name}" for name in MOVED], work_root],
    )
    check("desk, at once", shown(desk, "Home"), shown(desk, "Work"))
    tab = desk.evaluate("() => window.nibApp.workspace.tabs.map((one) => one.path)")
    if f"{work_root}/Plan.md" not in tab:
        wrong(f"[desk] Plan's tab did not follow it into Work: {tab}")

    # And somebody goes on writing in it, which is what the tab is there for: it followed
    # the note into Work, and so must every word typed into it from here on.
    desk.evaluate("async (path) => { await window.nibApp.workspace.open(path) }", f"{work_root}/Plan.md")
    wait(desk, "() => !!document.querySelector('.cm-content')", "[desk] Plan open in Work")
    desk.locator(".cm-content").first.click()
    desk.keyboard.press("Control+End")
    desk.keyboard.type(" Typed after the move.")
    desk.wait_for_timeout(3000)

    # Sync round: nudged, and given time to go and come back.
    for _ in range(3):
        desk.evaluate("() => window.nibApp.sync.nudge?.()")
        desk.wait_for_timeout(4000)
    check("desk, after sync", shown(desk, "Home"), shown(desk, "Work"))
    check("the account", on_account(worker, ids["Home"]), on_account(worker, ids["Work"]))

    desk.reload(wait_until="domcontentloaded")
    wait(desk, "() => !!window.nibApp?.workspace?.activeSpace", "[desk] the app again")
    desk.wait_for_timeout(6000)
    check("desk, relaunched", shown(desk, "Home"), shown(desk, "Work"))

    other = device(browser, "other", token)
    wait(other, "() => window.nibApp.workspace.spaces.length >= 2", "[other] both spaces")
    other.wait_for_timeout(10000)
    check("another device", shown(other, "Home"), shown(other, "Work"))
    words = other.evaluate(
        "async () => { const ws = window.nibApp.workspace; const s = ws.spaces.find((o) => o.name === 'Work');"
        " return await ws.noteText(`${s.root}/Plan.md`) }"
    )
    say(f"[another device] Work/Plan.md says {words!r}")
    for typed in ("Typed before the move.", "Typed after the move."):
        if typed not in (words or ""):
            wrong(f"[another device] Work/Plan.md is missing {typed!r}")
    other.context.close()

    # Back the other way, all four at once, and one Ctrl+Z puts the whole move back -
    # here and on the account. (After the relaunch: what Ctrl+Z undoes is this run's.)
    try:
        desk.evaluate(
            "async ([from, into]) => { await window.nibApp.workspace.moveMany(from, into) }",
            [[f"{work_root}/{name}" for name in MOVED], home_root],
        )
    except Exception as error:  # noqa: BLE001 - a refused move is the finding, not a crash
        wrong(f"[desk] the move back to Home was refused: {error}")
        return
    back = shown(desk, "Work"), shown(desk, "Home")
    for name in MOVED:
        if holds(back[0], name) or not holds(back[1], name):
            wrong(f"[desk, moved back] {name} is not back in Home: Home {back[1]}, Work {back[0]}")
    desk.evaluate("async () => { await window.nibApp.workspace.undoFileAction() }")
    check("desk, undone", shown(desk, "Home"), shown(desk, "Work"))
    for _ in range(3):
        desk.evaluate("() => window.nibApp.sync.nudge?.()")
        desk.wait_for_timeout(4000)
    check("desk, undone and synced", shown(desk, "Home"), shown(desk, "Work"))
    check("the account, undone", on_account(worker, ids["Home"]), on_account(worker, ids["Work"]))

def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(OWNER)
        if not V1:
            worker.sql(f"update users set sync_version = 2 where email = '{OWNER}'")
        ids = {}
        for name in ("Home", "Work"):
            ids[name] = worker.request("/v1/spaces", token=token, body={"name": name})["space"]["id"]
        for path, content in FILES.items():
            worker.request(f"/v1/spaces/{ids['Home']}/notes", token=token, body={"path": path, "content": content})
        say(f"the account, on sync v{1 if V1 else 2}, holds Home {sorted(FILES)} and an empty Work")
        drive(browser, worker, token, ids)
    return DRIVE.verdict("a move to another space moves, on the disk, the account and every device")


if __name__ == "__main__":
    raise SystemExit(main())
