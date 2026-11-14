from __future__ import annotations

import json
import re
import sys
import time

from playwright.sync_api import Browser, ConsoleMessage, Error, Frame, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
DIST = harness.DIST

PAGE = "https://frames.example.test/plan?a=1&b=2"

NOTE = f"""# Frames

A page somewhere else, framed by hand:

<iframe src="{PAGE}" height="240"></iframe>

A block that does something:

<div id="dial">nothing yet</div>
<script type="text/template" id="kept">a template, never run</script>
<script>
document.getElementById('dial').textContent = 'it ran'
document.getElementById('dial').dataset.script = document.currentScript.tagName
document.body.style.height = '300px'
</script>
<script type="module">
document.getElementById('dial').dataset.module = 'ran'
</script>

A provider the table knows:

![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

And a fence that runs:

```js
console.log('the fence ran')
6 * 7
```
"""

SEED = """
async ([note, name]) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith(name))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

INSIDE = """
() => {
  const dial = document.getElementById('dial')
  return {
    said: dial?.textContent ?? null,
    script: dial?.dataset.script ?? null,
    module: dial?.dataset.module ?? null,
    kept: document.getElementById('kept')?.textContent ?? null,
  }
}
"""

COUNTS = """
() => {
  const count = (selector) => document.querySelectorAll(selector).length
  return {
    cards: count('.embed-web'),
    pages: count('.embed-page'),
    blocks: count('.embed-html'),
    frames: count('iframe'),
    // The tag itself, which must never reach the page as a tag.
    tags: document.querySelector('#write')?.innerHTML.includes('<iframe src=') ?? false,
  }
}
"""

FRAME = """
(selector) => {
  const found = document.querySelector(selector + ' iframe')
  if (!found) return null
  const card = found.closest('.embed-web')
  const box = found.getBoundingClientRect()
  return {
    src: found.getAttribute('src'),
    srcdoc: (found.getAttribute('srcdoc') || '').slice(0, 40),
    sandbox: found.getAttribute('sandbox'),
    title: found.getAttribute('title'),
    height: Math.round(box.height),
    asked: card.style.getPropertyValue('--embed-height'),
  }
}
"""

violations: list[str] = []

ENGINES = ("chrome", "webkit")
engine = ENGINES[0]

def wrong(what: str) -> None:
    DRIVE.wrong(f"[{engine}] {what}")

def shot(page: Page, name: str) -> None:
    DRIVE.shot(page, f"{engine}/{name}", caret="initial")

def policy() -> str:
    html = (DIST / "index.html").read_text(encoding="utf-8")
    found = re.search(
        r'http-equiv="Content-Security-Policy"\s*content="([^"]*)"', html, re.IGNORECASE
    )
    if not found:
        raise SystemExit("the built index.html declares no policy to serve")

    return re.sub(r"\s+", " ", found.group(1)).strip()

def scroll_to(page: Page, selector: str) -> None:
    page.evaluate(
        """(selector) => {
          document.querySelector(selector)?.scrollIntoView({ block: 'center' })
        }""",
        selector,
    )
    page.wait_for_timeout(400)

def noticed(message: ConsoleMessage) -> None:
    text = message.text
    if "Content Security Policy" in text or "Content-Security-Policy" in text:
        violations.append(f"[{engine}] {text}")
        say(f"violation: {text[:170]}")

def asked_for(page: Page) -> list[str]:
    return page.evaluate(
        """() => performance
          .getEntriesByType('resource')
          .map((one) => one.name)
          .filter((name) => !name.startsWith(location.origin))"""
    )

def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("console", noticed)
    DRIVE.open(page, origin=ORIGIN)
    say(f"the space holds {page.evaluate(SEED, [NOTE, 'Frames'])}")
    wait_for(page, "window.orden && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)
    return page

def drive(browser: Browser) -> None:
    page = fresh(browser)

    try:
        wait_for(page, "document.querySelectorAll('.embed-web').length >= 3", "the cards", 15)
    except SystemExit:
        pass
    counts = page.evaluate(COUNTS)
    say(f"[editor] {json.dumps(counts)}")
    shot(page, "01-editor")
    if counts["cards"] != 3:
        wrong(f"the editor drew {counts['cards']} cards, not 3 (a page, a block and a video)")
    if counts["pages"] != 1:
        wrong(f"the editor drew {counts['pages']} cards for the tag, not 1")
    if counts["blocks"] != 1:
        wrong(f"the editor drew {counts['blocks']} cards for the block, not 1")
    if counts["frames"] != 0:
        wrong(f"the editor loaded {counts['frames']} frames before anybody asked")
    if counts["tags"]:
        wrong("the tag itself reached the page")

    outside = asked_for(page)
    if outside:
        wrong(f"opening the note fetched from outside: {outside[:4]}")

    page.evaluate(
        """() => {
          const at = window.orden.state.doc.toString().indexOf("console.log('the fence ran')")
          window.orden.focus()
          window.orden.dispatch({ selection: { anchor: at + 3 } })
        }"""
    )
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Enter")

    lines: list[str] = []
    seen = False
    until = time.monotonic() + 30
    while time.monotonic() < until:
        lines, running = page.evaluate(
            """() => [
              [...document.querySelectorAll('.orden-run-line')].map((one) => one.textContent),
              !!document.querySelector('iframe[title=\"Orden runner\"]'),
            ]"""
        )
        seen = seen or running
        if len(lines) >= 2:
            break
        page.wait_for_timeout(200)

    say(f"[fence] {json.dumps(lines)}")
    if not seen:
        wrong("no runner frame was seen while the fence ran, so its going away proves nothing")
    try:
        wait_for(page, "!document.querySelector('iframe[title=\"Orden runner\"]')", "the runner", 20)
    except SystemExit:
        wrong("the runner was never taken down")
    shot(page, "02-fence")
    if not any("the fence ran" in (line or "") for line in lines):
        wrong("the js fence printed nothing: the runner cannot run under this policy")
    if not any("42" in (line or "") for line in lines):
        wrong("the js fence gave back no value")

    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    try:
        wait_for(page, "document.querySelectorAll('.embed-web').length >= 3", "the cards", 15)
    except SystemExit:
        pass
    read = page.evaluate(COUNTS)
    say(f"[reading] {json.dumps(read)}")
    shot(page, "03-reading")
    if read["cards"] != 3:
        wrong(f"the reading view drew {read['cards']} cards, not 3")
    if read["blocks"] != 1:
        wrong(f"the reading view drew {read['blocks']} cards for the block, not 1")
    if read["frames"] != 0:
        wrong(f"the reading view loaded {read['frames']} frames before anybody asked")
    if read["tags"]:
        wrong("the tag itself reached the reading view")

    scroll_to(page, ".embed-page")
    page.click(".embed-page")
    page.wait_for_timeout(900)
    framed = page.evaluate(FRAME, ".embed-page")
    say(f"[page] {json.dumps(framed)}")
    shot(page, "04-page-framed")
    if not framed:
        wrong("a press on the page's card loaded no frame")
    else:
        if framed["src"] != PAGE:
            wrong(f"the frame points at {framed['src']}")
        if framed["sandbox"] != "allow-scripts":
            wrong(f"a page nobody vouched for got the sandbox {framed['sandbox']!r}")
        if framed["title"] != "frames.example.test":
            wrong(f"the frame is titled {framed['title']!r}")
        if abs(framed["height"] - 240) > 4:
            wrong(f"the frame is not the room the tag asked for: {framed['height']}")

    scroll_to(page, ".embed-html")
    page.click(".embed-html")
    ran_by_then(page, ".embed-html")
    ran = page.evaluate(FRAME, ".embed-html")
    say(f"[block] {json.dumps(ran)}")
    shot(page, "05-block-running")
    if not ran:
        wrong("a press on the block's card ran nothing")
    else:
        if ran["src"] is not None:
            wrong(f"the block's frame fetched {ran['src']}")
        if "<!doctype html>" not in ran["srcdoc"].lower():
            wrong(f"the block's frame holds {ran['srcdoc']!r}")
        if ran["asked"].strip() not in {"300px", "301px"}:
            wrong(f"the block asked for {ran['asked']!r}, so its script did not run")
        if ran["sandbox"] != "allow-scripts":
            wrong(f"the block's frame got the sandbox {ran['sandbox']!r}")

    inside = block_frame(page)
    said = inside.evaluate(INSIDE) if inside else None
    say(f"[inside] {json.dumps(said)}")
    expected = {"said": "it ran", "script": "SCRIPT", "module": "ran", "kept": "a template, never run"}
    if said != expected:
        wrong(f"the block's scripts did not run the way a page runs them: {said}")

    page.context.close()

def ran_by_then(page: Page, card: str) -> None:
    until = time.monotonic() + 20
    while time.monotonic() < until:
        asked = page.evaluate(
            "(card) => document.querySelector(card)?.style.getPropertyValue('--embed-height') ?? ''",
            card,
        )
        if asked.strip() in {"300px", "301px"}:
            break
        page.wait_for_timeout(200)
    page.wait_for_timeout(300)

def block_frame(page: Page) -> Frame | None:
    for frame in page.frames:
        if frame is page.main_frame:
            continue
        try:
            if frame.evaluate("() => !!document.getElementById('dial')"):
                return frame
        except Error:
            continue

    return None

def main() -> int:
    global engine, ORIGIN

    asked = sys.argv[sys.argv.index("--engine") + 1] if "--engine" in sys.argv else None
    engines = [one for one in ENGINES if asked in (None, one)]
    if not engines:
        raise SystemExit(f"no engine called {asked}; the drive knows {', '.join(ENGINES)}")

    with DRIVE.session(playwright=True) as play:
        said = policy()
        say(f"the policy is {said[:90]}…")
        DRIVE.header("Content-Security-Policy", said)
        for engine in engines:
            say(f"-- {engine} --")
            if engine != "chrome" and DRIVE.server is not None:
                ORIGIN = DRIVE.server.origin("127.0.0.1")
            browser = DRIVE.browser(play) if engine == "chrome" else harness.answering(play.webkit.launch())
            try:
                drive(browser)
            finally:
                browser.close()

    if violations:
        say(f"{len(violations)} complaint(s) about the policy")
        for one in violations:
            failures.append(f"policy violation: {one[:170]}")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print(
        "\na tag is a card, a block runs in a sandbox, a fence still"
        f" runs, and the policy complained about nothing in {' or '.join(engines)}",
        flush=True,
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
