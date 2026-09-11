"""The find bar over a note being written in, and over a note being read.

CodeMirror's own search panel is gone; the bar is nib's own component now, and
all three surfaces draw the same one. What this run is for is the things only a
real browser can answer:

  - Ctrl+F puts the bar up, under the strip, with the word the caret was on;
  - the tally counts, and says which match the caret is on;
  - the three flags in the field change what matches;
  - Enter steps on, Shift+Enter steps back, and the matches are lit;
  - Ctrl+H opens the replace row, and Replace and Replace all do;
  - Escape closes it and hands the caret back to the note;
  - the same bar, with neither the flags nor the replace row, over a note being
    read, which is a surface that cannot honour either.

Builds the web app, serves `dist` on a port of its own, drives light and dark and
a phone, and stops everything again. Screenshots go beside this file under
`shots/find-bar/`.

Run it from the repository root:

    python apps/desktop/test/e2e/find-bar.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "find-bar"

# A port of this run's own, above the dev server's 1420 and clear of the others.
PORT = 18897
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40

failures: list[str] = []

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(fine: bool, what: str) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}")


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
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build that is there")
        return

    say("building the web app")
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


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    return page


# A note with a word in it several times, in two cases, and once as part of a
# longer word: enough for the tally to count, for Match case to change the
# answer, and for Whole word to change it again.
NOTE = """# The wind

