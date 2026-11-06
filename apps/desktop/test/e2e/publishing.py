from __future__ import annotations

import difflib
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
SERVICE = harness.SERVICE

BLOG_ROOT = "localhost"
BLOG = f"http://field.{BLOG_ROOT}:{harness.worker_port()}"

OWNER = "owner@example.com"
SPACE = "Field notes"
NOTE = "Everything.md"
OTHER = "Another note.md"
OTHER_TEXT = "# Another note\n\nThe other note itself.\n\n## Why it works\n\nBecause.\n"

FIXTURE = SERVICE / "test" / "everything.md"

PATIENCE = 60

def request(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
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
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE, variables={"BLOG_ROOT": BLOG_ROOT})

    def account(self, email: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{email}', 'Ada Lovelace', {now});"
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
        page.wait_for_timeout(100)

    raise SystemExit(f"gave up waiting for {what}")

def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")

TREE = """
() => {
  const write = document.querySelector('#write')
  if (!write) return null

  const out = []
  const walk = (node, depth) => {
    for (const child of node.children) {
      const classes = [...child.classList].sort().join('.')
      out.push('  '.repeat(depth) + child.tagName.toLowerCase() + (classes ? '.' + classes : ''))
      walk(child, depth + 1)
    }
  }

  walk(write, 0)
  return out
}
"""

ALLOWED = [
    "the page's own furniture: the way back, the byline, the offer to present, the footer",
    "the front matter, which became that furniture rather than a table on the page",
    "the mermaid diagram, which this drive publishes through the API rather than"
    " from the app, so nothing has drawn its picture and the fence stays code",
    "a tag, which is a link to the search in the app and words on a page",
]

OWN_SCRIPT = "/s/"

THEME_LINE = "nib:site-theme"

CHROME = re.compile(r"^(?:p\.back|p\.by|p\.present|footer)$")

PROPERTIES = "div.properties"

def depth_of(line: str) -> int:
    return (len(line) - len(line.lstrip())) // 2

def trimmed(tree: list[str]) -> list[str]:
    out: list[str] = []
    dropping: int | None = None

    for line in tree:
        depth = depth_of(line)
        if dropping is not None:
            if depth > dropping:
                continue
            dropping = None

        bare = line.strip()
        if CHROME.match(bare) or bare == PROPERTIES:
            dropping = depth
            continue

        if bare in ("a.tag", "span.tag"):
            out.append("  " * depth + "TAG")
            continue

        if bare.startswith("figure.diagram"):
            out.append("  " * depth + "DIAGRAM")
            dropping = depth
            continue

        out.append(line)

    collapsed: list[str] = []
    for at, line in enumerate(out):
        after = out[at + 1] if at + 1 < len(out) else ""
        if line.strip() == "pre" and after.strip() == "code.language-mermaid":
            collapsed.append("  " * depth_of(line) + "DIAGRAM")
            continue
        if line.strip() == "code.language-mermaid":
            continue
        collapsed.append(line)

    return collapsed

TALLEST = 14_000

def tall(page: Page) -> None:
    height = page.evaluate(
        "() => Math.ceil(document.querySelector('#write').getBoundingClientRect().height) + 120"
    )
    page.set_viewport_size({"width": 1180, "height": min(int(height), TALLEST)})
    page.wait_for_timeout(600)

def fresh(
    browser: Browser,
    label: str,
    at: str,
    token: str | None = None,
    asked: list[str] | None = None,
) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900})
    if token:
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    if asked is not None:
        page.on("request", lambda request: asked.append(request.url))
    page.goto(at, wait_until="domcontentloaded")
    return page

