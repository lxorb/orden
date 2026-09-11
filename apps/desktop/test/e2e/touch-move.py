"""Moving things with a finger, where a drag is not available.

A held finger opens a row's menu before any drag could begin, and a browser fires
no drag events from a touch at all, so on a phone or a tablet the only outcome of
pressing a note, a folder or a space was the menu. This drives the answer to that
with real touch events on the real elements: the menu now carries a Move, a note
goes where the sheet says and can be undone, and a space in the rail lifts and
steps.

Nothing here needs an account or the Worker: the browser build seeds its own notes
and everything under test is local. So it serves the built page and drives it.

Run it from the repository root:

    python apps/desktop/test/e2e/touch-move.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/`.
"""

from __future__ import annotations

import functools
import json
import http.server
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots"

# A port of this test's own, and not the dev server's 1420.
PORT = 18877
ORIGIN = f"http://127.0.0.1:{PORT}"

# A phone. The size alone is not one: the device class is decided from what the
# machine says about itself and from the pointer, and the width only tells a phone
# from a tablet. So the context below carries a phone's user agent as well as its
# touch screen; see `deviceFor` in apps/desktop/src/lib/viewport.svelte.ts.
PHONE = {"width": 390, "height": 844}
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

PATIENCE = 20


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (APP / "dist" / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    # A production build hides the app's stores, and the test drives them.
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Pages:
    """The built page, served. No Worker: nothing here signs in."""

    def __init__(self) -> None:
        self.server: http.server.ThreadingHTTPServer | None = None

    def start(self) -> None:
        say(f"serving the build on {ORIGIN}")
        handler = functools.partial(
            http.server.SimpleHTTPRequestHandler, directory=str(APP / "dist")
        )
        # Its own log would drown the run.
        handler.log_message = lambda *args, **kwargs: None  # type: ignore[assignment]
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if not self.server:
            return

        say("stopping the server")
        self.server.shutdown()
        self.server.server_close()
        self.server = None


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, label: str, theme: str = "light") -> Page:
    """A phone-sized browser that has never held anything."""
    context = browser.new_context(
        viewport=PHONE,
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme=theme,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => document.documentElement.hasAttribute('data-touch')", "a touch layout")
    return page


# Real touch events on the real element, which is what the long-press action
# listens on. Playwright's touchscreen can only tap, and a press is a tap held.
PRESS = """
(selector) => {
  const node = document.querySelector(selector)
  if (!node) return false

  const box = node.getBoundingClientRect()
  const at = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const touch = new Touch({ identifier: 1, target: node, ...at })
  const send = (kind) =>
    node.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )

  send('touchstart')
  window.__nibRelease = () => send('touchend')
  return true
}
"""

# A finger that sets off across the row before the press fires, which must not
# open the menu.
SWIPE = """
(selector) => {
  const node = document.querySelector(selector)
  if (!node) return false

  const box = node.getBoundingClientRect()
  const start = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const at = (x, y) => new Touch({ identifier: 1, target: node, clientX: x, clientY: y })
  const send = (kind, touch) =>
    node.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )

  send('touchstart', at(start.clientX, start.clientY))
  send('touchmove', at(start.clientX + 40, start.clientY + 4))
  return true
}
"""


def hold(page: Page, selector: str, label: str) -> None:
    """Presses and holds until the menu opens, then lets go."""
    if not page.evaluate(PRESS, selector):
        raise SystemExit(f"[{label}] nothing matched {selector}")

    page.wait_for_selector('[role="menu"]:visible', timeout=5000)
    page.evaluate("() => window.__nibRelease?.()")


def seed(page: Page) -> None:
    """Two spaces, a row that holds something in the first, and a note beside it.

    `Work` is a folder with no note of its own, which is what a folder out of
    somebody's vault is: nib never makes one, so it is seeded the way one arrives -
    by something being in it. A canvas rather than a note, so "a note landed in
    Work" is false until the move under test makes it true.
    """
    page.evaluate(
        """
        async () => {
          const app = window.nibApp
          await app.workspace.createCanvas('/Notes/Work', 'Board.canvas')
          await app.workspace.addSpace('Uni')
          const notes = app.workspace.spaces.find((one) => one.name === 'Notes')
          if (notes) await app.workspace.showSpace(notes.id)
        }
        """
    )
    wait_for(page, "() => window.nibApp.workspace.activeSpace?.name === 'Notes'", "Notes to open")
    wait_for(
        page,
        "() => window.nibApp.workspace.spaces.some((one) => one.name === 'Uni')",
        "the second space",
    )


def tree_paths(page: Page) -> list[str]:
    return page.evaluate(
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.nibApp.workspace.tree)"
        "}"
    )


def space_names(page: Page) -> list[str]:
    return page.evaluate("() => window.nibApp.workspace.spaces.map((one) => one.name)")


