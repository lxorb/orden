from __future__ import annotations

import json
import re
import sys
import time

from playwright.sync_api import Browser, Error, Frame, Page
from playwright.sync_api import TimeoutError as Timeout

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
DIST = harness.DIST

NOTE = """# Endless

A fence that never ends:

```js
console.log('started')
while (true) {}
```

A block whose script never ends:

<div id="dial">nothing yet</div>
<script>
document.getElementById('dial').textContent = 'it began'
document.body.style.height = '120px'
while (true) {}
</script>

A block whose loops are made from text, or wait in a handler:

<div id="made">nothing yet</div>
<button id="press" onclick="while (true) {}">press</button>
<script>
const said = []
for (const run of [
  () => eval('while (true) {}'),
  () => new Function('for (;;) {}')(),
  () => setTimeout('while (true) {}'),
]) {
  try {
    run()
    said.push('ran')
  } catch (error) {
    said.push(error.name)
  }
}
document.getElementById('made').textContent = said.join(' ')
</script>

A block whose pattern backtracks without end:

<div id="pattern">nothing yet</div>
<script>
document.getElementById('pattern').textContent = 'it ran'
;/^(\\w+\\s?)+$/.test('a'.repeat(40) + '!')
</script>

A block that makes its patterns as it runs:

<div id="madepattern">nothing yet</div>
<script>
const tried = []
const source = ['(\\\\w+', '\\\\s?)+$'].join('')
const text = 'a'.repeat(40) + '!'
for (const run of [
  () => new RegExp(source).test(text),
  () => text.match(source),
  () => eval('/' + source + '/').test(text),
]) {
  try {
    run()
    tried.push('ran')
  } catch (error) {
    tried.push(error.name)
  }
}
document.getElementById('madepattern').textContent = tried.join(' ')
</script>

A block that makes a frame of its own to run what it says:

<div id="nested">nothing yet</div>
<script>
const own = [...document.scripts].find((one) => !one.type && one !== document.currentScript && one.textContent.includes('orden-frame'))
const child = document.createElement('iframe')
child.srcdoc = '<script type="text/plain" id="orden-frame">while (true) {}</' + 'script><script>' + own.textContent + '</' + 'script>'
document.body.append(child)
document.getElementById('nested').textContent = 'made a frame'
</script>

A block that reaches into a frame it makes, for the eval and patterns there:

<div id="reached">nothing yet</div>
<script>
const reached = []
const inner = document.createElement('iframe')
document.body.append(inner)
for (const run of [
  () => inner.contentWindow.eval('while (true) {}'),
  () => new inner.contentWindow.RegExp('^(\\w+\\s?)+$').test('a'.repeat(40) + '!'),
  () => window[0].Function('for (;;) {}')(),
]) {
  try {
    run()
    reached.push('ran')
  } catch (error) {
    reached.push(error.name)
  }
}
document.getElementById('reached').textContent = reached.join(' ')
</script>

The end.
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

ENGINES = ("chrome", "webkit")
engine = ENGINES[0]
ORIGIN: str | None = None

def wrong(what: str) -> None:
    DRIVE.wrong(f"[{engine}] {what}")

def policy() -> str:
    html = (DIST / "index.html").read_text(encoding="utf-8")
    found = re.search(r'http-equiv="Content-Security-Policy"\s*content="([^"]*)"', html, re.IGNORECASE)
    if not found:
        raise SystemExit("the built index.html declares no policy to serve")
    return re.sub(r"\s+", " ", found.group(1)).strip()

def answers(page: Page, what: str, patience: float = 3) -> bool:
    try:
        page.wait_for_function("() => true", timeout=patience * 1000)
        return True
    except (Timeout, Error):
        wrong(f"the app stopped answering {what}")
        return False

def typed_lands(page: Page, words: str) -> bool:
    try:
        page.wait_for_function(
            """(words) => {
              const end = window.orden.state.doc.length
              window.orden.dispatch({ changes: { from: end, insert: words } })
              return window.orden.state.doc.toString().endsWith(words)
            }""",
            arg=words,
            timeout=3000,
        )
        return True
    except (Timeout, Error):
        wrong(f"typing {words!r} did not land")
        return False

def fence(page: Page) -> None:
    page.evaluate(
        """() => {
          const at = window.orden.state.doc.toString().indexOf("console.log('started')")
          window.orden.focus()
          window.orden.dispatch({ selection: { anchor: at + 3 } })
        }"""
    )
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Enter")
    began = time.monotonic()

    page.wait_for_timeout(3000)
    if not answers(page, "while the fence ran"):
        return
    typed_lands(page, " typed while it ran")
    lines = page.evaluate("() => [...document.querySelectorAll('.orden-run-line')].map((one) => one.textContent)")
    say(f"[fence] while it runs: {json.dumps(lines)}")
    if not any("started" in (line or "") for line in lines):
        wrong("the fence printed nothing before its loop")

    try:
        DRIVE.wait_for(
            page,
            "!document.querySelector('iframe[title=\"Orden runner\"]')"
            " && /tim/i.test(document.querySelector('.orden-run-state')?.textContent ?? '')",
            "the run to be stopped as timed out",
            30,
        )
        say(f"[fence] stopped after {time.monotonic() - began:.0f} s")
    except SystemExit as gave_up:
        wrong(str(gave_up))
    DRIVE.shot(page, f"{engine}/01-fence", caret="initial")

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

def block(page: Page) -> None:
    page.evaluate("() => document.querySelector('.embed-html')?.scrollIntoView({ block: 'center' })")
    page.wait_for_timeout(400)
    page.click(".embed-html")
    page.wait_for_timeout(5000)
    if not answers(page, "once the block was pressed"):
        return
    typed_lands(page, " typed after the block")

    frame = block_frame(page)
    said = frame.evaluate("() => document.getElementById('dial')?.textContent") if frame else None
    say(f"[block] the dial says {said!r}")
    if said != "it began":
        wrong(f"the block did not run up to its loop: the dial says {said!r}")
    DRIVE.shot(page, f"{engine}/02-block", caret="initial")

def made_frame(page: Page) -> Frame | None:
    for frame in page.frames:
        if frame is page.main_frame:
            continue
        try:
            if frame.evaluate("() => !!document.getElementById('made')"):
                return frame
        except Error:
            continue
    return None

def made(page: Page) -> None:
    card = page.locator(".embed-html").nth(1)
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    card.click()
    page.wait_for_timeout(2000)
    if not answers(page, "once the block of made code was pressed"):
        return
    frame = made_frame(page)
    said = frame.evaluate("() => document.getElementById('made')?.textContent") if frame else None
    say(f"[made] the block says {said!r}")
    if said != "EvalError EvalError EvalError":
        wrong(f"code made from text was not refused: the block says {said!r}")
    if frame:
        frame.click("button")
        page.wait_for_timeout(1500)
        if answers(page, "once the button with a looping handler was pressed"):
            typed_lands(page, " typed after the press")
    DRIVE.shot(page, f"{engine}/03-made", caret="initial")

def frame_with(page: Page, element: str) -> Frame | None:
    for frame in page.frames:
        if frame is page.main_frame:
            continue
        try:
            if frame.evaluate("(id) => !!document.getElementById(id)", element):
                return frame
        except Error:
            continue
    return None

def refused(page: Page, index: int, element: str, said: str, what: str) -> None:
    card = page.locator(".embed-html").nth(index)
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    card.click()
    page.wait_for_timeout(2500)
    if not answers(page, f"once the block {what} was pressed"):
        return
    typed_lands(page, f" typed after the block {what}")
    frame = frame_with(page, element)
    found = frame.evaluate("(id) => document.getElementById(id)?.textContent", element) if frame else None
    say(f"[{element}] the block says {found!r}")
    if found != said:
        wrong(f"the block {what} says {found!r}, not {said!r}")
    DRIVE.shot(page, f"{engine}/04-{element}", caret="initial")

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page, origin=ORIGIN)
    say(f"the space holds {page.evaluate(SEED, [NOTE, 'Endless'])}")
    DRIVE.wait_for(page, "window.orden && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)

    fence(page)
    block(page)
    made(page)
    refused(page, 2, "pattern", "nothing yet", "with a pattern that backtracks without end")
    refused(page, 3, "madepattern", "SyntaxError SyntaxError SyntaxError", "that makes its patterns as it runs")
    refused(page, 4, "nested", "made a frame", "that makes a frame of its own")
    refused(page, 5, "reached", "SecurityError SecurityError SecurityError", "that reaches into a frame it makes")
    context.close()

def main() -> int:
    global engine, ORIGIN

    asked = sys.argv[sys.argv.index("--engine") + 1] if "--engine" in sys.argv else None
    if asked is None and harness.WEBKIT:
        asked = "webkit"
    engines = [one for one in ENGINES if asked in (None, one)]
    if not engines:
        raise SystemExit(f"no engine called {asked}; the drive knows {', '.join(ENGINES)}")

    with DRIVE.session(playwright=True) as play:
        DRIVE.header("Content-Security-Policy", policy())
        for engine in engines:
            say(f"-- {engine} --")
            if engine != "chrome" and DRIVE.server is not None:
                ORIGIN = DRIVE.server.origin("127.0.0.1")
            browser = DRIVE.browser(play) if engine == "chrome" else harness.answering(play.webkit.launch())
            try:
                drive(browser)
            finally:
                browser.close()

    return DRIVE.verdict("code that never ends never takes the app with it")

if __name__ == "__main__":
    raise SystemExit(main())
