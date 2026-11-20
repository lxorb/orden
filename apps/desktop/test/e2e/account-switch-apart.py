import json
import sys
import time
from playwright.sync_api import Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
BUDGET = 1800
say = DRIVE.say
ORIGIN = harness.worker_origin()
PATIENCE = 60
V2 = "--v2" in sys.argv
QUICK = "--quick" in sys.argv
wrong: list[str] = []
def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE, arg=None):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg) if arg is not None else page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")
def settled(page: Page, what: str) -> None:
    wait_for(page, "() => window.ordenApp.sync.status !== 'syncing'", f"{what} to settle")
    page.wait_for_timeout(1500)
def fresh_token(worker, email: str) -> str:
    import hashlib, uuid
    token = uuid.uuid4().hex + uuid.uuid4().hex
    user = worker.query(f"select id from users where email = '{email}'")[0]["id"]
    worker.sql(harness.session_row(hashlib.sha256(token.encode()).hexdigest(), user, int(time.time() * 1000)))
    return token
def switch(page: Page, token: str) -> None:
    page.evaluate(
        """async (token) => {
          const account = window.ordenApp.account
          await account.signOut()
        }""",
    )
    page.wait_for_timeout(10000)
    say(f"signed out: user={page.evaluate('() => window.ordenApp.account.user?.email ?? null')} spaces={page.evaluate('() => window.ordenApp.workspace.spaces.map((s) => s.name)')}")
    page.evaluate(
        """async (token) => {
          const account = window.ordenApp.account
          const who = await (await fetch('/v1/me', { headers: { authorization: 'Bearer ' + token } })).json()
          await account.arrive(token, who)
        }""",
        token,
    )
    page.wait_for_timeout(2000)
    page.evaluate("() => window.ordenApp.account.settled()")
    say(f"switched: user={page.evaluate('() => window.ordenApp.account.user?.email')} settling={page.evaluate('() => window.ordenApp.account.settling')} spaces={page.evaluate('() => window.ordenApp.workspace.spaces.map((s) => s.name)')}")
    wait_for(page, "() => !!window.ordenApp.account.user && !!window.ordenApp.workspace.activeSpace", "the new account")
def account_view(worker: Worker, token: str) -> dict[str, dict[str, str]]:
    spaces = worker.request("/v1/spaces", token=token)
    out: dict[str, dict[str, str]] = {}
    for space in spaces.get("spaces", []):
        listed = worker.request(f"/v1/spaces/{space['id']}/changes?since=0", token=token)
        notes: dict[str, str] = {}
        for one in listed.get("notes", []):
            if one.get("deleted"):
                continue
            notes[one["path"]] = worker.request(f"/v1/notes/{one['id']}", token=token).get("content", "")
        out[f"{space['name']}#{space.get('role', '')}"] = notes
    return out
