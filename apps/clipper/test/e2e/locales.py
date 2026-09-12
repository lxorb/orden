"""The two pages the extension draws, in five hard languages, photographed and
measured.

A catalogue can be right word by word and still break a popup that is three
hundred and forty pixels wide: German compounds are twice the length of the
English they replace, Japanese has no spaces to wrap at, Thai has none either and
stacks its vowels above and below the line, Bengali hangs its glyphs off a
headline and needs more height than Latin, and Arabic is written the other way
round.

So this loads the built extension, sets the language in `chrome.storage.local`
the way the options page does, and opens each page once per language: the popup at
the width Chrome actually gives it, and the options page both at that width and at
its own. Each picture comes with a reading taken from the page itself - an element
whose `scrollWidth` is past its `clientWidth` while its `overflow-x` is not a
scroller is a label that has been cut off. English at the same width is the
baseline, so only what the *translation* broke is a failure.

Arabic is here for its text alone. Right-to-left layout is a later batch; what
this drive does is write down what that batch will have to put right.

Chrome will not hand a popup to Playwright - there is no window to attach to - so
the popup is opened as an ordinary tab at `chrome-extension://<id>/popup.html`,
which is the same markup with the same stylesheet; see clip.py, which reads the
worker the same way. It runs headed, because an extension does not load in the
headless shell.

Run it after `node scripts/build.js`:

    python apps/clipper/test/e2e/locales.py

`--languages de,ja` narrows it while something is being fixed. `CHROMIUM` names a
browser to use instead of the one Playwright registered.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import pathlib
import shutil
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE.parent.parent / "dist"
OUT = HERE.parent.parent.parent.parent / "target" / "clipper-locales"

# The languages, and what each one is here to catch. English first: it is the
# baseline every other reading is measured against.
LANGUAGES = {
    "en": "the baseline",
    "de": "long compounds",
    "ja": "no spaces, full-width punctuation",
    "ar": "right to left, text only",
    "th": "no spaces, stacked vowels",
    "bn": "tall glyphs",
}

# A session, a space to save into and an interpreter that is set up, so the popup
# draws the whole of itself rather than the sign-in form: the tabs, the target, the
# template row and the line under it. Nothing here reaches a server - the token is
# not a real one - and nothing needs to: what is being read is the words.
def seeded(language: str, port: int) -> str:
    held = {
        "nib:session": "not-a-real-token",
        "nib:email": "reader@example.com",
        "nib:spaces": [{"id": "space-1", "name": "Notes", "position": 0}],
        "nib:target": {"spaceId": "space-1", "folder": "Clips"},
        "nib:language": language,
        "nib:theme": "dark",
        "nib:interpreter": {
            "provider": "compatible",
            "address": f"http://127.0.0.1:{port}/v1",
            "models": {"compatible": "a-model-on-this-machine"},
            "keys": {},
            # Every template the defaults offer, so whichever one the page's address
            # claims has its switch on and the counted row is on screen.
            "on": {
                "Recipe": True,
                "Product": True,
                "Paper": True,
                "Thread": True,
                "Article": True,
                "Generic": True,
            },
        },
    }
    return f"async () => {{ await chrome.storage.local.clear(); await chrome.storage.local.set({json.dumps(held)}) }}"


# What the page says about itself: every element that is drawn, that is not a
# scroller, and whose contents are wider than the room it has. A path made of the
# nearest few tags and classes names it, so the same row in two languages is the
# same row here. The same reading scripts/locale-e2e.py takes of the app.
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
    if (/(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY)) continue
    if (element.clientWidth < 2) continue

    const over = element.scrollWidth - element.clientWidth
    if (over > 1) {
      // An element that asks for an ellipsis has said its text may be cut: a
      // select showing a long folder name is doing what it was built to do.
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
    words: (document.querySelector('#app')?.textContent || '').trim().slice(0, 120),
  }
}
"""

# How wide the surface actually is, asked of the page rather than worked out from
# the stylesheet: the popup is a fixed column and the options page is a card with a
# ceiling, and both are written in tokens this drive has no business reading.
# Border-box, which is what the app's base stylesheet puts everything in, so what
# comes back is the width Chrome gives the popup.
MEASURE = """
() => {
  const main = document.querySelector('main')
  return main ? Math.ceil(main.getBoundingClientRect().width) : 0
}
"""


