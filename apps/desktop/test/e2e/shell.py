"""The shell, seen: the rail, the list panel, the tabs and the layers over them.

Serves the built web app and photographs every surface the design pass touches,
on a desktop in both schemes, on a tablet and on a phone - each with the user
agent and the pointer that device really has, because the device class is decided
from those and not from the width; see deviceFor in viewport.svelte.ts.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode development

Then, from the repository root:

    python apps/desktop/test/e2e/shell.py before
    python apps/desktop/test/e2e/shell.py after

Screenshots go beside this file under `shots/shell-<name>/`, which is ignored.
This is a scratch drive rather than a test: it photographs the app and says what
it saw.
"""

from __future__ import annotations

import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port.
PORT = 18953
ORIGIN = f"http://127.0.0.1:{PORT}"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# name, width, height, agent, finger, scheme
DEVICES = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("tablet", 834, 1194, TABLET_AGENT, True, "light"),
    ("tablet-wide", 1194, 834, TABLET_AGENT, True, "dark"),
    ("phone", 390, 844, PHONE_AGENT, True, "light"),
    # A phone on its side, which is the one handheld shape where the drawer
    # slides over the note rather than becoming the whole screen: the width is
    # past `data-narrow`, so the bar under it stays where it is. What a drawer
    # leaves behind as it goes is only ever visible here.
    ("phone-wide", 844, 390, PHONE_AGENT, True, "dark"),
]

# A space with enough in it to judge a list by: a folder with notes inside, notes
# beside it, a bookmark, and words that repeat so a search finds several lines.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name)

  await ws.createFolder()
  ws.stopRenaming()
  await ws.rename(join(root, 'New folder'), 'Field notes')
  const folder = join(root, 'Field notes')

  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\n## What went in this week\\n\\n- Pressure on the pen\\n- Slides out of a note\\n\\n### Wind\\n\\nThe wind was steady all week.', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor that formats what you write as you write it.', undefined)
  await ws.noteFrom('# Reading list\\n\\nA paper about ink, and one about wind.', undefined)
  await ws.noteFrom('# Standup\\n\\nMonday: wind tunnel. Tuesday: ink.', undefined)
  await ws.noteFrom('# Ledger\\n\\nWhat the wind cost.', folder)
  await ws.noteFrom('# Sketches\\n\\nInk on paper.', folder)

  ws.device.expand(folder)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) {
    ws.bookmarks.toggle({ kind: 'note', path: first.name })
    await ws.openEntry(first.path, { activate: true })
  }
  const second = ws.notes.find((one) => one.name.startsWith('Read me'))
  if (second) await ws.openEntry(second.path, { activate: true })
  const third = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (third) await ws.openEntry(third.path, { activate: true })

  return ws.files.map((one) => one.name)
}
"""


def say(words: str) -> None:
    print(f"  {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, without a line per asset."""

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


def dismiss(page) -> None:
    """Escape, and then whatever scrim did not take it."""
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    for _ in range(3):
        scrim = page.locator(".scrim:visible").last
        if not scrim.count():
            return
        try:
            scrim.click(force=True, position={"x": 4, "y": 4}, timeout=2000)
        except Exception:
            return
        page.wait_for_timeout(300)


