import hashlib
import json
import re
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
EMAIL = "stress-2560@example.com"
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
BIG = {f"Big/n{i:02d}.md": f"# n{i:02d}\n\nwords of n{i:02d}\n" for i in range(40)}
BIG.update({f"Big/Sub/s{i}.md": f"# s{i}\n\nwords of s{i}\n" for i in range(10)})
BIG["keep.md"] = "# keep\n\nwords of keep\n"
WANT = {path: f"words of {path.split('/')[-1][:-3]}" for path in BIG}
BURST = """async (plan) => {
  const ws = window.ordenApp.workspace
  await ws.loadTree()
  const root = ws.activeSpace.root.replace(/\\/+$/, '')
  for (const one of ['Big/n00.md', 'Big/n05.md', 'Big/Sub/s1.md']) await ws.openEntry(root + '/' + one)
  const nap = (ms) => new Promise((go) => setTimeout(go, ms))
  const going = []
  for (const step of plan) {
    if (step === 'delete') going.push(ws.remove(root + '/Big', true))
    else if (step === 'undo') going.push(ws.undoFileAction())
    else if (step === 'redo') going.push(ws.redoFileAction())
    else await nap(Number(step))
  }
  await Promise.allSettled(going)
  await nap(1500)
  await ws.loadTree()
  return { stack: ws.undone.stack.map((one) => one.kind), ahead: ws.undone.ahead.map((one) => one.kind),
    tabs: ws.tabs.filter((t) => t.path).map((t) => [t.path.slice(root.length + 1), (t.doc || '').slice(0, 20)]) }
}"""
def dupes(notes: dict[str, str] | None) -> list[str]:
    return sorted(one for one in (notes or {}) if re.search(r" \d+(\.md)?$|/[^/]* \d+/", one[:-3] if one.endswith(".md") else one))
def burst(browser: Browser, worker: Worker, token: str, key: str, plan: list[str], present: bool) -> None:
    space = f"Stress {key}"
    space_id = new_space(worker, token, space, BIG)
    a, b = two(browser, worker, key, space, len(BIG))
    seen = a.evaluate(BURST, plan)
    say(f"[{key}] after the burst stack={seen['stack']} ahead={seen['ahead']} tabs={seen['tabs']}")
    passes([a, b, a, b])
    want = WANT if present else {"keep.md": WANT["keep.md"]}
    held = {"a": files(a, space), "b": files(b, space), "account": there(worker, token, space_id)}
    for where, notes in held.items():
        if notes is None:
            failed(f"[{key}] {where} lacks the space")
            continue
        extra = sorted(set(notes) - set(want))
        lost = sorted(set(want) - set(notes))
        if extra or lost:
            failed(f"[{key}] {where}: extra {extra[:8]} ({len(extra)}), lost {lost[:8]} ({len(lost)})")
        for path, words in want.items():
            if path in notes and words not in (notes.get(path) or ""):
                failed(f"[{key}] {where} has wrong words in {path}: {notes.get(path)!r:.60}")
        if dupes(notes):
            failed(f"[{key}] {where} has copies {dupes(notes)[:6]}")
    say(f"[{key}] a={len(held['a'] or {})} b={len(held['b'] or {})} account={len(held['account'])}")
    a.context.close()
    b.context.close()
SCENES = {
    "undo-burst": lambda br, w, t: burst(br, w, t, "undo-burst", ["delete", "undo", "undo", "undo"], True),
    "undo-mid-delete": lambda br, w, t: burst(br, w, t, "undo-mid-delete", ["delete", "5", "undo", "5", "undo"], True),
    "undo-redo-burst": lambda br, w, t: burst(br, w, t, "undo-redo-burst", ["delete", "400", "undo", "redo", "undo", "redo", "undo"], True),
    "redo-wins": lambda br, w, t: burst(br, w, t, "redo-wins", ["delete", "400", "undo", "30", "redo"], False),
}
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(EMAIL)
        worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")
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
    print("\nall held once", flush=True)
    return 0
if __name__ == "__main__":
    sys.exit(main())
