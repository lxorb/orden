"""Web tabs, in a real browser against the web build.

What a unit test cannot see. A website in the space is a file, a row with a globe
in front of it, a tab with a bar over it, and - in a browser - either a frame or
the card that stands in where the site refuses to be framed. Whether all of that
is really there, and whether it reads as one design in both schemes, is a picture.

Everything it needs is served from here, so the drive needs no network and always
answers the same: one page that allows framing and one that refuses it with
`X-Frame-Options: DENY`, beside the built app on the same port.

The desktop embedding - a child webview placed over the pane - is not here and
cannot be: driving it means building the Rust, which this machine does not do.
That half is held by the crate's own tests and by CI; see docs/web-tabs.md.

Run it with the repository's own Chromium:

    python scripts/web-tab-e2e.py

It builds nothing. `pnpm --filter @nib/desktop build` first, then this."""

import http.server
import json
import os
import pathlib
import shutil
import socket
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist"
OUT = ROOT / "target" / "web-tab-e2e"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

# The ports this agent's drives are allowed to bind.
PORTS = range(20100, 20200)

FRAMED = "/drive/framed.html"
REFUSED = "/drive/refused.html"

PAGES = {
    FRAMED: (
        "<!doctype html><html><head><title>A page that frames</title></head>"
        "<body style='font:16px system-ui;padding:2rem'>"
        "<h1>A page that frames</h1>"
        "<p>This one sends no X-Frame-Options, so a browser shows it.</p>"
        "</body></html>"
    ),
    REFUSED: (
        "<!doctype html><html><head><title>A page that refuses</title></head>"
        "<body style='font:16px system-ui;padding:2rem'>"
        "<h1>A page that refuses</h1>"
        "<p>DENY, like most of the web.</p>"
        "</body></html>"
    ),
}

NOTE = "/Notes/Idea.md"
NOTE_TEXT = "# Idea\n\nAn ordinary note, for the mark beside it.\n"

WEB_NOTE = "/Reading/A page that frames.md"
REFUSED_NOTE = "/Reading/A page that refuses.md"


def web_note(url: str, title: str) -> str:
    return (
        f"---\nurl: {url}\ntitle: {title}\ndate: 2026-09-12T08:00:00.000Z\n---\n\n"
        f"# {title}\n\n<{url}>\n"
    )


SEED = """
async (files) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib', 1)
    request.onupgradeneeded = () => {
      const made = request.result
      if (!made.objectStoreNames.contains('files')) made.createObjectStore('files', { keyPath: 'path' })
      if (!made.objectStoreNames.contains('assets')) made.createObjectStore('assets', { keyPath: 'path' })
      if (!made.objectStoreNames.contains('meta')) made.createObjectStore('meta')
      if (!made.objectStoreNames.contains('snapshots')) {
        const store = made.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        store.createIndex('notePath', 'notePath')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const now = Date.now()
  for (const [path, content] of files) {
    await new Promise((resolve, reject) => {
      const request = db
        .transaction('files', 'readwrite')
        .objectStore('files')
        .put({ path, content, modified: now, created: now })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
  return true
}
"""

# Every file in the store, so a clip can be read back out of it.
FILES = """
async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return await new Promise((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').getAll()
    request.onsuccess = () => resolve(request.result.map((one) => [one.path, one.content]))
    request.onerror = () => reject(request.error)
  })
}
"""

# The mark a row wears, by the row's name: the first path in its icon, which is
# what tells a globe from a page without reading the picture.
MARKS = """
() =>
  Object.fromEntries(
    [...document.querySelectorAll('.nib-row.row')].map((row) => [
      row.querySelector('.nib-row-label')?.textContent ?? '',
      row.querySelector('.mark svg')?.innerHTML.slice(0, 120) ?? '',
    ]),
  )
"""


def chrome() -> pathlib.Path:
    """The newest Chromium the repository's Playwright has fetched."""
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]


def free_port() -> int:
    for port in PORTS:
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port

    raise SystemExit(f"no free port in {PORTS.start}-{PORTS.stop - 1}")


class Handler(http.server.SimpleHTTPRequestHandler):
    """The build, plus the two pages the drive needs, quietly."""

    def log_message(self, *_args):
        pass

    def do_GET(self):
        page = PAGES.get(self.path)
        if page is None:
            super().do_GET()
            return

        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The whole point of the second page: a header the browser obeys and the app
        # cannot talk round.
        if self.path == REFUSED:
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)


def serve(port: int) -> http.server.ThreadingHTTPServer:
    def build(*args):
        return Handler(*args, directory=str(DIST))

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), build)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def shoot(page, name: str, scheme: str, selector: str | None = None) -> str:
    target = OUT / f"{name}-{scheme}.png"
    if selector:
        page.locator(selector).screenshot(path=str(target))
    else:
        page.screenshot(path=str(target))
    return target.name


def open_row(page, name: str) -> None:
    page.click(f".nib-row.row:has(.nib-row-label:text-is('{name}'))")
    page.wait_for_timeout(1200)


def address(page) -> str:
    return page.input_value(".webbar input.address")


