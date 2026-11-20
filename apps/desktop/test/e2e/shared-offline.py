import hashlib
import json
import sys
import time
import uuid
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
BUDGET = 1800
say = DRIVE.say
ORIGIN = harness.worker_origin()
EMAIL = "shared-owner@example.com"
MEMBER = "shared-member@example.com"
PATIENCE = 60
ONLY = [one for one in sys.argv[1:] if not one.startswith("--")]
wrong: list[str] = []
def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
def token_for(worker: Worker, email: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    user = worker.query(f"select id from users where email = '{email}'")[0]["id"]
    worker.sql(harness.session_row(hashlib.sha256(token.encode()).hexdigest(), user, int(time.time() * 1000)))
    return token
def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE, arg=None):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg) if arg is not None else page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")
def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 760})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account.user", f"[{label}] the account")
    return page
def settled(page: Page) -> None:
    wait_for(page, "() => window.ordenApp.sync.status !== 'syncing'", "sync to settle")
    page.wait_for_timeout(1200)
def passes(pages, times: int = 2) -> None:
    for _ in range(times):
        for page in pages:
            page.evaluate("() => window.ordenApp.sync.nudge()")
            page.wait_for_timeout(2500)
            settled(page)
def select(page: Page, space: str) -> None:
    wait_for(page, "(n) => window.ordenApp.workspace.spaces.some((one) => one.name === n)", f"space {space}", arg=space)
    page.evaluate(
        "async (name) => { const ws = window.ordenApp.workspace;"
        " await ws.selectSpace(ws.spaces.find((one) => one.name === name).id); await ws.loadTree() }",
        space,
    )
def files(page: Page, space: str) -> dict[str, str] | None:
    return page.evaluate(
        """async (name) => {
          const ws = window.ordenApp.workspace
          const found = ws.spaces.find((one) => one.name === name)
          if (!found) return null
          await ws.selectSpace(found.id)
          await ws.loadTree()
          const base = found.root.replace(/\\/+$/, '') + '/'
          const out = {}
          for (const note of ws.notes) out[note.path.slice(base.length)] = (await ws.noteText(note.path)) ?? ''
          return out
        }""",
        space,
    )
def spaces(page: Page) -> list[str]:
    return page.evaluate("() => window.ordenApp.workspace.spaces.map((one) => one.name).sort()")
def there(worker: Worker, token: str, space_id: str) -> dict[str, str]:
    listed = worker.request(f"/v1/spaces/{space_id}/changes?since=0", token=token)
    out: dict[str, str] = {}
    for one in listed.get("notes", []):
        if not one.get("deleted"):
            out[one["path"]] = worker.request(f"/v1/notes/{one['id']}", token=token).get("content", "")
    return out
def act(page: Page, script: str) -> None:
    page.evaluate(
        "async (script) => { const ws = window.ordenApp.workspace; await ws.loadTree();"
        " const at = (rel) => ws.activeSpace.root.replace(/\\/+$/, '') + '/' + rel;"
        " await (new Function('ws', 'at', `return (async () => { ${script} })()`))(ws, at); await ws.loadTree() }",
        script,
    )
def restore(page: Page, names: list[str]) -> list[str]:
    page.evaluate("() => { const { settings } = window.ordenApp; settings.section = 'trash'; settings.open = true }")
    page.wait_for_timeout(3000)
    region = page.locator("[role=region][aria-label=Settings]")
    rows = region.locator(".row")
    listed = [rows.nth(i).locator(".title").inner_text() for i in range(rows.count())]
    say(f"Recently deleted lists {listed}")
    pressed = []
    for name in names:
        row = rows.filter(has=page.locator(".title", has_text=name)).first
        if not row.count():
            continue
        row.get_by_role("button", name="Restore").click()
        pressed.append(name)
        page.wait_for_timeout(2500)
    page.evaluate("() => { window.ordenApp.settings.open = false }")
    return pressed
def new_space(worker: Worker, token: str, name: str, seed: dict[str, str]) -> str:
    space = worker.request("/v1/spaces", token=token, body={"name": name})["space"]
    for path, content in seed.items():
        worker.request(f"/v1/spaces/{space['id']}/notes", token=token, body={"path": path, "content": content})
    return space["id"]
def two(browser: Browser, worker: Worker, key: str, space: str, count: int) -> tuple[Page, Page]:
    pages = []
    for which in ("a", "b"):
        page = signed_in(browser, token_for(worker, EMAIL), f"{key}/{which}")
        select(page, space)
        wait_for(page, f"async () => (await window.ordenApp.workspace.loadTree(), window.ordenApp.workspace.notes.length >= {count})", f"[{key}/{which}] the seed")
        settled(page)
        pages.append(page)
    return pages[0], pages[1]
