from __future__ import annotations

import base64
import json
import struct
import zlib

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin

PHONE = {"width": 420, "height": 880}
AGENT = (
    "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

def png(width: int, height: int, tint: tuple[int, int, int]) -> bytes:

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body))
        )

    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.append(tint[0] * (x + 1) // width)
            rows.append(tint[1] * (y + 1) // height)
            rows.append(tint[2])

    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", head)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )

SHARED_PICTURE = png(240, 160, (250, 120, 60))
TAKEN_PHOTO = png(200, 200, (90, 180, 250))

ACTIVITY = """
() => {
  const held = {
    shared: '',
    handed: '{"command":"","open":""}',
    bytes: {},
    dictates: false,
    word: 'this launch, and no frame in it',
    said: { widgets: [], done: Number(sessionStorage.getItem('handed-done') ?? 0), listen: [] },
  }
  window.__android = held

  const slice = (base64, offset, length) => {
    const binary = atob(base64)
    const cut = binary.slice(offset, offset + length)
    return cut ? btoa(cut) : ''
  }

  window.__ORDEN_SYSTEM__ = {
    insets: () => '{"top":24,"right":0,"bottom":48,"left":0}',
    // Into the page itself, whoever asked, which is what makes it a word only the
    // page has: the activity runs this line in the main frame.
    askForTheFrame: () => window.__nibFrame?.(held.word),
    bars: () => undefined,
    handed: (said) => {
      if (said !== held.word) return ''
      const answer = held.handed
      held.handed = '{"command":"","open":""}'
      return answer
    },
    shared: (said) => (said === held.word ? held.shared : ''),
    sharedBytes: (said, at, offset, length) =>
      said === held.word ? slice(held.bytes[at] ?? '', offset, length) : '',
    sharedDone: (said) => {
      if (said !== held.word) return
      held.shared = ''
      held.said.done++
      sessionStorage.setItem('handed-done', String(held.said.done))
    },
    widgets: (said, json) => {
      if (said === held.word) held.said.widgets.push(json)
    },
    dictates: () => held.dictates,
    listen: (said, on) => {
      if (said !== held.word) return false
      held.said.listen.push(on)
      return on
    },
  }
}
"""

SPEECH = """
() => {
  class Fake {
    constructor() {
      this.continuous = false
      this.interimResults = true
      this.lang = ''
      this.onresult = null
      this.onerror = null
      this.onend = null
      window.__speech = this
      this.started = 0
      this.stopped = 0
    }

    start() {
      this.started++
    }

    stop() {
      this.stopped++
    }

    hear(words, isFinal) {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: words } }] })
    }
  }

  window.SpeechRecognition = Fake
  delete window.webkitSpeechRecognition
}
"""

PICKERS = """
() => {
  window.__pickers = []
  const clicked = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') {
      window.__pickers.push({ accept: this.accept, capture: this.capture })
    }
    return clicked.call(this)
  }
}
"""

SHARE_LINK = {
    "action": "android.intent.action.SEND",
    "subject": "A page worth keeping",
    "items": [
        {"name": "", "mime": "text/plain", "size": 0, "text": "https://example.test/a/plan"},
        {"name": "shot.png", "mime": "image/png", "size": len(SHARED_PICTURE)},
    ],
}

SHARE_WORDS = {
    "action": "android.intent.action.SEND",
    "subject": "",
    "items": [{"name": "", "mime": "text/plain", "size": 0, "text": "one more thing"}],
}

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Handed'))
  await ws.openEntry(found.path, { activate: true })
  return { name: found.name, root: ws.activeSpace.root }
}
"""

NOTE = """# Handed

Words already here.
"""

STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    open: ws.active?.path ?? null,
    name: ws.active?.name ?? null,
    doc: ws.active?.doc ?? '',
    tabs: ws.tabs.length,
    notes: ws.notes.map((one) => one.name),
    files: ws.files.map((one) => one.path),
  }
}
"""

def started(page: Page) -> None:
    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")

def fresh(
    browser: Browser,
    finger: bool,
    share: dict | None = None,
    activity: bool = True,
) -> Page:
    context = browser.new_context(
        service_workers="allow",
        viewport=PHONE if finger else {"width": 1180, "height": 900},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **({"user_agent": AGENT} if finger else {}),
    )
    for one in ((ACTIVITY,) if activity else ()) + (SPEECH, PICKERS):
        context.add_init_script(f"({one})()")

    if share:
        waiting = json.dumps(json.dumps(share))
        bytes_of = json.dumps({"1": base64.b64encode(SHARED_PICTURE).decode()})
        context.add_init_script(
            f"""
            (() => {{
              if (sessionStorage.getItem('handed-once')) return
              sessionStorage.setItem('handed-once', '1')
              window.__android.shared = {waiting}
              window.__android.bytes = {bytes_of}
            }})()
            """
        )

    page = context.new_page()
    DRIVE.choosers(page)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: say(f"console {message.type}: {message.text}")
        if message.type in ("error", "warning")
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    started(page)
    return page

def palette(page: Page, words: str) -> None:
    page.keyboard.press("Control+o")
    page.wait_for_timeout(350)
    page.keyboard.type(f"> {words}")
    page.wait_for_timeout(450)

def rows(page: Page) -> list[dict]:
    return page.evaluate(
        """() => [...document.querySelectorAll('.palette .orden-row')].map((one) => ({
             label: one.querySelector('.orden-row-label')?.textContent?.trim() ?? '',
             dim: one.classList.contains('dim'),
           }))"""
    )

def shared_at_a_cold_start(page: Page) -> str:
    page.wait_for_selector(".sheet .orden-button", timeout=20000)
    page.wait_for_timeout(500)
    shot(page, "01-the-sheet-asks-at-a-cold-start")

    labels = page.evaluate(
        """() => [...document.querySelectorAll('.sheet .orden-button')]
             .map((one) => one.textContent.trim()).filter(Boolean)"""
    )
    say(f"[cold] the sheet offers {labels}")
    if "New note" not in labels:
        wrong(f"the sheet does not offer a note of its own: {labels}")

    page.locator(".sheet").get_by_role("button", name="New note", exact=True).click()

    wait_for(
        page,
        "window.nibApp.workspace.notes.some((one) => one.name.startsWith('A page worth keeping'))",
        "the shared note to land",
        patience=30,
    )
    page.wait_for_timeout(900)

    state = page.evaluate(STATE)
    say(f"[cold] {json.dumps(state)}")

    if not (state["name"] or "").startswith("A page worth keeping"):
        wrong(f"the shared note was not opened: {state['name']!r}")

    doc = state["doc"]
    for wanted in ("source: https://example.test/a/plan", "date: 20", "# A page worth keeping"):
        if wanted not in doc:
            wrong(f"the note does not say {wanted!r}: {doc!r}")

    if "![](assets/shot.png)" not in doc:
        wrong(f"the picture is not drawn in the note: {doc!r}")

    done = page.evaluate("() => window.__android.said.done")
    if done != 1:
        wrong(f"the activity was told {done} times that the copies may go, not once")

    page.reload(wait_until="domcontentloaded")
    started(page)
    wait_for(page, "navigator.serviceWorker.controller", "the worker to take the page over")
    page.evaluate(
        """() => {
             const ws = window.nibApp.workspace
             const found = ws.notes.find((one) => one.name.startsWith('A page worth keeping'))
             return ws.openEntry(found.path, { activate: true })
           }"""
    )
    page.wait_for_timeout(1600)

    drawn = page.evaluate(
        """() => {
             // The editor's own image, and not the empty one-pixel buffers CodeMirror
             // puts either side of every widget it draws.
             const image = document.querySelector('.cm-content img.orden-image')
             if (!image) return null

             // The address as the page resolved it, and as the note wrote it: an
             // `<img>` the resolver has not answered for yet has the second and
             // not the first.
             let where = image.getAttribute('src') ?? ''
             try {
               where = new URL(image.src, location.href).pathname
             } catch {}

             return { src: where, complete: image.complete, width: image.naturalWidth }
           }"""
    )
    say(f"[cold] the picture as the editor drew it: {json.dumps(drawn)}")
    shot(page, "02-shared-at-a-cold-start")

    if not drawn:
        wrong("the shared picture is not in the note at all")
    else:
        if "/asset/" not in drawn["src"] or not drawn["src"].endswith("shot.png"):
            wrong(f"the picture is not beside the note: {drawn['src']}")
        if not drawn["complete"] or drawn["width"] < 1:
            wrong(f"the shared picture did not draw: {drawn}")

    return state["open"]

def shared_while_it_is_open(page: Page) -> None:
    page.evaluate(SEED, NOTE)
    wait_for(page, "window.nib", "the editor")
    page.wait_for_timeout(500)

    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )

    hand(page, SHARE_WORDS)
    page.wait_for_selector(".sheet .orden-button", timeout=10000)
    page.wait_for_timeout(500)
    shot(page, "03-the-sheet-asks")

    labels = page.evaluate(
        """() => [...document.querySelectorAll('.sheet .orden-button')]
             .map((one) => one.textContent.trim()).filter(Boolean)"""
    )
    say(f"[open] the sheet offers {labels}")
    if not any(one.startswith("Add to") for one in labels):
        wrong(f"the sheet does not offer the note in front of you: {labels}")

    page.locator(".sheet").get_by_role("button", name="Add to Handed").click()
    page.wait_for_timeout(900)

    state = page.evaluate(STATE)
    say(f"[open] {json.dumps(state)}")
    shot(page, "04-added-to-the-open-note")

    if not (state["name"] or "").startswith("Handed"):
        wrong(f"the words went somewhere else: {state['name']!r}")
    if "one more thing" not in state["doc"]:
        wrong(f"the words did not land in the note: {state['doc']!r}")
    if state["doc"].count("one more thing") != 1:
        wrong(f"the words landed more than once: {state['doc']!r}")

