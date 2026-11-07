#!/usr/bin/env python3

import base64
import hashlib
import hmac
import http.server
import json
import os
import socketserver
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devtools import Session, targets  # noqa: E402

OUT = Path(sys.argv[1])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
DEBUG = int(os.environ["ORDEN_CEF_DEBUG_PORT"])
PORTS = {"mark": 8781, "three": 8783, "wrong": 8784}
SECRET = "JBSWY3DPEHPK3PXPJBSWY3DP"
PASS_PASSWORD = "drive the pass, drive it well"
failures = []
posts = []
held = threading.Lock()

def fail(what):
    print(f"::error::pass: {what}")
    failures.append(what)

def note(what):
    print(f"pass: {what}", flush=True)

def code_at(seconds):
    key = base64.b32decode(SECRET)
    digest = hmac.new(key, struct.pack(">Q", int(seconds) // 30), hashlib.sha1).digest()
    at = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[at : at + 4])[0] & 0x7FFFFFFF
    return f"{number % 1_000_000:06d}"

def page(title, body):
    return f"<!doctype html><title>{title}</title><body style='font:16px sans-serif;padding:24px'>{body}</body>"

def login_form(action, said=""):
    return page(
        "sign in",
        f"<p>{said}</p><form method=post action={action}>"
        "<label>Username <input name=username autocomplete=username></label><br>"
        "<label>Password <input type=password name=password autocomplete=current-password></label><br>"
        "<button type=submit>Sign in</button></form>",
    )

JOIN = page(
    "join",
    "<form method=post action=/join>"
    "<label>Email <input type=email name=email autocomplete=email></label><br>"
    "<label>Password <input type=password name=password autocomplete=new-password></label><br>"
    "<button type=submit>Create account</button></form>",
)

USERNAME = page(
    "who",
    "<form method=post action=/signin><label>Username <input name=username autocomplete=username></label>"
    "<button type=submit>Next</button></form>",
)
PASSWORD = page(
    "password",
    "<form method=post action=/signin/password><label>Password <input type=password name=password "
    "autocomplete=current-password></label><button type=submit>Next</button></form>",
)
CODE = page(
    "code",
    "<form method=post action=/signin/code><label>Verification code <input name=code "
    "autocomplete=one-time-code inputmode=numeric maxlength=6></label><button type=submit>Verify</button></form>",
)
DONE = page("signed in", "<h1>signed in</h1>")

class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def answer(self, body, status=200):
        data = body.encode()
        self.send_response(status)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def moved(self, to):
        self.send_response(303)
        self.send_header("location", to)
        self.send_header("content-length", "0")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        pages = {
            "/login": login_form("/login"),
            "/join": JOIN,
            "/signin": USERNAME,
            "/signin/password": PASSWORD,
            "/signin/code": CODE,
            "/done": DONE,
        }
        self.answer(pages.get(path, page("nothing", "nothing here")), 200 if path in pages else 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("content-length", "0"))
        sent = dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))
        port = self.server.server_address[1]
        with held:
            posts.append((port, path, sent))
        note(f"POST {port}{path} {sent}")
        if path == "/join":
            self.moved("/done")
        elif path == "/login" and port == PORTS["wrong"]:
            self.answer(login_form("/login", "Wrong password."))
        elif path == "/login":
            self.moved("/done")
        elif path == "/signin":
            self.moved("/signin/password" if sent.get("username") == "carol" else "/signin")
        elif path == "/signin/password":
            self.moved("/signin/code" if sent.get("password") == "pw-carol" else "/signin/password")
        elif path == "/signin/code":
            now = time.time()
            good = sent.get("code") in {code_at(now + step) for step in (-30, 0, 30)}
            self.moved("/done" if good else "/signin/code")
        else:
            self.answer(page("nothing", "nothing here"), 404)

class Serving(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")

PORT, TOKEN = endpoint()

def run(code, timeout=15):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {TOKEN}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=timeout) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None

def until(check, seconds=20, every=0.25):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        said = check()
        if said:
            return said
        time.sleep(every)
    return None

