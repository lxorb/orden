"""What the reader does inside a real page, in a real Chrome, with a page that
is trying things on.

The unit tests run the same pipeline against jsdom, which cannot answer three
questions: whether Chrome accepts the manifest at all, whether the world the
reader is injected into is really out of the page's reach, and whether the
extension's own service worker starts without complaining. So this loads the
built extension, points it at `hostile.html`, and asks the worker for the clip
the popup would have previewed.

Run it after `node scripts/build.js`:

    python apps/clipper/test/e2e/clip.py

It needs Playwright's Chromium, and it runs headed because an extension does
not load in the headless shell.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DIST = HERE.parent.parent / "dist"

# The clip the worker asks the page for, which is what the popup's Page tab does.
READING = {"read": "page", "link": None}

# Runs in the service worker: inject the reader into the page's tab and ask it.
IN_WORKER = """
async () => {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' })
  const tab = tabs[0]
  if (!tab?.id) return { error: 'no page tab', tabs: tabs.length }

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  return { clip: await chrome.tabs.sendMessage(tab.id, READING) }
}
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):  # noqa: D102
        pass


def serving(folder: Path) -> tuple[int, socketserver.TCPServer]:
    """The fixtures on a port of the machine's choosing, so nothing collides."""
    handler = functools.partial(Quiet, directory=str(folder))
    server = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1], server


def checks(clip: dict, probe: dict, origin: str) -> list[tuple[bool, str]]:
    """What the clip has to be true of.

    The note the popup previews is built from this clip by `note.ts`, whose own
    tests say what a hostile title cannot do to it. What is here is what only a
    real browser can answer.
    """
    markdown = clip["markdown"]
    images = clip["images"]
    tags = clip["origin"]["tags"]

    return [
        # The reader is injected into an isolated world, so none of it is the
        # page's to reach. Without `chrome.runtime` the page cannot send the
        # worker a message either, forged or otherwise.
        (probe["runtime"] == "undefined", "the page cannot reach chrome.runtime"),
        (probe["flag"] == "hidden", "nor the reader's own flag"),
        (probe["bundle"] == "hidden", "nor the reader's bundle"),
        ("javascript:" not in markdown, "a link the browser would run keeps no address"),
        ("data:text/html" not in markdown, "nor one to a document of the page's own making"),
        (f"{origin}/relative/page" in markdown, "a relative link is made absolute"),
        (f"{origin}/pic/large.png" in images, "a picture takes the widest candidate offered"),
        (f"{origin}/pic/deferred.png" in images, "and the address it was deferring"),
        ("//other.example/protocol-relative.png" not in images, "a scheme is filled in"),
        (len(images) == len(set(images)), "each picture is numbered once"),
        (sum(1 for i in images if i.startswith("data:")) == 1, "a picture may be its own bytes"),
        ("alert('svg')" not in markdown, "an svg's script does not reach the note"),
        ("Decoration the page" not in markdown, "nor what the page calls decoration"),
        ("Navigation nobody" not in markdown, "nor the navigation beside the article"),
        ("````rust" in markdown, "a fence names its language and clears its own backticks"),
        ("| a | b |" in markdown, "a table comes out as one"),
        ("  - nested" in markdown, "a nested list keeps its nesting"),
        ("​" in markdown, "zero width text survives"),
        ("\U0001f600" in markdown and "\U0001f1fa\U0001f1f8" in markdown, "so do emoji"),
        ("מלל" in markdown, "so does right to left text"),
        (tags == ["one", "two", "three", "tagged"], "the page's own tags are read once each"),
    ]


def main() -> int:
    if not DIST.is_dir():
        print(f"no build at {DIST}: run node scripts/build.js first")
        return 2

    port, server = serving(HERE)
    failures = 0

    try:
        with sync_playwright() as play:
            context = play.chromium.launch_persistent_context(
                "",
                headless=False,
                executable_path=os.environ.get("CHROMIUM"),
                args=[
                    f"--disable-extensions-except={DIST}",
                    f"--load-extension={DIST}",
                ],
            )

            problems: list[str] = []
            context.on("weberror", lambda error: problems.append(str(error.error)))

            worker = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker")
            )
            print(f"  worker    {worker.url}")

            page = context.new_page()
            page.goto(f"http://127.0.0.1:{port}/hostile.html")
            page.wait_for_load_state("load")

            answer = worker.evaluate(f"const READING = {json.dumps(READING)}; ({IN_WORKER})()")
            if "clip" not in answer:
                print(f"  the worker could not read the page: {answer}")
                return 1

            clip = answer["clip"]
            probe = page.evaluate("window.nibProbe")

            for ok, said in checks(clip, probe, f"http://127.0.0.1:{port}"):
                print(f"  {'ok  ' if ok else 'FAIL'}      {said}")
                failures += 0 if ok else 1

            # The two pages the extension draws, for anything they say on load.
            base = worker.url.split("/background.js")[0]
            for name in ("popup.html", "options.html"):
                shown = context.new_page()
                shown.goto(f"{base}/{name}")
                shown.wait_for_timeout(400)
                drawn = shown.locator("#app > *").count()
                print(f"  {'ok  ' if drawn else 'FAIL'}      {name} draws something")
                failures += 0 if drawn else 1
                shown.close()

            if problems:
                print("  page errors:")
                for said in problems:
                    print(f"    {said}")
                failures += len(problems)

            context.close()
    finally:
        server.shutdown()

    print(f"\n  {'all checks passed' if not failures else f'{failures} failed'}\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
