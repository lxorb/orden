"""Folding, seen: the chevron in the margin, the mark a fold leaves behind, the
caret revealing a heading's source without the fold letting go, folding
everything down to the outline, and a fold that is still there when the note is
opened again.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be a development one or `window.nib` and `window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/fold.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/fold/`.
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
SHOTS = HERE / "shots" / "fold"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18951
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# Chapter one

The first words of the chapter, long enough to see.

## Under one

Something nested here.

- a list item
  - a child of it
  - another child

> [!note]
> A callout with something in it.

```js
const answer = 41 + 1
```

| Kind | Size |
| --- | ---: |
| Image | 288 |

```mermaid
graph TD
  A --> B
```

# Chapter two

The second chapter, so there is more than one to fold.
"""

OTHER = "# Elsewhere\n\nA second note, to come back from.\n"

SEED = """
async ([first, second]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(first, root)
  await ws.noteFrom(second, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

STATE = """
() => ({
  hinges: document.querySelectorAll('.nib-fold-hinge').length,
  marks: document.querySelectorAll('.nib-folded').length,
  lines: document.querySelectorAll('.cm-content .cm-line').length,
  shown: [...document.querySelectorAll('.cm-content .cm-line')]
    .map((line) => line.textContent.trim())
    .filter((text) => text.length),
})
"""

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
    # `vite build` is a production build whatever mode it is given unless the
    # environment says otherwise, and a production build is the one with the
    # app's stores hidden. Both are set, so the built page keeps them.
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


def state(page: Page) -> dict:
    return page.evaluate(STATE)


def folds(page: Page) -> list[list[int]]:
    """What the app has written down about this tab, which is the fold state."""
    return page.evaluate("() => window.nibApp.workspace.active?.folds ?? []")


def fresh(browser: Browser, label: str, finger: bool) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
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
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE, OTHER])}")
    page.wait_for_timeout(400)
    return page


def open_chapter(page: Page, label: str) -> None:
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Chapter'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)


def drive_pointer(browser: Browser) -> None:
    page = fresh(browser, "desktop", finger=False)
    open_chapter(page, "desktop")

    before = state(page)
    say(f"[desktop] open: {json.dumps({k: before[k] for k in ('hinges', 'marks', 'lines')})}")
    shot(page, "01-open")
    if before["hinges"] < 4:
        wrong(f"too few chevrons for a note this shape: {before['hinges']}")
    if before["marks"]:
        wrong("something is folded in a note nobody has folded")

    # The chevron: nothing until the pointer is on the line.
    heading = page.locator(".cm-line.nib-h1").first
    hidden = page.evaluate(
        "() => getComputedStyle(document.querySelector('.nib-fold-hinge')).opacity"
    )
    say(f"[desktop] a chevron nobody is pointing at: opacity {hidden}")
    if hidden != "0":
        wrong(f"the chevron is not calm: opacity {hidden}")

    heading.hover()
    page.wait_for_timeout(400)
    shown = page.evaluate(
        "() => getComputedStyle(document.querySelector('.nib-fold-hinge')).opacity"
    )
    say(f"[desktop] under the pointer: opacity {shown}")
    if shown != "1":
        wrong(f"the chevron does not come when the pointer is on the line: opacity {shown}")
    shot(page, "02-hover")

    # Folding by pointer.
    page.locator(".nib-fold-hinge").first.click()
    page.wait_for_timeout(600)
    after = state(page)
    say(f"[desktop] folded by pointer: {json.dumps({k: after[k] for k in ('marks', 'lines')})}")
    shot(page, "03-folded-by-pointer")
    if after["marks"] != 1:
        wrong(f"a fold left no mark behind: {after['marks']} marks")
    if any("first words" in one.lower() for one in after["shown"]):
        wrong("the folded section is still on the page")

    # The fold has to survive the caret coming to the heading, which is what
    # brings the `#` back into view.
    page.evaluate(
        """() => {
          window.nib.dispatch({ selection: { anchor: 2 } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(500)
    revealed = state(page)
    say(f"[desktop] with the caret on the heading: {revealed['marks']} marks")
    shot(page, "04-folded-with-source-revealed")
    if revealed["marks"] != 1:
        wrong("the fold let go when the heading showed its source")
    if not any(one.startswith("# Chapter one") for one in revealed["shown"]):
        wrong("the heading did not show its own source with the caret on it")

    # And unfolding by pointer again.
    page.locator(".nib-fold-hinge").first.click()
    page.wait_for_timeout(500)
    if state(page)["marks"]:
        wrong("a second click did not open the fold")
    shot(page, "05-open-again")

    # The keyboard: the caret deep inside a section, and the chord folds the
    # section it is in without taking the caret out of sight.
    page.evaluate(
        """() => {
          const at = window.nib.state.doc.toString().indexOf('Something nested here')
          window.nib.dispatch({ selection: { anchor: at + 4 } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Alt+BracketLeft")
    page.wait_for_timeout(500)
    caret = page.evaluate(
        """() => {
          const head = window.nib.state.selection.main.head
          const line = window.nib.state.doc.lineAt(head)
          return { line: line.number, text: line.text, marks: document.querySelectorAll('.nib-folded').length }
        }"""
    )
    say(f"[desktop] folded by keyboard: {json.dumps(caret)}")
    shot(page, "06-folded-by-keyboard")
    if caret["marks"] != 1:
        wrong("the chord folded nothing")
    if caret["text"].strip() not in ("## Under one", "Under one"):
        wrong(f"the caret was not brought up to the line that owns the fold: {caret['text']!r}")

    # Fold everything, from the palette, which is where a command with no chord
    # has to be reachable.
    page.keyboard.press("Control+p")
    page.wait_for_timeout(400)
    page.keyboard.type("> Fold everything")
    page.wait_for_timeout(600)
    shot(page, "07-palette")
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    outline = state(page)
    say(f"[desktop] the outline: {json.dumps(outline['shown'])}")
    shot(page, "08-outline")
    if outline["marks"] != 2:
        wrong(f"fold everything did not leave one mark per chapter: {outline['marks']}")
    if any("nested" in one for one in outline["shown"]):
        wrong("something inside a folded chapter is still on the page")

    written = folds(page)
    say(f"[desktop] written down: {json.dumps(written)}")
    if len(written) < 2:
        wrong(f"the folds were not written down: {written}")
    if written != sorted(written):
        wrong(f"the folds were written down out of document order: {written}")

    # Away to another note and back: the folds are this note's, on this device.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const other = ws.notes.find((one) => one.name.startsWith('Elsewhere'))
          await ws.openEntry(other.path, { activate: true })
        }"""
    )
    page.wait_for_timeout(700)
    shot(page, "09-elsewhere")
    open_chapter(page, "desktop")
    back = state(page)
    say(f"[desktop] back on the chapter: {back['marks']} marks")
    shot(page, "10-back-still-folded")
    if back["marks"] != 2:
        wrong(f"the folds did not come back with the note: {back['marks']} marks")

    # A reload, which is the session coming off the disk.
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "[desktop] the reload")
    page.wait_for_timeout(1200)
    restarted = state(page)
    say(f"[desktop] after a reload: {restarted['marks']} marks")
    shot(page, "11-after-reload")
    if restarted["marks"] != 2:
        wrong(f"the folds did not survive a reload: {restarted['marks']} marks")

    # Unfold everything, on its chord.
    page.locator(".cm-content").click()
    page.keyboard.press("Control+Alt+BracketRight")
    page.wait_for_timeout(600)
    opened = state(page)
    say(f"[desktop] unfolded: {opened['marks']} marks, {opened['lines']} lines")
    shot(page, "12-unfolded-everything")
    if opened["marks"]:
        wrong("unfold everything left something folded")

    # And the block that a fold has to be able to cover without either of them
    # breaking: a rendered diagram and a table inside a folded chapter.
    page.evaluate(
        """() => {
          window.nib.dispatch({ selection: { anchor: 2 } })
          window.nib.focus()
        }"""
    )
    page.keyboard.press("Control+Alt+BracketLeft")
    page.wait_for_timeout(900)
    over = state(page)
    say(f"[desktop] a chapter holding a diagram and a table, folded: {over['marks']} marks")
    shot(page, "13-folded-over-a-diagram")
    if over["marks"] != 1:
        wrong("folding over a rendered diagram did not hold")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    page = fresh(browser, "phone", finger=True)
    open_chapter(page, "phone")

    box = page.evaluate(
        """() => {
          const hinge = document.querySelector('.nib-fold-hinge')
          const style = getComputedStyle(hinge)
          const rect = hinge.getBoundingClientRect()
          return { opacity: style.opacity, width: rect.width, height: rect.height }
        }"""
    )
    say(f"[phone] the chevron: {json.dumps(box)}")
    shot(page, "20-phone-open")
    if box["opacity"] != "1":
        wrong("a screen with no pointer has no chevron to tap")
    if box["height"] < 44:
        wrong(f"the tap target is smaller than a thumb: {box['height']}px tall")

    page.locator(".nib-fold-hinge").first.tap()
    page.wait_for_timeout(700)
    tapped = state(page)
    say(f"[phone] tapped: {tapped['marks']} marks")
    shot(page, "21-phone-folded")
    if tapped["marks"] != 1:
        wrong("a tap folded nothing")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a pointer ---")
                drive_pointer(browser)
                say("--- a finger ---")
                drive_finger(browser)
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

    print("\na note folds, stays folded, and comes back folded", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
