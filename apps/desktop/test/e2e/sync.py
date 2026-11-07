from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()
ROOT = harness.ROOT

EMAIL = "sync-drive@example.com"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

def request(path: str, token: str | None = None, body: object = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data, method=method)
    if token:
        ask.add_header("authorization", f"Bearer {token}")
    if data is not None:
        ask.add_header("content-type", "application/json")

    try:
        with urllib.request.urlopen(ask, timeout=30) as answer:
            said = answer.read().decode()
            return json.loads(said) if said else {}
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}

def totp(secret_hex: str, at: float | None = None) -> str:
    step = int((at if at is not None else time.time()) // 30)
    digest = hmac.new(bytes.fromhex(secret_hex), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[19] & 15
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF

    return str(value % 1_000_000).zfill(6)

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE, variables={"OPENAI_KEY_SECRET": "a secret for the drive"})

    def account(self, device: str = "the drive") -> tuple[str, str]:  # type: ignore[override]
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});")

        return self.session(user, device), user

    def session(self, user: str, device: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)

        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', '{device}', {now});"
        )

        return token

def pane_rows(page) -> list[str]:
    return page.evaluate(
        """() => [...document.querySelectorAll('.pane .setting, .pane .action')]
             .map((one) => one.textContent.replace(/\\s+/g, ' ').trim())
             .filter(Boolean)"""
    )

def opened(browser, name: str, width: int, height: int, agent: str, finger: bool, token: str):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="dark" if not finger else "light",
        device_scale_factor=2,
    )

    context.add_init_script(f"try {{ localStorage.setItem('orden:session', '{token}') }} catch {{}}")

    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.on(
        "console",
        lambda one: say(f"[{name}] console {one.type}: {one.text}")
        if one.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=40000)
    page.wait_for_function("() => !!window.nibApp.account.user", timeout=40000)

    return context, page

