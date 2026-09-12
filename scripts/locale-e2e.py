"""Every surface in five hard languages, at two widths, photographed and measured.

A catalogue can be right word by word and still break the app: German compounds
are twice the length of the English they replace, Japanese has no spaces to wrap
at, Thai has none either and stacks its vowels above and below the line, Bengali
hangs its glyphs off a headline and needs more height than Latin, and Arabic is
written the other way round.

So this opens the built app once per language per width, reaches every surface
that has words on it, photographs each one, and asks the page itself what is
clipped: an element whose `scrollWidth` is past its `clientWidth` while its
`overflow-x` is not a scroller is a label that has been cut off. English at the
same width is the baseline, so only what the *translation* broke is a failure -
a name that was already elided in English is the design working.

Arabic is here for its text alone. Right-to-left layout is a later batch; what
this drive does is write down what that batch will have to put right.

Run it with the repository's own Chromium, against a build:

    pnpm --filter @nib/desktop build
    python scripts/locale-e2e.py

`--languages de,ja` and `--widths desktop` narrow it while something is being
fixed."""

import argparse
import functools
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
OUT = ROOT / "target" / "locale-e2e"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

NOTE_PATH = "/Notes/Sprachen.md"
NOTE = """# Sprachen

A note with something of everything in it, so every surface has words to draw.

- A list item
- A second one

| Left | Right |
| --- | --- |
| a | 1 |

```ts
const greeting: string = 'hello'
```

> A quote, which the reader sees rendered.
"""

# The languages, and what each one is here to catch.
LANGUAGES = {
    "en": "the baseline",
    "de": "long compounds",
    "ja": "no spaces, full-width punctuation",
    "ar": "right to left, text only",
    "th": "no spaces, stacked vowels",
    "bn": "tall glyphs",
}

WIDTHS = {"desktop": (1400, 900), "phone": (390, 844)}

# What the app keeps its notes in, seeded before the first paint so a launch finds
# a space with something in it. The same shape as the other drives use.
SEED = """
async ([path, text, language]) => {
  localStorage.setItem('nib:language', language)

  // Whatever version the app itself has made, rather than a number written down
  // here: naming one that has fallen behind is a VersionError and no note.
  const open = (version) => new Promise((resolve, reject) => {
    const request = version ? indexedDB.open('nib', version) : indexedDB.open('nib')
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

  let db = await open()
  if (!db.objectStoreNames.contains('files')) {
    const version = db.version + 1
    db.close()
    db = await open(version)
  }

  const now = Date.now()
  await new Promise((resolve, reject) => {
    const request = db
      .transaction('files', 'readwrite')
      .objectStore('files')
      .put({ path, content: text, modified: now, created: now })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  return true
}
"""

# What the page says about itself: every element that is drawn, that is not a
# scroller, and whose contents are wider than the room it has. A path made of the
# nearest few tags and classes names it, so the same row in two languages is the
# same row here.
CLIPPED = """
() => {
  const path = (element) => {
    const parts = []
    for (let node = element; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      const classes = [...node.classList].filter((one) => !one.startsWith('s-')).slice(0, 2)
      parts.unshift([node.tagName.toLowerCase(), ...classes].join('.'))
    }
    return parts.join(' > ')
  }

  const clipped = []
  const tall = []

  for (const element of document.querySelectorAll('body *')) {
    const box = element.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) continue

    const style = getComputedStyle(element)
    if (style.visibility === 'hidden') continue
    // A scroller is meant to be scrolled; a pane that holds a document is not a
    // label that has been cut off.
    if (/(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY)) continue
    if (element.clientWidth < 2) continue

    const over = element.scrollWidth - element.clientWidth
    if (over > 1) clipped.push({ where: path(element), over, text: (element.textContent || '').trim().slice(0, 48) })

    // A glyph taller than the row it sits in: Bengali and Thai stack above and
    // below the line, and a row sized for Latin cuts the top off.
    const under = element.scrollHeight - element.clientHeight
    if (under > 1 && style.overflowY === 'hidden') {
      tall.push({ where: path(element), over: under, text: (element.textContent || '').trim().slice(0, 48) })
    }
  }

  const page = document.documentElement
  return {
    clipped,
    tall,
    sideways: page.scrollWidth - page.clientWidth,
    lang: page.lang,
    dir: page.dir || getComputedStyle(page).direction,
  }
}
"""

