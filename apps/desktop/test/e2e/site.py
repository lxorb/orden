"""Publishing part one, against the real Worker: which notes, what will change,
where a page lives, what its head says, and a site behind a password.

Two halves, because `wrangler dev` builds the URL the Worker sees from the origin
it was given rather than from the request's Host header - so a run is either the
API or one blog, and this restarts the Worker between the two. The database is the
same either way, which is what makes that honest: the site the second half asks
for is the site the first half published.

    the sheet     a folder made private, and what the sheet says will change
    the pages     what the hostname serves and what it does not
    the paths     a permalink, an alias, and the redirect a rename leaves
    the machines  the sitemap, the feed, robots and the favicon
    the password  the form, a wrong word, the right one, and the note behind it

Run it from the repository root:

    python apps/desktop/test/e2e/site.py

Screenshots go beside this file under `shots/site/`, which is ignored.
"""

from __future__ import annotations

import hashlib
import json
import re
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SERVICE = ROOT / "services" / "sync"
SHOTS = APP / "test" / "e2e" / "shots" / "site"

# Above 18000, and not a port any other drive here uses.
PORT = 18991
ORIGIN = f"http://127.0.0.1:{PORT}"

# Every browser resolves `*.localhost` itself, so a blog's own hostname needs no
# hosts file: the Worker is told that this is the domain blogs are published under.
BLOG_ROOT = "localhost"
BLOG_HOST = f"field.{BLOG_ROOT}"
BLOG = f"http://{BLOG_HOST}:{PORT}"

EMAIL = "site-drive@example.com"
PASSWORD = "the quiet part"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: The notes the site is made of. Everything the rules and the front matter have
#: to be right about, and nothing else.
NOTES = {
    "Public/One.md": "# One\n\nThe first words of it.\n\n![a shot](/i/abc123.png)\n",
    "Public/Two.md": "---\ndate: 2026-05-06\ndescription: The second one.\n---\n\n# Two\n\nMore.\n",
    "Drafts/Three.md": "# Three\n\nNot ready.\n",
    "Quiet.md": "---\npublish: false\n---\n\n# Quiet\n\nNever on the site.\n",
    "Pinned.md": "---\npermalink: pinned/here\naliases:\n  - old-pin\n---\n\n# Pinned\n",
    "Moved.md": "# Moved\n\nThis note is about to be renamed.\n",
}


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [shutil.which("npx") or "npx", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
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


class Answer:
    """One answer from the site: what it said, and how."""

    def __init__(self, status: int, text: str, headers) -> None:
        self.status = status
        self.text = text
        self.headers = headers


class Straight(urllib.request.HTTPRedirectHandler):
    """A redirect is an answer here rather than a step on the way to one."""

    def redirect_request(self, *_args):
        return None


def site(
    path: str,
    data: bytes | None = None,
    opener=None,
    follow: bool = True,
    cookie: str = "",
) -> Answer:
    """The blog. Asked for on the loopback address, because a browser resolves
    `*.localhost` by itself and Python does not - and it makes no difference:
    `wrangler dev` was told which origin it is answering as, so the Worker sees
    the blog's hostname whatever address the request arrived on."""
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data)
    if data is not None:
        ask.add_header("content-type", "application/x-www-form-urlencoded")
    if cookie:
        ask.add_header("cookie", cookie)

    if opener is None and not follow:
        opener = urllib.request.build_opener(Straight)

    open_it = opener.open if opener else urllib.request.urlopen
    try:
        with open_it(ask, timeout=30) as answer:
            return Answer(answer.status, answer.read().decode("utf-8", "replace"), answer.headers)
    except urllib.error.HTTPError as refused:
        return Answer(refused.code, refused.read().decode("utf-8", "replace"), refused.headers)


def answering() -> bool:
    try:
        urllib.request.urlopen(f"{ORIGIN}/health", timeout=5).read()
        return True
    except urllib.error.HTTPError:
        return True
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        return False