def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    def strip(tag: str, selector: str, pad: int = 8) -> None:
        """One row of the app, close up: the bars are 38 to 56 pixels tall and a
        whole phone screen is not where a glyph in one of them can be judged."""
        try:
            box = page.locator(selector).first.bounding_box()
        except Exception as why:
            say(f"[{name}] no {selector}: {why}")
            return
        if not box:
            say(f"[{name}] {selector} has no box")
            return

        page.screenshot(
            path=str(shots / f"{name}-{tag}.png"),
            clip={
                "x": max(0, box["x"] - pad),
                "y": max(0, box["y"] - pad),
                "width": min(width, box["width"] + pad * 2),
                "height": box["height"] + pad * 2,
            },
        )
        say(f"shot {name}-{tag}.png")

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    # A scratch drive should say what it could not reach rather than sit on it.
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    # Spare history entries, so a back gesture inside the app never reaches the
    # page before it and reloads everything.
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    say(f"[{name}] the space holds {page.evaluate(SEED)}")
    page.wait_for_timeout(600)

    # The file list, which is the surface this is all about.
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)
    shot("files")

    # The quiet row at the bottom of the panel: who is here, the theme and the
    # settings. The same three on every device, which is the point of it.
    strip("foot", "aside .foot")

    # The two rows a handheld reads the app through, close up: the bar over the
    # note with the sidebar button at the left of it, and the drawer's own head
    # with the same button in the same corner. One glyph, one animation, and
    # nothing else showing at the edge of either.
    if finger:
        strip("drawerhead", "aside .head")
        page.evaluate("() => window.nibApp.workspace.closePanel()")
        page.wait_for_timeout(500)
        strip("titlebar", ".document header")
        shot("note")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)
    else:
        # With the panel shut there is nothing else on the screen saying which
        # space these notes are in, so the bar says it.
        page.evaluate("() => window.nibApp.workspace.closePanel()")
        page.wait_for_timeout(500)
        strip("collapsed", "header")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

    # The space's own menu, which is what the name at the top of the panel is.
    switcher = page.locator("aside .name")
    if switcher.count():
        try:
            switcher.click(force=True)
            page.wait_for_timeout(400)
            shot("spaces")
        except Exception as why:
            say(f"[{name}] no switcher: {why}")
        dismiss(page)

    # A row's own menu, asked for the way a pointer asks and a thumb asks.
    rows = page.locator("aside .row")
    if rows.count():
        try:
            rows.nth(2).click(button="right", force=True)
            page.wait_for_timeout(400)
            shot("rowmenu")
        except Exception as why:
            say(f"[{name}] no row menu: {why}")
        dismiss(page)

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)
    shot("outline")

    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(400)
    box = page.locator("aside input").first
    if box.count():
        try:
            box.fill("wind")
            page.wait_for_timeout(900)
        except Exception as why:
            say(f"[{name}] nothing to type in: {why}")
    shot("search")

    page.evaluate("() => window.nibApp.workspace.showPanel('links')")
    page.wait_for_timeout(600)
    shot("links")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)

    # The layers over the note.
    page.keyboard.press("Control+KeyP" if not finger else "Control+KeyP")
    page.wait_for_timeout(500)
    if page.locator(".palette").count():
        shot("palette")
        dismiss(page)

    # The app's own menu: the bars at the left of the title bar on a desktop, the
    # three dots at the right of it on a handheld.
    trigger = (
        page.locator("header button[aria-label]").last
        if finger
        else page.locator("header button[aria-label]").first
    )
    if trigger.count():
        try:
            trigger.click(force=True)
            page.wait_for_timeout(500)
            shot("menu")
        except Exception as why:
            say(f"[{name}] no menu: {why}")
        dismiss(page)

    page.evaluate("() => window.nibApp.settings.show()")
    page.wait_for_timeout(800)
    shot("settings")

    # Appearance, because it is the pane with the segmented controls in it: the
    # raised surface has to sit under the choice in force there the same way it
    # does over the panel tabs.
    page.evaluate(
        "() => { window.nibApp.settings.section = 'appearance'; window.nibApp.settings.listing = false }"
    )
    page.wait_for_timeout(700)
    shot("settings-appearance")
    page.evaluate("() => window.nibApp.settings.hide?.() ?? (window.nibApp.settings.open = false)")
    page.wait_for_timeout(400)

    # The note itself, with its table, which is the other thing the tokens touch.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const path = await ws.noteFrom('# A table\\n\\n| Platform | Sync | Publish |\\n| --- | --- | --- |\\n| Desktop | yes | yes |\\n| Phone | yes | no |\\n| Tablet | yes | yes |\\n')
          if (path) await ws.openEntry(path, { activate: true })
        }"""
    )
    page.wait_for_timeout(900)
    shot("table")

    context.close()


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"
    out = Path(__file__).resolve().parent / "shots" / f"shell-{tag}"

    pages = Pages()
    pages.start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for one in DEVICES:
                    say(f"--- {one[0]} ---")
                    drive(browser, out, *one)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