# Where right-to-left text has ended up in a left-to-right box. Nothing is fixed
# here; the point is the list the next batch works from.
BIDI = """
() => {
  const rtl = /[\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF]/
  const found = new Map()

  for (const element of document.querySelectorAll('body *')) {
    const own = [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.nodeValue)
      .join('')
    if (!rtl.test(own)) continue

    const box = element.getBoundingClientRect()
    if (box.width < 2) continue

    const style = getComputedStyle(element)
    if (style.direction === 'rtl') continue

    const key = [...element.classList].filter((one) => !one.startsWith('s-')).join('.') || element.tagName.toLowerCase()
    const seen = found.get(key) ?? { rows: 0, align: style.textAlign }
    seen.rows += 1
    found.set(key, seen)
  }

  return [...found].map(([where, one]) => ({ where, ...one })).sort((a, b) => b.rows - a.rows)
}
"""


def chrome() -> pathlib.Path:
    """The newest Chromium the repository's Playwright has fetched."""
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The build, served without a line per request."""

    def log_message(self, *_args):
        pass


def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server


def open_note(page) -> None:
    """The seeded note, by the palette, which takes the name rather than a word
    of the interface and so works in every language."""
    page.keyboard.press("Control+p")
    page.wait_for_timeout(300)
    page.keyboard.type("Sprachen")
    page.wait_for_timeout(700)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)


def away(page) -> None:
    """Whatever is open, closed, without knowing what it was."""
    for _ in range(3):
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)


class Shots:
    """One folder per language and width, and a reading taken with each picture."""

    def __init__(self, page, language: str, width: str) -> None:
        self.page = page
        self.language = language
        self.width = width
        self.folder = OUT / f"{language}-{width}"
        self.folder.mkdir(parents=True, exist_ok=True)
        self.readings: dict[str, dict] = {}

    def take(self, name: str) -> None:
        self.page.wait_for_timeout(220)
        target = self.folder / f"{name}.png"
        self.page.screenshot(path=str(target))
        self.readings[name] = self.page.evaluate(CLIPPED)


def walk(page, shots: Shots) -> list[str]:
    """Every surface with words on it, photographed and measured. Answers the
    surfaces it could not reach, which on a phone is some of them by design."""
    missed: list[str] = []

    def reach(name: str, open_it) -> None:
        try:
            open_it()
        except Exception as failure:  # noqa: BLE001 - a surface that is not there is a note, not a crash
            missed.append(f"{name}: {type(failure).__name__}")
            away(page)
            return

        shots.take(name)
        away(page)

    # The shell: the list, the note, the bar under it.
    shots.take("shell")

    # The palette, both halves of it: the files it opens with, and the commands
    # behind `>`, which is where most of the app's words are.
    def files():
        page.keyboard.press("Control+p")
        page.wait_for_timeout(400)

    reach("palette-files", files)

    def commands():
        page.keyboard.press("Control+p")
        page.wait_for_timeout(300)
        page.keyboard.type(">")
        page.wait_for_timeout(600)

    reach("palette-commands", commands)

    # The menus. Reached by position rather than by name, because the name is the
    # thing being tested.
    groups = 0

    def menu():
        nonlocal groups
        page.click("button.trigger", timeout=4000)
        page.wait_for_timeout(400)
        groups = page.locator(".groups .nib-row").count()

    reach("menu", menu)

    for index in range(groups):
        def group(at=index):
            page.click("button.trigger", timeout=4000)
            page.wait_for_timeout(300)
            page.locator(".groups .nib-row").nth(at).click()
            page.wait_for_timeout(300)

        reach(f"menu-{index + 1}", group)

    # Settings, and every pane of it. `Mod-,` rather than a row somebody has to
    # read, and the panes by position for the same reason.
    panes = 0

    def settings():
        nonlocal panes
        page.keyboard.press("Control+Comma")
        page.wait_for_timeout(600)
        panes = page.locator(".sheet .group .item").count()

    reach("settings", settings)

    for index in range(panes):
        def pane(at=index):
            page.keyboard.press("Control+Comma")
            page.wait_for_timeout(500)
            page.locator(".sheet .group .item").nth(at).click()
            page.wait_for_timeout(700)

        reach(f"settings-{index + 1}", pane)

    return missed


def regressions(baseline: dict[str, dict], readings: dict[str, dict]) -> list[str]:
    """What the translation broke, and only that: a row already cut off in English
    is the design, a row cut off only here is the catalogue."""
    faults: list[str] = []

    for surface, reading in readings.items():
        was = baseline.get(surface, {})

        # One row of a list clipped is the same fault as the twenty beside it, so
        # each place is named once, with the worst overflow it had.
        for kind, said in (("clipped", "cut off by"), ("tall", "too tall by")):
            before = {one["where"] for one in was.get(kind, [])}
            worst: dict[str, tuple[int, str]] = {}
            for one in reading[kind]:
                if one["where"] in before:
                    continue
                had = worst.get(one["where"])
                if not had or one["over"] > had[0]:
                    worst[one["where"]] = (one["over"], one["text"])

            for where, (over, text) in worst.items():
                faults.append(f"{surface}: {where} {said} {over}px - {text!r}")

        if reading["sideways"] > was.get("sideways", 0) + 1:
            faults.append(f"{surface}: the page scrolls sideways by {reading['sideways']}px")

    return faults


def main() -> int:
    # The report is Arabic, Thai and Bengali; a console in the system codepage
    # cannot print it, and a drive that falls over on its own output has found
    # nothing.
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    parser.add_argument("--widths", default=",".join(WIDTHS))
    asked = parser.parse_args()

    languages = [one for one in asked.languages.split(",") if one]
    widths = [one for one in asked.widths.split(",") if one]
    for one in languages:
        if one not in LANGUAGES:
            raise SystemExit(f"no such language here: {one}")
    if "en" not in languages:
        languages.insert(0, "en")

    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @nib/desktop build")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    url, server = serve()
    report: dict[str, object] = {}
    failures: list[str] = []
    baselines: dict[str, dict] = {}

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))

        try:
            for width in widths:
                size = WIDTHS[width]

                for language in languages:
                    context = browser.new_context(
                        viewport={"width": size[0], "height": size[1]},
                        # A phone is a phone: the app reads the pointer, not the width
                        # alone, and half its layout hangs off that.
                        has_touch=width == "phone",
                        is_mobile=width == "phone",
                        locale=language if language != "en" else "en-US",
                    )
                    page = context.new_page()

                    problems: list[str] = []
                    page.on("pageerror", lambda error: problems.append(f"page error: {error}"))

                    try:
                        page.goto(url)
                        page.wait_for_timeout(2000)
                        page.evaluate(SEED, [NOTE_PATH, NOTE, language])
                        page.reload()
                        page.wait_for_timeout(2500)
                        open_note(page)

                        shots = Shots(page, language, width)
                        missed = walk(page, shots)

                        said = f"{language} {width}"
                        report[f"{said}: surfaces"] = sorted(shots.readings)
                        if missed:
                            report[f"{said}: not reached"] = missed
                        report[f"{said}: the page says"] = {
                            "lang": next(iter(shots.readings.values()))["lang"],
                            "dir": next(iter(shots.readings.values()))["dir"],
                        }

                        if language == "en":
                            baselines[width] = shots.readings
                        else:
                            faults = regressions(baselines[width], shots.readings)
                            report[f"{said}: clipped"] = faults or "nothing the English does not"
                            failures += [f"{said}: {one}" for one in faults]

                        if language == "ar":
                            # With a pane of words open: the shell on its own is
                            # file names, which are whatever somebody typed.
                            page.keyboard.press("Control+Comma")
                            page.wait_for_timeout(700)
                            report[f"{said}: right-to-left text in left-to-right boxes"] = (
                                page.evaluate(BIDI)
                            )
                            away(page)

                        if problems:
                            report[f"{said}: page problems"] = problems[:6]
                            failures += [f"{said}: {one}" for one in problems[:6]]
                    finally:
                        context.close()
        finally:
            browser.close()
            server.shutdown()
            server.server_close()

    (OUT / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))

    if failures:
        print("\nFAILED:")
        for one in failures:
            print(f"  {one}")
        return 1

    print(f"\nall good; the pictures and the report are in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
