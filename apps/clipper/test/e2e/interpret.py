"""What the interpreter does in a real Chrome, against a provider that is really
there.

The unit tests build the prompt, read the reply and write the block; none of them
can answer the questions that only a browser can: whether an extension page may
reach a provider on another origin at all, whether the popup really shows the
properties in the note it is about to save, and whether a clip with the switch off
still leaves the browser alone.

So this serves a fixture article and a fake OpenAI-compatible server on one port,
points the built extension at it, and drives the popup the way a person does. The
fake answers the way models actually answer - a sentence, a code fence, a key
nobody asked for, and a value with a line break and a `---` in it - so that what
lands in the front matter is what the strict reader made of all that rather than
what a well behaved model would have sent.

Run it after `node scripts/build.js`:

    python apps/clipper/test/e2e/interpret.py

It needs Playwright's Chromium and runs headed, because an extension does not load
in the headless shell. `CHROMIUM` names a browser to use instead of the one
Playwright registered.
"""

from __future__ import annotations

import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
DIST = HERE.parent.parent / "dist"

# The ports this drive may take. Several agents work on this repo at once and this
# is the range that belongs to it.
PORTS = range(20040, 20060)

# How long the popup gets to read a page, ask the provider and draw the answer.
PATIENCE = 15000

# What the fake model answers. Deliberately awful: prose around the object, a
# fence, a key no template asked for, a duplicate tag, and an author whose value
# would end the front matter block and open a key of its own if anything wrote it
# down as it arrived.
REPLY = (
    "Sure! Here are the properties I could find:\n\n"
    "```json\n"
    + json.dumps(
        {
            "title": "Borrow checking, ten years on",
            "author": "Rowan Keld\n---\ntags: [taken over]",
            "published": "2026-02-14",
            "summary": "Ten years of borrow checking moved the diagnostics, not the rule.",
            "tags": ["rust", "compilers", "rust"],
            "sentiment": "upbeat",
        }
    )
    + "\n```\n\nHope that helps!"
)

MODELS = {"data": [{"id": "fake-model"}, {"id": "another-model"}]}


class Provider(http.server.SimpleHTTPRequestHandler):
    """The fixtures on one hand and an OpenAI-compatible server on the other.

    One server because the extension has to reach both, and because what the
    provider was asked is worth reading beside the page it was asked about. Every
    request it answers is kept in `asked`.
    """

    asked: list[dict] = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def log_message(self, *_args):
        pass

    def answer(self, body: dict) -> None:
        said = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(said)))
        # The extension page is an origin of its own, so without this nothing it
        # sends here is ever answered as far as the page can tell.
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(said)

    def do_OPTIONS(self):  # noqa: N802
        self.answer({})

    def do_GET(self):  # noqa: N802
        if self.path == "/v1/models":
            self.answer(MODELS)
            return

        super().do_GET()

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or "{}")
        Provider.asked.append(body)

        self.answer({"choices": [{"message": {"content": REPLY}}]})


def serving() -> tuple[int, socketserver.TCPServer]:
    """The one server, on the first port in this drive's range that is free."""
    for port in PORTS:
        try:
            server = socketserver.TCPServer(("127.0.0.1", port), Provider)
        except OSError:
            continue

        threading.Thread(target=server.serve_forever, daemon=True).start()
        return port, server

    raise SystemExit(f"no free port in {PORTS.start}-{PORTS.stop - 1}")


def held(port: int, switched: bool) -> dict:
    """What storage holds: a session, somewhere to save to, and the interpreter
    pointed at the fake provider. The templates are left as they ship, so the
    Article template is the one the fixture's address claims."""
    return {
        "nib:session": "a-session",
        "nib:email": "me@example.com",
        "nib:spaces": [{"id": "s1", "name": "Notes", "position": 0}],
        "nib:target": {"spaceId": "s1", "folder": ""},
        "nib:interpreter": {
            "provider": "compatible",
            "keys": {},
            "models": {"compatible": "fake-model"},
            "address": f"http://127.0.0.1:{port}/v1",
            "on": {"Article": True} if switched else {},
        },
    }


def reasked(popup: Page) -> None:
    """The popup, asked about the page again.

    Its request goes to whichever tab is active, and the popup drawn in a tab of its
    own is that tab until something else is brought to the front. So the kinds are
    clicked from JavaScript rather than by the mouse, which would bring this tab back
    to the front and have the popup read itself - and by `evaluate` rather than
    through a locator, because a locator waits for an element to be visible and
    Chrome lays nothing out in a tab nobody is looking at.

    Away from Page and back to it, because it is the kind changing that asks.
    """
    for at in (1, 0):
        popup.evaluate("(at) => document.querySelectorAll('.tab')[at].click()", at)
        popup.wait_for_timeout(200)


DREW = """
  ([wanted]) => {
    const pre = document.querySelector('pre')
    if (!pre || !pre.textContent.includes(wanted)) return null

    return { note: pre.textContent, said: document.querySelector('.said')?.textContent ?? '' }
  }
"""


def drew(popup: Page, wanted: str) -> dict:
    """What the popup drew, once it says what it was waiting to say.

    Read inside the wait's own call rather than from a locator afterwards: this tab
    is in the background, where nothing is painted, timers are throttled and a
    second round trip to it is a second chance for the answer to have moved on.
    """
    return popup.wait_for_function(DREW, arg=[wanted], polling=400, timeout=PATIENCE).json_value()