HELP = """
const typed = (el, text) => {
  const own = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  own.set.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
const labelled = (text) => {
  const label = [...document.querySelectorAll('label')].find((one) => one.textContent.trim() === text)
  return label ? document.getElementById(label.htmlFor) : null
}
const pressed = (text, within = document) => {
  const one = [...within.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === text && !button.disabled && button.getClientRects().length,
  )
  if (!one) return false
  one.click()
  return true
}
"""

def app(code, timeout=15):
    return run(f"(() => {{ {HELP} return ({code}) }})()", timeout)

def shown_bubble():
    return app("document.querySelector('[data-pass-fill]')?.dataset.passFill ?? null")

def bubble_says():
    return app("document.querySelector('[data-pass-fill]')?.innerText ?? ''") or ""

def site_page(port, path=""):
    for one in targets(DEBUG):
        url = one.get("url", "")
        if one.get("type") == "page" and url.startswith(f"http://127.0.0.1:{port}{path}"):
            return one
    return None

def in_page(port, expression, path=""):
    target = until(lambda: site_page(port, path), 20)
    if not target:
        return None
    session = Session(target)
    try:
        return session.value(expression)
    finally:
        session.close()

def opened(url):
    run("(nib.workspace.openWebsite(), 'opened')")
    time.sleep(0.5)
    tab = run("nib.workspace.activeTabId")
    run(f"(nib.pages.go({json.dumps(tab)}, {json.dumps(url)}), 'sent')")
    port = urllib.parse.urlparse(url).port
    path = urllib.parse.urlparse(url).path
    if not until(lambda: in_page(port, "document.readyState === 'complete'", path), 30):
        fail(f"{url} never loaded in a web tab")
    time.sleep(1.5)
    return tab

def sent_on(port, path):
    with held:
        return [one for at, where, one in posts if at == port and where == path]

def shot(name):
    subprocess.run(["grim", str(OUT / f"pass-{name}.png")], check=False, capture_output=True)

def joined(port, email, password):
    opened(f"http://127.0.0.1:{port}/join")
    typed = in_page(
        port,
        f"""(() => {{
  const set = (el, text) => {{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
    el.dispatchEvent(new Event('input', {{ bubbles: true }}))
  }}
  set(document.querySelector('[name=email]'), {json.dumps(email)})
  set(document.querySelector('[name=password]'), {json.dumps(password)})
  document.querySelector('form').requestSubmit()
  return true
}})()""",
        "/join",
    )
    if typed is not True:
        fail(f"the join page on {port} could not be typed into: {typed!r}")
        return False
    if not until(lambda: shown_bubble() == "save", 15):
        fail(f"no Save login? after joining on {port} as {email}; the bubble: {shown_bubble()!r}")
        shot(f"no-save-{port}")
        return False
    says = bubble_says()
    if "Save login?" not in says or email not in says:
        fail(f"the save bubble says {says!r}")
    app("pressed('Save', document.querySelector('[data-pass-fill]'))")
    if until(lambda: shown_bubble() is None, 10) is not None and shown_bubble() is not None:
        fail("the save bubble stayed after Save")
    return True

