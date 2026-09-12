"""The recorder, driven: a microphone, a file beside the note, and words under it.

Three things are being claimed and none of them can be shown by a unit test, because
all three are the browser's own machinery:

1. **Record** opens the microphone, writes a file into the space beside where a pasted
   picture goes, and puts `![[recording-….weba]]` at the caret - which draws as the
   audio player the note already draws for `![[take.mp3]]`. The pill in the status bar
   is the whole of what is said while it runs: a red dot, the time, a stop.
2. **Transcribe**, on the embed's own menu, sends that very file through the Worker's
   Whisper route and writes the transcript under the player as a callout.
3. **Meeting notes** does the same recording in a note of its own, with the transcript
   arriving every twenty seconds while it runs and a summary above it at the end, and
   the pill says when a piece failed and is being tried again.

Chromium is given a microphone that plays a file: `--use-fake-device-for-media-stream`
with `--use-file-for-fake-audio-capture`, so `getUserMedia` answers with real samples
and `MediaRecorder` writes a real Opus file. The Worker is not: `/v1/ask/heard` and
`/v1/ask/summary` are answered here, because what is under test is what the app does
with an answer rather than what Whisper makes of a sine wave. The route itself is held
to its own contract in services/sync/test/ask.test.ts.

Run it from the repository root:

    python apps/desktop/test/e2e/recording.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/recording/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import math
import os
import shutil
import socket
import socketserver
import struct
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, Route, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "recording"

# In this agent's own range, and nowhere near the dev server's 1420.
PORT = 19842
ORIGIN = f"http://127.0.0.1:{PORT}"

# What the fake Whisper route answers with, and what a summary comes back as. German,
# so the language the route reports has somewhere to show up: the callout is headed
# with it and the transcript heading takes it too.
HEARD = "Guten Morgen, wir fangen an."
LANGUAGE = "de"
SUMMARY = "## Takeaways\n\n- The fonts are decided\n\n## Open tasks\n\n- [ ] Send the file"

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

# A session, put straight into the store. Signing in properly is signin.py's drive;
# what is wanted here is only the one thing transcribing asks for - an account token -
# and the model the account would have chosen for the glasses, which is the same model
# a summary is asked of.
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

# Every player in the note, and whether it actually has sound behind it. `duration` is
# the honest question: an `<audio>` pointed at nothing is still an `<audio>`, and only a
# decoded file has a length.
PLAYERS = """
() => {
  const out = []
  for (const player of document.querySelectorAll('audio')) {
    out.push({
      tag: player.tagName.toLowerCase(),
      src: new URL(player.src, location.href).pathname,
      ready: player.readyState,
      duration: Number.isFinite(player.duration) ? Math.round(player.duration * 10) / 10 : 0,
      wide: Math.round(player.getBoundingClientRect().width),
    })
  }
  return out
}
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def wav(seconds: float, path: Path) -> Path:
    """A microphone, as a file: sixteen bit mono at 48 kHz, which is what Chromium's
    fake capture takes. Speech would not survive being read by Whisper here anyway -
    the route is answered locally - so this is a tone that rises, which is something
    every part of the chain can carry and nothing can mistake for silence."""
    rate = 48_000
    count = int(rate * seconds)
    frames = bytearray()

    for at in range(count):
        # A slow sweep, so a file that is looped does not click at the seam.
        turn = at / rate
        value = math.sin(2 * math.pi * (220 + 40 * math.sin(turn)) * turn)
        frames += struct.pack("<h", int(value * 12_000))

    head = b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt "
    head += struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    head += b"data" + struct.pack("<I", len(frames))

    path.write_bytes(head + bytes(frames))
    return path


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error

    threading.Thread(target=server.serve_forever, daemon=True).start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)

    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 40) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(100)

    raise SystemExit(f"gave up waiting for {what}")


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


class Whisper:
    """The Worker's two routes, answered here.

    `stumble` makes the next request fail once, which is what the pill's own
    "being tried again" state is for: the piece has to land anyway."""

    def __init__(self) -> None:
        self.heard = 0
        self.summaries = 0
        self.stumble = False
        self.sizes: list[int] = []
        self.pieces: list[str] = []

    def listen(self, route: Route) -> None:
        self.heard += 1
        body = route.request.post_data_buffer or b""
        self.sizes.append(len(body))
        self.pieces.append(route.request.url)

        if self.stumble:
            self.stumble = False
            route.fulfill(status=500, content_type="application/json", body='{"error":"nope"}')
            return

        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"said": HEARD, "language": LANGUAGE}),
        )

    def summarise(self, route: Route) -> None:
        self.summaries += 1
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"summary": SUMMARY}),
        )