def dismissing_it_does_nothing(page: Page) -> None:
    before = page.evaluate(STATE)
    hand(page, SHARE_WORDS)
    page.wait_for_selector(".sheet .orden-button", timeout=10000)
    page.wait_for_timeout(400)

    page.keyboard.press("Escape")
    page.wait_for_timeout(900)

    after = page.evaluate(STATE)
    say(f"[dismissed] {json.dumps(after)}")

    if after["doc"] != before["doc"]:
        wrong("dismissing the sheet wrote into the note anyway")
    if len(after["notes"]) != len(before["notes"]):
        wrong(f"dismissing the sheet made a note: {after['notes']}")
    if not page.evaluate("() => window.__android.said.done >= 3"):
        wrong("the activity was never told it could let the dismissed share go")

def hand(page: Page, share: dict) -> None:
    page.evaluate(
        """([shared, bytes]) => {
             window.__android.shared = shared
             window.__android.bytes = bytes
             window.__nibHanded()
           }""",
        [json.dumps(share), {}],
    )
    page.wait_for_timeout(300)

def tile(page: Page, command: str) -> None:
    page.evaluate(
        """(command) => {
             window.__android.handed = JSON.stringify({ command, open: '' })
             window.__nibHanded()
           }""",
        command,
    )

def a_tile_and_a_widget_row(page: Page, note: str) -> None:
    before = page.evaluate(STATE)

    tile(page, "new")
    page.wait_for_timeout(900)
    after = page.evaluate(STATE)
    say(f"[tile] new note: {json.dumps(after)}")
    if after["open"] is not None or after["doc"] != "" or after["name"] == before["name"]:
        wrong(f"the tile did not open a blank note: {json.dumps(after)}")

    palette(page, "Record")
    offered = next((one for one in rows(page) if one["label"] == "Record"), None)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    say(f"[tile] the palette's own Record row: {json.dumps(offered)}")

    quiet = page.evaluate(STATE)
    tile(page, "record")
    page.wait_for_timeout(1200)
    started = page.evaluate(STATE)
    say(f"[tile] after the recorder's tile: {started['name']!r}")
    if offered and not offered["dim"]:
        if started == quiet:
            wrong("the recorder's tile did nothing, though the app has the row")
        tile(page, "record")
        page.wait_for_timeout(900)
    elif started != quiet:
        wrong(f"a greyed Record row did something from a tile anyway: {json.dumps(started)}")

    quiet = page.evaluate(STATE)
    tile(page, "not-a-command")
    page.wait_for_timeout(700)
    if page.evaluate(STATE) != quiet:
        wrong("a command the app does not have did something anyway")

    page.evaluate(
        """(path) => {
             window.__android.handed = JSON.stringify({ command: '', open: path })
             window.__nibHanded()
           }""",
        note,
    )
    page.wait_for_timeout(1000)
    landed = page.evaluate(STATE)
    say(f"[widget] the row opened {landed['name']!r}")
    shot(page, "05-a-widget-row-opened-a-note")
    if landed["open"] != note:
        wrong(f"the widget row opened {landed['open']!r} rather than {note!r}")