def pass_set_up():
    view = {
        "scope": {"kind": "all"},
        "filter": "all",
        "sort": "recent",
        "item": None,
        "page": "items",
        "settingsTab": "general",
    }
    run(f"(nib.workspace.openUnsaved('pass', {json.dumps(json.dumps(view))}, 'Pass'), 'opened')")
    if not until(lambda: app("!!document.querySelector('input[aria-label=\"Pass password\"]')"), 30):
        fail("the Pass tab shows no setup")
        shot("no-setup")
        return False
    app(
        f"""(() => {{
  typed(document.querySelector('input[aria-label="Pass password"]'), {json.dumps(PASS_PASSWORD)})
  typed(document.querySelector('input[aria-label="Type it again"]'), {json.dumps(PASS_PASSWORD)})
  return true
}})()"""
    )
    time.sleep(0.3)
    app("pressed('Continue')")
    if not until(lambda: app("pressed('I saved it')"), 60):
        fail("setting Pass up showed no recovery key")
        shot("no-recovery")
        return False
    if not until(lambda: app("pressed('New login')"), 20):
        fail("the empty Pass shows no New login")
        shot("no-new-login")
        return False
    time.sleep(0.5)
    made = app(
        f"""(() => {{
  const fields = {{
    'Title': 'Three steps',
    'Email or username': 'carol',
    'Password': 'pw-carol',
    '2FA secret key (TOTP)': {json.dumps(SECRET)},
  }}
  for (const [label, text] of Object.entries(fields)) {{
    const field = labelled(label)
    if (!field) return 'no field ' + label
    typed(field, text)
  }}
  return pressed('Add website') ? 'ok' : 'no Add website'
}})()"""
    )
    if made != "ok":
        fail(f"the new login could not be filled in: {made!r}")
        shot("no-fields")
        return False
    time.sleep(0.3)
    app(
        f"""(() => {{
  const sites = document.querySelectorAll('input[aria-label="Website"]')
  typed(sites[sites.length - 1], 'http://127.0.0.1:{PORTS["three"]}')
  return true
}})()"""
    )
    time.sleep(0.3)
    if not app("pressed('Create')"):
        fail("the new login has no Create to press")
        shot("no-create")
        return False
    if not until(lambda: app("!document.querySelector('form.edit')"), 15):
        fail("the new login was not made")
        shot("not-made")
        for said in thrown_pressing("Create"):
            print(f"pass: thrown while Create was pressed: {said}", flush=True)
        return False
    note("Pass set up, one login made in the Pass tab")
    settings = {**view, "page": "settings"}
    run(f"(nib.workspace.openUnsaved('pass', {json.dumps(json.dumps(settings))}, 'Pass'), 'opened')")
    switch = """[...document.querySelectorAll('button[role=switch]')].find(
      (one) => one.textContent.trim() === 'Sign in automatically' && one.getClientRects().length)"""
    if not until(lambda: app(f"!!({switch})"), 20):
        fail("Pass's settings show no Sign in automatically")
        shot("no-auto-login-switch")
        return False
    app(f"(({switch}).getAttribute('aria-checked') === 'true' || ({switch}).click(), true)")
    if not until(lambda: app(f"({switch}).getAttribute('aria-checked') === 'true'"), 10):
        fail("Sign in automatically did not turn on")
        return False
    note("Sign in automatically turned on in Pass's settings")
    return True

def app_target():
    for one in targets(DEBUG):
        url = one.get("url", "")
        if one.get("type") == "page" and ("tauri" in url.split("/")[0] or "tauri.localhost" in url):
            return one
    return None

def thrown_pressing(text):
    target = app_target()
    if not target:
        return ["no target for the app's own page"]
    session = Session(target)
    said = []
    try:
        session.call("Debugger.enable")
        session.call("Debugger.setPauseOnExceptions", {"state": "all"})
        session.call(
            "Runtime.evaluate",
            {
                "expression": f"setTimeout(() => [...document.querySelectorAll('button')].find((one) => one.textContent.trim() === {json.dumps(text)})?.click(), 50), true"
            },
        )
        end = time.monotonic() + 8
        while time.monotonic() < end and len(said) < 12:
            session.listen(0.5)
            pending = session.events[:]
            session.events.clear()
            for event in pending:
                if event.get("method") != "Debugger.paused":
                    continue
                params = event.get("params", {})
                frames = [
                    f"{one.get('functionName') or '?'}@{one.get('url', '').rsplit('/', 1)[-1]}:{one.get('location', {}).get('lineNumber')}"
                    for one in params.get("callFrames", [])[:4]
                ]
                said.append(f"{params.get('data', {}).get('description', '')[:300]} at {frames}")
                session.call("Debugger.resume")
        session.call("Debugger.setPauseOnExceptions", {"state": "none"})
        session.call("Debugger.disable")
    finally:
        session.close()
    return said

def nothing_in_page_world(port):
    said = in_page(
        port, "JSON.stringify([typeof window.nibPass, typeof window.__nibPass, typeof window.ipc])"
    )
    note(f"the page's own world has nibPass, __nibPass, ipc: {said}")
    if said != '["undefined","undefined","undefined"]':
        fail(f"the page's own world is handed Pass's channel: {said}")

