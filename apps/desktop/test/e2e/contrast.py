"""More contrast, measured: the switch beside the theme, what it does to the
palette on both sides of it, and that a system asking for it is answered without
anybody pressing anything.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be a development one or `window.nib` and `window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/contrast.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/contrast/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "contrast"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18962
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# What contrast is for

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com)
and a bit of **weight**.

> A quote, which is drawn in the muted colour.

```js
const answer = 41 + 1 // a comment
function shout(word) { return `${word}!` }
```

| Kind | Size |
| --- | ---: |
| Image | 288 |
"""

SEED = """
async ([note]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

# Every colour that has to be read, against the page it is read on. Measured
# through a probe element so a token written as a hex, an rgb() or a color-mix()
# all come back as the colour the eye gets.
RATIOS = """
(names) => {
  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.opacity = '0'
  document.body.append(probe)

  const colourOf = (token) => {
    probe.style.color = 'red'
    probe.style.color = `var(${token})`
    const said = getComputedStyle(probe).color
    const parts = said.match(/[\\d.]+/g) ?? []
    return parts.slice(0, 3).map(Number)
  }

  const light = ([r, g, b]) => {
    const channel = (one) => {
      const value = one / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const paper = light(colourOf('--bg'))
  const out = {}
  for (const name of names) {
    const ink = light(colourOf(name))
    const [high, low] = ink > paper ? [ink, paper] : [paper, ink]
    out[name] = Math.round(((high + 0.05) / (low + 0.05)) * 10) / 10
  }

  probe.remove()
  return out
}
"""

# What a fence is coloured in, which is the one thing a theme file cannot reach.
CODE = """
() => {
  const found = {}
  for (const span of document.querySelectorAll('.cm-line.nib-code span')) {
    const name = [...span.classList].find((one) => one.startsWith('ͼ')) ?? span.className
    if (name && !found[name]) found[name] = getComputedStyle(span).color
  }
  return found
}
"""

WANTED = [
    "--text",
    "--text-strong",
    "--muted",
    "--muted-strong",
    "--accent",
    "--line",
    "--line-strong",
    "--danger",
    "--success",
]

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error

    threading.Thread(target=server.serve_forever, daemon=True).start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)

    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser, label: str, forced: bool = False) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="dark",
        forced_colors="none",
        contrast="more" if forced else "no-preference",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE])}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('What contrast'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page


def ratios(page: Page) -> dict:
    return page.evaluate(RATIOS, WANTED)


def contrast(page: Page, on: bool) -> None:
    page.evaluate("(on) => window.nibApp.theme.setContrast(on)", on)
    page.wait_for_timeout(400)


def scheme(page: Page, which: str) -> None:
    page.evaluate("(which) => window.nibApp.theme.setScheme(which)", which)
    page.wait_for_timeout(400)


def check(page: Page, label: str, floors: dict) -> dict:
    """Every colour against the page it is read on, with the floors it has to
    clear once more contrast is asked for."""
    said = ratios(page)
    say(f"[{label}] {json.dumps(said)}")

    for token, floor in floors.items():
        if said.get(token, 0) < floor:
            wrong(f"[{label}] {token} is {said.get(token)}:1 against the page, under {floor}:1")

    return said


def drive_scheme(browser: Browser, which: str, at: int) -> None:
    page = fresh(browser, which)
    scheme(page, which)

    plain = check(page, f"{which}, as it is", {})
    shot(page, f"{at}-{which}-plain")
    code_plain = page.evaluate(CODE)

    contrast(page, True)
    if page.evaluate("() => document.documentElement.dataset.contrast") != "more":
        wrong(f"[{which}] the page does not say it is drawn with more contrast")

    more = check(
        page,
        f"{which}, with more",
        {
            "--text": 15,
            "--text-strong": 15,
            "--muted": 7,
            "--muted-strong": 9,
            "--accent": 5.5,
            "--line": 3,
            "--line-strong": 4.5,
            "--danger": 4.5,
            "--success": 4.5,
        },
    )
    shot(page, f"{at + 1}-{which}-more")

    for token, was in plain.items():
        if more.get(token, 0) < was:
            wrong(f"[{which}] {token} lost contrast: {was}:1 became {more.get(token)}:1")

    code_more = page.evaluate(CODE)
    say(f"[{which}] the fence: {json.dumps(code_plain)} became {json.dumps(code_more)}")
    if code_plain == code_more:
        wrong("the syntax in a fence is the same colour with more contrast asked for")

    # And off again, which is the reader saying so and has to be remembered.
    contrast(page, False)
    if page.evaluate("() => document.documentElement.dataset.contrast"):
        wrong(f"[{which}] the page still says more contrast after it was turned off")
    if page.evaluate("() => localStorage.getItem('nib:contrast')") != "off":
        wrong(f"[{which}] turning it off was not written down")

    page.context.close()


def drive_settings(browser: Browser) -> None:
    page = fresh(browser, "settings")
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    page.wait_for_timeout(600)
    shot(page, "20-the-switch")

    rows = page.evaluate(
        "() => [...document.querySelectorAll('.setting')]"
        ".map((row) => row.textContent.trim().slice(0, 40))"
    )
    say(f"[settings] the appearance pane: {json.dumps(rows[:8], ensure_ascii=False)}")
    if not any("contrast" in row.lower() for row in rows):
        wrong("the switch is not on the appearance pane")

    switch = page.locator("[role='switch']", has_text="More contrast").first
    switch.click()
    page.wait_for_timeout(500)
    shot(page, "21-switched-on")
    if page.evaluate("() => document.documentElement.dataset.contrast") != "more":
        wrong("pressing the switch did not turn the contrast up")
    if switch.get_attribute("aria-checked") != "true":
        wrong("the switch does not say it is on")

    page.context.close()


def drive_asked_for(browser: Browser) -> None:
    """A system that asks for more contrast is answered without anybody pressing
    anything - and the switch is still theirs to turn off."""
    page = fresh(browser, "system", forced=True)

    if page.evaluate("() => document.documentElement.dataset.contrast") != "more":
        wrong("a system asking for more contrast was not answered")
    shot(page, "30-asked-by-the-system")

    contrast(page, False)
    if page.evaluate("() => document.documentElement.dataset.contrast"):
        wrong("the switch cannot turn off what the system asked for")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- dark ---")
                drive_scheme(browser, "dark", 1)
                say("--- light ---")
                drive_scheme(browser, "light", 10)
                say("--- the switch ---")
                drive_settings(browser)
                say("--- asked for by the system ---")
                drive_asked_for(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe app can be asked for more contrast, and answers on both sides", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
