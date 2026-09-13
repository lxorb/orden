"""Contrast, measured: the theme, on both of its sides.

Contrast was a switch beside the mode, and what it did was restate the palette
over whichever theme was in force. It is a theme now, `contrast` in the store, so
what is measured here is a theme: every colour that has to be read, against the
page it is read on, in the dark and in the light, plus the syntax inside a code
fence - which no theme could reach at all until the four `--syntax-*` tokens
existed, and which is the reason the switch existed in the first place.

The drive carries the theme's stylesheet below instead of installing it. A browser
build has a themes folder only in name, the catalogue lives behind nibeditor.com,
and a drive that fetched it would be measuring whatever the network answered that
day. So THEME is the palette published as `contrast` in lxorb/nib-themes, applied
where `store.install` leaves it: the stylesheet in the head under the app's own
id, and the reader's accent taken back off the root, which is exactly what
`paintAccent` does for a theme that brings an accent of its own.

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
PORT = 18986
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# What contrast is for

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com)
and a bit of **weight**.

> A quote, which is drawn in the muted colour.

```js
class Kestrel {}
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

# The contrast theme as the registry publishes it: both schemes, the four syntax
# colours included. Kept here in full rather than fetched, so what this run
# measures is the palette and not the day's network. See the module docstring.
THEME = """
[data-theme='light'] {
  color-scheme: light;

  --bg: #ffffff;
  --surface: #f2f4f7;
  --surface-2: #e6eaf0;
  --surface-3: #d7dde6;
  --press: #c6cede;

  --line: #7c8593;
  --line-strong: #5c6472;

  --muted: #4a515c;
  --muted-strong: #2b3038;
  --text: #000000;
  --text-strong: #000000;

  --accent: #3a25c9;
  --accent-hover: #2e1cae;
  --accent-press: #24148f;
  --accent-soft: rgb(58 37 201 / 0.14);
  --accent-line: rgb(58 37 201 / 0.6);
  --selection: rgb(58 37 201 / 0.24);

  --danger: #b3121b;
  /* 7.75:1 on the white above. It was #0a7a4e, which cleared the registry's own
     4.5 bar and was still under the 5.73:1 the app's built-in light theme has for
     the same token: More contrast made one colour worse, which is what the
     comparison below catches. Published as contrast 2.0.1. */
  --success: #065f3c;

  --syntax-number: #8a4b00;
  --syntax-function: #0b4fbe;
  --syntax-type: #0a7a4e;
  --syntax-property: #6a1fb0;

  --scrollbar: #9aa3b2;
  --scrollbar-hover: #6b7480;
}

[data-theme='dark'] {
  color-scheme: dark;

  --bg: #000000;
  --surface: #101318;
  --surface-2: #191d24;
  --surface-3: #232830;
  --press: #2d333d;

  --line: #5d6673;
  --line-strong: #7e8898;

  --muted: #b9c0cb;
  --muted-strong: #d8dee6;
  --text: #ffffff;
  --text-strong: #ffffff;

  --accent: #9d90ff;
  --accent-hover: #b3a8ff;
  --accent-press: #8b7bff;
  --accent-soft: rgb(157 144 255 / 0.22);
  --accent-line: rgb(157 144 255 / 0.7);
  --selection: rgb(157 144 255 / 0.4);

  --danger: #ff6b70;
  --success: #4ee39f;

  --syntax-number: #ffc861;
  --syntax-function: #79b8ff;
  --syntax-type: #5ef2b0;
  --syntax-property: #d0a6ff;

  --scrollbar: #5b6470;
  --scrollbar-hover: #7d8794;
}
"""

# What installing this theme leaves behind, and nothing else.
APPLY = """
(css) => {
  const style = document.createElement('style')
  // The id the app puts a theme file's stylesheet in, so this sits exactly where
  // an installed theme sits in the cascade.
  style.id = 'nib-user-theme'
  style.textContent = css
  document.head.append(style)

  // A theme that states an accent keeps it: the app lifts its own accent tokens
  // off the root rather than painting over the picture the card showed. See
  // paintAccent in theme.svelte.ts.
  const own = ['--accent', '--accent-hover', '--accent-soft', '--accent-line', '--selection']
  for (const token of own) document.documentElement.style.removeProperty(token)
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

# What a fence is coloured in. The four `--syntax-*` tokens reach these and
# nothing else does, so this is the assertion the tokens exist for.
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

# The floors the theme has to clear, each against the page the colour is read on.
FLOORS = {
    "--text": 15,
    "--text-strong": 15,
    "--muted": 7,
    "--muted-strong": 9,
    "--accent": 5.5,
    "--line": 3,
    "--line-strong": 4.5,
    "--danger": 4.5,
    "--success": 4.5,
}

# The catalogue is behind nibeditor.com and this run is not about reaching it. A
# console error that is the browser reporting a request nobody could answer is not
# the app going wrong.
TOLERATED = ("nibeditor.com", "Failed to load resource", "net::ERR")

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


def listen(page: Page, label: str) -> None:
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error" and not any(one in message.text for one in TOLERATED)
        else None,
    )


def launched(browser: Browser, label: str, forced: bool = False) -> Page:
    """A window, up, with nothing in it yet. What a first launch looks like."""
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="dark",
        forced_colors="none",
        contrast="more" if forced else "no-preference",
    )
    page = context.new_page()
    listen(page, label)
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    return page


def fresh(browser: Browser, label: str, forced: bool = False) -> Page:
    """A window with a note in it, open, which is what the colours are read on."""
    page = launched(browser, label, forced)

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


