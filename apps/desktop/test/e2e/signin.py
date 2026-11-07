from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

PERSON = "reader@example.com"

SPACES = {"Journal": 9, "Uni": 12}

PATIENCE = 60

def request(path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method="GET" if data is None else "POST",
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self, email: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{email}', 'Emil', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )

        return token

def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")

def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")

def fresh(browser: Browser, label: str, theme: str = "light") -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=theme)
    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.ordenApp", f"[{label}] the app to start")
    return page

def on_a_bad_line(page: Page) -> None:
    session = page.context.new_cdp_session(page)
    session.send("Network.enable")
    session.send(
        "Network.emulateNetworkConditions",
        {
            "offline": False,
            "latency": 400,
            "downloadThroughput": 50 * 1024,
            "uploadThroughput": 50 * 1024,
        },
    )

def tree_paths(page: Page) -> list[str]:
    return page.evaluate(
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.ordenApp.workspace.tree)"
        "}"
    )

def space_names(page: Page) -> list[str]:
    return page.evaluate("() => window.ordenApp.workspace.spaces.map((one) => one.name)")

def surface(page: Page) -> str:
    return page.evaluate(
        "() => {"
        "  const node = document.querySelector('.arriving');"
        "  if (!node) return 'not there';"
        "  const box = node.getBoundingClientRect();"
        "  const style = getComputedStyle(node);"
        "  return JSON.stringify({"
        "    width: Math.round(box.width),"
        "    height: Math.round(box.height),"
        "    said: node.innerText.trim(),"
        "    over: style.position,"
        "    shut: document.querySelector('main')?.inert === true,"
        "  })"
        "}"
    )

def state(page: Page) -> str:
    return page.evaluate(
        "() => {"
        "  const app = window.ordenApp;"
        "  return JSON.stringify({"
        "    signedIn: app.account.signedIn,"
        "    settling: app.account.settling,"
        "    error: app.account.error,"
        "    step: app.account.step,"
        "    open: app.account.open,"
        "    sync: app.sync.status,"
        "    showing: app.arriving?.showing ?? 'no store',"
        "    total: app.arriving?.total ?? null,"
        "    done: app.arriving?.done ?? null,"
        "  })"
        "}"
    )

WATCH = """
() => {
  window.__nib = []
  const tick = () => {
    const store = window.ordenApp.arriving
    window.__nib.push([
      Math.round(performance.now()),
      store.showing ? 1 : 0,
      document.querySelector('.arriving') ? 1 : 0,
      window.ordenApp.account.signedIn ? 1 : 0,
      window.ordenApp.account.settling ? 1 : 0,
      window.ordenApp.sync.status,
      // What the foot actually said, which is the thing under test: the store
      // being right and the row being wrong are two different failures.
      (document.querySelector('aside .foot .coming')?.innerText ?? '').trim(),
    ])
    if (window.__nib.length < 600) setTimeout(tick, 200)
  }
  tick()
}
"""

COUNT = re.compile(r"\d+\s*of\s*\d+")

def counted_in(page: Page, patience: float = 30) -> str:
    until = time.monotonic() + patience
    while True:
        live = page.evaluate(
            "() => (document.querySelector('aside .foot .coming')?.innerText ?? '').trim()"
        )
        if COUNT.search(live):
            return live

        seen = [row[6] for row in page.evaluate("() => window.__nib ?? []") if COUNT.search(row[6])]
        if seen:
            return f"{seen[0]} up to {seen[-1]}"

        if time.monotonic() >= until:
            return ""

        page.wait_for_timeout(200)

def watched(page: Page) -> str:
    rows = page.evaluate("() => window.__nib ?? []")
    out: list[str] = []
    last = None
    for row in rows:
        shape = tuple(row[1:])
        if shape != last:
            out.append(
                f"{row[0]:>6}ms showing={row[1]} drawn={row[2]} in={row[3]}"
                f" settling={row[4]} sync={row[5]} foot={row[6]!r}"
            )
            last = shape

    return "\n    ".join(out) or "nothing recorded"

def sign_in(page: Page, worker: Worker, label: str, address: str) -> None:
    page.locator("input[type=email]").fill(address)

    already = len(worker.written())
    page.get_by_role("button", name="Continue").click()

    code = worker.waits_for_mail(
        address, r"(\d{6}) is your (?:nibeditor|Orden) code", f"[{label}] the sign-in code", already
    ).group(1)
    say(f"[{label}] the code in the mail is {code}")

    page.locator(".digits input").first.fill(code)

