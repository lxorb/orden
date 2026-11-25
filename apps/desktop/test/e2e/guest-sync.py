import hashlib
import json
import sys
import time
import urllib.request
import uuid
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
ORIGIN = harness.worker_origin()
PATIENCE = 60
request = harness.request
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
    def owner(self, email: str, version: int) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(
            f"insert into users (id, email, name, created_at, sync_version)"
            f" values ('{user}', '{email}', 'Owner', {now}, {version});"
            + harness.session_row(hashlib.sha256(token.encode()).hexdigest(), user, now)
        )
        return token
def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")
def guest_through(browser: Browser, link: str, label: str) -> Page:
    page = browser.new_context(viewport={"width": 1180, "height": 760}).new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(f"{ORIGIN}/join/{link}", wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account?.signedIn", f"[{label}] the guest session")
    return page
def folder_of(page: Page, label: str, space_id: str, role: str) -> str:
    wait_for(
        page,
        f"() => window.ordenApp.account.spaces.find((one) => one.id === {json.dumps(space_id)})?.role === {json.dumps(role)}",
        f"[{label}] the shared space",
    )
    return wait_for(
        page,
        "() => window.ordenApp.workspace.spaces.find("
        f"(one) => window.ordenApp.sync.remoteIdFor(one.root) === {json.dumps(space_id)})?.name ?? null",
        f"[{label}] a folder for the shared space",
    )
def words_of(page: Page, name: str, file: str) -> str:
    return page.evaluate(
        "async ([name, file]) => { const ws = window.ordenApp.workspace;"
        " const space = ws.spaces.find((one) => one.name === name); if (!space) return '';"
        " await ws.selectSpace(space.id); await ws.loadTree();"
        " const note = ws.notes.find((one) => one.path.endsWith(file));"
        " return note ? ((await ws.noteText(note.path)) ?? '') : '' }",
        [name, file],
    )
def until_true(page: Page, check, patience: int = PATIENCE) -> bool:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if check():
            return True
        page.evaluate("() => window.ordenApp.sync.nudge()")
        page.wait_for_timeout(2000)
    return check()
def notes_on(token: str, space_id: str) -> dict[str, dict]:
    listed = request(f"/v1/spaces/{space_id}/changes?since=0", token)["notes"]
    return {one["path"]: one for one in listed if not one.get("deleted")}
def guest_case(browser: Browser, worker: Worker, version: int, role: str, wrong) -> None:
    label = f"owner on v{version}, guest who may {role}"
    token = worker.owner(f"owner-{version}-{role}@example.com", version)
    space = request("/v1/spaces", token, {"name": f"Shared {version} {role}"})["space"]
    request(f"/v1/spaces/{space['id']}/notes", token, {"path": "first.md", "content": "# First\n\nthere before\n"})
    request(f"/v1/spaces/{space['id']}/share/link", token, {"role": role, "mode": "open"}, method="PUT")
    link = worker.query(f"select token from space_links where space_id = '{space['id']}'")[0]["token"]
    guest = guest_through(browser, link, label)
    name = folder_of(guest, label, space["id"], role)
    if not until_true(guest, lambda: "there before" in words_of(guest, name, "first.md")):
        wrong(f"[{label}] the note already in the space never reached the guest")
    request(f"/v1/spaces/{space['id']}/notes", token, {"path": "later.md", "content": "# Later\n\nwritten after\n"})
    if not until_true(guest, lambda: "written after" in words_of(guest, name, "later.md")):
        wrong(f"[{label}] a note the owner wrote later never reached the guest")
    first = notes_on(token, space["id"])["first.md"]
    request(
        f"/v1/notes/{first['id']}",
        token,
        {"content": "# First\n\nchanged by the owner\n", "version": first["version"]},
        method="PUT",
    )
    guest.reload(wait_until="domcontentloaded")
    wait_for(guest, "() => !!window.ordenApp?.account?.signedIn", f"[{label}] the guest session again")
    if not until_true(guest, lambda: "changed by the owner" in words_of(guest, name, "first.md")):
        wrong(f"[{label}] the owner's change never reached the guest after a reload")
    guest.evaluate(
        "async (name) => { const ws = window.ordenApp.workspace;"
        " const space = ws.spaces.find((one) => one.name === name);"
        " await ws.noteFrom('# From the guest\\n\\nwritten by the guest\\n', space.root) }",
        name,
    )
    sent = until_true(guest, lambda: any("From the guest" in path for path in notes_on(token, space["id"])), 40)
    if role == "write" and not sent:
        wrong(f"[{label}] the guest's note never reached the owner")
    if role == "read" and sent:
        wrong(f"[{label}] a guest who may only read sent a note")
    say(f"[{label}] took every change, and {'sent its own' if sent else 'sent nothing'}")
    guest.context.close()
def tree_of(page: Page, name: str) -> list[str]:
    return page.evaluate(
        "async (name) => { const ws = window.ordenApp.workspace;"
        " const space = ws.spaces.find((one) => one.name === name); if (!space) return [];"
        " await ws.selectSpace(space.id); await ws.loadTree();"
        " const walk = (e, at) => (e.children ?? []).flatMap((c) => [at + c.name + (c.is_dir ? '/' : ''), ...walk(c, at + c.name + '/')]);"
        " return walk(ws.tree ?? {}, '').sort() }",
        name,
    )
def member_of(browser: Browser, worker: Worker, link: str, label: str) -> Page:
    token = worker.owner(f"member-{uuid.uuid4().hex[:6]}@example.com", 2)
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.goto(f"{ORIGIN}/join/{link}", wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account?.user", f"[{label}] the member session")
    return page
def tree_case(browser: Browser, worker: Worker, wrong) -> None:
    token = worker.owner("tree-owner@example.com", 2)
    space = request("/v1/spaces", token, {"name": "Tree"})["space"]
    sid = space["id"]
    empty, links = uuid.uuid4().hex, uuid.uuid4().hex
    ops = [
        {"op": uuid.uuid4().hex, "t": "mkdir", "id": empty, "parent": None, "name": "ETHCC", "seen": 0},
        {"op": uuid.uuid4().hex, "t": "mkdir", "id": links, "parent": None, "name": "Important Links", "seen": 0},
    ]
    say(f"ops {request(f'/v2/spaces/{sid}/ops', token, {'ops': ops})}")
    request(f"/v1/spaces/{sid}/notes", token, {"path": "Important Links/Important Links.md", "content": "# Important Links\n"})
    request(f"/v1/spaces/{sid}/notes", token, {"path": "Important Links/Site.url", "content": "[InternetShortcut]\nURL=https://example.com/\n"})
    request(f"/v1/spaces/{sid}/notes", token, {"path": "Plan.md", "content": "# Plan\n"})
    pdf = b"%PDF-1.4\n%probe\n"
    digest = hashlib.sha256(pdf).hexdigest()
    put = urllib.request.Request(f"{ORIGIN}/v1/blobs/{digest}", data=pdf, method="PUT")
    put.add_header("authorization", f"Bearer {token}")
    put.add_header("content-type", "application/pdf")
    urllib.request.urlopen(put, timeout=30).read()
    file_op = {"op": uuid.uuid4().hex, "t": "create", "id": uuid.uuid4().hex, "kind": "file", "parent": links, "name": "Sheet.pdf", "seen": 0, "hash": digest}
    say(f"file {request(f'/v2/spaces/{sid}/ops', token, {'ops': [file_op]})}")
    request(f"/v1/spaces/{sid}/share/link", token, {"role": "write", "mode": "open"}, method="PUT")
    link = worker.query(f"select token from space_links where space_id = '{sid}'")[0]["token"]
    owner = browser.new_context(viewport={"width": 1180, "height": 760})
    owner.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    mine = owner.new_page()
    mine.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(mine, "() => !!window.ordenApp?.account?.user", "[owner] the session")
    views = {"owner": mine, "guest": guest_through(browser, link, "guest"), "member": member_of(browser, worker, link, "member")}
    trees = {}
    for who, page in views.items():
        name = folder_of(page, who, sid, "owner" if who == "owner" else "write")
        until_true(page, lambda: len(tree_of(page, name)) >= (6 if who == "owner" else 5), 60)
        trees[who] = tree_of(page, name)
        say(f"[{who}] {trees[who]}")
    shared = [one for one in trees["owner"] if not one.endswith(".url")]
    for who in ("guest", "member"):
        if trees[who] != shared:
            wrong(f"[{who}] holds another tree than the owner: {trees[who]} against {shared}")
def main() -> int:
    worker = Worker()
    failures: list[str] = []
    def wrong(what: str) -> None:
        say(f"FAILED: {what}")
        failures.append(what)
    with DRIVE.session() as browser:
        worker.start()
        for version in (1, 2):
            for role in ("write", "read"):
                guest_case(browser, worker, version, role, wrong)
        tree_case(browser, worker, wrong)
    print("\nall kept" if not failures else f"\n{len(failures)} thing(s) wrong", flush=True)
    return 1 if failures else 0
sys.exit(main())
