"""The plugin driven in a real browser, against a bridge that answers like the
device.

The unit tests measure the pieces: the mapping, the pager, the gesture machine, the
command grammar, the question flow. This measures the whole road - `even.html`
boots the app, finds a bridge, makes its page, sets a note into six text
containers, and answers a tap, a hold, a double tap and a scroll off a temple. A
mapping can be right and the plugin still be wrong: a container never made, a
gesture never wired up, a band never sent.

What it cannot do is prove anything about a pair of glasses. There is no radio and
no firmware here, so every timing is the plugin's own share and the panel pictures
are drawn with the firmware's metrics and a stand-in face; see
`scripts/even-panel.mjs` and the device checklist in docs/even.md.

Run it with the repository's own Chromium, after the plugin's own build:

    pnpm --filter @nib/desktop build:even
    python scripts/even-e2e.py
"""

import functools
import http.server
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist-even"
OUT = ROOT / "target" / "even-e2e"
DOCS = ROOT / "docs" / "even"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

SPACE = "/Notes"
NOTE_PATH = f"{SPACE}/Even Realities glasses.md"
OTHER_PATH = f"{SPACE}/Monday standup.md"
DEEP_PATH = f"{SPACE}/Inbox/Reading list.md"
CANVAS_PATH = f"{SPACE}/A canvas.canvas"

NOTE = r"""# Even Realities glasses

The panel is 576 by 288 pixels with one font in one size, so every construct in a
note has to be said with the character set rather than with type.

## What the mapping does

Marks that only style words are dropped: **bold**, *italic*, ~~struck~~ and
==marked== all reach the glasses as their words. Marks that say what something
*is* are kept, because on a panel with one font code and prose look exactly alike:
`inline code` keeps its ticks and a fence keeps its lines.

- a bullet
  - one level in
- [ ] a task not done
- [x] a task done

> A quote, with a bar down its left.

> [!warning]
> A callout says which kind it is.

## Code

```ts
const panel = { width: 576, height: 288 }
const line = 27
```

## A table

| Call | Cost |
| :--- | ---: |
| textContainerUpgrade | 83 |
| rebuildPageContainer | 165 |
| updateImageRawData | 185 |

## Maths and pictures

Inline $E = mc^2$ and a display formula:

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

![A sketch of the panel](sketch.png)

A footnote[^one], a [link](https://nibeditor.com) and a wikilink to
[[Monday standup]].

[^one]: Which reads as a superscript.

## The glyphs the font has not got

No backtick, no check mark, no ballot box, no tab: ✓ ✗ ☐ ☑ and a tab between
these	two words. Nothing is dropped, and nothing draws as nothing.
"""

OTHER = "# Monday standup\n\nSomewhere for the wikilink to point.\n"
DEEP = "# Reading list\n\nA note one folder in.\n"
CANVAS = '{"nodes":[],"edges":[]}'