def same(key: str, worker: Worker, token: str, space: str, space_id: str, a: Page, b: Page, want: dict[str, str]) -> None:
    held = {"a": files(a, space), "b": files(b, space), "account": there(worker, token, space_id)}
    for where, notes in held.items():
        say(f"[{key}] {where} holds {json.dumps(notes)[:400]}")
        if notes is None:
            failed(f"[{key}] {where} lacks the space {space}")
            continue
        if sorted(notes) != sorted(want):
            failed(f"[{key}] {where} holds {sorted(notes)}, wanted {sorted(want)}")
        for path, words in want.items():
            if words not in (notes.get(path) or ""):
                failed(f"[{key}] {where} lost the words of {path}")
def edit(page: Page, space: str, rel: str, add: str) -> None:
    page.evaluate(
        """async ([space, rel]) => {
          const ws = window.ordenApp.workspace
          const found = ws.spaces.find((one) => one.name === space)
          await ws.selectSpace(found.id)
          await ws.loadTree()
          await ws.openEntry(found.root.replace(/\\/+$/, '') + '/' + rel, { activate: true })
        }""",
        [space, rel],
    )
    page.wait_for_function("() => !!window.orden && window.orden.state.doc.length > 0", timeout=15000)
    page.evaluate("(t) => { const v = window.orden; v.dispatch({ changes: { from: v.state.doc.length, insert: t } }) }", f"\n{add}\n")
    page.wait_for_timeout(300)
    page.evaluate("async () => { await window.ordenApp.workspace.writeNow() }")
    page.wait_for_timeout(500)
    page.evaluate("() => { for (const tab of [...window.ordenApp.workspace.tabs]) window.ordenApp.workspace.close(tab.id) }")
def shared(browser: Browser, worker: Worker, owner_token: str, key: str, member_act: str) -> None:
    space = f"Shared {key}"
    space_id = new_space(worker, owner_token, space, {"plan.md": "# Plan\n\nthe start\n", "keep.md": "# keep\n"})
    now = int(time.time() * 1000)
    worker.sql(f"insert into space_members (space_id, email, item, role, joined_at, created_at) values ('{space_id}', '{MEMBER}', '', 'write', {now}, {now})")
    owner = signed_in(browser, token_for(worker, EMAIL), f"{key}/owner")
    member = signed_in(browser, token_for(worker, MEMBER), f"{key}/member")
    for page in (owner, member):
        select(page, space)
        wait_for(page, "async () => (await window.ordenApp.workspace.loadTree(), window.ordenApp.workspace.notes.length >= 2)", f"[{key}] the seed")
        settled(page)
    owner.evaluate("async (s) => { const ws = window.ordenApp.workspace; for (const n of ws.notes) await ws.noteText(n.path) }", space)
    edit(owner, space, "plan.md", "warm up")
    DRIVE.preload(owner, harness.WORKER_DIST)
    owner.context.set_offline(True)
    owner.wait_for_timeout(500)
    edit(owner, space, "plan.md", "owner wrote offline")
    act(member, member_act)
    passes([member], 2)
    owner.context.set_offline(False)
    owner.wait_for_timeout(1500)
    passes([owner, member, owner, member], 2)
    held = {"owner": files(owner, space), "member": files(member, space), "account": there(worker, owner_token, space_id)}
    for where, notes in held.items():
        say(f"[{key}] {where} holds {json.dumps(notes)[:400]}")
    live = json.dumps(held["account"])
    if "owner wrote offline" not in live:
        trash = worker.query(f"select name, deleted from notes where space_id = '{space_id}'")
        failed(f"[{key}] the owner's offline words are not live on the account; rows {trash}")
    if held["owner"] != held["member"] or sorted(held["owner"] or {}) != sorted(held["account"]):
        failed(f"[{key}] the trees differ")
    owner.context.close()
    member.context.close()
SCENES = {
    "member-renames": lambda b, w, t: shared(b, w, t, "member-renames", "await ws.rename(at('plan.md'), 'Plan renamed.md')"),
    "member-deletes": lambda b, w, t: shared(b, w, t, "member-deletes", "await ws.remove(at('plan.md'), false)"),
    "member-moves": lambda b, w, t: shared(b, w, t, "member-moves", "await ws.noteFrom('# d\\n', at('Done')); await ws.moveMany([at('plan.md')], at('Done'))"),
}
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(EMAIL)
        worker.account(MEMBER)
        worker.sql(f"update users set sync_version = 2 where email in ('{EMAIL}', '{MEMBER}')")
        for key, run in SCENES.items():
            if ONLY and not any(one in key for one in ONLY):
                continue
            say(f"--- {key} ---")
            try:
                run(browser, worker, token)
            except SystemExit as gave_up:
                failed(f"[{key}] gave up: {gave_up}")
    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\nall kept", flush=True)
    return 0
sys.exit(main())
