from __future__ import annotations

import json
import math
import struct
import tempfile
from pathlib import Path

from playwright.sync_api import Browser, Page, Route

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

HEARD = "Guten Morgen, wir fangen an."
LANGUAGE = "de"

OLD_MEETING = """---
date: 2026-09-12
duration: 4:09
---

# Meeting 2026-09-12 1432

![[recording-2026-09-12-1432.weba]]

*Written by gpt-6-astra*

## Takeaways

- The fonts are decided

## Transcript (German)
*Written by whisper*

Guten Morgen, wir fangen an.

"""

NOTE = """# Recordings

Record one here:

"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Recordings'))
  await ws.openEntry(found.path, { activate: true })
  return { name: found.name, root: ws.activeSpace.root }
}
"""

SIGNED_IN = """
() => {
  const app = window.nibApp
  app.account.token = 'a-drive-session'
  app.account.user = { id: 'drive', email: 'drive@example.com', name: 'Drive' }
  app.account.settling = false
  app.modes.glassesModel = 'gpt-6-astra'
  return !!app.account.accountToken
}
"""

PLAYERS = """
() => {
  const out = []
  for (const player of document.querySelectorAll('audio')) {
    out.push({
      tag: player.tagName.toLowerCase(),
      src: new URL(player.src, location.href).pathname,
      ready: player.readyState,
      // A file `MediaRecorder` wrote carries no duration in its header - it was a live
      // stream when it was written - so a browser answers `Infinity` for it until it has
      // read the whole thing. That is a decoded file, not a broken one.
      duration: player.duration,
      wide: Math.round(player.getBoundingClientRect().width),
    })
  }
  return out
}
"""

def wav(seconds: float, path: Path) -> Path:
    rate = 48_000
    count = int(rate * seconds)
    frames = bytearray()

    for at in range(count):
        turn = at / rate
        value = math.sin(2 * math.pi * (220 + 40 * math.sin(turn)) * turn)
        frames += struct.pack("<h", int(value * 12_000))

    head = b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt "
    head += struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    head += b"data" + struct.pack("<I", len(frames))

    path.write_bytes(head + bytes(frames))
    return path

class Byok:

    def __init__(self) -> None:
        self.asked = 0
        self.models: list[str] = []
        self.formats: list[str] = []
        self.bytes: list[int] = []

    def listen(self, route: Route) -> None:
        self.asked += 1
        body = route.request.post_data_buffer or b""
        self.bytes.append(len(body))

        said = body.decode("latin-1")
        for name, into in (("model", self.models), ("response_format", self.formats)):
            mark = f'name="{name}"'
            if mark in said:
                after = said.split(mark, 1)[1]
                into.append(after.split("\r\n\r\n", 1)[1].split("\r\n", 1)[0].strip())

        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"text": HEARD, "language": LANGUAGE}),
        )

class Whisper:

    def __init__(self) -> None:
        self.heard = 0
        self.sizes: list[int] = []
        self.pieces: list[str] = []

    def listen(self, route: Route) -> None:
        self.heard += 1
        body = route.request.post_data_buffer or b""
        self.sizes.append(len(body))
        self.pieces.append(route.request.url)

        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"said": HEARD, "language": LANGUAGE}),
        )