def drive(page, url: str, scheme: str, report: dict, failures: list) -> None:
    shots: list[str] = []

    # 1. The file list. A website is a row like any other, with a globe in front of
    #    it where a note has a page.
    marks = page.evaluate(MARKS)
    report[f"{scheme}: the marks in the list"] = marks
    web = marks.get("A page that frames", "")
    note = marks.get("Idea", "")
    if not web:
        failures.append(f"{scheme}: no row for the website")
    elif web == note:
        failures.append(f"{scheme}: the website wears the same mark as a note")
    shots.append(shoot(page, "sidebar", scheme, ".sidebar"))

    # 2. Opening it: the bar, and the page in a frame.
    open_row(page, "A page that frames")
    if not page.locator(".webbar").count():
        failures.append(f"{scheme}: no bar over the page")
        return

    page.wait_for_timeout(1500)
    framed = page.locator("iframe.framed").count() == 1
    report[f"{scheme}: the page that allows framing"] = "framed" if framed else "carded"
    if not framed:
        failures.append(f"{scheme}: a page that allows framing was not framed")

    resting = address(page)
    report[f"{scheme}: what the bar says"] = resting
    if "127.0.0.1" not in resting or "A page that frames" not in resting:
        failures.append(f"{scheme}: the bar says {resting!r} rather than the site and the title")
    shots.append(shoot(page, "tab-framed", scheme))

    # 3. Ctrl+L, which is the address itself rather than the resting face.
    page.keyboard.press("Control+l")
    page.wait_for_timeout(300)
    typed = address(page)
    report[f"{scheme}: what Ctrl+L shows"] = typed
    if not typed.startswith("http://127.0.0.1"):
        failures.append(f"{scheme}: Ctrl+L left {typed!r} in the field")
    shots.append(shoot(page, "address-focused", scheme, ".webbar"))

    # 4. Typing an address that refuses to be framed: the card stands in, with the
    #    row that opens it in the reader's own browser.
    page.fill(".webbar input.address", f"{url.rstrip('/')}{REFUSED}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    carded = page.locator(".card").count() == 1
    report[f"{scheme}: the page that refuses framing"] = "carded" if carded else "framed"
    if not carded:
        failures.append(f"{scheme}: a page that refuses framing was framed anyway")
    shots.append(shoot(page, "tab-refused", scheme))

    # 5. Back to a page that frames, and clip it. In a browser the frame's words
    #    belong to the site, so the clip is the link - which is what the glyph said.
    page.fill(".webbar input.address", f"{url.rstrip('/')}{FRAMED}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2000)

    clip = page.locator('.webbar button[aria-label="Clip the link"]')
    report[f"{scheme}: what the clip glyph says"] = clip.count() and "Clip the link"
    if not clip.count():
        failures.append(f"{scheme}: the clip glyph does not say it will keep the link")
    else:
        clip.click()
        page.wait_for_timeout(1500)

    files = dict(page.evaluate(FILES))
    clipped = {
        path: text
        for path, text in files.items()
        if path not in {NOTE, WEB_NOTE, REFUSED_NOTE} and "source:" in text
    }
    report[f"{scheme}: the clip"] = {
        "path": next(iter(clipped), None),
        "front matter": next(iter(clipped.values()), "").split("---")[1].strip()
        if clipped
        else None,
    }
    if not clipped:
        failures.append(f"{scheme}: nothing was clipped into the space")

    # 6. The dots: what a browser keeps in the same place, including what this site
    #    is allowed - which is nothing.
    page.click('.webbar button[aria-label="More"]')
    page.wait_for_timeout(400)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.menu .row, .menu button')].map((one) => one.textContent.trim()).filter(Boolean)"
    )
    report[f"{scheme}: the dots"] = rows
    shots.append(shoot(page, "dots", scheme))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    report[f"{scheme}: screenshots"] = shots


def main() -> int:
    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @nib/desktop build")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    server = serve(port)

    seed = [
        [NOTE, NOTE_TEXT],
        [WEB_NOTE, web_note(f"{url.rstrip('/')}{FRAMED}", "A page that frames")],
        [REFUSED_NOTE, web_note(f"{url.rstrip('/')}{REFUSED}", "A page that refuses")],
    ]

    report: dict[str, object] = {"served on": url}
    failures: list[str] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))

        try:
            for scheme in ["light", "dark"]:
                context = browser.new_context(
                    color_scheme=scheme, viewport={"width": 1400, "height": 900}
                )
                page = context.new_page()

                problems: list[str] = []
                page.on("pageerror", lambda error: problems.append(f"page error: {error}"))
                page.on(
                    "console",
                    lambda message: problems.append(f"console: {message.text}")
                    if message.type == "error"
                    else None,
                )

                try:
                    page.goto(url)
                    page.wait_for_timeout(2500)
                    page.evaluate(SEED, seed)
                    page.reload()
                    page.wait_for_timeout(3000)

                    drive(page, url, scheme, report, failures)

                    report[f"{scheme}: page problems"] = problems[:10]
                    failures += [f"{scheme}: {one}" for one in problems[:10]]
                finally:
                    context.close()
        finally:
            browser.close()
            server.shutdown()
            server.server_close()

    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    if failures:
        print("\nFAILED:")
        for one in failures:
            print(f"  {one}")
        return 1

    print(f"\nall good; the pictures are in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