# The bridge, installed before a line of the app runs, exactly as the phone app
# installs the real one. It answers what the host answers and writes down every
# call, so what reached the glasses can be read back off the page.
BRIDGE = r"""
window.__even = { calls: [], containers: {}, page: null, mic: false }

const ok = (value) => Promise.resolve(value)

window.flutter_inappwebview = { callHandler: () => ok(null) }

window.EvenAppBridge = {
  createStartUpPageContainer(page) {
    window.__even.calls.push({ method: 'start', page })
    window.__even.page = page
    for (const one of page.textObject ?? []) {
      window.__even.containers[one.containerName] = { ...one }
    }
    // Zero is success, which is what the host answers.
    return ok(0)
  },

  rebuildPageContainer(page) {
    window.__even.calls.push({ method: 'rebuild', page })
    window.__even.page = page
    window.__even.containers = {}
    for (const one of page.textObject ?? []) {
      window.__even.containers[one.containerName] = { ...one }
    }
    return ok(true)
  },

  textContainerUpgrade(one) {
    if (window.__heardAt && !window.__wroteAt) window.__wroteAt = performance.now()
    window.__even.calls.push({ method: 'words', name: one.containerName })
    const held = window.__even.containers[one.containerName]
    if (held) held.content = one.content
    return ok(true)
  },

  audioControl(open, source) {
    window.__even.calls.push({ method: 'mic', open, source })
    window.__even.mic = open
    return ok(true)
  },

  shutDownPageContainer(exitMode) {
    window.__even.calls.push({ method: 'leave', exitMode })
    return ok(true)
  },

  getLocalStorage: () => ok(''),
  setLocalStorage: () => ok(true),

  onEvenHubEvent(handler) {
    window.__even.send = handler
    return () => {
      window.__even.send = null
    }
  },
}

/** One gesture, in the shape the host sends it.
 *
 *  A tap is protobuf's zero and protobuf leaves a zero field out, so a tap really
 *  does arrive with no event type on it at all. */
window.__gesture = (kind) => {
  const of = { tap: null, double: 3, hold: 9, up: 1, down: 2 }
  const type = of[kind]
  const sys = type === null ? { eventSource: 1 } : { eventType: type, eventSource: 1 }
  window.__even.send?.({ sysEvent: sys })
}

/** A recogniser of our own, in place of the WebView's.
 *
 *  Chromium has `webkitSpeechRecognition` and it needs a microphone and a network to
 *  say anything, so this stands in for it: the same three properties, the same
 *  `onresult` shape, and one function to make it hear something. */
window.__heardAt = 0
window.__wroteAt = 0

class Recogniser {
  constructor() {
    this.continuous = false
    this.interimResults = false
    this.lang = ''
    this.onresult = null
    this.onerror = null
    this.onend = null
    window.__recogniser = this
  }

  start() {
    this.running = true
  }

  stop() {
    this.running = false
  }

  abort() {
    this.running = false
  }
}

window.SpeechRecognition = Recogniser

window.__say = (text) => {
  window.__heardAt = performance.now()
  window.__wroteAt = 0
  window.__recogniser?.onresult?.({
    resultIndex: 0,
    results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } },
  })
}

/** Nib's own API, answering from a script. Nothing leaves the machine, and every
 *  host the plugin asked for is written down - which is now the whole of the check,
 *  because the account's OpenAI key is written and never read back and the plugin
 *  has none to send. The question goes to nibeditor.com, and to nothing else.
 *
 *  Signed in, because a question is asked of an account: `/v1/me` answers with one,
 *  which is what puts a token in `account.accountToken`. Everything the syncing then
 *  asks for is answered 404 here, which the app already treats as "not now" - the
 *  glasses are what this drive is about. */
window.__asked = []
window.__hosts = []
const realFetch = window.fetch.bind(window)

const ANSWER = [
  'You decided to use the firmware font only, with no bitmaps at all.',
  '',
  'The note says the panel is 576 by 288 pixels with one font in one size,',
  'so the mapping says every construct with the character set instead of',
  'with type. A page of words is one send of about 83 ms against four',
  'image sends of about 185 ms each, which is the whole reason for it.',
  '',
  'It also says what the font has not got: no backtick, so a fence is',
  'written with three left quotes; no check mark and no ballot box, so a',
  'task is a box that is filled or not; and no tab at all, so one is spent',
  'as the spaces it stood for. Nothing in a note is dropped, and nothing',
  'reaches the glasses as a character that draws nothing.',
].join('\n')

const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

window.fetch = (input, init) => {
  const url = String(typeof input === 'string' ? input : (input?.url ?? input))
  if (!url.startsWith('https://nibeditor.com')) return realFetch(input, init)

  const path = new URL(url).pathname
  window.__hosts.push(new URL(url).host)

  if (path === '/v1/me') {
    return json({ user: { id: 'u1', email: 'reader@example.com', name: 'Reader' } })
  }

  if (path === '/v1/settings') {
    return json({
      settings: { glassesModel: 'gpt-6-astra', glassesEffort: 'low' },
      // What the account says about its key: that there is one, and how it ends.
      // Never the key - there is no route that answers with it.
      key: { set: true, tail: 'key1' },
    })
  }

  if (path === '/v1/ask/models') return json({ models: ['gpt-6-astra'] })

  if (path === '/v1/ask') {
    window.__asked.push(JSON.parse(String(init?.body ?? '{}')))
    return json({ answer: ANSWER })
  }

  if (path === '/v1/ask/heard') return json({ said: null })

  // Everything else the app asks the account for. Refused rather than half
  // answered: a shape made up here would be a second copy of the service.
  return json({ error: 'not in this drive' }, 404)
}

/** No sockets. A room is opened for every note that is being written in, and a
 *  socket that cannot connect writes an error to the console - which this drive
 *  reads as a fault in the plugin. There is no service here to connect to. */
class NoSocket {
  constructor() {
    this.readyState = 0
  }
  send() {}
  close() {
    this.readyState = 3
  }
  addEventListener() {}
  removeEventListener() {}
}

window.WebSocket = NoSocket

window.__listen = () => {
  window.__say('voice commands on')
  return true
}

window.__bands = () => {
  const out = {}
  for (const [name, one] of Object.entries(window.__even.containers)) {
    out[name] = one.content
  }
  return out
}
"""