def fresh(browser: Browser, finger: bool = False) -> tuple[Page, Whisper]:
    context = browser.new_context(
        service_workers="allow",
        viewport={"width": 420, "height": 880} if finger else {"width": 1180, "height": 900},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        permissions=["microphone"],
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )

    whisper = Whisper()
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.route("https://orden.so/**", lambda route: route.abort())
    page.route("**/v1/ask/heard*", whisper.listen)

    DRIVE.open(page)
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    wait_for(page, "navigator.serviceWorker.controller", "the asset worker")

    seeded = page.evaluate(SEED, NOTE)
    say(f"the space {seeded['root']} holds {seeded['name']}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(500)
    return page, whisper

PRESS_ROW = """
([label]) => {
  const rows = [...document.querySelectorAll('[role=option]')]
  const found = rows.find(
    (one) => (one.querySelector('.orden-row-label')?.textContent ?? '').trim() === label,
  )
  if (!found) return rows.map((one) => one.textContent.trim())

  // A command that cannot run wears `.dim` and does nothing when pressed, so saying
  // which of the two happened is the difference between a broken drive and a row that
  // is honestly not available.
  const off = found.classList.contains('dim')
  found.click()
  return off ? 'greyed out' : 'pressed'
}
"""

def run_command(page: Page, words: str) -> None:
    page.keyboard.press("Control+O")
    wait_for(page, "document.querySelector('.palette input')", "the palette's field")
    page.locator(".palette input").click()
    page.keyboard.type(f">{words}")
    page.wait_for_timeout(400)

    answered = page.evaluate(PRESS_ROW, [words])
    if answered != "pressed":
        wrong(f"the palette would not run {words!r}: {json.dumps(answered)}")
    page.wait_for_timeout(200)

def trouble(page: Page) -> str:
    return page.evaluate("() => window.nibApp.settings.error ?? ''")

def pill(page: Page) -> dict:
    return page.evaluate(
        """() => {
      const box = document.querySelector('.recording')
      if (!box) return { there: false }
      const dot = box.querySelector('.dot')
      return {
        there: true,
        clock: box.querySelector('.clock')?.textContent ?? '',
        stops: !!box.querySelector('button'),
        said: document.querySelector('.said')?.textContent ?? '',
      }
    }"""
    )

def note_says(page: Page) -> str:
    return page.evaluate("() => window.nibApp.workspace.active?.doc ?? ''")

def drive(browser: Browser) -> None:
    page, whisper = fresh(browser)

    say("--- a recording ---")
    page.click(".cm-content")
    page.keyboard.press("Control+End")

    run_command(page, "Record")
    wait_for(page, "document.querySelector('.recording')", "the pill")

    state = pill(page)
    say(f"the pill says {json.dumps(state)}")
    if not state["stops"]:
        wrong("the pill offers no way to stop")
    shot(page, "pill")

    page.wait_for_timeout(3200)
    ticking = pill(page)
    say(f"after three seconds the pill says {ticking['clock']}")
    if ticking["clock"] in {"", "0:00"}:
        wrong(f"the clock never moved: {ticking['clock']!r}")

    page.click(".recording button")
    wait_for(page, "!document.querySelector('.recording')", "the pill to go")
    wait_for(page, "window.nibApp.workspace.active.doc.includes('![[recording-')", "the embed")

    said = note_says(page)
    embed = said[said.index("![[") : said.index("]]") + 2]
    say(f"the note now says {embed}")
    if not embed.endswith(".weba]]") and not embed.endswith(".m4a]]"):
        wrong(f"the recording is named {embed}, which is not a sound file")

    page.keyboard.press("Control+Home")
    page.wait_for_timeout(1400)
    players = page.evaluate(PLAYERS)
    say(f"players: {json.dumps(players)}")
    if len(players) != 1:
        wrong(f"{len(players)} players in the note, not one")
    for player in players:
        if player["ready"] < 2:
            wrong(f"the player never read the file: {player}")
        if not player["src"].startswith("/asset/"):
            wrong(f"the player is not pointed at the space own asset store: {player}")
        if player["wide"] < 100:
            wrong(f"the player is drawn {player['wide']}px wide")
    shot(page, "player")

    say("--- transcribing it ---")
    if not page.evaluate(SIGNED_IN):
        wrong("the drive could not put a session in the store")

    box = page.locator("audio").first.bounding_box()
    if not box:
        wrong("the player has no box to press")
        return

    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button="right")
    page.wait_for_timeout(400)

    rows = page.evaluate(
        "() => [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]"
        ".map((one) => one.textContent.trim())"
    )
    say(f"the menu offers {json.dumps(rows)}")
    if "Transcribe" not in rows:
        wrong("no Transcribe row on the recording's menu")
        page.keyboard.press("Escape")
    else:
        shot(page, "menu")
        page.get_by_role("menuitem", name="Transcribe").click()
        wait_for(page, "window.nibApp.workspace.active.doc.includes('[!quote]')", "the transcript")

        said = note_says(page)
        if "> [!quote] Transcript (German)" not in said:
            wrong(f"the transcript is not headed with its language:\n{said}")
        if "> *Written by whisper*" not in said:
            wrong("nothing in the note says a model wrote the transcript")
        if HEARD not in said:
            wrong("the words the model heard are not in the note")
        say(f"the callout reads:\n{said[said.index('> [!quote]') :]}")
        shot(page, "transcript")

    if whisper.heard < 1:
        wrong("nothing was ever sent to the transcriber")
    else:
        say(f"{whisper.heard} piece(s) sent, {whisper.sizes} bytes each")
        for size in whisper.sizes:
            if size < 44:
                wrong(f"a piece of {size} bytes is not a WAV at all")

    page.context.close()

