import hashlib
import json
import sys
import time
import uuid
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
BUDGET = 900
say = DRIVE.say
ORIGIN = harness.worker_origin()
EMAIL = "sync-latency@example.com"
TARGET = 2.0
PATIENCE = 90.0
VERSIONS = [1, 2] if "--v1" in sys.argv else [2]
PATHS = (
    "() => { const ws = window.ordenApp.workspace; const base = ws.activeSpace.root.replace(/\\/+$/, '') + '/';"
    " return ws.notes.map((n) => n.path.slice(base.length)).sort() }"
)
wrong: list[str] = []
table: list[tuple[str, str, float]] = []
def second_token(worker: harness.Worker, email: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    user = worker.query(f"select id from users where email = '{email}'")[0]["id"]
    worker.sql(harness.session_row(hashlib.sha256(token.encode()).hexdigest(), user, int(time.time() * 1000)))
    return token
def wait_for(page: Page, script: str, what: str, patience: float = PATIENCE, arg: object = None):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")
def signed_in(browser: Browser, token: str, label: str, frames: list) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    def socket(ws) -> None:
        frames.append((time.monotonic(), label, "open", ws.url.split("/v2/")[-1][:40]))
        ws.on("framereceived", lambda frame: frames.append((time.monotonic(), label, "in", str(frame)[:80])))
        ws.on("close", lambda _: frames.append((time.monotonic(), label, "close", ws.url[-40:])))
    page.on("websocket", socket)
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account.user", f"[{label}] the account")
    return page
def select(page: Page, space: str) -> None:
    wait_for(page, "(n) => window.ordenApp.workspace.spaces.some((one) => one.name === n)", f"space {space}", arg=space)
    page.evaluate(
        "async (name) => { const ws = window.ordenApp.workspace;"
        " await ws.selectSpace(ws.spaces.find((one) => one.name === name).id); await ws.loadTree() }",
        space,
    )
def act(page: Page, script: str) -> None:
    page.evaluate(
        "async (script) => { const ws = window.ordenApp.workspace; await ws.loadTree();"
        " const at = (rel) => ws.activeSpace.root.replace(/\\/+$/, '') + '/' + rel;"
        " await (new Function('ws', 'at', `return (async () => { ${script} })()`))(ws, at) }",
        script,
    )
def record(version: int | str, what: str, seconds: float) -> None:
    table.append((f"v{version}", what, seconds))
    say(f"v{version} {what}: {seconds:.2f} s")
    if seconds > TARGET and str(version).startswith("2"):
        wrong.append(f"v{version} {what} took {seconds:.2f} s, more than {TARGET} s")
def shows(version: int | str, away: Page, what: str, check: str, started: float) -> None:
    try:
        wait_for(away, f"() => {{ const p = ({PATHS})(); return {check} }}", what)
        record(version, what, time.monotonic() - started)
    except SystemExit:
        record(version, what, PATIENCE)
def open_note(page: Page, rel: str) -> None:
    page.evaluate(
        "async (rel) => { const ws = window.ordenApp.workspace; await ws.loadTree();"
        " const path = ws.activeSpace.root.replace(/\\/+$/, '') + '/' + rel;"
        " await ws.openEntry(path, { activate: true }) }",
        rel,
    )
    page.wait_for_function(
        "() => { const tab = window.ordenApp.workspace.active; return !!tab && !tab.coming && !!window.orden"
        " && window.orden.state.doc.length > 0 }",
        timeout=20000,
    )
def typed(page: Page, words: str) -> None:
    page.evaluate(
        "(text) => { const view = window.orden; view.dispatch({ changes: { from: view.state.doc.length, insert: text } }) }",
        f" {words}",
    )
def holds(page: Page, words: str) -> bool:
    return bool(page.evaluate("(w) => !!window.orden && window.orden.state.doc.toString().includes(w)", words))
def live_after(version: int | str, writer: Page, reader: Page, what: str, started: float) -> None:
    sent: list[tuple[str, float]] = []
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        words = f"{what.split()[0]}{len(sent)}x"
        typed(writer, words)
        sent.append((words, time.monotonic()))
        writer.wait_for_timeout(150)
        for one, at in sent:
            if holds(reader, one) and time.monotonic() - at < 1.0:
                record(version, what, at - started)
                return
    record(version, what, PATIENCE)
def run(browser: Browser, worker: harness.Worker, version: int, shared: bool = False) -> None:
    email = f"v{version}{'-shared' if shared else ''}-{EMAIL}"
    label = f"{version} on one session" if shared else str(version)
    token = worker.account(email)
    if version == 2:
        worker.sql(f"update users set sync_version = 2 where email = '{email}'")
    frames: list = []
    if shared:
        away = signed_in(browser, token, "away", frames)
        away.wait_for_timeout(3000)
        here = signed_in(browser, token, "here", frames)
    else:
        here = signed_in(browser, token, "here", frames)
        away = signed_in(browser, second_token(worker, email), "away", frames)
    space = f"Latency {label}"
    here.evaluate(
        "async (name) => { const ws = window.ordenApp.workspace; await ws.addSpace(name);"
        " await ws.selectSpace(ws.spaces.find((one) => one.name === name).id) }",
        space,
    )
    act(here, "await ws.noteFrom('# Seed\\n\\nthe seed\\n', ws.activeSpace.root)")
    here.evaluate("() => window.ordenApp.sync.nudge()")
    away.reload(wait_until="domcontentloaded")
    wait_for(away, "() => !!window.ordenApp?.account.user", "away again")
    select(away, space)
    wait_for(away, f"() => ({PATHS})().includes('Seed.md')", "away to hold the seed")
    here.wait_for_timeout(8000)
    mark = len(frames)
    started = time.monotonic()
    act(here, "await ws.noteFrom('# Made\\n\\nmade here\\n', ws.activeSpace.root)")
    shows(label, away, "create", "p.includes('Made.md')", started)
    started = time.monotonic()
    act(here, "await ws.rename(at('Made.md'), 'Named.md')")
    shows(label, away, "rename", "p.includes('Named.md') && !p.includes('Made.md')", started)
    act(here, "await ws.noteFrom('# keep\\n', at('F'))")
    wait_for(away, f"() => ({PATHS})().some((one) => one.startsWith('F/'))", "the folder")
    here.wait_for_timeout(3000)
    started = time.monotonic()
    act(here, "await ws.moveMany([at('Named.md')], at('F'))")
    shows(label, away, "move", "p.includes('F/Named.md') && !p.includes('Named.md')", started)
    started = time.monotonic()
    act(here, "await ws.remove(at('F/Named.md'), false)")
    shows(label, away, "delete", "!p.includes('F/Named.md')", started)
    here.wait_for_timeout(3000)
    open_note(here, "Seed.md")
    here.wait_for_timeout(1500)
    started = time.monotonic()
    open_note(away, "Seed.md")
    live_after(label, away, here, "away typing reaches here", started)
    live_after(label, here, away, "here typing reaches away", started)
    t0 = frames[mark][0] if len(frames) > mark else started
    for at, who, kind, said in frames[mark:]:
        if kind != "in" or "poke" in said or "room" in said or "hello" in said:
            say(f"  ws {at - t0:7.2f} {who} {kind} {said}")
    for page in (here, away):
        page.context.close()
def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        for version in VERSIONS:
            try:
                run(browser, worker, version)
            except SystemExit as gave_up:
                wrong.append(f"v{version} gave up: {gave_up}")
        try:
            run(browser, worker, 2, shared=True)
        except SystemExit as gave_up:
            wrong.append(f"v2 on one session gave up: {gave_up}")
    print("\n| sync | what | seconds |\n|---|---|---|", flush=True)
    for version, what, seconds in table:
        print(f"| {version} | {what} | {seconds:.2f} |", flush=True)
    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print(f"\nevery change showed within {TARGET} s with sync v2", flush=True)
    return 0
sys.exit(main())