def drive(browser, worker: Worker, out: Path, token: str, user: str, name: str, width, height, agent, finger):
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    context, page = opened(browser, name, width, height, agent, finger, token)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    page.wait_for_function(
        "() => window.nibApp.workspace.activeSpace && window.nibApp.sync.status !== 'off'",
        timeout=40000,
    )

    space = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    made = page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          return await ws.noteFrom('# The plan\\n\\nThe first words.', ws.activeSpace.root)
        }"""
    )
    say(f"[{name}] wrote {made.replace(chr(92), '/').split('/')[-1]}")

    page.evaluate("() => window.nibApp.sync.nudge()")
    page.wait_for_function(
        "(path) => !!window.nibApp.sync.tracked(path)", arg=made, timeout=40000
    )

    tracked = page.evaluate("(path) => window.nibApp.sync.tracked(path)", made)
    held = request(f"/v1/notes/{tracked['id']}/versions", token)
    say(f"[{name}] the account holds {len(held.get('versions', []))} version(s): {held.get('versions')}")

    worker.sql("update note_versions set at = at - 600000;")
    page.evaluate(
        """async (path) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.path === path)
          if (note) await ws.open(note.path)
          window.nibApp.workspace.replace('# The plan\\n\\nSomething else entirely.')
          await ws.writeNow()
        }""",
        made,
    )
    page.evaluate("() => window.nibApp.sync.nudge()")
    page.wait_for_timeout(4000)

    held = request(f"/v1/notes/{tracked['id']}/versions", token)
    say(f"[{name}] and now {len(held.get('versions', []))}, by {[one['by'] for one in held.get('versions', [])]}")

    page.evaluate("() => (window.nibApp.settings.historyOpen = true)")
    page.wait_for_timeout(900)
    shot("history")
    rows = page.evaluate("() => [...document.querySelectorAll('.versions button')].map((one) => one.textContent.trim())")
    say(f"[{name}] the history sheet lists: {rows}")
    page.evaluate("() => (window.nibApp.settings.historyOpen = false)")
    page.wait_for_timeout(400)

    page.evaluate("() => window.nibApp.settings.show('sync')")
    page.wait_for_timeout(900)
    shot("pane")

    page.evaluate("() => window.nibApp.modes.setConflicts('newest')")
    page.wait_for_timeout(1200)
    settings = request("/v1/settings", token)
    say(f"[{name}] the account's conflict rule is {settings.get('settings', {}).get('conflicts')!r}")

    say(f"[{name}] the pane offers: {pane_rows(page)}")
    page.evaluate("() => window.nibApp.modes.setKeepVersions(365)")
    page.wait_for_timeout(1200)
    kept = request("/v1/settings", token).get("settings", {}).get("keepVersions")
    say(f"[{name}] the account keeps versions for {kept} days")

    day = 24 * 60 * 60 * 1000
    for age in [2, 40, 70, 100, 200, 300]:
        worker.sql(
            "insert or ignore into note_versions (note_id, at, hash, size, by) values"
            f" ('{tracked['id']}', cast(strftime('%s','now') as integer) * 1000 - {age * day},"
            f" 'aged-{age}', 120, 'the drive');"
        )

    page.evaluate("() => (window.nibApp.settings.historyOpen = true)")
    page.wait_for_timeout(1500)
    months = page.evaluate(
        "() => [...document.querySelectorAll('.versions .month')].map((one) => one.textContent.trim())"
    )
    say(f"[{name}] with a year kept the sheet is cut up by month: {months}")
    shot("history-by-month")
    page.evaluate("() => (window.nibApp.settings.historyOpen = false)")
    page.wait_for_timeout(300)
    page.evaluate("() => window.nibApp.settings.show('sync')")
    page.wait_for_timeout(600)

    passes = page.evaluate("() => window.nibApp.sync.status")
    log = page.evaluate(
        """() => [...document.querySelectorAll('.pass')].map((one) => one.textContent.replace(/\\s+/g, ' ').trim())"""
    )
    say(f"[{name}] sync is {passes}; the log says: {log[:3]}")

    page.evaluate("() => window.nibApp.settings.show('account')")
    page.wait_for_timeout(900)

    turn = page.query_selector('button:has-text("Turn on")')
    if turn:
        turn.click()
        page.wait_for_selector(".copyable .value", timeout=20000)
        shown = (page.text_content(".copyable .value") or "").strip()
        padded = shown + "=" * (-len(shown) % 8)
        page.fill('input[aria-label="Code from the app"]', totp(base64.b32decode(padded).hex()))
        page.click('button:has-text("Confirm")')
        page.wait_for_timeout(1500)

    say(f"[{name}] the account pane says: {pane_rows(page)}")
    shot("account")
    page.evaluate("() => window.nibApp.settings.show('sync')")
    page.wait_for_timeout(300)

    remote = page.evaluate(
        "() => window.nibApp.sync.remoteIdFor(window.nibApp.workspace.activeSpace.root)"
    )
    asked = request(
        f"/v1/spaces/{remote}/rollback",
        token,
        {"at": int(time.time() * 1000) - 300000, "dry": True},
    )
    say(f"[{name}] a rollback to five minutes ago would change {asked.get('notes')} note(s)")

    context.close()
    return remote

def second_factor(worker: Worker, token: str) -> None:
    begun = request("/v1/second", token, {})
    if "secret" not in begun:
        say(f"the second factor could not be begun: {begun}")
        return

    padded = begun["secret"] + "=" * (-len(begun["secret"]) % 8)
    secret = base64.b32decode(padded).hex()

    done = request("/v1/second/confirm", token, {"holding": begun["holding"], "code": totp(secret)})
    say(f"the second factor is on, with {len(done.get('recovery', []))} recovery codes")

    state = request("/v1/second", token)
    say(f"and the pane would say: on={state.get('on')} codesLeft={state.get('codesLeft')}")

    refused = request("/v1/second", token, {"code": "000000"}, method="DELETE")
    say(f"a wrong code turning it off: {refused.get('status')} {refused.get('error')!r}")

    off = request("/v1/second", token, {"code": totp(secret)}, method="DELETE")
    say(f"the right one: on={off.get('on')}")

def sessions(worker: Worker, token: str, user: str) -> None:
    other = worker.session(user, "another laptop")
    listed = request("/v1/sessions", token)
    say(f"signed in on: {[(one['name'], one['current']) for one in listed.get('sessions', [])]}")

    theirs = next((one for one in listed.get("sessions", []) if not one["current"]), None)
    if theirs:
        request(f"/v1/sessions/{theirs['id']}", token, method="DELETE")
        after = request("/v1/sessions", other)
        say(f"after ending it, that session answers {after.get('status', 200)}")

def headless(worker: Worker, token: str, space: str) -> None:
    minted = request("/v1/mcp/token", token, {"readOnly": False})
    program = minted.get("token", "")

    with tempfile.TemporaryDirectory(prefix="orden-ci-") as held:
        folder = Path(held)
        done = subprocess.run(
            ["node", str(ROOT / "scripts" / "nib-sync.mjs"), "pull", space, str(folder)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "ORDEN_TOKEN": program, "ORDEN_API": ORIGIN},
            check=False,
        )

        say(f"nib-sync pull said: {done.stdout.strip() or done.stderr.strip()}")
        landed = sorted(one.name for one in folder.rglob("*.md"))
        say(f"and left: {landed}")

        if landed:
            (folder / "from-ci.md").write_text("# From CI\n\nWritten by the action.\n", "utf-8")
            pushed = subprocess.run(
                ["node", str(ROOT / "scripts" / "nib-sync.mjs"), "push", space, str(folder)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env={**os.environ, "ORDEN_TOKEN": program, "ORDEN_API": ORIGIN},
                check=False,
            )
            say(f"nib-sync push said: {pushed.stdout.strip() or pushed.stderr.strip()}")

def page_note(browser, token: str, space: str) -> None:
    paper = (
        '{"nodes":[{"id":"p1","type":"page","x":0,"y":0,"width":794,"height":1123}],'
        '"edges":[]}\n'
    )
    made = request(f"/v1/spaces/{space}/notes", token, {"path": "Journal.pages", "content": paper})
    landed = made.get("note", {}).get("path")
    say(f"the account took the page note as {landed!r}")
    if landed != "Journal.pages":
        say("FAILED: the account would not take a page note")
        return

    context, page = opened(browser, "pages", 1280, 860, DESKTOP_AGENT, False, token)
    try:
        page.wait_for_function(
            """() => {
              const walk = (one) => (one ? [one.path, ...(one.children ?? []).flatMap(walk)] : [])
              return walk(window.nibApp.workspace.tree)
                .some((path) => path.endsWith('Journal.pages'))
            }""",
            timeout=60000,
        )
        say("and a second device found it in its tree")
    except Exception as error:
        say(f"FAILED: the page note never reached a second device: {error}")
    finally:
        context.close()

def main() -> int:
    out = DRIVE.shots
    worker = Worker()

    worker.start()

    with DRIVE.session() as browser:
        token, user = worker.account()
        say("an account with nothing in it; the app makes its own space")

        say("--- the second factor ---")
        second_factor(worker, token)

        worker.session(user, "another laptop")

        remote = ""

        for one in [
            ("desktop", 1440, 900, DESKTOP_AGENT, False),
            ("phone", 390, 844, PHONE_AGENT, True),
        ]:
            say(f"--- {one[0]} ---")
            remote = drive(browser, worker, out, token, user, *one) or remote
        say("--- a page note across two devices ---")
        if remote:
            page_note(browser, token, remote)

    say(f"shots in {out}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