OWN_TRANSCRIBER = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'On this machine', baseUrl: base, model: 'llama' })
  ai.setDefault(made.id)
  return { id: made.id, transcriber: ai.transcriber?.id ?? null }
}
"""

def byok(browser: Browser) -> None:
    say("=== a transcriber of the reader's own ===")
    page, whisper = fresh(browser)
    own = Byok()
    page.route("**/v1/audio/transcriptions", own.listen)

    wait_for(page, "window.nibApp.ai", "the AI providers")
    made = page.evaluate(OWN_TRANSCRIBER, "http://127.0.0.1:23305/v1")
    say(f"the provider is set up: {json.dumps(made)}")
    if not made["transcriber"]:
        wrong("a compatible provider is not read as a transcriber")

    if page.evaluate("() => !!window.nibApp.account.accountToken"):
        wrong("this check is about having no account, and there is one")

    page.click(".cm-content")
    page.keyboard.press("Control+End")

    run_command(page, "Record")
    wait_for(page, "document.querySelector('.recording')", "the pill")
    page.wait_for_timeout(3200)
    page.click(".recording button")
    wait_for(page, "!document.querySelector('.recording')", "the pill to go")
    wait_for(page, "window.nibApp.workspace.active.doc.includes('![[recording-')", "the embed")

    page.keyboard.press("Control+Home")
    page.wait_for_timeout(1400)

    box = page.locator("audio").first.bounding_box()
    if not box:
        wrong("the player has no box to press")
        page.context.close()
        return

    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button="right")
    page.wait_for_timeout(400)

    rows = page.evaluate(
        "() => [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]"
        ".map((one) => one.textContent.trim())"
    )
    if "Transcribe" not in rows:
        wrong(f"no Transcribe row with a provider of one's own and no account: {rows}")
        page.keyboard.press("Escape")
        page.context.close()
        return

    shot(page, "byok-menu")
    page.get_by_role("menuitem", name="Transcribe").click()
    wait_for(page, "window.nibApp.workspace.active.doc.includes('[!quote]')", "the transcript")

    said = note_says(page)
    if HEARD not in said:
        wrong(f"the words the provider heard are not in the note:\n{said}")
    if "> *Written by whisper-1*" not in said:
        wrong(f"the transcript does not name the model that wrote it:\n{said}")
    if "> [!quote] Transcript (German)" not in said:
        wrong(f"the language the provider said is not in the heading:\n{said}")
    say(f"the callout reads:\n{said[said.index('> [!quote]') :]}")
    shot(page, "byok-transcript")

    if own.asked < 1:
        wrong("nothing was sent to the reader's own transcriber")
    else:
        say(f"{own.asked} piece(s) to the provider: models {own.models}, shapes {own.formats}")
    if own.models and own.models[0] != "whisper-1":
        wrong(f"a server on this machine was asked for {own.models[0]!r}")
    if own.formats and own.formats[0] != "verbose_json":
        wrong(f"the language was not asked for: {own.formats[0]!r}")
    for size in own.bytes:
        if size < 44:
            wrong(f"a piece of {size} bytes is not a WAV at all")

    if whisper.heard:
        wrong(f"{whisper.heard} piece(s) went to the account as well")

    page.context.close()

OFFERED = """
() => [...document.querySelectorAll('[role=option] .orden-row-label')].map((one) => one.textContent.trim())
"""

OPEN_OLD = """
async (text) => {
  const ws = window.nibApp.workspace
  const path = await ws.noteFrom(text, ws.activeSpace.root)
  await ws.openEntry(path, { activate: true })
  return { kind: ws.active?.kind, path: ws.active?.path ?? '' }
}
"""

def old_meeting(browser: Browser) -> None:
    say("--- an old meeting note ---")
    page, _whisper = fresh(browser)

    opened = page.evaluate(OPEN_OLD, OLD_MEETING)
    wait_for(page, "window.nibApp.workspace.active?.doc.includes('## Transcript')", "the old note")
    said = note_says(page)
    say(f"the old meeting note opens as a {opened['kind']}: {opened['path']}")
    if opened["kind"] != "note":
        wrong(f"an old meeting note opened as a {opened['kind']}, not a note")
    if said != OLD_MEETING:
        wrong(f"the old meeting note was changed on opening:\n{said}")
    shot(page, "old-meeting")

    page.keyboard.press("Control+O")
    wait_for(page, "document.querySelector('.palette input')", "the palette's field")
    page.locator(".palette input").click()
    page.keyboard.type(">meeting")
    page.wait_for_timeout(400)
    rows = page.evaluate(OFFERED)
    say(f"the palette offers {json.dumps(rows)} for meeting")
    if any("Meeting" in row for row in rows):
        wrong(f"the palette still offers a meeting: {rows}")
    page.keyboard.press("Escape")
    page.context.close()

def phone(browser: Browser) -> None:
    say("--- a finger ---")
    page, _whisper = fresh(browser, finger=True)

    page.evaluate("() => { const ws = window.nibApp.workspace; if (!ws.panel) ws.showPanel('tree') }")
    page.wait_for_timeout(450)

    page.evaluate(
        """() => {
      const space = document.querySelector('[data-space-rest]')
      space.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    }"""
    )
    wait_for(page, "document.querySelector('[role=menuitem]')", "the space's menu")
    rows = page.evaluate(
        "() => [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]"
        ".map((one) => one.textContent.trim())"
    )
    say(f"the space offers {json.dumps(rows)}")
    if "Record" in rows:
        wrong("the phone's space menu offers Record, which is not a kind of note")
    if any("Meeting" in row for row in rows):
        wrong(f"the phone's space menu still offers a meeting: {rows}")
    shot(page, "phone-kinds")
    page.keyboard.press("Escape")
    page.evaluate("() => window.nibApp.workspace.closePanel()")
    page.wait_for_timeout(450)

    run_command(page, "Record")
    wait_for(page, "document.querySelector('.recording')", "the pill on a phone")
    page.wait_for_timeout(600)

    state = page.evaluate(
        """() => {
      const box = document.querySelector('.recording')
      const shown = box ? getComputedStyle(box) : null
      const seen = box?.getBoundingClientRect()
      return {
        display: shown?.display ?? 'none',
        // How far the bottom edge of the pill is from the bottom of the screen,
        // which is what says whether it is clear of the gesture bar or sitting on
        // it, and how tall it is under a thumb.
        above: Math.round(window.innerHeight - (seen?.bottom ?? 0)),
        tall: Math.round(seen?.height ?? 0),
        width: Math.round(seen?.width ?? 0),
      }
    }"""
    )
    say(f"the pill on a phone: {json.dumps(state)}")
    if state["display"] == "none":
        wrong("the pill is hidden on a phone, where it is the only thing that says so")
    if state["above"] < 8:
        wrong(f"the pill sits on the bottom edge of the screen: {state}")
    if state["tall"] < 40:
        wrong(f"the pill is only {state['tall']}px tall under a thumb: {state}")
    shot(page, "phone-pill")

    page.wait_for_timeout(1500)
    page.click(".recording button")
    wait_for(
        page,
        "window.nibApp.workspace.active?.doc.includes('![[recording-')",
        "the embed on a phone",
    )
    said = note_says(page)
    first = said.split("\n")[0]
    say(f"the recording landed in the note being written, which now opens {first!r}")
    if "]]#" in said or "]]!" in said:
        wrong(f"the embed was written into the line that was there: {first!r}")
    shot(page, "phone-note")

    page.context.close()

def main() -> int:
    with tempfile.TemporaryDirectory() as made:
        sound = wav(4, Path(made) / "microphone.wav")
        with DRIVE.session(
            args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-audio-capture={sound}",
                "--autoplay-policy=no-user-gesture-required",
            ],
        ) as browser:
            drive(browser)
            byok(browser)
            old_meeting(browser)
            phone(browser)

    return DRIVE.verdict("a recording, a transcript and an old meeting note, on a pointer and a finger")

if __name__ == "__main__":
    raise SystemExit(main())