def what_the_widget_draws(page: Page) -> None:
    said = page.evaluate("() => window.__android.said.widgets")
    if not said:
        wrong("the home screen was never told anything")
        return

    last = json.loads(said[-1])
    say(f"[widget] {json.dumps(last)}")

    if not last.get("title"):
        wrong(f"the widget has no heading: {last}")
    if not last.get("notes"):
        wrong(f"the widget lists nothing: {last}")
    if any(".md" in one["name"] for one in last["notes"]):
        wrong(f"the widget names notes by their files: {last['notes']}")

    page.evaluate(
        """(row) => {
             const ws = window.nibApp.workspace
             const last = ws.notes.find((one) => one.path.endsWith(row))
             return ws.openEntry(last.path, { activate: true }).then(() =>
               ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: last.path, is_dir: false })),
             )
           }""",
        last["notes"][-1]["path"],
    )
    page.wait_for_timeout(900)

    listed = json.loads(page.evaluate("() => window.__android.said.widgets.at(-1)"))
    kept = page.evaluate("() => window.nibApp.workspace.active.name")
    say(f"[widget] with {kept!r} kept open: {json.dumps(listed)}")
    first = (listed.get("notes") or [{}])[0].get("name")
    if first != kept.replace(".md", ""):
        wrong(f"the kept note is not at the top of the widget: {first!r} rather than {kept!r}")

