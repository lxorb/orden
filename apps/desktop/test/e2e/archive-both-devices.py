import json
import sys
import time
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
BUDGET = 900
say = DRIVE.say
ORIGIN = harness.worker_origin()
PATIENCE = 60
V1 = "--v1" in sys.argv
RELOAD = "--reload" in sys.argv
KNOWN = "archiving a space offline undoes another device's archive (#2250)"
wrong: list[str] = []
def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)
def second_token(worker, email: str) -> str:
    import hashlib, uuid
    token = uuid.uuid4().hex + uuid.uuid4().hex
    user = worker.query(f"select id from users where email = '{email}'")[0]["id"]
    worker.sql(harness.session_row(hashlib.sha256(token.encode()).hexdigest(), user, int(time.time() * 1000)))
    return token
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
def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)});"
                            " try { localStorage.setItem('orden:hints', JSON.stringify(['sign-in', 'graph', 'palette'])) } catch {}")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp?.account.user", f"[{label}] the account")
    return page
def shown(page: Page) -> list[str]:
    return page.evaluate("() => window.ordenApp.workspace.shownSpaces.map((one) => one.name).sort()")
def archive(page: Page, name: str) -> None:
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    page.wait_for_timeout(200)
    if not page.locator(".orden-layer.spaces").count():
        page.locator("aside button.name").first.click()
    wait_for(page, "() => !!document.querySelector('.orden-layer.spaces')", "the list of spaces")
    page.wait_for_timeout(300)
    page.locator(".orden-layer.spaces > .line").filter(has_text=name).locator(".more").click()
    wait_for(page, "() => !!document.querySelector('[role=menu].menu')", f"{name}'s menu")
    page.locator(".menu [role=menuitem]", has_text="Archive").first.click()
    page.wait_for_timeout(800)
    if page.locator(".orden-layer.spaces").count():
        page.keyboard.press("Escape")
    page.wait_for_timeout(300)
def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account("archive-both@example.com")
        if not V1:
            worker.sql("update users set sync_version = 2 where email = 'archive-both@example.com'")
        ids = {}
        for name in ("One", "Two", "Three"):
            space = worker.request("/v1/spaces", token=token, body={"name": name})["space"]
            ids[name] = space["id"]
            worker.request(f"/v1/spaces/{space['id']}/notes", token=token, body={"path": f"{name} note.md", "content": f"# {name}\n"})
        pages = {}
        for which in ("a", "b"):
            page = signed_in(browser, token if which == "a" else second_token(worker, "archive-both@example.com"), which)
            wait_for(page, "() => ['One', 'Two', 'Three'].every((n) => window.ordenApp.workspace.spaces.some((s) => s.name === n && window.ordenApp.sync.remoteIdFor(s.root)))", f"[{which}] the spaces")
            page.wait_for_timeout(2000)
            pages[which] = page
        a, b = pages["a"], pages["b"]
        say(f"shown a={shown(a)} b={shown(b)}")
        DRIVE.preload(b, harness.WORKER_DIST)
        b.context.set_offline(True)
        b.wait_for_timeout(500)
        archive(b, "Three")
        say(f"b archived Three while offline: shown b={shown(b)}")
        archive(a, "Two")
        a.wait_for_timeout(2000)
        held = worker.request("/v1/settings", token=token).get("settings", {}).get("archivedSpaces")
        say(f"the account archives {held} after a archived Two")
        b.context.set_offline(False)
        b.wait_for_timeout(1500)
        if RELOAD:
            b.reload(wait_until="domcontentloaded")
            wait_for(b, "() => !!window.ordenApp?.account.user", "[b] back")
        else:
            b.evaluate("() => window.ordenApp.account.loadSpaces()")
        b.wait_for_timeout(4000)
        held = worker.request("/v1/settings", token=token).get("settings", {}).get("archivedSpaces") or []
        names = sorted(name for name, one in ids.items() if one in held)
        say(f"after b came back the account archives {names}")
        a.evaluate("() => window.ordenApp.account.loadSpaces()")
        a.wait_for_timeout(3000)
        say(f"shown a={shown(a)} b={shown(b)}")
        if names != ["Three", "Two"]:
            failed(f"the account archives {names}, not both Two (archived on a) and Three (archived on b offline)")
        if shown(a) != ["One"]:
            failed(f"a shows {shown(a)}")
        if shown(b) != ["One"]:
            failed(f"b shows {shown(b)}")
    if wrong:
        print(f"KNOWN: {KNOWN}", flush=True)
        return 0
    print(f"KNOWN NO LONGER: {KNOWN} - take it off", flush=True)
    return 0
sys.exit(main())