def fresh(browser: Browser, finger: bool = False) -> tuple[Page, Whisper]:
    context = browser.new_context(
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
    # The account's own routes, answered here. Everything else the app would ask of
    # nibeditor.com is refused rather than answered: syncing is not what is under test,
    # and it is written to carry on when the service cannot be reached.
    page.route("**/v1/ask/heard*", whisper.listen)
    page.route("**/v1/ask/summary", whisper.summarise)
    page.route("https://nibeditor.com/**", lambda route: route.abort())

    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    # The worker in front of the page is what answers for a file in the space; without
    # it a player is pointed at an address nothing serves.
    wait_for(page, "navigator.serviceWorker.controller", "the asset worker")

    seeded = page.evaluate(SEED, NOTE)
    say(f"the space {seeded['root']} holds {seeded['name']}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(500)
    return page, whisper


def run_command(page: Page, words: str) -> None:
    """Through the palette, which is how a reader with a keyboard reaches any of this.
    The same rows the Paragraph menu and the phone's plus show, out of one list."""
    page.keyboard.press("Control+P")
    page.wait_for_timeout(250)
    page.keyboard.type(words)
    page.wait_for_timeout(350)
    page.keyboard.press("Enter")


def pill(page: Page) -> dict:
    return page.evaluate(
        """() => {
      const box = document.querySelector('.pill')
      if (!box) return { there: false }
      const dot = box.querySelector('.dot')
      return {
        there: true,
        clock: box.querySelector('.clock')?.textContent ?? '',
        behind: !!dot && dot.classList.contains('behind'),
        stops: !!box.querySelector('button'),
        said: document.querySelector('.said')?.textContent ?? '',
      }
    }"""
    )


def note_says(page: Page) -> str:
    return page.evaluate("() => window.nibApp.workspace.active?.doc ?? ''")


def drive(browser: Browser) -> None:
    page, whisper = fresh(browser)

    # ── A recording, with no account at all ────────────────────────────────
    say("--- a recording ---")
    page.click(".cm-content")
    page.keyboard.press("Control+End")

    run_command(page, "Record")
    wait_for(page, "document.querySelector('.pill')", "the pill")

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

    # The pill's own button, which is the same command the row ran.
    page.click(".pill button")
    wait_for(page, "!document.querySelector('.pill')", "the pill to go")
    wait_for(page, "window.nibApp.workspace.active.doc.includes('![[recording-')", "the embed")

    said = note_says(page)
    embed = said[said.index("![[") : said.index("]]") + 2]
    say(f"the note now says {embed}")
    if not embed.endswith(".weba]]") and not embed.endswith(".m4a]]"):
        wrong(f"the recording is named {embed}, which is not a sound file")

    page.wait_for_timeout(1200)
    players = page.evaluate(PLAYERS)
    say(f"players: {json.dumps(players)}")
    if len(players) != 1:
        wrong(f"{len(players)} players in the note, not one")
    for player in players:
        if player["ready"] < 1:
            wrong(f"the player never read the file: {player}")
        if player["duration"] <= 0:
            wrong(f"the player has no sound behind it: {player}")
    shot(page, "player")

    # ── The transcript, off the embed's own menu ───────────────────────────
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
        # A WAV of 16 kHz mono is 32 kB a second; three seconds is about a hundred.
        for size in whisper.sizes:
            if size < 44:
                wrong(f"a piece of {size} bytes is not a WAV at all")

    page.context.close()


def meeting(browser: Browser) -> None:
    say("--- meeting notes ---")
    page, whisper = fresh(browser)
    if not page.evaluate(SIGNED_IN):
        wrong("the drive could not put a session in the store")

    # The first piece fails, so the pill has to say so and the piece has to land anyway.
    whisper.stumble = True

    run_command(page, "Meeting notes")
    wait_for(page, "document.querySelector('.pill')", "the pill")
    wait_for(
        page,
        "window.nibApp.workspace.active?.doc.includes('## Transcript')",
        "the meeting note",
    )

    started = note_says(page)
    say(f"the meeting note opens:\n{started}")
    if "date: " not in started:
        wrong("the meeting note carries no date")
    if "duration" in started:
        wrong("the meeting note claims a duration before it has one")
    shot(page, "meeting-start")

    # One piece is twenty seconds of speech; the drive waits for it to arrive rather
    # than for a clock, so a slow machine does not fail this.
    wait_for(
        page,
        f"window.nibApp.workspace.active.doc.includes({json.dumps(HEARD)})",
        "the first piece of transcript",
        patience=90,
    )
    say("a piece of the transcript arrived while the recording was still running")

    behind = pill(page)
    say(f"the pill said {json.dumps(behind)}")
    if whisper.heard < 2:
        wrong(f"the piece that failed was never tried again ({whisper.heard} requests)")

    page.click(".pill button")
    wait_for(page, "window.nibApp.workspace.active.doc.includes('Takeaways')", "the summary")
    wait_for(page, "!document.querySelector('.pill')", "the pill to go", patience=60)

    said = note_says(page)
    say(f"the meeting note ends up as:\n{said}")

    if "duration: " not in said:
        wrong("no duration in the meeting note front matter")
    if "![[recording-" not in said:
        wrong("the meeting note does not embed its own recording")
    if said.index("Takeaways") > said.index("## Transcript"):
        wrong("the summary was written below the transcript rather than above it")
    if "*Written by gpt-6-astra*" not in said:
        wrong("nothing says which model wrote the summary")
    if whisper.summaries != 1:
        wrong(f"{whisper.summaries} summaries asked for, not one")

    shot(page, "meeting")
    page.context.close()


def phone(browser: Browser) -> None:
    """The same command from the one plus a thumb can reach, and the same pill on a
    screen with no hover on it: the numbers in the status bar are a pointer's, the pill
    is not."""
    say("--- a finger ---")
    page, _whisper = fresh(browser, finger=True)

    page.click(".new")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]"
        ".map((one) => one.textContent.trim())"
    )
    say(f"a press on the plus makes a note; a long press offers {json.dumps(rows)}")

    # A long press, which is what the plus answers on a phone.
    box = page.locator(".new").bounding_box()
    if box:
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(300)

    page.evaluate(
        """() => {
      const plus = document.querySelector('.new')
      plus.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    }"""
    )
    page.wait_for_timeout(400)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]"
        ".map((one) => one.textContent.trim())"
    )
    say(f"the plus offers {json.dumps(rows)}")
    if "Record" not in rows:
        wrong("no Record row on the phone's plus")
    shot(page, "phone-plus")

    if "Record" in rows:
        page.get_by_role("menuitem", name="Record").click()
        wait_for(page, "document.querySelector('.pill')", "the pill on a phone")

        state = page.evaluate(
            """() => {
          const box = document.querySelector('.pill')
          const shown = box ? getComputedStyle(box) : null
          return {
            display: shown?.display ?? 'none',
            bottom: Math.round(box?.getBoundingClientRect().bottom ?? 0),
            width: Math.round(box?.getBoundingClientRect().width ?? 0),
          }
        }"""
        )
        say(f"the pill on a phone: {json.dumps(state)}")
        if state["display"] == "none":
            wrong("the pill is hidden on a phone, where it is the only thing that says so")
        if state["bottom"] > 880:
            wrong(f"the pill is off the bottom of the screen: {state}")
        shot(page, "phone-pill")

        page.wait_for_timeout(1500)
        page.click(".pill button")
        wait_for(
            page,
            "window.nibApp.workspace.active?.doc.includes('![[recording-')",
            "the embed on a phone",
        )
        say("the recording landed in a note made by the plus")
        shot(page, "phone-note")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with tempfile.TemporaryDirectory() as made:
            sound = wav(4, Path(made) / "microphone.wav")
            with sync_playwright() as play:
                browser = play.chromium.launch(
                    channel="chrome",
                    args=[
                        "--use-fake-device-for-media-stream",
                        "--use-fake-ui-for-media-stream",
                        f"--use-file-for-fake-audio-capture={sound}",
                        "--autoplay-policy=no-user-gesture-required",
                    ],
                )
                try:
                    drive(browser)
                    meeting(browser)
                    phone(browser)
                finally:
                    browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\na recording, a transcript and a meeting, on a pointer and a finger", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