def the_camera_row(page: Page) -> None:
    page.evaluate(
        """() => {
             const ws = window.nibApp.workspace
             const found = ws.notes.find((one) => one.name.startsWith('Handed'))
             return ws.openEntry(found.path, { activate: true })
           }"""
    )
    page.wait_for_timeout(700)
    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )

    palette(page, "Photo")
    listed = rows(page)
    say(f"[camera] the palette offers {json.dumps(listed[:3])}")
    shot(page, "06-the-camera-row")

    photo = next((one for one in listed if one["label"] == "Photo"), None)
    if not photo:
        wrong("there is no camera row on a phone")
        page.keyboard.press("Escape")
        return
    if photo["dim"]:
        wrong("the camera row is greyed out on a phone")

    with page.expect_file_chooser() as chooser:
        page.keyboard.press("Enter")
    chooser.value.set_files(
        {"name": "photo.png", "mimeType": "image/png", "buffer": TAKEN_PHOTO}
    )
    page.wait_for_timeout(1500)

    asked = page.evaluate("() => window.__pickers")
    say(f"[camera] the chooser it opened: {json.dumps(asked)}")
    if not any(one["capture"] == "environment" for one in asked):
        wrong(f"the row did not ask for the camera: {asked}")
    if not any(one["accept"] == "image/*" for one in asked):
        wrong(f"the row asked for the wrong kind of file: {asked}")

    state = page.evaluate(STATE)
    say(f"[camera] the note now says {state['doc']!r}")
    shot(page, "07-the-photo-in-the-note")
    if "![photo](" not in state["doc"]:
        wrong(f"the photograph was not drawn at the caret: {state['doc']!r}")
    if "assets/" not in state["doc"].split("![photo](")[-1]:
        wrong(f"the photograph did not land beside the note: {state['doc']!r}")