def keep_local_notes(page: Page, label: str) -> None:
    keep = page.get_by_role("button", name="Keep them")
    try:
        keep.wait_for(timeout=15_000)
        keep.click()
        say(f"[{label}] kept the notes already here")
    except Exception:
        say(f"[{label}] nothing here to ask about")

def main() -> int:
    worker = Worker()
    failures: list[str] = []

    def wrong(what: str) -> None:
        say(f"FAILED: {what}")
        failures.append(what)

    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
        worker.start()

        token = worker.account(PERSON)
        wanted: set[str] = set()
        for name, count in SPACES.items():
            space = request("/v1/spaces", token, {"name": name})["space"]
            for index in range(count):
                path = f"note-{index + 1}.md"
                request(
                    f"/v1/spaces/{space['id']}/notes",
                    token,
                    {"path": path, "content": f"# {name} {index + 1}\n\nsomething written\n"},
                )
                wanted.add(f"/{name}/{path}")
        say(f"the account holds {len(SPACES)} spaces and {len(wanted)} notes")

        page = fresh(browser, "reader")
        on_a_bad_line(page)

        page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
        page.wait_for_selector("aside .foot", timeout=10_000)

        page.evaluate(WATCH)
        page.evaluate("() => (window.ordenApp.account.open = true)")
        page.locator("input[type=email]").wait_for(timeout=10_000)
        sign_in(page, worker, "reader", PERSON)

        say("waiting for the state to go up")
        try:
            wait_for(page, "() => window.ordenApp.arriving.showing", "the state", 30)
        except SystemExit:
            raise SystemExit(
                f"the state never went up. the app says: {state(page)}\n"
                f"    {watched(page)}"
            )
        say("it went up before the account had been asked anything")
        say(f"the surface is {surface(page)}")

        if page.evaluate("() => document.querySelector('main')?.inert === true"):
            wrong("the app was shut off while there was already a list to use")

        keep_local_notes(page, "reader")

        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / "signing-in-light.png"))
        say("photographed the state, light")

        counted = counted_in(page)
        if not counted:
            raise SystemExit(
                f"the count never appeared. the app says: {state(page)}\n"
                f"    {watched(page)}"
            )
        say(f"the state counts: {counted!r}")
        page.screenshot(path=str(SHOTS / "signing-in-counting.png"))

        say("waiting for the state to go")
        wait_for(
            page,
            "() => !window.ordenApp.arriving.showing",
            "the state to go",
            patience=90,
        )
        say("it went on its own, and the app is reachable again")

        if page.evaluate("() => document.querySelector('main')?.inert === true"):
            wrong("the app was left unreachable after the pass finished")

        names = space_names(page)
        for name in SPACES:
            if name not in names:
                wrong(f"{name} never reached the rail: {names!r}")
        say(f"the rail holds {names!r}")

        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "signed-in.png"))
        say("photographed the app once the state had lifted")

        counted = page.evaluate("() => window.ordenApp.arriving.done")
        if counted != len(wanted):
            wrong(f"the state counted {counted} of the {len(wanted)} notes")
        else:
            say(f"it counted all {counted} notes down")

        for name in SPACES:
            page.evaluate(
                "(wanted) => {"
                "  const space = window.ordenApp.workspace.spaces.find((one) => one.name === wanted);"
                "  if (space) window.ordenApp.workspace.showSpace(space.id)"
                "}",
                name,
            )
            wait_for(
                page,
                "() => window.ordenApp.workspace.tree?.path === "
                + json.dumps(f"/{name}"),
                f"{name}'s file list",
            )
            listed = tree_paths(page)
            theirs = {path for path in wanted if path.startswith(f"/{name}/")}
            missing = sorted(one for one in theirs if one not in listed)
            if missing:
                wrong(f"{name} arrived empty: missing {missing!r}")
            else:
                say(f"{name} holds all {len(theirs)} of its notes, with no reload")

        page.evaluate("() => window.ordenApp.sync.nudge()")
        page.wait_for_timeout(1500)
        if page.locator(".arriving").count() or page.evaluate(
            "() => window.ordenApp.arriving.showing"
        ):
            wrong("a later pass put the state back up")
        else:
            say("a later pass says nothing: the sync light is the whole report")

        page.evaluate("() => window.ordenApp.account.signOut()")
        wait_for(page, "() => !window.ordenApp.account.signedIn", "the sign-out")
        page.wait_for_timeout(400)
        if page.locator(".arriving").count():
            wrong("signing out left the state up")
        else:
            say("signing out cleared it")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nsigning in said so, counted, lifted on its own, and never trapped anybody", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
