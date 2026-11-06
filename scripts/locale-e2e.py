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

LANGUAGES = {
    "en": "the baseline",
    "de": "long compounds",
    "ja": "no spaces, full-width punctuation",
    "ar": "right to left",
    "ur": "right to left, Nastaliq hanging below the line",
    "th": "no spaces, stacked vowels",
    "bn": "tall glyphs",
}

RIGHT_TO_LEFT = {"ar", "fa", "ps", "ur"}

WIDTHS = {"desktop": (1400, 900), "phone": (390, 844)}

PHONE_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

MOD = {"desktop": "Control", "phone": "Meta"}

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

HOLD = """
() => {
  // Only a build a drive may steer carries it (`--mode drive`); a release has none.
  if (!window.nibApp?.sync2) throw new Error('not a drivable build')
  const side = (device, at, text, word) => ({
    device, at: Date.now() - at * 3600000,
    excerpt: { text, marks: [[text.indexOf(word), text.indexOf(word) + word.length]] },
  })
  window.__held = window.nibApp.sync2.connectFake([{
    id: 'held', path: window.nibApp.workspace.active.path, name: 'Plan',
    mine: side('Laptop', 2, 'We meet at noon on Friday.', 'noon'),
    theirs: side('iPhone', 1, 'We meet at one on Saturday.', 'one'),
  }])
}
"""

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
  const elided = []
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
    if (over > 1) {
      // An element that asks for an ellipsis has said its text may be cut: a
      // select showing a long folder name is doing what it was built to do. Those
      // are written down rather than failed, because a language that elides where
      // English fits is worth a look and is not a broken layout.
      const found = { where: path(element), over, text: (element.textContent || '').trim().slice(0, 48) }
      ;(style.textOverflow === 'ellipsis' ? elided : clipped).push(found)
    }

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
    elided,
    tall,
    sideways: page.scrollWidth - page.clientWidth,
    lang: page.lang,
    dir: page.dir || getComputedStyle(page).direction,
  }
}
"""

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

MIRRORED = """
() => {
  const page = document.documentElement
  const box = (selector) => {
    const found = document.querySelector(selector)
    if (!found) return null
    const rect = found.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
    }
  }

  // `scaleX(-1)` is a matrix whose first component is negative; identity is 1.
  // Only the marks actually on screen: a browser does not work a transform out
  // for an element it is not drawing, and answers `none` for every one of the
  // chevrons a desktop hides, which is not the same as a mark facing the wrong
  // way.
  const marks = [...document.querySelectorAll('.nib-mirror')]
    .filter((one) => one.getBoundingClientRect().width > 1)
    .map((one) => ({
      where: [...one.classList].filter((name) => !name.startsWith('s-')).join('.'),
      flipped: new DOMMatrix(getComputedStyle(one).transform).a < 0,
    }))

  const write = document.querySelector('#write')

  return {
    dir: page.dir || getComputedStyle(page).direction,
    lang: page.lang,
    window: window.innerWidth,
    panels: box('.panels'),
    note: box('.document'),
    status: box('footer[data-region=status]'),
    marks,
    writing: write
      ? { dir: write.getAttribute('dir'), direction: getComputedStyle(write).direction }
      : null,
  }
}
"""

def mirroring(language: str, width: str, reading: dict) -> list[str]:
    faults: list[str] = []
    wanted = "rtl" if language in RIGHT_TO_LEFT else "ltr"
    if reading["dir"] != wanted:
        faults.append(f"the page says dir={reading['dir']!r} rather than {wanted!r}")

    writing = reading["writing"]
    if not writing:
        faults.append("no writing surface on screen")
    elif writing["direction"] != "ltr":
        faults.append(f"the note followed the interface: {writing['direction']}")

    for mark in reading["marks"]:
        if mark["flipped"] != (wanted == "rtl"):
            said = "is not turned over" if wanted == "rtl" else "is turned over"
            faults.append(f"the mark .{mark['where']} {said}")

    panels, note, status = reading["panels"], reading["note"], reading["status"]
    edge = reading["window"]

    if width == "desktop" and panels and note and panels["width"] > 2:
        if wanted == "rtl" and not (panels["right"] >= edge - 2 and note["left"] <= 2):
            faults.append(f"the list is not against the right edge: {panels} in {edge}")
        if wanted == "ltr" and not (panels["left"] <= 2 and note["right"] >= edge - 2):
            faults.append(f"the list is not against the left edge: {panels} in {edge}")

    if status and status["width"] > 2:
        if wanted == "rtl" and status["left"] > 2:
            faults.append(f"the status bar is not at the left edge: {status}")
        if wanted == "ltr" and status["right"] < edge - 2:
            faults.append(f"the status bar is not at the right edge: {status} in {edge}")

    return faults

def chrome() -> pathlib.Path:
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]

def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])

class Quiet(http.server.SimpleHTTPRequestHandler):

    def log_message(self, *_args):
        pass

def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server

def open_note(page, mod: str) -> None:
    page.keyboard.press(f"{mod}+p")
    page.wait_for_timeout(300)
    page.keyboard.type("Sprachen")
    page.wait_for_timeout(700)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)

def away(page) -> None:
    for _ in range(3):
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

class Shots:

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

def walk(page, shots: Shots, mod: str) -> list[str]:
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

    shots.take("shell")

    def files():
        page.keyboard.press(f"{mod}+p")
        page.wait_for_timeout(400)

    reach("palette-files", files)

    def commands():
        page.keyboard.press(f"{mod}+p")
        page.wait_for_timeout(300)
        page.keyboard.type(">")
        page.wait_for_timeout(600)

    reach("palette-commands", commands)

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

    panes = 0

    def settings():
        nonlocal panes
        page.keyboard.press(f"{mod}+Comma")
        page.wait_for_timeout(600)
        panes = page.locator(".sheet .group .item").count()

    reach("settings", settings)

    for index in range(panes):
        def pane(at=index):
            page.keyboard.press(f"{mod}+Comma")
            page.wait_for_timeout(500)
            page.locator(".sheet .group .item").nth(at).click()
            page.wait_for_timeout(700)

        reach(f"settings-{index + 1}", pane)

    def diverged():
        page.evaluate(HOLD)
        page.wait_for_selector("[role=dialog] .sides", timeout=4000)

    reach("diverged", diverged)

    def resurrected():
        page.evaluate(
            "() => window.__held.engine.emit('resurrected', { id: 'held', name: 'Plan', device: 'iPhone' })"
        )
        page.locator(".toast", has_text="Plan").hover(timeout=4000)

    reach("resurrected", resurrected)
    page.evaluate("() => window.__held?.stop()")

    return missed

def regressions(baseline: dict[str, dict], readings: dict[str, dict]) -> list[str]:
    faults: list[str] = []

    for surface, reading in readings.items():
        was = baseline.get(surface, {})

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

def elisions(baseline: dict[str, dict], readings: dict[str, dict]) -> list[str]:
    found: list[str] = []

    for surface, reading in readings.items():
        before = {one["where"] for one in baseline.get(surface, {}).get("elided", [])}
        worst: dict[str, tuple[int, str]] = {}
        for one in reading["elided"]:
            if one["where"] in before:
                continue
            had = worst.get(one["where"])
            if not had or one["over"] > had[0]:
                worst[one["where"]] = (one["over"], one["text"])

        for where, (over, text) in worst.items():
            found.append(f"{surface}: {where} elides {over}px - {text!r}")

    return found

def main() -> int:
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
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @orden/desktop build")

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
                        has_touch=width == "phone",
                        is_mobile=width == "phone",
                        **({"user_agent": PHONE_AGENT} if width == "phone" else {}),
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
                        open_note(page, MOD[width])

                        shots = Shots(page, language, width)

                        away(page)
                        if page.locator(".panels").evaluate("one => one.clientWidth") < 2:
                            page.click(".nib-glyph.toggle", timeout=4000)
                            page.wait_for_timeout(500)

                        shots.take("shell-open")
                        turned = page.evaluate(MIRRORED)
                        away(page)

                        missed = walk(page, shots, MOD[width])

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

                            elided = elisions(baselines[width], shots.readings)
                            if elided:
                                report[f"{said}: elided where English fits"] = elided

                        page.keyboard.press(f"{MOD[width]}+Comma")
                        page.wait_for_timeout(700)
                        turned["marks"] = page.evaluate(MIRRORED)["marks"]
                        if language in RIGHT_TO_LEFT:
                            report[f"{said}: right-to-left text in left-to-right boxes"] = (
                                page.evaluate(BIDI)
                            )
                        away(page)

                        report[f"{said}: laid out"] = turned
                        turns = mirroring(language, width, turned)
                        report[f"{said}: mirroring"] = turns or "the way it reads"
                        failures += [f"{said}: {one}" for one in turns]

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