def chromium() -> str | None:
    return os.environ.get("CHROMIUM")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The fixtures, served without a line per request, and a provider that never
    answers.

    The interpreter is pointed at this server, and a POST to it is left hanging:
    that is the state the counted row is written for - the switch is on, the page
    has gone, and the line says how much of it was sent while the answer is
    awaited. A provider that refused would put its own sentence there instead, and
    one that answered would take the row away."""

    def log_message(self, *_args):
        pass

    def do_POST(self):  # noqa: N802 - the base class names it
        threading.Event().wait(20)
        self.send_error(503)


class Patient(http.server.ThreadingHTTPServer):
    """Threaded, because the hanging POST must not hold up the next page, and
    silent about a socket that goes away: the popup is closed while its request is
    still waiting, which is the whole point of the request."""

    daemon_threads = True

    def handle_error(self, *_args):
        pass


def serving(folder: pathlib.Path) -> tuple[int, Patient]:
    """The fixtures on a port of the machine's choosing, so nothing collides."""
    handler = functools.partial(Quiet, directory=str(folder))
    server = Patient(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1], server


def readings(page, width: int, folder: pathlib.Path, name: str) -> dict:
    page.set_viewport_size({"width": width, "height": 900})
    page.wait_for_timeout(250)
    folder.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(folder / f"{name}.png"), full_page=True)
    return page.evaluate(CLIPPED)


def regressions(baseline: dict, reading: dict, surface: str) -> list[str]:
    """What the translation broke, and only that: a row already cut off in English
    is the design, a row cut off only here is the catalogue."""
    faults: list[str] = []

    for kind, said in (("clipped", "cut off by"), ("tall", "too tall by")):
        before = {one["where"] for one in baseline.get(kind, [])}
        worst: dict[str, tuple[int, str]] = {}
        for one in reading[kind]:
            if one["where"] in before:
                continue
            had = worst.get(one["where"])
            if not had or one["over"] > had[0]:
                worst[one["where"]] = (one["over"], one["text"])

        for where, (over, text) in worst.items():
            faults.append(f"{surface}: {where} {said} {over}px - {text!r}")

    if reading["sideways"] > baseline.get("sideways", 0) + 1:
        faults.append(f"{surface}: the page scrolls sideways by {reading['sideways']}px")

    return faults


def elisions(baseline: dict, reading: dict, surface: str) -> list[str]:
    """Where this language asked for the ellipsis it was offered and English did
    not. Not a failure - the element declared that its text may be cut - but the
    shortlist of rows whose translation could stand to be shorter."""
    before = {one["where"] for one in baseline.get("elided", [])}
    worst: dict[str, tuple[int, str]] = {}
    for one in reading["elided"]:
        if one["where"] in before:
            continue
        had = worst.get(one["where"])
        if not had or one["over"] > had[0]:
            worst[one["where"]] = (one["over"], one["text"])

    return [f"{surface}: {where} elides {over}px - {text!r}" for where, (over, text) in worst.items()]