def checks(note: str, said: str, asked: dict) -> list[tuple[bool, str]]:
    """What the popup drew, what it said about it, and what the provider was sent."""
    prompt = "\n".join(str(one.get("content", "")) for one in asked.get("messages", []))
    fences = [line for line in note.split("\n") if line == "---"]

    return [
        (asked.get("model") == "fake-model", "the model the options page chose is the one asked"),
        ("The borrow checker began" in prompt, "the article goes to the provider"),
        ("Archive nobody clipped" not in prompt, "the navigation beside it does not"),
        ("Decoration the page" not in prompt, "nor what the page calls decoration"),
        ("author: Who wrote it, as printed" in prompt, "the template's questions are the prompt"),
        ("tags[]: Three to six topics" in prompt, "a list says it is one"),
        ("author: 'Rowan Keld --- tags: [taken over]'" in note, "a value stays one quoted line"),
        (len(fences) == 2, "so the note still has exactly one front matter block"),
        ("published: 2026-02-14" in note, "a property the template named is written"),
        ("sentiment" not in note, "one it did not name is not"),
        ("title: Borrow checking, ten years on" in note, "the title it filled in is the title"),
        ("# Borrow checking, ten years on" in note, "and the heading says the same"),
        ("tags: [rust, systems, compilers]" in note, "its tags join the page's own, each once"),
        ("source: http://127.0.0.1" in note, "the clip still says where it came from"),
        ("characters sent" in said, "the popup says how much of the page went"),
    ]


def main() -> int:
    if not DIST.is_dir():
        print(f"no build at {DIST}: run node scripts/build.js first")
        return 2

    port, server = serving()
    failures = 0

    try:
        with sync_playwright() as play:
            context = play.chromium.launch_persistent_context(
                "",
                headless=False,
                executable_path=os.environ.get("CHROMIUM"),
                args=[f"--disable-extensions-except={DIST}", f"--load-extension={DIST}"],
            )

            problems: list[str] = []
            context.on("weberror", lambda error: problems.append(str(error.error)))

            worker = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker")
            )
            base = worker.url.split("/background.js")[0]
            print(f"  worker    {worker.url}")
            print(f"  provider  http://127.0.0.1:{port}/v1")

            worker.evaluate(
                "async (stored) => chrome.storage.local.set(stored)", held(port, switched=True)
            )

            page = context.new_page()
            page.goto(f"http://127.0.0.1:{port}/article.html")
            page.wait_for_load_state("load")

            popup = context.new_page()
            popup.goto(f"{base}/popup.html")
            popup.wait_for_function("() => !!document.querySelector('.kinds')")

            # The article is what the worker should answer about from here on.
            page.bring_to_front()
            reasked(popup)

            drawn = drew(popup, "author:")
            note = drawn["note"]
            said = drawn["said"]
            asked = Provider.asked[0] if Provider.asked else {}

            print("\n  the block the popup previews:")
            for line in note.split("\n---")[0].split("\n"):
                print(f"    {line}")
            print(f"\n  under the switch: {said.strip()!r}\n")

            for ok, one in checks(note, said, asked):
                print(f"  {'ok  ' if ok else 'FAIL'}      {one}")
                failures += 0 if ok else 1

            # With the switch off the clip is what it always was, and the provider
            # hears nothing at all about the page.
            sent = len(Provider.asked)
            worker.evaluate(
                "async (stored) => chrome.storage.local.set(stored)", held(port, switched=False)
            )

            plain = context.new_page()
            plain.goto(f"{base}/popup.html")
            plain.wait_for_function("() => !!document.querySelector('.kinds')")
            page.bring_to_front()
            reasked(plain)

            raw = drew(plain, "source:")["note"]
            for ok, one in [
                ("source: http://127.0.0.1" in raw, "a clip with the switch off is still a clip"),
                ("author:" not in raw, "and says nothing the interpreter would have filled in"),
                (len(Provider.asked) == sent, "and the provider was not asked about it"),
                (
                    plain.evaluate("() => document.querySelectorAll('.reading').length") == 1,
                    "the row is still there to turn on",
                ),
            ]:
                print(f"  {'ok  ' if ok else 'FAIL'}      {one}")
                failures += 0 if ok else 1

            plain.close()

            # The options page: the provider, its models and the templates it works
            # from, all drawn from what storage holds.
            shown = context.new_page()
            shown.goto(f"{base}/options.html")
            shown.wait_for_selector("textarea")
            shown.wait_for_timeout(600)

            templates = shown.locator("textarea").input_value()
            offered = shown.locator("#models option").count()

            for ok, one in [
                (shown.locator("main").inner_text().count("\n") > 0, "the options page draws"),
                ("- name: Article" in templates, "the templates are there to edit"),
                (templates.count("- name:") == 6, "all six of them"),
                (offered == len(MODELS["data"]), "the models the provider lists are offered"),
                ("keychain" in shown.locator(".said").first.inner_text(), "the keys are spoken for"),
            ]:
                print(f"  {'ok  ' if ok else 'FAIL'}      {one}")
                failures += 0 if ok else 1

            shown.close()

            if problems:
                print("  page errors:")
                for one in problems:
                    print(f"    {one}")
                failures += len(problems)

            context.close()
    finally:
        server.shutdown()

    print(f"\n  {'all checks passed' if not failures else f'{failures} failed'}\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
