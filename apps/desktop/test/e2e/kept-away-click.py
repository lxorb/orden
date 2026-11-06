from __future__ import annotations

import json
import time

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
ORIGIN = harness.worker_origin()
PATIENCE = 60
EMAIL = "kept-away-click@example.com"
SPACE = "Live"
ROOT = f"/{SPACE}"
NOTES = [f"{ROOT}/Note {index:02d}.md" for index in range(1, 61)]

wrong: list[str] = []

def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)

class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)

def wait_for(page: Page, script: str, what: str, arg: object = None, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    failed(f"gave up waiting for {what}")
    return None

MISSING = "(paths) => paths.filter((one) => !window.nibApp.workspace.entryAt(one))"

ROW = """(path) => document.querySelector(`.row[data-path="${CSS.escape(path)}"]`)"""

def window_for(context, label: str) -> Page:
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: failed(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp?.account.user", f"[{label}] the account")
    wait_for(
        page,
        "(name) => window.nibApp.workspace.spaces.some((one) => one.name === name)",
        f"[{label}] the space",
        SPACE,
    )
    page.evaluate(
        "(name) => { const ws = window.nibApp.workspace;"
        " ws.showSpace(ws.spaces.find((one) => one.name === name).id) }",
        SPACE,
    )
    wait_for(
        page,
        f"""(paths) => window.nibApp.arriving.coming.size === 0 && !({MISSING})(paths).length""",
        f"[{label}] every note listed",
        NOTES,
    )
    wait_for(page, "() => !!window.nibApp.sync.engine?.engine", f"[{label}] the engine")
    page.evaluate("() => { const ws = window.nibApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    wait_for(page, "() => !!document.querySelector('[role=tree] .row')", f"[{label}] the file list")
    return page

def scroll_to(page: Page, path: str) -> None:
    page.evaluate(
        f"""async (path) => {{
          let box = document.querySelector('[role=tree]')
          while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
          const row = {ROW}
          const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
          for (let step = 0; step < 200 && !row(path); step++) {{
            box.scrollTop += box.clientHeight / 2
            await frame()
          }}
          box.scrollTop += row(path).getBoundingClientRect().top - box.getBoundingClientRect().top
          await frame()
          await frame()
        }}""",
        path,
    )
    page.wait_for_timeout(300)

def kept_away(page: Page, path: str) -> bool:
    return page.evaluate(
        "(path) => window.nibApp.sync.engine.engine.awayFiles().some((one) => one.path === path)",
        path,
    )

def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(EMAIL)
        worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")
        space = worker.request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        for path in NOTES:
            name = path.removeprefix(f"{ROOT}/")
            worker.request(
                f"/v1/spaces/{space['id']}/notes",
                token=token,
                body={"path": name, "content": f"# {name}\n"},
            )

        def device():
            context = browser.new_context(viewport={"width": 1100, "height": 560})
            context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
            return context

        a = window_for(device(), "A")
        b = window_for(device(), "B")
        a.bring_to_front()

        reading = f"{ROOT}/Note 35.md"
        if not kept_away(a, reading):
            failed("A keeps the words of Note 35 before anything asked for them")
        scroll_to(a, f"{ROOT}/Note 30.md")
        a.locator(f'.row[data-path="{reading}"]').click()
        wait_for(a, "(path) => window.nibApp.workspace.active?.path === path", "[A] Note 35 open", reading)
        lost: set[str] = set()
        for _ in range(16):
            lost.update(a.evaluate(MISSING, NOTES))
            a.wait_for_timeout(250)
        if lost:
            failed(f"notes left A's list after a row was clicked: {sorted(lost)}")
        if kept_away(a, reading):
            failed("Note 35, open on A, is still kept away")
        words = a.evaluate("() => window.nibApp.workspace.active?.note?.latest ?? null")
        if "# Note 35.md" not in (words or ""):
            failed(f"Note 35 opened on A with other words: {words!r}")
        say(f"A clicked Note 35: it opened, and {60 - len(lost)} of 60 notes stayed listed")

        going = f"{ROOT}/Note 36.md"
        if not kept_away(b, going):
            failed("B keeps the words of Note 36 before anything asked for them")
        try:
            b.evaluate("(path) => window.nibApp.workspace.remove(path, false)", going)
        except Exception as error:
            failed(f"B could not delete Note 36, which it keeps no words of: {error}")
        wait_for(b, "(paths) => !window.nibApp.workspace.entryAt(paths[0])", "[B] Note 36 gone", [going])
        wait_for(a, "(paths) => !window.nibApp.workspace.entryAt(paths[0])", "[A] Note 36 gone", [going])
        rest = [one for one in NOTES if one != going]
        for label, page in (("A", a), ("B", b)):
            missing = page.evaluate(MISSING, rest)
            if missing:
                failed(f"[{label}] notes left the list with Note 36: {missing}")
        say("B deleted Note 36 without its words, and both lists lost that one alone")
        DRIVE.shot(a, "01-after")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