class Worker:
    """The Worker under wrangler dev, and the local database behind it."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.log = SHOTS / "worker.log"
        self.opened = None

    def build(self) -> None:
        say("building the app against the local Worker")
        environment = {**os.environ, "VITE_NIB_API": ORIGIN, "NODE_ENV": "development"}
        built = subprocess.run(
            [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
            cwd=APP,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if built.returncode != 0:
            raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")

    def clean(self) -> None:
        state = SERVICE / ".wrangler" / "state"
        if state.exists():
            say("clearing what the last run left")
            shutil.rmtree(state, ignore_errors=True)

    def migrate(self) -> None:
        say("applying the migrations")
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", cwd=SERVICE)
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

        say(f"{done.stdout.count('0029') + done.stdout.count('0030')} of the new two named")

    def sql(self, statement: str) -> str:
        done = npx(
            "wrangler", "d1", "execute", "nib", "--local", f"--command={statement}", cwd=SERVICE
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

        return done.stdout

    def start(self, upstream: str | None = None) -> None:
        say(f"the Worker on {ORIGIN}" + (f", answering as {upstream}" if upstream else ""))
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("ab")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                "--local",
                "--port",
                str(PORT),
                "--ip",
                "127.0.0.1",
                "--var",
                f"BLOG_ROOT:{BLOG_ROOT}",
                *(["--local-upstream", upstream] if upstream else []),
                "--show-interactive-dev-session=false",
            ],
            cwd=SERVICE,
            stdout=self.opened,
            stderr=subprocess.STDOUT,
        )

        until = time.monotonic() + 150
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            if answering():
                say("it is answering")
                return
            time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        if self.opened:
            self.opened.flush()

        return self.log.read_text("utf-8", errors="replace") if self.log.exists() else ""

    def stop(self) -> None:
        if not self.process:
            return

        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(self.process.pid)],
                capture_output=True,
                check=False,
            )
        else:
            self.process.terminate()

        try:
            self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()

        self.process = None
        if self.opened:
            self.opened.close()
            self.opened = None

    def account(self) -> str:
        """An account with a live session, put straight into the database: signing
        in is not what this is about."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{EMAIL}', 'Ada Lovelace', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', 'the drive', {now});"
        )

        return token


def opened(browser, name: str, width: int, height: int, agent: str, finger: bool, token: str):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="light" if finger else "dark",
        device_scale_factor=2,
    )
    context.add_init_script(f"try {{ localStorage.setItem('nib:session', '{token}') }} catch {{}}")

    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)

    # A browser that has been introduced and then had its own notes erased, which
    # is what somebody who wants only what the account holds arrives as. The same
    # opening as first-sync.py, and the reason is the same: a device with a space
    # of its own has two spaces after signing in, and which one is "the space" is
    # then a question this drive should not have to ask.
    page.evaluate("async () => await window.nibApp.workspace.eraseLocalSpaces()")
    page.wait_for_function("() => window.nibApp.workspace.spaces.length === 0", timeout=60000)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.account.user", timeout=60000)

    return context, page