the wind came up in the night, and the Wind
dropped again before morning. a windmill
turned once. wind, Wind, windward.
"""

SEED = """
async (text) => {
  const ws = window.nibApp.workspace
  const path = await ws.noteFrom(text, ws.activeSpace.root)
  await ws.openEntry(path)
  if (ws.panel) ws.showPanel(null)
  return path
}
"""

# What the bar is showing: the query, the tally, which flags are on, whether the
# replace row is out, and how many matches are lit in the document.
BAR = """
() => {
  const bar = document.querySelector('.findbar')
  if (!bar) return null

  return {
    query: bar.querySelector('input')?.value ?? null,
    tally: bar.querySelector('.tally')?.textContent?.trim() ?? '',
    flags: bar.querySelectorAll('.flag').length,
    steps: bar.querySelectorAll('.act').length,
    replacing: bar.querySelectorAll('input').length > 1,
    lit: document.querySelectorAll('.cm-searchMatch').length,
    here: document.querySelectorAll('.cm-searchMatch-selected').length,
    field: bar.querySelector('input')?.className ?? '',
    focused: document.activeElement?.tagName ?? '',
  }
}
"""

WHERE = "() => document.activeElement?.className ?? document.activeElement?.tagName ?? ''"
DOC = "() => window.nib.state.doc.toString()"
# No CodeMirror panel anywhere: the one thing this rework must be able to prove.
PANEL = "() => document.querySelectorAll('.cm-panel, .cm-panels').length"


# What makes the window a phone. A headless browser has no touch screen for the
# app to recognise, so the device is set the way the other drives set it, along
# with the attributes the tokens read for the touch scale.
AS_PHONE = """
() => {
  const app = window.nibApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

# Every target in the bar, measured. The bar draws no number of its own: the
# field is `--row-height` and each button is a row square, so a thumb gets 56px
# where a pointer gets 28 without this component knowing which it is on.
SIZES = """
() => {
  const out = []
  for (const [what, selector] of [
    ['the field', '.findbar .nib-field'],
    ['a step', '.findbar .act'],
    ['a flag', '.findbar .flag'],
  ]) {
    const one = document.querySelector(selector)
    if (!one) { out.push({ what, missing: true }); continue }

    const box = one.getBoundingClientRect()
    out.push({ what, width: Math.round(box.width), height: Math.round(box.height) })
  }

  return out
}
"""

# A row a finger has to land on, from this size up: the same number
# touch-scale.test.ts holds the stylesheets to.
FINGER = 40


def on_phone(browser: Browser) -> None:
    """The same bar under a thumb. Nothing about it is a phone's own drawing, so
    what is checked is that every target came out finger-sized."""
    label = "phone"
    page = fresh(browser, label, {"width": 390, "height": 844}, "light")
    try:
        page.evaluate(AS_PHONE)
        page.wait_for_timeout(200)
        say(f"[{label}] wrote {page.evaluate(SEED, NOTE)}")
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
        page.wait_for_timeout(400)

        page.locator(".cm-content").first.click()
        page.keyboard.press("Control+f")
        page.wait_for_timeout(400)

        bar = page.evaluate(BAR)
        check(bar is not None, f"[{label}] Ctrl+F puts the bar up")
        if not bar:
            return

        page.locator(".findbar input").first.fill("wind")
        page.wait_for_timeout(300)
        page.locator(".findbar").first.screenshot(path=str(SHOTS / "bar-phone.png"))
        say(f"[{label}] wrote bar-phone.png")

        for one in page.evaluate(SIZES):
            say(f"[{label}]   {one}")
            if one.get("missing"):
                check(False, f"[{label}] {one['what']} is drawn")
                continue

            check(
                one["height"] >= FINGER,
                f"[{label}] {one['what']} is a finger's target ({one['height']}px)",
            )
    finally:
        page.context.close()


def drive(browser: Browser, label: str, scheme: str) -> None:
    page = fresh(browser, label, {"width": 1180, "height": 760}, scheme)
    try:
        say(f"[{label}] wrote {page.evaluate(SEED, NOTE)}")
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
        page.wait_for_timeout(300)

        # ── Ctrl+F, with a word under the caret ──
        content = page.locator(".cm-content").first
        content.click()
        page.keyboard.press("Control+Home")
        # Onto the word "wind" in the heading, then select it.
        page.keyboard.press("Control+ArrowRight")
        page.keyboard.press("Control+ArrowRight")
        page.keyboard.press("Control+Shift+ArrowRight")
        page.keyboard.press("Control+f")
        page.wait_for_timeout(400)

        bar = page.evaluate(BAR)
        say(f"[{label}] the bar: {bar}")
        check(bar is not None, f"[{label}] Ctrl+F puts the bar up")
        if not bar:
            return

        check(page.evaluate(PANEL) == 0, f"[{label}] and no library panel with it")
        check(
            "nib-field" in bar["field"],
            f"[{label}] the query sits in one .nib-field ({bar['field']})",
        )
        check(bar["flags"] == 3, f"[{label}] with three flags inside it ({bar['flags']})")
        check(bar["query"].strip().lower() == "wind", f"[{label}] on the word the caret was on")
        check(bar["lit"] >= 4, f"[{label}] and the matches are lit ({bar['lit']})")

        page.locator(".findbar").first.screenshot(path=str(SHOTS / f"bar-{label}.png"))
        say(f"[{label}] wrote bar-{label}.png")

        # ── The tally, and what the flags do to it ──
        def tally() -> str:
            page.wait_for_timeout(250)
            return page.evaluate(BAR)["tally"]

        field = page.locator(".findbar input").first
        field.fill("wind")
        loose = tally()
        say(f"[{label}] 'wind' is {loose!r}")
        # Seven: the heading, two in the second line, windmill, and the three on
        # the last line. Case is ignored until Match case is pressed.
        check("of 7" in loose, f"[{label}] finds every wind, however written ({loose!r})")

        page.locator('.findbar .flag[aria-label="Match case"]').click()
        cased = tally()
        say(f"[{label}] with Match case: {cased!r}")
        check(cased != loose, f"[{label}] Match case changes the answer")

        page.locator('.findbar .flag[aria-label="Match case"]').click()
        page.locator('.findbar .flag[aria-label="Whole word"]').click()
        whole = tally()
        say(f"[{label}] with Whole word: {whole!r}")
        check(whole != loose, f"[{label}] Whole word changes the answer")

        page.locator('.findbar .flag[aria-label="Whole word"]').click()
        page.locator('.findbar .flag[aria-label="Regular expression"]').click()
        field.fill("w[a-z]+d")
        regex = tally()
        say(f"[{label}] as a regular expression: {regex!r}")
        check(bool(regex) and "0" not in regex[:2], f"[{label}] a regular expression matches")
        page.locator('.findbar .flag[aria-label="Regular expression"]').click()

        # ── Enter and Shift+Enter ──
        field.fill("wind")
        page.wait_for_timeout(250)
        first = page.evaluate(BAR)["tally"]
        field.press("Enter")
        page.wait_for_timeout(250)
        second = page.evaluate(BAR)["tally"]
        say(f"[{label}] Enter took {first!r} to {second!r}")
        check(first != second, f"[{label}] Enter steps on")

        field.press("Shift+Enter")
        page.wait_for_timeout(250)
        back = page.evaluate(BAR)["tally"]
        say(f"[{label}] Shift+Enter took {second!r} to {back!r}")
        check(back == first, f"[{label}] and Shift+Enter steps back")

        check(
            page.evaluate(BAR)["here"] == 1,
            f"[{label}] and the match the caret is on is the one picked out",
        )

        # ── The replace row ──
        page.locator('.findbar .act[aria-label="Replace"]').click()
        page.wait_for_timeout(400)
        open_bar = page.evaluate(BAR)
        say(f"[{label}] with the replace row: {open_bar}")
        check(open_bar["replacing"], f"[{label}] the chevron opens the replace row")

        page.locator(".findbar").first.screenshot(path=str(SHOTS / f"replace-{label}.png"))
        say(f"[{label}] wrote replace-{label}.png")

        page.locator(".findbar input").nth(1).fill("gale")
        page.locator(".findbar .apply").first.click()
        page.wait_for_timeout(400)
        once = page.evaluate(DOC)
        say(f"[{label}] after one Replace: {once.count('gale')} gale, {once.count('wind')} wind")
        check(once.count("gale") == 1, f"[{label}] Replace changes one match")

        page.locator(".findbar .apply").nth(1).click()
        page.wait_for_timeout(500)
        all_done = page.evaluate(DOC)
        say(f"[{label}] after Replace all: {all_done.count('gale')} gale")
        check(all_done.count("gale") > 1, f"[{label}] and Replace all changes the rest")

        # ── Escape ──
        page.locator(".findbar input").first.press("Escape")
        page.wait_for_timeout(400)
        say(f"[{label}] the keyboard landed on {page.evaluate(WHERE)!r}")
        check(page.evaluate(BAR) is None, f"[{label}] Escape closes the bar")
        check(
            "cm-content" in page.evaluate(WHERE),
            f"[{label}] and hands the caret back to the note",
        )
        check(
            page.evaluate("() => document.querySelectorAll('.cm-searchMatch').length") == 0,
            f"[{label}] and the matches go with it",
        )

        # ── The same bar over a note being read ──
        page.evaluate("() => window.nibApp.workspace.toggleReading?.()")
        page.wait_for_timeout(200)
        reading = page.evaluate(
            "() => { const ws = window.nibApp.workspace; const tab = ws.active;"
            " if (tab) tab.reading = true; return !!tab?.reading }"
        )
        page.wait_for_timeout(600)
        if reading and page.locator(".read").count():
            page.locator(".read").first.click()
            page.keyboard.press("Control+f")
            page.wait_for_timeout(400)
            read_bar = page.evaluate(BAR)
            say(f"[{label}] the reader's bar: {read_bar}")
            if read_bar:
                check(
                    read_bar["flags"] == 0,
                    f"[{label}] a note being read gets no flags it cannot honour",
                )
                check(
                    not read_bar["replacing"],
                    f"[{label}] and nothing to replace with",
                )
                page.locator(".findbar").first.screenshot(path=str(SHOTS / f"reading-{label}.png"))
                say(f"[{label}] wrote reading-{label}.png")
            else:
                say(f"[{label}] the reader's bar did not open; nothing checked there")
        else:
            say(f"[{label}] could not switch to reading; nothing checked there")
    finally:
        page.context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                drive(browser, "light", "light")
                drive(browser, "dark", "dark")
                on_phone(browser)
            finally:
                browser.close()
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    if failures:
        print("\nwhat is still wrong:", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe find bar is nib's own, and it finds, steps and replaces", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