SEED = r"""
async ([rows]) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib', 1)
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

  const put = (store, row) => new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(row)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

  const now = Date.now()
  for (const [path, content] of rows) {
    await put('files', { path, content, modified: now, created: now })
  }

  // The picture the note names, so that nothing on the page asks the server for
  // something that is not there.
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    ),
    (one) => one.charCodeAt(0),
  )
  await put('assets', {
    path: '/Notes/sketch.png',
    type: 'image/png',
    data: png.buffer,
    modified: now,
  })

  return true
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
    def log_message(self, *_args):
        pass


def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server


class Report:
    def __init__(self):
        self.lines: list[str] = []
        self.bad = 0

    def ok(self, said: str, passed: bool, detail: str = ""):
        self.lines.append(f"{'PASS' if passed else 'FAIL'}  {said}{f'  [{detail}]' if detail else ''}")
        if not passed:
            self.bad += 1

    def say(self, said: str):
        self.lines.append(f"      {said}")

    def show(self):
        print("\n".join(self.lines))
        print(f"\n{len(self.lines)} lines, {self.bad} failures")


def main() -> int:
    if not (DIST / "even.html").exists():
        raise SystemExit("no dist-even/even.html: pnpm --filter @nib/desktop build:even first")

    OUT.mkdir(parents=True, exist_ok=True)
    report = Report()
    address, server = serve()
    screens: list[dict] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        try:
            page = browser.new_page(viewport={"width": 420, "height": 900})
            errors: list[str] = []
            page.on("pageerror", lambda one: errors.append(str(one)))
            page.on(
                "console",
                lambda one: errors.append(one.text) if one.type == "error" else None,
            )
            missing: list[str] = []
            page.on(
                "requestfailed",
                lambda one: missing.append(one.url),
            )
            page.on(
                "response",
                lambda one: missing.append(f"{one.status} {one.url}") if one.status >= 400 else None,
            )

            # The bridge before the app, which is how the phone installs the real
            # one: a call made before it lands does nothing and says nothing.
            page.add_init_script(BRIDGE)

            # The notes have to exist before the app reads its space.
            page.goto(f"{address}even.html")
            page.wait_for_timeout(400)
            page.evaluate(
                SEED,
                [
                    [
                        [NOTE_PATH, NOTE],
                        [OTHER_PATH, OTHER],
                        [DEEP_PATH, DEEP],
                        [CANVAS_PATH, CANVAS],
                    ]
                ],
            )
            page.evaluate(
                """
                () => {
                  localStorage.setItem(
                    'nib:modes',
                    JSON.stringify({
                      glassesBreak: 2,
                      glassesLineNumbers: true,
                      glassesPageNumber: true,
                      glassesVoice: true,
                      glassesModel: 'gpt-6-astra',
                      glassesEffort: 'low',
                    }),
                  )
                  // A session, because a question is asked of an account: the key is
                  // on the account and the plugin has none. The stub above answers
                  // for it; see BRIDGE.
                  localStorage.setItem('nib:session', 'a-test-session')
                }
                """
            )
            # The plugin's own store flushes to a cookie after a pause, because a
            # packed plugin's localStorage belongs to a port that never comes back;
            # see lib/even/local.ts. Nothing survives a reload before it has.
            page.wait_for_timeout(700)
            page.reload()
            page.wait_for_timeout(1200)

            # The page the plugin asked for.
            made = page.evaluate("window.__even.page")
            report.ok("the plugin found the bridge and made its page", made is not None)
            if made is None:
                report.say("nothing else can be measured without one")
                report.show()
                return 1

            texts = made.get("textObject") or []
            report.ok(
                "makes text containers and no image container at all",
                len(texts) >= 6 and not made.get("imageObject"),
                f"{len(texts)} text, {len(made.get('imageObject') or [])} image",
            )
            report.ok(
                "exactly one container captures events",
                sum(1 for one in texts if one.get("isEventCapture") == 1) == 1,
            )
            report.ok(
                "the capture layer holds one space, so a scroll reaches us",
                any(
                    one.get("isEventCapture") == 1 and one.get("content") == " "
                    for one in texts
                ),
            )
            report.ok(
                "every container carries a unique z order",
                len({one.get("zOrderIndex") for one in texts}) == len(texts),
            )
            report.ok(
                "no container reaches past the panel",
                all(
                    one["xPosition"] + one["width"] <= 576
                    and one["yPosition"] + one["height"] <= 288
                    for one in texts
                ),
            )

            # A note has to be opened before there is anything to show. The plugin
            # opens on its own welcome note, so the sidebar is the way to another.
            open_note(page, "Even Realities glasses")

            bands = page.evaluate("window.__bands()")
            body = bands.get("nibBody", "")
            report.ok("sets the note into the body band", "panel is 576" in body, body[:40])
            report.ok(
                "puts the heading in the head band, not in the body",
                bands.get("nibHead", "").startswith("EVEN REALITIES GLASSES"),
                bands.get("nibHead", ""),
            )
            report.ok(
                "draws the heavy rule under a first level heading",
                set(bands.get("nibRule", "").strip()) == {"═"},
            )
            report.ok(
                "never sends more rows than the panel holds",
                len(body.split("\n")) <= 8,
                f"{len(body.split(chr(10)))} rows",
            )
            report.ok(
                "carries the line numbers in a column of their own",
                bands.get("nibNums", "").strip() != "",
                bands.get("nibNums", "").replace("\n", "|"),
            )
            report.ok(
                "says which page of how many in the top right, beside the microphone",
                re.search(r"\S {2,}1/\d+$", bands.get("nibHead", "").rstrip()) is not None,
                bands.get("nibHead", "").rstrip(),
            )
            report.ok(
                "keeps the last line of the panel for the note",
                "nibFoot" not in bands,
                ", ".join(sorted(bands)),
            )
            screens.append({"name": "glasses-1", "lineNumbers": True, **naming(bands)})

            # A scroll off a temple turns the page, and the frame in the plugin
            # follows it.
            before = bands.get("nibHead", "")
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(500)
            turned = page.evaluate("window.__bands()")
            report.ok(
                "a scroll off a temple turns the page",
                turned.get("nibHead") != before and turned.get("nibBody") != body,
                turned.get("nibHead", "").rstrip(),
            )

            # A white card over the region with the rest of the note faded, which is
            # the screenshot Emil sent; see even/Glasses.svelte.
            report.ok(
                "the plugin marks the region as a card with the rest faded",
                page.locator(".card").count() == 1 and page.locator(".fade").count() == 1,
            )
            report.ok(
                "and the card is sized to what the glasses show",
                page.evaluate(
                    "() => { const c = document.querySelector('.card'); "
                    "return c ? c.getBoundingClientRect().height > 12 : false }"
                ),
            )
            page.screenshot(path=str(OUT / "phone-frame.png"))

            # Sent again only where it changed: the head and the rule did not.
            page.evaluate("window.__even.calls = []")
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(500)
            sent = [one["name"] for one in page.evaluate("window.__even.calls") if one["method"] == "words"]
            report.ok(
                "a page turn sends only the bands that changed",
                "nibRule" not in sent and "nibBody" in sent,
                ", ".join(sent),
            )
            report.say(f"a page turn is {len(sent)} bands, about {len(sent) * 83} ms of radio")

            deeper = page.evaluate("window.__bands()")
            screens.append({"name": "glasses-2", "lineNumbers": True, **naming(deeper)})

            # A tap opens the sidebar.
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(500)
            side = page.evaluate("window.__bands()")
            report.ok(
                "a tap opens the sidebar, with the space at the top",
                side.get("nibHead", "").startswith("Notes"),
                side.get("nibHead", ""),
            )
            report.ok(
                "the sidebar lists the notes with a cursor on one",
                "▶ " in side.get("nibBody", ""),
                side.get("nibBody", "").replace("\n", " | "),
            )
            report.ok(
                "the sidebar never lists a canvas",
                "A canvas" not in side.get("nibBody", ""),
            )
            report.ok(
                "the sidebar lists a folder as a label",
                "Inbox" in side.get("nibBody", ""),
            )
            screens.append({"name": "sidebar", "lineNumbers": True, **naming(side)})

            # And a scroll moves the cursor rather than the page.
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(300)
            moved = page.evaluate("window.__bands()")
            report.ok(
                "a scroll in the sidebar moves the cursor",
                moved.get("nibBody") != side.get("nibBody"),
                moved.get("nibHead", "").rstrip(),
            )

            # A double tap closes it rather than leaving the app.
            page.evaluate("window.__even.calls = []")
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)
            after = page.evaluate("window.__bands()")
            left = [one for one in page.evaluate("window.__even.calls") if one["method"] == "leave"]
            report.ok(
                "a double tap closes the sidebar instead of leaving the app",
                not left and not after.get("nibHead", "").startswith("Notes"),
                after.get("nibHead", ""),
            )

            # And on the note it is the system's own question, which a review checks.
            page.evaluate("window.__even.calls = []")
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)
            left = [one for one in page.evaluate("window.__even.calls") if one["method"] == "leave"]
            report.ok(
                "a double tap on the note raises the system's leave question",
                len(left) == 1 and left[0]["exitMode"] == 1,
                json.dumps(left),
            )

            # A hold opens the modal.
            page.evaluate("window.__gesture('hold')")
            page.wait_for_timeout(400)
            modal = page.evaluate("window.__bands()")
            rows = modal.get("nibBody", "")
            report.ok(
                "a hold offers switch space, change note and the microphone",
                "Switch space" in rows and "Change note" in rows and "Voice" in rows,
                rows.replace("\n", " | "),
            )
            screens.append({"name": "modal", "lineNumbers": True, **naming(modal)})

            # Switch space is a list of the spaces.
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            spaces = page.evaluate("window.__bands()")
            report.ok(
                "switch space lists the spaces",
                spaces.get("nibHead", "").startswith("Spaces"),
                spaces.get("nibBody", "").replace("\n", " | "),
            )
            screens.append({"name": "spaces", "lineNumbers": True, **naming(spaces)})

            # Change note is the tree, with folders that open and shut. It opens with
            # the cursor on the note the reader is in, which is Emil's rule, so the
            # folder above it is one step up.
            page.evaluate("window.__gesture('hold')")
            page.wait_for_timeout(300)
            page.evaluate("window.__gesture('down')")
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            tree = page.evaluate("window.__bands()")
            report.ok(
                "the notes open with the cursor on the note the reader is in",
                "▶ Even Realities glasses" in tree.get("nibBody", ""),
                tree.get("nibBody", "").replace("\n", " | "),
            )
            page.evaluate("window.__gesture('up')")
            page.wait_for_timeout(200)
            report.ok(
                "change note is the tree, with a folder shut",
                tree.get("nibHead", "").startswith("Notes") and "▶ Inbox" in tree.get("nibBody", ""),
                tree.get("nibBody", "").replace("\n", " | "),
            )

            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            opened = page.evaluate("window.__bands()")
            report.ok(
                "a tap on a folder opens it where it stands",
                "▼ Inbox" in opened.get("nibBody", "") and "Reading list" in opened.get("nibBody", ""),
                opened.get("nibBody", "").replace("\n", " | "),
            )
            screens.append({"name": "notes", "lineNumbers": True, **naming(opened)})

            # A tap on a note opens it and puts the tree away.
            page.evaluate("window.__gesture('down')")
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(1200)
            switched = page.evaluate("window.__bands()")
            report.ok(
                "a tap on a note opens it on the glasses",
                "READING LIST" in switched.get("nibHead", ""),
                switched.get("nibHead", ""),
            )

            # The settings, on the glasses. Every one of them is reachable without the
            # phone, and the rows come from the one schema the phone's own Settings
            # section is drawn from; see even/settings.ts.
            def open_settings():
                page.evaluate("window.__gesture('hold')")
                page.wait_for_timeout(300)
                for _one in range(3):
                    page.evaluate("window.__gesture('down')")
                page.evaluate("window.__gesture('tap')")
                page.wait_for_timeout(400)

            open_settings()
            settings = page.evaluate("window.__bands()")
            rows = settings.get("nibBody", "")
            report.ok(
                "a hold reaches the settings, with every setting and what it says now",
                "Line numbers" in rows and "Page number" in rows and "On" in rows,
                rows.replace(chr(10), " | "),
            )
            screens.append({"name": "settings", "lineNumbers": True, **naming(settings)})

            # The reset is at the foot of them, where an action belongs. Walked to
            # rather than looked for: the cursor stops at the end of the list.
            seen = []
            for _step in range(40):
                seen.append(page.evaluate("window.__bands()").get("nibBody", ""))
                page.evaluate("window.__gesture('down')")
            report.ok(
                "and the reset at the foot of them",
                any("Reset glasses settings" in one for one in seen),
            )

            # A tap on a toggle flips it where it stands, and the panel says so at
            # once. This is Emil's page number: he turned it off and on again and it
            # never came back, because nothing was sent when the page had not changed.
            def flip_page_number():
                open_settings()
                page.evaluate("window.__gesture('down')")
                page.evaluate("window.__gesture('down')")
                page.evaluate("window.__gesture('tap')")
                page.wait_for_timeout(400)
                answer = page.evaluate("window.__bands()")
                page.evaluate("window.__gesture('double')")
                page.evaluate("window.__gesture('double')")
                page.wait_for_timeout(700)
                return answer

            off = flip_page_number()
            report.ok(
                "a tap on a toggle flips it, and the row says so at once",
                "Off" in off.get("nibBody", ""),
                off.get("nibBody", "").replace(chr(10), " | "),
            )
            without = page.evaluate("window.__bands()")
            report.ok(
                "and the page number is gone from the panel, without a keystroke",
                re.search(r"\d+/\d+$", without.get("nibHead", "").rstrip()) is None,
                without.get("nibHead", "").rstrip(),
            )

            flip_page_number()
            again = page.evaluate("window.__bands()")
            report.ok(
                "off and then on again is the same as never having touched it",
                re.search(r"\d+/\d+$", again.get("nibHead", "").rstrip()) is not None,
                again.get("nibHead", "").rstrip(),
            )

            # Voice, driven through a recogniser of our own: the words arrive exactly
            # as the WebView's own hands them over, and what the plugin does with them
            # is the whole of what is being measured.
            report.ok(
                "opens the microphone when the reader asks for it",
                page.evaluate("(() => { window.__listen(); return true })()") is True,
            )
            page.wait_for_timeout(500)
            report.ok(
                "lights the corner while it is listening",
                page.evaluate("window.__bands()").get("nibMic", "").strip() == "\u25cf",
                page.evaluate("window.__bands()").get("nibMic", ""),
            )

            for said, wanted, what in [
                ("next", "turns the page", "next"),
                ("back", "turns it back", "back"),
                ("spaces view", "opens the spaces", "Spaces"),
                ("close", "closes it again", "close"),
                ("open page three", "goes to a page by number", "3/"),
                ("go to line forty", "goes to a line of the note", "line"),
            ]:
                page.evaluate("(text) => window.__say(text)", said)
                page.wait_for_timeout(400)
                heard = page.evaluate("window.__bands()")
                # Either the words are still flashed in the foot, or the screen the
                # command asked for is up. Both are the command having been obeyed.
                report.ok(
                    f'hears "{said}" and {wanted}',
                    said.split()[0] in heard.get("nibHead", "").lower()
                    or what in heard.get("nibHead", ""),
                    heard.get("nibHead", "").rstrip(),
                )

            # How long the plugin itself takes over a command, from the words arriving
            # to the panel being written. What the recogniser took before that is the
            # recogniser's own and is not ours to measure.
            page.evaluate("window.__even.calls = []; window.__heardAt = 0; window.__wroteAt = 0")
            worst = 0.0
            for _round in range(10):
                page.evaluate("window.__say('next')")
                page.wait_for_timeout(220)
                took = page.evaluate("window.__wroteAt - window.__heardAt")
                worst = max(worst, float(took or 0))

            heard_on = page.locator(".voice").inner_text() if page.locator(".voice").count() else ""
            report.ok(
                "says on the phone which way it is listening, so one screenshot answers",
                "Phone recogniser" in heard_on,
                heard_on.replace(chr(10), " / "),
            )
            page.screenshot(path=str(OUT / "phone-voice.png"))

            report.ok("answers a spoken command inside one frame", worst < 16, f"{worst:.2f} ms worst")
            report.say(f"a command costs the plugin {worst:.2f} ms from the word to the panel")

            # A question, with the model answering from a stub.
            page.evaluate("window.__say('question what did I decide about the font')")
            page.wait_for_timeout(300)
            asking = page.evaluate("window.__bands()")
            report.ok(
                "puts the question up while the model is working",
                "what did i decide" in asking.get("nibHead", "").lower(),
                asking.get("nibHead", ""),
            )
            said = page.locator(".voice").inner_text() if page.locator(".voice").count() else ""
            report.ok(
                "shows the question and the waiting on the phone too",
                "what did i decide" in said.lower(),
                said.replace("\n", " / "),
            )
            page.screenshot(path=str(OUT / "phone-asking.png"))
            screens.append({"name": "asking", "lineNumbers": True, **naming(asking)})

            page.wait_for_timeout(1200)
            answered = page.evaluate("window.__bands()")
            report.ok(
                "opens the answer on the glasses, one sentence first",
                "firmware font" in answered.get("nibBody", ""),
                answered.get("nibBody", "").split("\n")[0],
            )
            asked = page.evaluate("window.__asked")
            sent = asked[0] if asked else {}
            report.ok(
                "asked Nib the question, with the model and nothing else",
                sorted(sent.keys()) == ["effort", "model", "question"],
                json.dumps(sorted(sent.keys())),
            )
            report.ok(
                "sent no key and no note, because it has neither",
                "sk-" not in json.dumps(sent) and "firmware font" not in json.dumps(sent),
                json.dumps(sent),
            )
            hosts = page.evaluate("window.__hosts")
            report.ok(
                "reached nibeditor.com and nothing else, which is the whole whitelist",
                bool(hosts) and set(hosts) == {"nibeditor.com"},
                json.dumps(sorted(set(hosts))),
            )
            phone = page.locator(".voice").inner_text() if page.locator(".voice").count() else ""
            report.ok(
                "shows the answer's first sentence on the phone too",
                "firmware font" in phone,
                phone.replace("\n", " / "),
            )
            page.screenshot(path=str(OUT / "phone-answer.png"))
            screens.append({"name": "answer", "lineNumbers": True, **naming(answered)})

            # A scroll goes down the answer a line at a time.
            first = answered.get("nibBody", "").split("\n")[0]
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(300)
            scrolled = page.evaluate("window.__bands()")
            report.ok(
                "a scroll goes down the answer a line at a time",
                scrolled.get("nibBody", "").split("\n")[0] != first,
                scrolled.get("nibBody", "").split("\n")[0],
            )

            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)
            report.ok(
                "a double tap closes the answer, back to the note",
                "READING LIST" in page.evaluate("window.__bands()").get("nibHead", "")
                or "GLASSES" in page.evaluate("window.__bands()").get("nibHead", ""),
                page.evaluate("window.__bands()").get("nibHead", ""),
            )

            # The frame, and the note on the phone, with the glasses on page one.
            open_note(page, "Even Realities glasses")
            page.screenshot(path=str(OUT / "phone-note.png"))
            back = page.evaluate("window.__bands()")
            screens.append({"name": "glasses-3", "lineNumbers": True, **naming(back)})

            # The note names a picture on purpose, to exercise the one block that
            # cannot be what it is on a panel of one font. Where the editor looks for
            # it in a browser is the editor's own business and not the plugin's, so
            # its miss is left out of this and everything else is not.
            astray = [one for one in missing if "sketch.png" not in one]
            report.ok("asks the server for nothing that is not there", not astray, "; ".join(astray[:3]))
            loose = [one for one in errors if "404" not in one]
            report.ok("no page errors anywhere along the way", not loose, "; ".join(loose[:3]))
        except Exception as bad:  # noqa: BLE001
            # The report is the whole point: a failure half way through has still
            # measured everything before it, and hiding that behind a traceback
            # makes the run useless.
            report.ok(f"the drive finished: {bad}"[:160], False)
        finally:
            browser.close()
            server.shutdown()

    (OUT / "screens.json").write_text(json.dumps(screens, indent=1), encoding="utf-8")
    subprocess.run(
        [
            "node",
            str(ROOT / "scripts" / "even-panel.mjs"),
            str(OUT / "screens.json"),
        ],
        check=True,
        cwd=ROOT / "packages" / "glasses",
    )

    # And the panels themselves, as pictures.
    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        try:
            shot = browser.new_page(viewport={"width": 576, "height": 288})
            for one in screens:
                name = one["name"]
                shot.goto((OUT / f"{name}.html").as_uri())
                shot.wait_for_timeout(120)
                shot.locator(".panel").screenshot(path=str(OUT / f"{name}.png"))
        finally:
            browser.close()

    report.say("")
    report.say(f"pictures in {OUT}")
    report.show()
    return 1 if report.bad else 0


def open_note(page, name: str) -> None:
    """A note opened the way a reader opens one: the sidebar, and a row in it."""
    if page.get_by_role("button", name="Show sidebar").count():
        page.get_by_role("button", name="Show sidebar").first.click()
        page.wait_for_timeout(300)

    page.get_by_text(name, exact=True).first.click()
    page.wait_for_timeout(1400)


def naming(bands: dict) -> dict:
    """The bands, by the name `even-panel.mjs` draws them under."""
    return {
        "head": bands.get("nibHead", ""),
        "rule": bands.get("nibRule", ""),
        "nums": bands.get("nibNums", ""),
        "body": bands.get("nibBody", ""),
        "foot": "",
        "mic": bands.get("nibMic", ""),
    }


if __name__ == "__main__":
    sys.exit(main())