def main() -> int:
    if not FIXTURE.exists():
        raise SystemExit(f"the fixture is missing: {FIXTURE}")

    fixture = FIXTURE.read_text("utf-8")
    failures: list[str] = []

    def wrong(words: str) -> None:
        failures.append(words)
        say(f"WRONG: {words}")

    worker = Worker()
    worker.start()

    with DRIVE.session() as browser:
        token = worker.account(OWNER)
        space = request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        for path, content in ((NOTE, fixture), (OTHER, OTHER_TEXT)):
            request(f"/v1/spaces/{space['id']}/notes", token=token, body={"path": path, "content": content})

        request(
            f"/v1/spaces/{space['id']}/blog",
            token=token,
            body={"subdomain": "field"},
            method="PUT",
        )
        say(f"the space is published at {BLOG}")

        app = fresh(browser, "app", ORIGIN, token=token)
        wait_for(app, "() => !!window.nibApp", "the app to start")
        app.evaluate("() => window.nibApp.theme.setScheme('light')")

        folder = wait_for(
            app,
            "() => {"
            "  const found = window.nibApp.workspace.spaces.find("
            f"    (one) => window.nibApp.sync.remoteIdFor(one.root) === {json.dumps(space['id'])});"
            "  return found ? found.name : null"
            "}",
            "the space to arrive in the app",
        )
        app.evaluate(
            "(name) => {"
            "  const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
            "  if (space) window.nibApp.workspace.showSpace(space.id)"
            "}",
            folder,
        )

        listed = (
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            "  const paths = walk(window.nibApp.workspace.tree);"
            f"  return paths.includes('/{folder}/{NOTE}') && paths.includes('/{folder}/{OTHER}')"
            "}"
        )
        wait_for(app, listed, "both notes to arrive in the app")

        app.evaluate(
            "(name) => {"
            "  const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
            "  return space ? window.nibApp.links.build(space.root) : null"
            "}",
            folder,
        )
        wait_for(
            app,
            "() => window.nibApp.links"
            f"  .index('/{folder}/{NOTE}').notes"
            f"  .some((one) => one.name === {json.dumps(OTHER.replace('.md', ''))})",
            "the space to be read through",
        )

        app.evaluate(f"() => window.nibApp.workspace.open('/{folder}/{NOTE}')")
        wait_for(app, "() => !!document.querySelector('.cm-content')", "the editor")

        app.evaluate("() => window.nibApp.workspace.toggleReading()")
        wait_for(app, "() => !!document.querySelector('#write .callout')", "the reading view")
        app.wait_for_timeout(1500)

        reading = app.evaluate(TREE)
        if not reading:
            raise SystemExit("the reading view rendered nothing")
        app.screenshot(path=str(SHOTS / "reading-pane.png"))
        tall(app)
        app.locator("#write").screenshot(path=str(SHOTS / "reading.png"))
        say(f"the reading view is drawn: {len(reading)} elements")

        app.close()
        worker.stop()
        worker.start(upstream=f"field.{BLOG_ROOT}")

        asked: list[str] = []
        page = fresh(browser, "page", f"{ORIGIN}/everything", asked=asked)
        page.wait_for_selector("#write .callout", timeout=15_000)
        page.wait_for_timeout(500)

        page.evaluate("async () => { await document.fonts.ready }")
        elsewhere = sorted({url for url in asked if not url.startswith((ORIGIN, f"blob:{ORIGIN}/"))})
        say(f"the page asked for {len(asked)} addresses:")
        for url in sorted(set(asked)):
            say(f"  {url[len(ORIGIN) :] if url.startswith(ORIGIN) else url}")
        if elsewhere:
            wrong(f"the published page fetched from elsewhere: {', '.join(elsewhere)}")

        faces = page.evaluate(
            "() => [...document.fonts]"
            "  .filter((one) => one.family.startsWith('KaTeX_') && one.status === 'loaded')"
            "  .map((one) => one.family).sort()"
        )
        drawn = page.evaluate(
            "() => {"
            "  const found = document.querySelector('#write .katex-display .katex');"
            "  return found ? Math.round(found.getBoundingClientRect().width) : 0"
            "}"
        )
        if not faces:
            wrong("the published page drew its maths without any KaTeX face")
        elif not drawn:
            wrong("the published page drew no block equation")
        else:
            say(f"the equation is {drawn}px wide, set in {', '.join(faces)}")

        published = page.evaluate(TREE)
        if not published:
            raise SystemExit("the published page rendered nothing")
        page.screenshot(path=str(SHOTS / "published-page.png"), full_page=True)
        page.locator("#write").screenshot(path=str(SHOTS / "published.png"))
        say(f"the published page is drawn: {len(published)} elements")

        light = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
        night = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="dark")
        after = night.new_page()
        after.goto(f"{ORIGIN}/everything", wait_until="domcontentloaded")
        after.wait_for_selector("#write .callout", timeout=15_000)
        tall(after)
        after.locator("#write").screenshot(path=str(SHOTS / "published-dark.png"))

        if after.evaluate("() => getComputedStyle(document.body).backgroundColor") == light:
            wrong("the published page is the same colour in the dark as in the light")
        night.close()

        one = trimmed(reading)
        other = trimmed(published)

        if one != other:
            diff = [
                line
                for line in difflib.unified_diff(one, other, "reading", "published", n=2, lineterm="")
                if line.strip()
            ]
            (SHOTS / "difference.txt").write_text("\n".join(diff), "utf-8")
            wrong(f"the two differ in {sum(1 for line in diff if line[:1] in '+-') - 2} places")
            for line in diff[:40]:
                say(line)
        else:
            say(f"the same {len(one)} elements, in the same order, with the same classes")

        for note in ALLOWED:
            say(f"allowed: {note}")

        carried = page.evaluate(
            """() => [...document.querySelectorAll('script')].map((one) => ({
                 src: one.getAttribute('src') ?? '',
                 kind: one.getAttribute('type') ?? '',
                 words: (one.textContent ?? '').trim(),
               }))"""
        )
        for one in carried:
            if one["kind"] == "application/json":
                say("allowed: the graph's own data, which is not code")
            elif one["src"]:
                if one["src"].startswith(OWN_SCRIPT):
                    say(f"allowed: the site's own script at {one['src']}")
                else:
                    wrong(f"the published page carries somebody else's script: {one['src']!r}")
            elif THEME_LINE in one["words"]:
                say("allowed: the one inline line that sets the theme before the first paint")
            else:
                wrong(f"the published page carries an inline script: {one['words'][:80]!r}")
        if not page.evaluate(
            "() => [...document.styleSheets].some((one) => (one.href ?? '').includes('/s/'))"
        ):
            wrong("the published page is not wearing the app's stylesheet")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print(
        f"\na published note is the note: {SHOTS / 'reading.png'} beside {SHOTS / 'published.png'}",
        flush=True,
    )
    return 0

if __name__ == "__main__":
    sys.exit(main())