def mark_pressed(port):
    target = until(lambda: site_page(port, "/login"), 10)
    if not target:
        return False
    session = Session(target)
    try:
        box = until(
            lambda: session.value(
                "(() => { const one = document.querySelector('orden-pass-mark'); if (!one) return null; "
                "const box = one.getBoundingClientRect(); return box.width ? [box.x + box.width / 2, box.y + box.height / 2] : null })()"
            ),
            10,
        )
        if not isinstance(box, list):
            fail("no Pass mark on the sign-in fields")
            return False
        x, y = box
        for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
            session.call(
                "Input.dispatchMouseEvent",
                {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1},
            )
        return True
    finally:
        session.close()

def field_values(port, path):
    return in_page(
        port,
        "JSON.stringify([document.querySelector('[name=username]').value, document.querySelector('[name=password]').value])",
        path,
    )

def chosen(port, email, password):
    chose = app(
        "(() => { const one = [...document.querySelectorAll('[data-pass-choice]')].find((button) => "
        f"button.innerText.includes({json.dumps(email)})); if (!one) return false; one.click(); return true }})()"
    )
    if not chose:
        fail(f"{email}'s login could not be chosen; the bubble says {bubble_says()!r}")
        return False
    wanted = json.dumps([email, password], separators=(",", ":"))
    filled = until(lambda: field_values(port, "/login") == wanted, 10)
    if not filled:
        fail(f"choosing {email} filled {field_values(port, '/login')!r}")
        shot("not-filled")
        return False
    note(f"choosing {email} put {wanted} in the page's fields")
    return True

def marked_fill():
    port = PORTS["mark"]
    if not (joined(port, "alice@example.com", "pw-alice") and joined(port, "bob@example.com", "pw-bob")):
        return
    note("two logins saved from the join page's Save login?")
    opened(f"http://127.0.0.1:{port}/login")
    nothing_in_page_world(port)
    if not until(lambda: shown_bubble() == "choose", 10):
        fail(f"two matching logins offered no choice; the bubble: {shown_bubble()!r}")
        shot("no-first-choice")
        return
    note("two matching logins: not signed in by itself, the choice offered instead")
    if not chosen(port, "alice@example.com", "pw-alice"):
        return
    if not mark_pressed(port):
        return
    if not until(lambda: shown_bubble() == "choose", 10):
        fail(f"pressing the mark showed no choice; the bubble: {shown_bubble()!r}")
        shot("no-choice")
        return
    says = bubble_says()
    note(f"the mark's bubble: {says!r}")
    if "alice@example.com" not in says or "bob@example.com" not in says:
        fail(f"the saved logins are not offered again: {says!r}")
    if not chosen(port, "bob@example.com", "pw-bob"):
        return
    time.sleep(1.5)
    if sent_on(port, "/login"):
        fail("a fill from the mark sent the form")

def three_pages():
    port = PORTS["three"]
    opened(f"http://127.0.0.1:{port}/signin")
    done = until(lambda: in_page(port, "document.title", "/done") == "signed in", 30)
    asked = [(where, one) for at, where, one in posts if at == port]
    note(f"the three pages were sent: {asked}")
    if not done:
        fail(f"signing in by itself did not reach the end: {asked}")
        shot("three-stuck")
        return
    wanted = ["/signin", "/signin/password", "/signin/code"]
    if [where for where, _ in asked] != wanted:
        fail(f"the steps sent were {[where for where, _ in asked]}, not {wanted}")
    note("signed in by itself across the username, the password and the 2FA code")

def wrong_password():
    port = PORTS["wrong"]
    if not joined(port, "dave@example.com", "not-it"):
        return
    opened(f"http://127.0.0.1:{port}/login")
    if not until(lambda: sent_on(port, "/login"), 15):
        fail("the wrong password was never sent once")
        return
    time.sleep(8)
    count = len(sent_on(port, "/login"))
    note(f"a wrong password was sent {count} time(s) in 8 s")
    if count != 1:
        fail(f"a wrong password was sent {count} times")

for port in PORTS.values():
    threading.Thread(target=Serving(("127.0.0.1", port), Site).serve_forever, daemon=True).start()
if not until(lambda: run("1 + 1") == 2, 60, 0.5):
    raise SystemExit("::error::pass: the app never answered")
time.sleep(2)
if pass_set_up():
    marked_fill()
    three_pages()
    wrong_password()
shot("end")
(OUT / "pass-posts.json").write_text(json.dumps(posts, indent=1))
sys.exit(1 if failures else 0)
