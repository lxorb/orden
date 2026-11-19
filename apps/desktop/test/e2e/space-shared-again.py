import json
import sys
import time
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()
PATIENCE = 60
OWNER = "owner-again@example.com"
MEMBER = "member-again@example.com"
SPACE = "Team"
PLAN = "# Plan\n\nship it\n"
SAME = "# Same\n\nwords both hold\n"
wrong: list[str] = []
def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
def wait_for(page: Page, script: str, what: str, arg=None, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(150)
    raise SystemExit(f"gave up waiting for {what}")
def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account.user", f"[{label}] the account")
    wait_for(page, "() => !!window.ordenApp.sync.engine?.engine?.core", f"[{label}] the engine")
    return page
def names(page: Page) -> list[str]:
    listed = page.evaluate("() => window.ordenApp.workspace.spaces.map((one) => one.name)")
    return sorted(name for name in listed if name.startswith(SPACE))
def root_of(page: Page, name: str) -> str | None:
    return page.evaluate(
        "(name) => window.ordenApp.workspace.spaces.find((one) => one.name === name)?.root ?? null", name
    )
def paired(page: Page, name: str) -> str | None:
    return page.evaluate(
        "(name) => { const space = window.ordenApp.workspace.spaces.find((one) => one.name === name);"
        " return space ? window.ordenApp.sync.remoteIdFor(space.root) : null }",
        name,
    )
def rounds(page: Page, times: int = 2) -> None:
    for _ in range(times):
        page.evaluate("() => window.ordenApp.sync.engine.passNow()")
        page.wait_for_timeout(300)
def tracked(page: Page, path: str) -> bool:
    return bool(page.evaluate("(path) => !!window.ordenApp.sync.tracked(path)", path))
def note(worker: Worker, token: str, space: str, path: str, content: str) -> dict:
    return worker.request(f"/v1/spaces/{space}/notes", token=token, body={"path": path, "content": content})["note"]
def live(worker: Worker, space: str) -> list[str]:
    rows = worker.query(f"select path from notes where space_id = '{space}' and deleted = 0 order by path")
    return [row["path"] for row in rows]
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        owner_token = worker.account(OWNER)
        member_token = worker.account(MEMBER)
        worker.sql(f"update users set sync_version = 2 where email in ('{OWNER}', '{MEMBER}')")
        member_id = worker.query(f"select id from users where email = '{MEMBER}'")[0]["id"]
        share = worker.request("/v1/spaces", token=owner_token, body={"name": SPACE})["space"]
        note(worker, owner_token, share["id"], "plan.md", PLAN)
        note(worker, owner_token, share["id"], "same.md", SAME)
        now = int(time.time() * 1000)
        worker.sql(
            "insert into space_members (space_id, email, item, role, joined_at, created_at)"
            f" values ('{share['id']}', '{MEMBER}', '', 'write', {now}, {now})"
        )
        member = signed_in(browser, member_token, "member")
        wait_for(member, "(name) => window.ordenApp.workspace.spaces.some((one) => one.name === name)", "the shared space", SPACE)
        root = root_of(member, SPACE)
        wait_for(member, "(path) => !!window.ordenApp.sync.tracked(path)", "the shared notes", f"{root}/same.md")
        wait_for(member, "(path) => !!window.ordenApp.sync.tracked(path)", "the shared notes", f"{root}/plan.md")
        rounds(member)
        say(f"the member holds {SPACE} at {root}, paired with {paired(member, SPACE)}")
        member.evaluate(
            "async (id) => { const core = window.ordenApp.sync.engine.engine.core;"
            " await core.commit(core.forgetSpace(id)) }",
            share["id"],
        )
        if paired(member, SPACE) is not None:
            failed("the link to the shared space was not dropped")
        rounds(member, 3)
        if names(member) != [SPACE]:
            failed(f"paired again, the member's spaces are {names(member)}")
        if paired(member, SPACE) != share["id"]:
            failed(f"{SPACE} is paired with {paired(member, SPACE)}, not the shared space")
        own = worker.query(
            f"select name from spaces where user_id = '{member_id}' and deleted = 0 and name like '{SPACE}%'"
        )
        if own:
            failed(f"pairing again made spaces of the member's own: {[row['name'] for row in own]}")
        else:
            say("paired again, the shared space came back into its own folder and nothing was copied")
        note(worker, owner_token, share["id"], "later.md", "# Later\n")
        try:
            wait_for(member, "(path) => !!window.ordenApp.sync.tracked(path)", "a note written after", f"{root}/later.md")
            say("a note the owner writes afterwards still arrives")
        except SystemExit as gave_up:
            failed(str(gave_up))
        same_copy = worker.request("/v1/spaces", token=member_token, body={"name": f"{SPACE} 2"})["space"]
        note(worker, member_token, same_copy["id"], "plan.md", PLAN)
        note(worker, member_token, same_copy["id"], "same.md", SAME)
        changed = worker.request("/v1/spaces", token=member_token, body={"name": f"{SPACE} 3"})["space"]
        note(worker, member_token, changed["id"], "plan.md", PLAN + "\nwritten in the copy\n")
        note(worker, member_token, changed["id"], "same.md", SAME)
        empty = worker.request("/v1/spaces", token=member_token, body={"name": SPACE})["space"]
        seen: set[str] = set()
        until = time.monotonic() + PATIENCE * 2
        while time.monotonic() < until and (
            names(member) != [SPACE, f"{SPACE} 3"] or live(worker, changed["id"]) != ["plan.md"]
        ):
            seen.update(names(member))
            rounds(member, 1)
        say(f"the member held {sorted(seen)} on the way")
        if f"{SPACE} 2" not in seen and f"{SPACE} 3" not in seen:
            failed("the copies never came down to the member")
        gone = {row["id"]: row["deleted"] for row in worker.query(
            f"select id, deleted from spaces where id in ('{same_copy['id']}', '{changed['id']}', '{empty['id']}')"
        )}
        if names(member) != [SPACE, f"{SPACE} 3"]:
            state = member.evaluate(
                "() => ({ spaces: window.ordenApp.account.spaces.map((one) => [one.name, one.role, one.shared, one.onceShared, one.createdAt, one.notes]),"
                " shown: window.ordenApp.workspace.spaces.map((one) => [one.name, one.root, window.ordenApp.sync.remoteIdFor(one.root)]),"
                " mended: localStorage.getItem('orden:shared-copies-mended'),"
                " tracked: ['/Team/plan.md', '/Team/same.md', '/Team 2/plan.md', '/Team 2/same.md'].map((path) => window.ordenApp.sync.tracked(path)) })"
            )
            say(f"DIAG {json.dumps(state)}")
            failed(f"after the mend the member holds {names(member)}")
        if gone.get(same_copy["id"]) != 1 or gone.get(empty["id"]) != 1:
            failed(f"the copies left on the account: {gone}")
        if gone.get(changed["id"]) != 0:
            failed("the copy with words of its own was deleted")
        if live(worker, changed["id"]) != ["plan.md"]:
            failed(f"the copy with words of its own holds {live(worker, changed['id'])}")
        if live(worker, share["id"]) != ["later.md", "plan.md", "same.md"]:
            failed(f"the shared space holds {live(worker, share['id'])}")
        trashed = worker.query(
            f"select count(*) as n from notes where space_id = '{changed['id']}' and path = 'same.md' and deleted = 1"
        )
        if not trashed or int(trashed[0]["n"]) != 1:
            failed("the copy's note that matched the shared one is not in recently deleted")
        say("the same and the empty copies went, the copy's own words stayed")
        member.screenshot(path=str(SHOTS / "shared-again-mended.png"))
        rounds(member, 3)
        if names(member) != [SPACE, f"{SPACE} 3"] or live(worker, changed["id"]) != ["plan.md"]:
            failed(f"a second mend changed things: {names(member)}, {live(worker, changed['id'])}")
    if wrong:
        print("\nFAILED", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\na shared space paired again takes its own folder, and leftover copies are mended without losing words", flush=True)
    return 0
sys.exit(main())