def wear_the_theme(page: Page) -> None:
    """Installs the contrast theme, as far as a browser can. Called after the
    scheme is settled: the app takes its own theme stylesheet off the page every
    time it applies a theme, and this one is standing in for that stylesheet."""
    page.evaluate(APPLY, THEME)
    page.wait_for_timeout(400)


def scheme(page: Page, which: str) -> None:
    page.evaluate("(which) => window.nibApp.theme.setScheme(which)", which)
    page.wait_for_timeout(400)


def check(page: Page, label: str, floors: dict) -> dict:
    """Every colour against the page it is read on, with the floors the theme has
    to clear."""
    said = ratios(page)
    say(f"[{label}] {json.dumps(said)}")

    for token, floor in floors.items():
        if said.get(token, 0) < floor:
            wrong(f"[{label}] {token} is {said.get(token)}:1 against the page, under {floor}:1")

    return said


def unmarked(page: Page, label: str) -> None:
    """The attribute the switch used to set. Nothing sets it any more, and a theme
    that needed the app's help would be a theme the app was drawing over."""
    if page.evaluate("() => document.documentElement.getAttribute('data-contrast')"):
        wrong(f"[{label}] the page still says it is drawn with more contrast from outside")


def drive_scheme(browser: Browser, which: str, at: int) -> None:
    page = fresh(browser, which)
    scheme(page, which)

    plain = check(page, f"{which}, the built-in", {})
    shot(page, f"{at}-{which}-default")
    code_plain = page.evaluate(CODE)
    unmarked(page, which)

    wear_the_theme(page)
    more = check(page, f"{which}, the contrast theme", FLOORS)
    shot(page, f"{at + 1}-{which}-contrast")
    unmarked(page, which)

    if page.evaluate("() => document.documentElement.dataset.theme") != which:
        wrong(f"[{which}] the page is not wearing the scheme that was asked for")

    for token, was in plain.items():
        if more.get(token, 0) < was:
            wrong(f"[{which}] {token} lost contrast: {was}:1 became {more.get(token)}:1")

    code_more = page.evaluate(CODE)
    say(f"[{which}] the fence: {json.dumps(code_plain)} became {json.dumps(code_more)}")
    if code_plain == code_more:
        wrong(f"[{which}] the syntax in a fence is the same colour under the contrast theme")

    page.context.close()


def drive_settings(browser: Browser) -> None:
    """The Appearance pane asks two questions: which theme, and which side of it.
    Contrast was a third row, and is a theme in the store instead."""
    page = fresh(browser, "settings")
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    # The sheet is fetched the first time it is asked for rather than carried into the
    # first paint, so it arrives a moment after the store says it is open. Waited for,
    # because every question below is about what the pane does not say and a pane that
    # is not there yet says nothing at all. See surfaces.svelte.ts.
    page.wait_for_selector(".nib-screen.sheet", timeout=15000)
    page.wait_for_timeout(600)
    shot(page, "20-appearance")

    rows = page.evaluate(
        "() => [...document.querySelectorAll('.setting')]"
        ".map((row) => row.textContent.trim().slice(0, 40))"
    )
    say(f"[settings] the appearance pane: {json.dumps(rows[:8], ensure_ascii=False)}")

    if not rows:
        wrong("the appearance pane is empty, so what it offers cannot be read")
    if any("contrast" in row.lower() for row in rows):
        wrong("the appearance pane still offers a contrast row")
    if page.locator("[role='switch']", has_text="More contrast").count():
        wrong("the More contrast switch is still there")

    page.context.close()


def drive_offered(browser: Browser) -> None:
    """A system that asks for more contrast is shown the theme that answers it,
    once, on the card it would be installed from. Nothing is installed for the
    reader and nothing is asked twice."""
    page = launched(browser, "offered", forced=True)
    page.wait_for_timeout(800)

    if not page.evaluate("() => window.nibApp.theme.offerContrast"):
        wrong("a system asking for more contrast was not offered the theme")
    if not page.evaluate("() => window.nibApp.themeStore.open"):
        wrong("the theme store did not open on the offer")
    if page.evaluate("() => window.nibApp.themeStore.opened") != "contrast":
        wrong("the store opened on something other than the contrast theme")
    if page.evaluate("() => window.nibApp.settings.section") != "appearance":
        wrong("the offer did not arrive through Appearance, where the store lives")
    if page.evaluate("() => localStorage.getItem('nib:contrast-offered')") != "yes":
        wrong("the offer was not written down, so it would be made again")
    # Offered, not applied: the theme in force is whatever it was.
    if page.evaluate("() => window.nibApp.theme.id") != "default":
        wrong("the offer chose a theme instead of offering one")
    say(f"[offered] the card is {page.evaluate('() => !!window.nibApp.themeStore.chosen')}")
    shot(page, "30-offered")

    # The same machine, launched again. Still asking for more contrast, and this
    # time it is not asked back.
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp", "[offered] the app again")
    page.wait_for_timeout(800)

    if page.evaluate("() => window.nibApp.theme.offerContrast"):
        wrong("the offer was made a second time")
    if page.evaluate("() => window.nibApp.themeStore.open"):
        wrong("the theme store opened a second time")
    shot(page, "31-not-asked-again")

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
                say("--- the appearance pane ---")
                drive_settings(browser)
                say("--- offered to a system that asks ---")
                drive_offered(browser)
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

    print("\ncontrast is a theme, and it measures up on both of its sides", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