def sheet(browser, out: Path, token: str, name: str, width, height, agent, finger) -> None:
    """The publish sheet: the rules, what they would change, and Publish."""
    context, page = opened(browser, name, width, height, agent, finger, token)

    def shot(tag: str) -> None:
        page.screenshot(path=str(out / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    # The space the account holds, once this device has it and its notes.
    try:
        page.wait_for_function(
            f"() => window.nibApp.workspace.notes.length >= {len(NOTES)}", timeout=60000
        )
    except Exception:
        say(f"[{name}] still waiting: {page.evaluate('''() => ({
          spaces: window.nibApp.workspace.spaces.map((one) => one.name),
          notes: window.nibApp.workspace.notes.length,
          sync: window.nibApp.sync.status,
          error: window.nibApp.sync.lastError,
        })''')}")
        raise
    space = page.evaluate("() => window.nibApp.workspace.spaces[0]")
    say(f"[{name}] the device holds {space['name']} with its notes")

    page.evaluate("() => window.nibApp.publish.show(window.nibApp.workspace.spaces[0])")
    page.wait_for_timeout(600)
    page.evaluate("() => (window.nibApp.publish.confirmed = true)")
    page.evaluate("() => window.nibApp.publish.typeSubdomain('field')")

    # Drafts out, which is the whole of what a folder rule is.
    page.evaluate("() => window.nibApp.publish.rule('exclude', 'Drafts', true)")
    page.evaluate("async () => await window.nibApp.publish.askChanges()")
    page.wait_for_timeout(500)

    changes = page.evaluate("() => window.nibApp.publish.changes")
    say(f"[{name}] the sheet says: {changes}")

    rows = page.evaluate(
        """() => [...document.querySelectorAll('.changed li')].map((one) => one.textContent.trim())"""
    )
    said = page.evaluate(
        """() => [...document.querySelectorAll('.note')].map((one) => one.textContent.replace(/\\s+/g, ' ').trim())"""
    )
    say(f"[{name}] and shows {said} {rows}")
    shot("sheet")

    page.evaluate("() => window.nibApp.publish.description = 'Notes from the field.'")
    # The button rather than the store, because the icon the site wears is read
    # off the mark the sheet has drawn; see site-icon.ts.
    page.click("button.go")
    page.wait_for_timeout(2500)

    live = page.evaluate("() => window.nibApp.publish.blog")
    say(f"[{name}] published: enabled={live['enabled']} at {live['subdomain']} rules={live['site']['rules']}")
    shot("published")

    # The two panes P10 left behind, on the way past: the design pass measured
    # them and this is where they are looked at.
    for section in ["sync", "account"]:
        page.evaluate("() => window.nibApp.publish.close()")
        page.evaluate(f"() => window.nibApp.settings.show('{section}')")
        page.wait_for_timeout(900)
        shot(section)

    context.close()


def pages(worker: Worker, token: str, space: str) -> None:
    """What the hostname serves, once the Worker is answering as the blog."""
    index = site("/")
    listed = sorted(set(re.findall(r"<span>([^<]+)</span>", index.text)))
    say(f"the index lists: {listed}")

    for path, wanted in [
        ("/public/one", 200),
        ("/public/two", 200),
        ("/drafts/three", 404),
        ("/quiet", 404),
        ("/pinned/here", 200),
        ("/old-pin", 200),
        ("/moved", 200),
    ]:
        answer = site(path)
        say(f"{path} answers {answer.status} (wanted {wanted})")

    head = site("/public/one").text
    for what in ['<meta name="description"', 'property="og:image"', 'rel="canonical"', 'rel="alternate"']:
        say(f"the head of /public/one has {what}: {what in head}")

    # A rename, through the API, and the path it used to live at.
    notes = request(f"/v1/spaces/{space}/changes?since=0", token).get("notes", [])
    moved = next((one for one in notes if one["path"] == "Moved.md"), None)
    if moved:
        request(
            f"/v1/notes/{moved['id']}",
            token,
            {"path": "Moved along.md", "content": "# Moved\n\nRenamed.\n", "baseVersion": moved["version"]},
            method="PUT",
        )
        was = site("/moved", follow=False)
        say(f"after the rename /moved answers {was.status} to {was.headers.get('location')}")
        say(f"and /moved-along answers {site('/moved-along').status}")

    feed = site("/feed.xml")
    order = [one for one in ["<title>Two</title>", "<title>One</title>"] if one in feed.text]
    say(f"the feed is {feed.headers.get('content-type')} and reads {order}")
    say(f"it carries the summaries: {'<summary>The second one.</summary>' in feed.text}")

    sitemap = site("/sitemap.xml")
    say(f"the sitemap lists {sitemap.text.count('<loc>')} pages and no drafts: {'/drafts/' not in sitemap.text}")

    robots = site("/robots.txt")
    say(f"robots says: {robots.text.strip().splitlines()}")

    icon = site("/favicon.svg")
    say(f"the favicon is {icon.headers.get('content-type')}, {len(icon.text)} bytes")


def password(worker: Worker, token: str, space: str) -> None:
    """The form, a wrong word, the right one, and the note behind it."""
    request(f"/v1/spaces/{space}/site", token, {"password": PASSWORD}, method="PUT")

    asked = site("/public/one")
    say(f"with a password set, the page answers {asked.status} with a form: {'type=\"password\"' in asked.text}")
    say(f"and nothing of the note: {'The first words of it' not in asked.text}")
    say(f"robots now says: {site('/robots.txt').text.strip().splitlines()}")

    wrong = site("/public/one", data=b"password=nope")
    say(f"a wrong word answers {wrong.status}: {'not the password' in wrong.text}")

    right = site(
        "/public/one",
        data=f"password={PASSWORD.replace(' ', '+')}".encode(),
        follow=False,
    )
    ticket = (right.headers.get("set-cookie") or "").split(";")[0]
    say(f"the right one answers {right.status} to {right.headers.get('location')}, holding {ticket[:14]}…")

    # Carried by hand rather than by a cookie jar: the ticket is set `Secure`, and
    # a secure cookie is not sent back over the plain http a drive runs on. A
    # browser on the real site is on https and sends it by itself.
    read = site("/public/one", cookie=ticket)
    say(f"behind it, the note: {'The first words of it' in read.text} ({read.status})")

    request(f"/v1/spaces/{space}/site", token, {"password": None}, method="PUT")
    say(f"with the password off, the page answers {site('/public/one').status} again")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    worker = Worker()

    worker.clean()
    worker.migrate()
    worker.build()
    worker.start()

    token = ""
    space = ""

    try:
        token = worker.account()
        made = request("/v1/spaces", token, {"name": "Field notes"})
        space = made["space"]["id"]
        for path, content in NOTES.items():
            request(f"/v1/spaces/{space}/notes", token, {"path": path, "content": content})

        # A space that wears an icon, because what a tab shows is that icon drawn
        # by the app; a space with none gets its letter, which the Worker draws.
        worker.sql(f"update spaces set icon = 'FileText' where id = '{space}';")
        say(f"the account holds {len(NOTES)} notes in Field notes, marked FileText")

        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for one in [
                    ("desktop", 1440, 900, DESKTOP_AGENT, False),
                    ("phone", 390, 844, PHONE_AGENT, True),
                ]:
                    say(f"--- the sheet, {one[0]} ---")
                    sheet(browser, SHOTS, token, *one)
            finally:
                browser.close()
    finally:
        worker.stop()

    # And now as the blog itself, on the same database.
    worker.start(upstream=BLOG_HOST)
    try:
        say("--- what the hostname serves ---")
        pages(worker, token, space)
        say("--- behind a password ---")
        password(worker, token, space)
    finally:
        worker.stop()

    say(f"shots in {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