def dictation(page: Page, phone: bool) -> None:
    where = "phone" if phone else "browser"
    palette(page, "Dictate")
    listed = rows(page)
    row = next((one for one in listed if one["label"] == "Dictate"), None)
    say(f"[{where}] the palette offers {json.dumps(listed[:3])}")
    if not row:
        wrong(f"{where}: there is no dictation row")
        page.keyboard.press("Escape")
        return
    if row["dim"]:
        wrong(f"{where}: the dictation row is greyed out")

    page.keyboard.press("Enter")
    page.wait_for_timeout(600)

    if phone:
        asked = page.evaluate("() => window.__android.said.listen")
        say(f"[{where}] the activity was told {json.dumps(asked)}")
        if asked != [True]:
            wrong(f"the phone's recogniser was not asked to listen: {asked}")
        if page.evaluate("() => window.__speech?.started ?? 0"):
            wrong("the web's recogniser was started on a phone that has its own")
    else:
        started_it = page.evaluate("() => window.__speech?.started ?? 0")
        heard = page.evaluate(
            """() => ({
                 continuous: window.__speech.continuous,
                 interim: window.__speech.interimResults,
                 lang: window.__speech.lang,
               })"""
        )
        say(f"[{where}] started {started_it} times, {json.dumps(heard)}")
        if started_it != 1:
            wrong(f"the recogniser was started {started_it} times")
        if not heard["continuous"] or heard["interim"]:
            wrong(f"the recogniser is listening in the wrong shape: {heard}")
        if not heard["lang"]:
            wrong("the recogniser was not told which language to listen in")

    listening = page.evaluate(
        """() => {
             const found = document.querySelector('.track[role=status]')
             return found ? found.getAttribute('aria-label') : null
           }"""
    )
    say(f"[{where}] the line says {listening!r}")
    shot(page, f"08-listening-{where}")
    if listening != "Listening":
        wrong(f"{where}: nothing on screen says it is listening: {listening!r}")

    before = page.evaluate(STATE)["doc"]
    if not phone:
        page.evaluate("() => window.__speech.hear('and then we left', false)")
        page.wait_for_timeout(300)
        if page.evaluate(STATE)["doc"] != before:
            wrong("a half-heard sentence was written into the note")

    if phone:
        page.evaluate(
            """() => window.__nibHeard(JSON.stringify({ state: 'listening', text: 'and then we left' }))"""
        )
    else:
        page.evaluate("() => window.__speech.hear('and then we left', true)")

    page.wait_for_timeout(500)
    state = page.evaluate(STATE)
    say(f"[{where}] the note now says {state['doc']!r}")
    shot(page, f"09-dictated-{where}")
    if "and then we left" not in state["doc"]:
        wrong(f"{where}: what it heard is not in the note: {state['doc']!r}")
    if before and not before.endswith((" ", "\n")) and " and then we left" not in state["doc"]:
        wrong(f"{where}: the sentence was glued onto the last word: {state['doc']!r}")

    palette(page, "Stop")
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)

    if phone:
        asked = page.evaluate("() => window.__android.said.listen")
        say(f"[{where}] the activity was told {json.dumps(asked)}")
        if asked != [True, False]:
            wrong(f"the same row did not turn the phone's recogniser off: {asked}")
    else:
        stopped = page.evaluate("() => window.__speech.stopped")
        say(f"[{where}] stopped {stopped} times")
        if stopped < 1:
            wrong("the same row did not turn it off again")

    quiet = page.evaluate(
        "() => document.querySelector('.track[role=status]')?.getAttribute('aria-label') ?? null"
    )
    say(f"[{where}] the line now says {quiet!r}")
    if quiet == "Listening":
        wrong(f"{where}: the line still says it is listening")

def on_a_desktop(browser: Browser) -> None:
    page = fresh(browser, finger=False, activity=False)
    page.evaluate(SEED, NOTE)
    page.wait_for_timeout(600)

    palette(page, "Photo")
    listed = rows(page)
    say(f"[desktop] the palette offers {json.dumps(listed[:3])}")
    shot(page, "10-no-camera-row-on-a-desktop")

    photo = next((one for one in listed if one["label"] == "Photo"), None)
    if photo and not photo["dim"]:
        wrong("a desktop is offered a camera row that would open the file chooser")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    if page.evaluate("() => '__ORDEN_SYSTEM__' in window"):
        wrong("the drive left an activity behind on a desktop")

    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )
    dictation(page, phone=False)

    page.context.close()

def drive(browser: Browser) -> None:
    page = fresh(browser, finger=True, share=SHARE_LINK)
    note = shared_at_a_cold_start(page)
    shared_while_it_is_open(page)
    dismissing_it_does_nothing(page)
    a_tile_and_a_widget_row(page, note)
    what_the_widget_draws(page)
    the_camera_row(page)
    dictation(page, phone=True)
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        say("--- a phone ---")
        drive(browser)
        say("--- a desktop ---")
        on_a_desktop(browser)

    return DRIVE.verdict("what the phone hands over becomes a note, a command or a photograph")

if __name__ == "__main__":
    raise SystemExit(main())