def local_view(page: Page) -> dict[str, list[str]]:
    return page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          const out = {}
          for (const space of ws.spaces) {
            await ws.selectSpace(space.id)
            await ws.loadTree()
            out[space.name] = ws.notes.map((n) => n.name)
          }
          return out
        }"""
    )
def write_note(page: Page, space: str, text: str) -> None:
    page.evaluate(
        """async ([space, text]) => {
          const ws = window.ordenApp.workspace
          const found = ws.spaces.find((one) => one.name === space)
          await ws.selectSpace(found.id)
          await ws.noteFrom(text, found.root)
        }""",
        [space, text],
    )
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        alice = worker.account("alice-switch@example.com")
        bob = worker.account("bob-switch@example.com")
        worker.request("/v1/spaces", token=bob, body={"name": "Notes"})
        if V2:
            worker.sql("update users set sync_version = 2 where email like '%-switch@example.com'")
        context = browser.new_context(viewport={"width": 1100, "height": 700})
        context.add_init_script(
            f"if (!sessionStorage.getItem('seeded')) {{ sessionStorage.setItem('seeded', '1');"
            f" localStorage.setItem('orden:session', {json.dumps(alice)}) }}"
        )
        page = context.new_page()
        page.set_default_timeout(30000)
        page.on("pageerror", lambda error: say(f"page error: {error}"))
        page.on("console", lambda m: say(f"{m.type}: {m.text[:300]}") if m.type == "error" else None)
        page.goto(ORIGIN, wait_until="domcontentloaded")
        wait_for(page, "() => !!window.ordenApp?.account.user", "alice")
        wait_for(page, "() => !!window.ordenApp.workspace.activeSpace", "a space")
        page.evaluate(
            "async () => { const ws = window.ordenApp.workspace; await ws.addSpace('Alice private');"
            " await ws.selectSpace(ws.spaces.find((one) => one.name === 'Alice private').id) }"
        )
        wait_for(page, "() => window.ordenApp.sync.remoteIdFor(window.ordenApp.workspace.activeSpace.root)", "alice space up")
        write_note(page, "Alice private", "# Alice one\n\nalice secret one\n")
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "alice first")
        page.wait_for_timeout(3000)
        settled(page, "alice first")
        say(f"alice local: {local_view(page)}")
        say(f"alice account: {json.dumps(account_view(worker, alice))[:600]}")
        write_note(page, "Alice private", "# Alice two\n\nalice secret two written just before leaving\n")
        if not QUICK:
            page.evaluate("() => window.ordenApp.sync.nudge()")
            settled(page, "alice second")
        switch(page, bob)
        say(f"now {page.evaluate('() => window.ordenApp.account.user.email')}")
        if "--reload" in sys.argv:
            page.reload(wait_until="domcontentloaded")
            wait_for(page, "() => !!window.ordenApp?.account.user && !!window.ordenApp.workspace.activeSpace", "bob after a reload")
            say(f"reloaded as {page.evaluate('() => window.ordenApp.account.user.email')}")
        page.wait_for_timeout(2000)
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "bob first")
        page.wait_for_timeout(4000)
        settled(page, "bob first")
        bob_local = local_view(page)
        bob_there = account_view(worker, bob)
        say(f"bob local: {bob_local}")
        say(f"bob account: {json.dumps(bob_there)[:800]}")
        if "alice secret" in json.dumps(bob_there):
            failed("alice's words reached bob's account")
        if any("Alice" in one for one in bob_local) or "Alice" in json.dumps(bob_local):
            failed(f"bob sees alice's space or notes on this device: {bob_local}")
        write_note(page, next(iter(bob_local)) if bob_local else "", "# Bob one\n\nbob words\n")
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "bob write")
        alice = fresh_token(worker, "alice-switch@example.com")
        switch(page, alice)
        page.wait_for_timeout(2000)
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "alice back")
        page.wait_for_timeout(4000)
        settled(page, "alice back")
        alice_local = local_view(page)
        alice_there = account_view(worker, alice)
        say(f"alice local again: {alice_local}")
        say(f"alice account again: {json.dumps(alice_there)[:800]}")
        flat = json.dumps(alice_there)
        for line in ("alice secret one", "alice secret two written just before leaving"):
            if line not in flat:
                failed(f"alice's account lacks {line!r}")
        if "bob words" in flat:
            failed("bob's words reached alice's account")
        names = [n for notes in alice_there.values() for n in notes]
        dupes = [n for n in names if " 2." in n or "(from another" in n]
        if dupes:
            failed(f"alice's account holds copies {dupes}")
        spaces = list(alice_there)
        if len([s for s in spaces if s.startswith("Alice private")]) != 1:
            failed(f"alice's spaces are {spaces}")
        if "Bob" in json.dumps(alice_local) or "bob" in json.dumps(alice_local):
            failed(f"alice sees bob's notes here: {alice_local}")
        status = page.evaluate("() => [window.ordenApp.sync.status, window.ordenApp.sync.lastError]")
        if status[0] == "error":
            failed(f"sync error {status}")
    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\nall kept apart", flush=True)
    return 0
sys.exit(main())
