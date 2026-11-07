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

PORTS = range(21500, 21600)

ADDRESS = ".webbar input[role=combobox]"

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

WEB_NOTE = "/Notes/A page that frames.url"
REFUSED_NOTE = "/Notes/A page that refuses.url"
OLD_NOTE = "/Notes/A page written as a note.md"

def shortcut(url: str, title: str) -> str:

    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Orden-Added=2026-09-12T08:00:00.000Z\r\n"
    )

def web_note(url: str, title: str) -> str:

    return (
        f"---\nurl: {url}\ntitle: {title}\ndate: 2026-09-12T08:00:00.000Z\n---\n\n"
        f"# {title}\n\n<{url}>\n"
    )

SEED = """
async (files) => {
  // Whatever version the app made, rather than a number this script would have to
  // keep in step with web/store.ts: the page has already opened the database by the
  // time this runs, so the stores are there.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const now = Date.now()
  for (const [path, content] of files) {
    await new Promise((resolve, reject) => {
      // Two rows per file, because the app keeps the listing apart from the words:
      // `files` is what a note is read from and `stats` is what the file list walks.
      // See web/store.ts.
      const change = db.transaction(['files', 'stats'], 'readwrite')
      change.objectStore('files').put({ path, content, modified: now, created: now })
      change.objectStore('stats').put({ path, modified: now, created: now })
      change.oncomplete = () => resolve()
      change.onerror = () => reject(change.error)
    })
  }
  return true
}
"""

FILES = """
async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
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

MARKS = """
() =>
  Object.fromEntries(
    [...document.querySelectorAll('.orden-row.row')].map((row) => [
      row.querySelector('.orden-row-label')?.textContent ?? '',
      row.querySelector('.mark svg')?.innerHTML.slice(0, 120) ?? '',
    ]),
  )
