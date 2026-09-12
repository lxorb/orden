"""The size of the text, changed with Ctrl and the wheel.

What it proves: Ctrl and a notch over the note steps `--zoom` and says so with a
badge that goes on its own; a notch without Ctrl scrolls and changes nothing; a
notch over the panel changes nothing; the keys step and reset the same value; and
nothing here touches the browser's own zoom - the page's own scale stays 1, which
is the whole point of the app owning the gesture.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode development

Then, from the repository root:

    python apps/desktop/test/e2e/text-size.py

Screenshots go beside this file under `shots/text-size/`, which is ignored.
"""

from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = APP / "test" / "e2e" / "shots" / "text-size"

# Above 18000, and not a port any other drive here uses.
PORT = 18939
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\nThe words here are what the size is about.', undefined)
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

# The one number the whole thing is about, and the badge beside it.
SIZE = """
() => {
  const root = document.documentElement
  const badge = document.querySelector('.size')
  return {
    zoom: getComputedStyle(root).getPropertyValue('--zoom').trim(),
    kept: window.nibApp.modes.zoom,
    badge: badge ? badge.textContent.trim() : null,
    // What the app must never be doing: the page's own scale, which a webview
    // zoom would move.
    scale: Math.round(window.devicePixelRatio * 100) / 100,
  }
}
"""


def say(words: str) -> None:
    print(f"  {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # noqa: D102
        return


class Pages:
    """The built page, served."""

    def __init__(self) -> None:
        handler = functools.partial(Quiet, directory=str(APP / "dist"))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()
        say(f"serving {APP / 'dist'} on {ORIGIN}")

    def stop(self) -> None:
        self.server.shutdown()


def wheel(page, where: str, ctrl: bool, up: bool) -> None:
    """One notch, over whatever `where` names, with or without Ctrl."""
    box = page.locator(where).first.bounding_box()
    if not box:
        raise SystemExit(f"nothing at {where}")

    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    if ctrl:
        page.keyboard.down("Control")
    page.mouse.wheel(0, -120 if up else 120)
    if ctrl:
        page.keyboard.up("Control")
    page.wait_for_timeout(260)


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    say(f"the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(600)

    page.evaluate("() => window.nibApp.modes.resetZoom()")
    page.wait_for_timeout(400)
    say(f"at rest: {page.evaluate(SIZE)}")

    say("--- Ctrl and the wheel over the note ---")
    wheel(page, "#write", ctrl=True, up=True)
    say(f"one notch in:  {page.evaluate(SIZE)}")
    page.screenshot(path=str(SHOTS / "badge.png"))
    say("shot badge.png")

    wheel(page, "#write", ctrl=True, up=True)
    say(f"two notches in: {page.evaluate(SIZE)}")

    for _ in range(3):
        wheel(page, "#write", ctrl=True, up=False)
    say(f"three notches out: {page.evaluate(SIZE)}")

    # The badge says the size and then goes, which is what makes it a badge
    # rather than a thing to close.
    page.wait_for_timeout(1200)
    say(f"a moment later: {page.evaluate(SIZE)}")

    say("--- what must not change it ---")
    before = page.evaluate("() => window.nibApp.modes.zoom")
    wheel(page, "#write", ctrl=False, up=True)
    say(f"a notch without Ctrl: {before} -> {page.evaluate('() => window.nibApp.modes.zoom')}")

    # Over the panel, which a fresh profile starts without.
    page.keyboard.press("Control+Shift+L")
    page.wait_for_timeout(500)
    wheel(page, "[data-region='list']", ctrl=True, up=True)
    say(f"a notch over the file list: {page.evaluate('() => window.nibApp.modes.zoom')}")

    say("--- the keys ---")
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    for key in ["Control+Shift+Equal", "Control+Shift+Equal", "Control+Shift+Minus"]:
        page.keyboard.press(key)
        page.wait_for_timeout(220)
        say(f"{key:<22} -> {page.evaluate('() => window.nibApp.modes.zoom')}")

    page.keyboard.press("Control+Alt+Digit0")
    page.wait_for_timeout(300)
    say(f"Control+Alt+0          -> {page.evaluate(SIZE)}")

    # The three keys the brief asked about, which are the editor's: they must
    # still be the editor's.
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Control+Equal")
    page.wait_for_timeout(260)
    say(f"Control+= (Heading up) left the size at {page.evaluate('() => window.nibApp.modes.zoom')}")
    say(f"and the line now reads: {page.evaluate(LINE)!r}")

    page.screenshot(path=str(SHOTS / "after.png"))
    say("shot after.png")
    context.close()


# The line the caret is in, so a key that is the editor's can be seen to have
# been the editor's.
LINE = """
() => {
  const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
  if (!view) return ''
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.slice(0, 40)
}
"""


def main() -> int:
    if not (APP / "dist" / "index.html").exists():
        raise SystemExit("build the app first; see the top of this file")

    pages = Pages()
    pages.start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
