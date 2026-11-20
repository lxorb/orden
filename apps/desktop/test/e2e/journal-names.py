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
SETTLING: list[list[str]] = []
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
    say(f"signed out: user={page.evaluate('() => window.ordenApp.account.user?.email ?? null')} spaces={page.evaluate('() => window.ordenApp.workspace.spaces.map((s) => s.name + \"@\" + s.root)')} left={page.evaluate('() => localStorage.getItem(\"orden:left-spaces\")')}")
    page.evaluate(
        """async (token) => {
          const account = window.ordenApp.account
          const who = await (await fetch('/v1/me', { headers: { authorization: 'Bearer ' + token } })).json()
          await account.arrive(token, who)
        }""",
        token,
    )
    page.wait_for_timeout(2000)
    settling = page.evaluate("() => [window.ordenApp.account.settling, window.ordenApp.workspace.spaces.map((s) => s.name)]")
    say(f"while settling: {settling}")
    SETTLING.append(settling[1])
    page.evaluate("() => window.ordenApp.account.settled()")
    page.wait_for_timeout(1500)
    say(f"switched: user={page.evaluate('() => window.ordenApp.account.user?.email')} settling={page.evaluate('() => window.ordenApp.account.settling')} spaces={page.evaluate('() => window.ordenApp.workspace.spaces.map((s) => s.name)')}")
    wait_for(page, "() => !!window.ordenApp.account.user", "the new account")
    try:
        wait_for(page, "() => !!window.ordenApp.workspace.activeSpace", "a space of the new account", 25)
    except SystemExit:
        say("NO SPACE after signing in")
    page.wait_for_timeout(3000)
    say(f"runner: {page.evaluate('() => { const r = window.ordenApp.sync.v2; return r ? [r.accountNow, !!r.engine, r.status, r.lastError] : null }')}")
    say(f"later: user={page.evaluate('() => window.ordenApp.account.user?.id')} spaces={page.evaluate('() => window.ordenApp.workspace.spaces.map((s) => s.name + \"@\" + s.root)')} left={page.evaluate('() => localStorage.getItem(\"orden:left-spaces\")')}")
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
def names(page: Page) -> list[str]:
    return page.evaluate("() => window.ordenApp.workspace.spaces.map((s) => s.name + '@' + s.root)")
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        alice = worker.account("alice-journal@example.com")
        bob = worker.account("bob-journal@example.com")
        worker.sql("update users set sync_version = 2 where email like '%-journal@example.com'")
        made = worker.request("/v1/spaces", token=bob, body={"name": "Journal"})
        say(f"bob's account space: {made}")
        context = browser.new_context(viewport={"width": 1100, "height": 700})
        context.add_init_script(
            f"if (!sessionStorage.getItem('seeded')) {{ sessionStorage.setItem('seeded', '1');"
            f" localStorage.setItem('orden:session', {json.dumps(alice)}) }}"
        )
        page = context.new_page()
        page.set_default_timeout(30000)
        page.on("pageerror", lambda error: say(f"page error: {error}"))
        page.goto(ORIGIN, wait_until="domcontentloaded")
        wait_for(page, "() => !!window.ordenApp?.account.user", "alice")
        wait_for(page, "() => !!window.ordenApp.workspace.activeSpace", "a space")
        page.evaluate(
            "async () => { const ws = window.ordenApp.workspace; await ws.addSpace('Journal');"
            " await ws.selectSpace(ws.spaces.find((one) => one.name === 'Journal').id) }"
        )
        wait_for(page, "() => window.ordenApp.sync.remoteIdFor(window.ordenApp.workspace.activeSpace.root)", "alice journal up")
        write_note(page, "Journal", "# Alice day\n\nalice journal\n")
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "alice first")
        write_note(page, "Journal", "# Alice late\n\nalice late words\n")
        say(f"alice: {names(page)}")
        switch(page, bob)
        page.wait_for_timeout(2000)
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "bob first")
        page.wait_for_timeout(4000)
        settled(page, "bob first")
        shown = names(page)
        say(f"bob: {shown}")
        bob_names = [space["name"] for space in worker.request("/v1/spaces", token=bob).get("spaces", [])]
        say(f"bob's account names: {bob_names}")
        if not any(one.startswith("Journal@") for one in shown):
            failed(f"bob's Journal shows as {shown}")
        if bob_names != ["Journal"]:
            failed(f"bob's account names its space {bob_names}")
        alice = fresh_token(worker, "alice-journal@example.com")
        switch(page, alice)
        page.wait_for_timeout(2000)
        page.evaluate("() => window.ordenApp.sync.nudge()")
        settled(page, "alice back")
        page.wait_for_timeout(4000)
        settled(page, "alice back")
        shown = names(page)
        say(f"alice again: {shown}")
        alice_names = sorted(space["name"] for space in worker.request("/v1/spaces", token=alice).get("spaces", []))
        say(f"alice's account names: {alice_names}")
        if not any(one.startswith("Journal@") for one in shown):
            failed(f"alice's Journal shows as {shown}")
        if "Journal 2" in alice_names or "Journal" not in alice_names:
            failed(f"alice's account names its spaces {alice_names}")
        if "alice late words" not in json.dumps(account_view(worker, alice)):
            failed("alice's late words never reached her account")
    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\nall named right", flush=True)
    return 0
sys.exit(main())