"""

def chrome() -> pathlib.Path:
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

    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/favicon.ico":
            body = (DIST / "icon-256.png").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        page = PAGES.get(self.path)
        if page is None:
            super().do_GET()
            return

        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
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
    page.click(f".orden-row.row:has(.orden-row-label:text-is('{name}'))")
    page.wait_for_timeout(1200)

def address(page) -> str:
    return page.input_value(ADDRESS)

def drive(page, url: str, scheme: str, report: dict, failures: list) -> None:
    shots: list[str] = []

    page.keyboard.press("Control+Shift+e")
    page.wait_for_timeout(1200)

    marks = page.evaluate(MARKS)
    report[f"{scheme}: the marks in the list"] = marks
    web = marks.get("A page that frames", "")
    note = marks.get("Idea", "")
    if not web:
        failures.append(f"{scheme}: no row for the website")
    elif web == note:
        failures.append(f"{scheme}: the website wears the same mark as a note")
    shots.append(shoot(page, "sidebar", scheme, "aside"))

    open_row(page, "A page written as a note")
    page.wait_for_timeout(1500)
    held = dict(page.evaluate(FILES))
    became = OLD_NOTE.replace(".md", ".url")
    report[f"{scheme}: the note that was a website"] = (
        "a shortcut" if became in held else "still a note"
    )
    if became not in held:
        failures.append(f"{scheme}: a website written as a note did not become a shortcut")
    if OLD_NOTE in held:
        failures.append(f"{scheme}: the note that was converted is still where it was")

    open_row(page, "A page that frames")
    if not page.locator(".webbar").count():
        failures.append(f"{scheme}: no bar over the page")
        return

    page.wait_for_timeout(800)
    carded = page.locator(".card").count() == 1
    report[f"{scheme}: what a browser shows first"] = "card" if carded else "frame"
    if not carded:
        failures.append(f"{scheme}: a browser build framed a page without being asked")

    rows = page.evaluate(
        "() => [...document.querySelectorAll('.card button')].map((one) => one.textContent.trim())"
    )
    report[f"{scheme}: what the card offers"] = rows
    shots.append(shoot(page, "card", scheme))

    resting = address(page)
    report[f"{scheme}: what the bar says"] = resting
    if "127.0.0.1" not in resting or "A page that frames" not in resting:
        failures.append(f"{scheme}: the bar says {resting!r} rather than the site and the title")

    page.click(".card button:has-text('Show it here')")
    page.wait_for_timeout(2000)
    framed = page.locator("iframe.framed").count() == 1
    report[f"{scheme}: after the press"] = "framed" if framed else "still a card"
    if not framed:
        failures.append(f"{scheme}: pressing Show it here framed nothing")
    shots.append(shoot(page, "tab-framed", scheme))

    page.keyboard.press("Control+l")
    page.wait_for_timeout(300)
    typed = address(page)
    report[f"{scheme}: what Ctrl+L shows"] = typed
    if not typed.startswith("http://127.0.0.1"):
        failures.append(f"{scheme}: Ctrl+L left {typed!r} in the field")
    shots.append(shoot(page, "address-focused", scheme, ".webbar"))

    page.fill(ADDRESS, f"{url.rstrip('/')}{REFUSED}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    report[f"{scheme}: the frame after a second address"] = page.evaluate(
        "() => document.querySelector('iframe.framed')?.getAttribute('src') ?? 'no frame'"
    )
    shots.append(shoot(page, "tab-refused", scheme))

    page.fill(ADDRESS, f"{url.rstrip('/')}{FRAMED}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2000)

    if page.locator('.webbar button[aria-label^="Clip"]').count():
        failures.append(f"{scheme}: the bar still wears the scissors")
    page.click('.webbar button[aria-label="More"]')
    page.wait_for_timeout(400)
    save = page.locator("[role=menu] [role=menuitem]", has_text="Save as a note").first
    report[f"{scheme}: the dots save the page as a note"] = bool(save.count())
    if not save.count():
        failures.append(f"{scheme}: the dots have no Save as a note row")
        page.keyboard.press("Escape")
    else:
        save.click()
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

    page.click('.webbar button[aria-label="More"]')
    page.wait_for_timeout(400)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.menu .row, .menu button')].map((one) => one.textContent.trim()).filter(Boolean)"
    )
    report[f"{scheme}: the dots"] = rows

    wanted = ["New tab", "Bookmarks", "Zoom out", "Zoom in", "Full screen", "Print"]
    for row in wanted:
        if not any(row in one for one in rows):
            failures.append(f"{scheme}: the dots have no {row!r} row")

    for gone in ["Allow the camera", "Allow the clipboard"]:
        if any(gone in one for one in rows):
            failures.append(f"{scheme}: the dots still offer {gone!r}")

    if not any("100%" in one for one in rows):
        failures.append(f"{scheme}: the dots do not say how large the page is drawn")

    shots.append(shoot(page, "dots", scheme))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    site = page.locator('.webbar button[aria-label="Site information"]')
    if not site.count():
        failures.append(f"{scheme}: the bar has no mark for the site")
    else:
        site.click()
        page.wait_for_timeout(400)
        said = page.evaluate(
            "() => document.querySelector('.site[role=dialog]')?.textContent?.trim() ?? ''"
        )
        report[f"{scheme}: what the site says"] = said
        if "onnection" not in said:
            failures.append(f"{scheme}: the site bubble says {said!r}")
        shots.append(shoot(page, "site", scheme, ".web"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    report[f"{scheme}: screenshots"] = shots

def main() -> int:
    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @orden/desktop build")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    server = serve(port)

    seed = [
        [NOTE, NOTE_TEXT],
        [WEB_NOTE, shortcut(f"{url.rstrip('/')}{FRAMED}", "A page that frames")],
        [REFUSED_NOTE, shortcut(f"{url.rstrip('/')}{REFUSED}", "A page that refuses")],
        [OLD_NOTE, web_note(f"{url.rstrip('/')}{FRAMED}", "A page written as a note")],
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

                    loud = [one for one in problems if "X-Frame-Options" not in one]
                    report[f"{scheme}: page problems"] = loud[:10]
                    report[f"{scheme}: the browser refused the frame"] = any(
                        "X-Frame-Options" in one for one in problems
                    )
                    failures += [f"{scheme}: {one}" for one in loud[:10]]
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