def open_the_list(page: Page) -> None:
    page.evaluate("() => (window.nibApp.workspace.panel = 'tree')")
    page.wait_for_selector(".row[data-path$='.md']", timeout=5000)


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    pages = Pages()
    failures: list[str] = []

    def wrong(what: str) -> None:
        say(f"FAILED: {what}")
        failures.append(what)

    try:
        build()
        pages.start()

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                page = fresh(browser, "phone")
                seed(page)
                open_the_list(page)
                say(f"the list holds {tree_paths(page)!r}")

                # ── A note's menu offers the move ──────────────────────────
                hold(page, ".row[data-path$='.md']", "phone")
                offered = page.locator('[role="menuitem"]').all_inner_texts()
                if "Move" not in [one.strip() for one in offered]:
                    wrong(f"a note's menu on a touch screen offers {offered!r}, with no Move")
                else:
                    say("a note's menu offers Move")

                page.wait_for_timeout(200)
                page.screenshot(path=str(SHOTS / "touch-move-menu-light.png"))

                # ── Which opens the picker, in the app's own sheet ─────────
                page.get_by_role("menuitem", name="Move", exact=True).click()
                sheet = page.locator("div.sheet:not([role])")
                sheet.wait_for(state="visible", timeout=5000)
                page.wait_for_timeout(250)
                page.screenshot(path=str(SHOTS / "touch-move-picker-light.png"))

                rows = [one.strip() for one in page.locator(".found-row").all_inner_texts()]
                say(f"the picker offers {rows!r}")
                for wanted in ("Work", "Uni"):
                    if wanted not in rows:
                        wrong(f"the picker does not offer {wanted}: {rows!r}")

                # ── Tapping a target moves the note, and undo takes it back ─
                before = tree_paths(page)
                moved = next(
                    (one for one in before if one.endswith(".md") and "/Work/" not in one), None
                )
                if not moved:
                    raise SystemExit(f"no note to move in {before!r}")

                page.locator(".found-row", has_text="Work").first.click()
                wait_for(
                    page,
                    "() => {"
                    "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
                    "  return walk(window.nibApp.workspace.tree).some((one) => one.includes('/Work/') && one.endsWith('.md'))"
                    "}",
                    "the note to land in Work",
                )
                say(f"{moved} moved into Work")

                # The same undo a drag leaves behind.
                label = page.evaluate("() => window.nibApp.workspace.undoLabel ?? null")
                say(f"undo offers {label!r}")
                page.evaluate("() => window.nibApp.workspace.undoFileAction()")
                wait_for(
                    page,
                    "() => {"
                    "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
                    "  return !walk(window.nibApp.workspace.tree).some((one) => one.includes('/Work/') && one.endsWith('.md'))"
                    "}",
                    "the move to be undone",
                )
                say("and undo put it back")

                # ── A finger that moves first never opens the menu ──────────
                page.evaluate(SWIPE, ".row[data-path$='.md']")
                page.wait_for_timeout(900)
                if page.locator('[role="menu"]:visible').count():
                    wrong("a finger that set off across the row still opened the menu")
                else:
                    say("a finger that moves first opens no menu, so a drag can have it")

                # ── A space in the rail lifts and steps ────────────────────
                was = space_names(page)
                hold(page, "nav button.space", "phone")
                offered = [one.strip() for one in page.locator('[role="menuitem"]').all_inner_texts()]
                if "Move" not in offered:
                    wrong(f"a space's menu offers {offered!r}, with no Move")
                page.get_by_role("menuitem", name="Move", exact=True).click()

                page.wait_for_selector("nav button.space.lifted", timeout=5000)
                page.wait_for_selector("nav button.nudge", timeout=5000)
                page.wait_for_timeout(250)
                page.screenshot(path=str(SHOTS / "touch-move-rail-light.png"))
                say("the square lifted and grew its steps")

                page.get_by_role("button", name="Move down").click()
                wait_for(
                    page,
                    "() => window.nibApp.workspace.spaces.map((one) => one.name).join() !== "
                    + json.dumps(",".join(was)),
                    "the rail to reorder",
                )
                now = space_names(page)
                if now != list(reversed(was)):
                    wrong(f"one step down turned {was!r} into {now!r}")
                else:
                    say(f"the rail went from {was!r} to {now!r}")

                # Escape puts it down, like everything else the app opens.
                page.keyboard.press("Escape")
                page.wait_for_timeout(250)
                if page.locator("nav button.space.lifted").count():
                    wrong("Escape did not put the square down")
                else:
                    say("Escape put it down")
            finally:
                browser.close()

            # ── The same two surfaces in the dark ─────────────────────────
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                page = fresh(browser, "dark", theme="dark")
                seed(page)
                open_the_list(page)

                hold(page, ".row[data-path$='.md']", "dark")
                page.wait_for_timeout(200)
                page.screenshot(path=str(SHOTS / "touch-move-menu-dark.png"))

                page.get_by_role("menuitem", name="Move", exact=True).click()
                page.locator("div.sheet:not([role])").wait_for(state="visible", timeout=5000)
                page.wait_for_timeout(250)
                page.screenshot(path=str(SHOTS / "touch-move-picker-dark.png"))

                page.keyboard.press("Escape")
                hold(page, "nav button.space", "dark")
                page.get_by_role("menuitem", name="Move", exact=True).click()
                page.wait_for_selector("nav button.nudge", timeout=5000)
                page.wait_for_timeout(250)
                page.screenshot(path=str(SHOTS / "touch-move-rail-dark.png"))
                say("photographed all three in the dark")
            finally:
                browser.close()
    finally:
        pages.stop()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\na finger can move a note and reorder the rail", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