def main() -> int:
    # The report is Arabic, Thai and Bengali; a console in the system codepage
    # cannot print it, and a drive that falls over on its own output has found
    # nothing.
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    asked = parser.parse_args()

    languages = [one for one in asked.languages.split(",") if one]
    for one in languages:
        if one not in LANGUAGES:
            raise SystemExit(f"no such language here: {one}")
    if "en" not in languages:
        languages.insert(0, "en")

    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}: run node scripts/build.js first")

    shutil.rmtree(OUT, ignore_errors=True)
    report: dict[str, object] = {}
    failures: list[str] = []
    baselines: dict[str, dict] = {}
    port, server = serving(HERE)

    with sync_playwright() as play:
        context = play.chromium.launch_persistent_context(
            "",
            headless=False,
            executable_path=chromium(),
            args=[f"--disable-extensions-except={DIST}", f"--load-extension={DIST}"],
        )

        try:
            worker = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker")
            )
            base = worker.url.split("/background.js")[0]
            print(f"  extension  {base}")

            # The width Chrome gives the popup, and the width the options page asks
            # for, measured once from the English pages.
            page = context.new_page()
            page.set_viewport_size({"width": 1200, "height": 900})
            page.goto(f"{base}/popup.html")
            page.wait_for_timeout(600)
            popup_width = int(page.evaluate(MEASURE))

            page.goto(f"{base}/options.html")
            page.wait_for_timeout(600)
            card = int(page.evaluate(MEASURE))
            # And the room the page keeps either side of the card, which is a token
            # too: at a width the ceiling does not reach, what is left over is the
            # gutter. Together they are the window the card fills.
            page.set_viewport_size({"width": 400, "height": 900})
            page.wait_for_timeout(250)
            options_width = card + 400 - int(page.evaluate(MEASURE))
            page.close()
            print(f"  popup      {popup_width}px\n  options    {options_width}px")
            report["widths"] = {"popup": popup_width, "options": options_width}

            surfaces = [
                ("popup", "popup.html", popup_width),
                # The options page at the popup's width as well as its own: it is a
                # card with a ceiling, so a narrow window is a layout it really has.
                ("options-narrow", "options.html", popup_width),
                ("options", "options.html", options_width),
            ]

            for language in languages:
                worker.evaluate(seeded(language, port))
                folder = OUT / language
                taken: dict[str, dict] = {}

                # The page the reader is on, which is the page the popup asks the
                # worker about. It has to be the active tab while the popup starts,
                # so the popup is opened behind it: a clip that arrives is what puts
                # the preview, the template picker and the counted row on screen.
                article = context.new_page()
                article.goto(f"http://127.0.0.1:{port}/article.html")
                article.wait_for_load_state("load")

                with context.expect_page() as caught:
                    worker.evaluate(
                        f"() => chrome.tabs.create({{ url: '{base}/popup.html', active: false }})"
                    )
                popup = caught.value
                problems: list[str] = []
                popup.on("pageerror", lambda error: problems.append(f"page error: {error}"))
                popup.set_viewport_size({"width": popup_width, "height": 900})

                try:
                    popup.wait_for_selector(".preview pre", timeout=12000)
                except Exception:  # noqa: BLE001 - a popup with no clip is a finding
                    failures.append(f"{language} popup: no clip arrived")

                taken["popup"] = readings(popup, popup_width, folder, "popup")
                failures += [f"{language} popup: {one}" for one in problems]
                popup.close()
                article.close()

                for name, file, width in surfaces[1:]:
                    shown = context.new_page()
                    said_problems: list[str] = []
                    shown.on(
                        "pageerror", lambda error: said_problems.append(f"page error: {error}")
                    )
                    shown.set_viewport_size({"width": width, "height": 900})
                    shown.goto(f"{base}/{file}")
                    shown.wait_for_timeout(700)

                    reading = readings(shown, width, folder, name)
                    taken[name] = reading
                    if not reading["words"]:
                        failures.append(f"{language} {name}: the page drew nothing")
                    failures += [f"{language} {name}: {one}" for one in said_problems]
                    shown.close()

                said = f"{language} ({LANGUAGES[language]})"
                report[f"{said}: the page says"] = {
                    "lang": taken["popup"]["lang"],
                    "dir": taken["popup"]["dir"],
                }

                if language == "en":
                    baselines = taken
                    continue

                faults: list[str] = []
                elided: list[str] = []
                for name, _file, _width in surfaces:
                    faults += regressions(baselines[name], taken[name], name)
                    elided += elisions(baselines[name], taken[name], name)

                report[f"{said}: clipped"] = faults or "nothing the English does not"
                failures += [f"{language}: {one}" for one in faults]
                if elided:
                    report[f"{said}: elided where English fits"] = elided

            context.close()
        finally:
            server.shutdown()
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / "report.json").write_text(
                json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
            )

    print(json.dumps(report, indent=2, ensure_ascii=False))

    if failures:
        print("\nFAILED:")
        for one in failures:
            print(f"  {one}")
        return 1

    print(f"\n  all good; the pictures and the report are in {OUT}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
