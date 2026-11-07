from __future__ import annotations

import json
import math
import struct
import tempfile
from pathlib import Path

from playwright.sync_api import Browser, Page, Route

from harness import WEBKIT, Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

LIVE = "Kannst du"
WHOLE = "Kannst du bitte den Pull Request reviewen?"

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

COMPOSER = ".foot textarea"

def bursts(path: Path) -> Path:
    rate = 48_000
    frames = bytearray()
    for at in range(int(rate * 5.5)):
        turn = at / rate
        loud = 0.35 if turn < 4 else 0.002
        value = loud * math.sin(2 * math.pi * (180 + 60 * math.sin(3 * turn)) * turn)
        frames += struct.pack("<h", int(value * 32_000))
    head = b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt "
    head += struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    head += b"data" + struct.pack("<I", len(frames))
    path.write_bytes(head + bytes(frames))
    return path

class Transcriber:

    def __init__(self) -> None:
        self.asked: list[dict] = []
        self.final = False

    def listen(self, route: Route) -> None:
        body = route.request.post_data_buffer or b""
        said = body.decode("latin-1")
        fields = {}
        for name in ("model", "prompt"):
            mark = f'name="{name}"'
            if mark in said:
                fields[name] = said.split(mark, 1)[1].split("\r\n\r\n", 1)[1].split("\r\n", 1)[0]
        seconds = max(0, len(body) - 400) / 32_000
        self.asked.append({**fields, "seconds": round(seconds, 2)})
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"text": WHOLE if self.final or seconds > 3 else LIVE}),
        )

FIELD = """
(where) => {
  const field = document.querySelector(where)
  const wash = field?.offsetParent?.querySelector('[data-heard] mark')
  const mic = field?.closest('.foot, .quick')?.querySelector('button.mic')
  return {
    value: field?.value ?? null,
    focused: document.activeElement === field,
    live: wash?.textContent ?? null,
    listening: !!mic?.classList.contains('listening'),
    finishing: !!mic?.classList.contains('finishing'),
    pressed: mic?.getAttribute('aria-pressed') ?? null,
    level: mic ? Number(getComputedStyle(mic).getPropertyValue('--level') || 0) : null,
  }
}
"""

def field(page: Page, where: str = COMPOSER) -> dict:
    return page.evaluate(FIELD, where)

def opened(browser: Browser, dark: bool = False) -> tuple[Page, Transcriber]:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="dark" if dark else "light",
        permissions=["microphone"],
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    heard = Transcriber()
    page.route("**/v1/audio/transcriptions", heard.listen)
    DRIVE.open(page)
    wait_for(page, "window.nibApp.ai", "the AI providers")
    made = page.evaluate(OWN_TRANSCRIBER, "http://127.0.0.1:23317/v1")
    if not made["transcriber"]:
        wrong("a compatible provider is not read as a transcriber")
    page.keyboard.press("Control+Shift+A")
    wait_for(page, f"document.activeElement === document.querySelector('{COMPOSER}')", "the composer")
    return page, heard

def composer(browser: Browser) -> None:
    say("=== the composer ===")
    page, heard = opened(browser)
    page.keyboard.type("Frage: ")

    if not page.query_selector(".foot button.mic"):
        wrong("no microphone beside the round button")
        return
    shot(page, "01-composer")

    page.click(".foot button.mic")
    wait_for(page, "document.querySelector('.foot [role=dialog]')", "the chooser")
    rows = page.evaluate("() => [...document.querySelectorAll('.foot [role=dialog] button')].map((one) => one.textContent.trim())")
    say(f"the chooser offers {json.dumps(rows)}")
    if not rows or "Stays on this computer" not in rows[0]:
        wrong(f"the chooser does not say a server on this machine keeps the voice here: {rows}")
    page.wait_for_timeout(1500)
    if heard.asked:
        wrong(f"{len(heard.asked)} requests went before an engine was chosen")
    shot(page, "02-chooser")

    page.click(".foot [role=dialog] button >> nth=0")
    wait_for(page, f"document.querySelector('.foot button.mic.listening')", "the microphone to listen")
    wait_for(page, f"document.querySelector('{COMPOSER}').offsetParent?.querySelector('[data-heard] mark')", "live words")
    live = field(page)
    say(f"while listening: {json.dumps(live)}")
    if not live["value"].startswith("Frage: "):
        wrong(f"the live words did not land after what was typed: {live['value']!r}")
    if not live["focused"]:
        wrong("pressing the microphone took the keyboard from the field")
    shot(page, "03-live")

    page.wait_for_timeout(3000)
    live = max((one["seconds"] for one in heard.asked), default=0)
    heard.final = True
    page.click(".foot button.mic")
    wait_for(page, f"document.querySelector('{COMPOSER}').value.includes({json.dumps(WHOLE)})", "the final words")
    wait_for(page, "!document.querySelector('.foot button.mic.finishing')", "the microphone to rest")
    done = field(page)
    say(f"finished: {json.dumps(done)}")
    if done["value"] != f"Frage: {WHOLE}":
        wrong(f"the final words are not what the field says: {done['value']!r}")
    if done["live"] is not None:
        wrong("the final words still wear the live words' wash")
    final = heard.asked[-1]
    say(f"{len(heard.asked)} requests; the last: {json.dumps(final)}")
    if final["seconds"] + 0.05 < live:
        wrong(f"the final pass heard less than a live pass ({live} s): {final}")
    if "Frage:" not in final.get("prompt", ""):
        wrong(f"the final pass was not told what came before the caret: {final}")
    if final.get("model") != "whisper-1":
        wrong(f"a server on this machine was asked for {final.get('model')!r}")
    shot(page, "04-final")

    heard.final = False
    say("--- Escape ---")
    before = field(page)["value"]
    page.keyboard.press("Alt+V")
    wait_for(page, f"document.querySelector('{COMPOSER}').offsetParent?.querySelector('[data-heard] mark')", "live words again")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.foot button.mic.listening')", "the microphone to close")
    if field(page)["value"] != before:
        wrong(f"Escape did not put the field back: {field(page)['value']!r}")

    say("--- held ---")
    page.keyboard.down("Alt")
    page.keyboard.down("v")
    wait_for(page, f"document.querySelector('{COMPOSER}').offsetParent?.querySelector('[data-heard] mark')", "live words while held")
    page.wait_for_timeout(3000)
    heard.final = True
    page.keyboard.up("v")
    page.keyboard.up("Alt")
    wait_for(page, "!document.querySelector('.foot button.mic.listening, .foot button.mic.finishing')", "letting go to finish")
    if not field(page)["value"].endswith(WHOLE):
        wrong(f"push-to-talk did not write its words: {field(page)['value']!r}")
    page.context.close()

def dark(browser: Browser) -> None:
    say("=== the composer in the dark ===")
    page, _heard = opened(browser, dark=True)
    page.evaluate("() => localStorage.setItem('nib:dictation-engine', 'provider')")
    page.reload()
    DRIVE.open(page)
    wait_for(page, "window.nibApp.ai?.transcriber", "the provider again")
    page.keyboard.press("Control+Shift+A")
    wait_for(page, f"document.activeElement === document.querySelector('{COMPOSER}')", "the composer")
    page.click(".foot button.mic")
    wait_for(page, f"document.querySelector('{COMPOSER}').offsetParent?.querySelector('[data-heard] mark')", "live words")
    shot(page, "05-live-dark")
    page.keyboard.press("Escape")
    page.context.close()

def quick_add(browser: Browser) -> None:
    say("=== quick add ===")
    page, heard = opened(browser)
    page.keyboard.press("Escape")
    page.evaluate("() => localStorage.setItem('nib:dictation-engine', 'provider')")
    page.reload()
    DRIVE.open(page)
    wait_for(page, "window.nibApp.ai?.transcriber", "the provider again")
    page.keyboard.press("Control+Alt+Space")
    wait_for(page, "document.querySelector('.quick input.field')", "quick add")
    if not page.query_selector(".quick button.mic"):
        wrong("quick add has no microphone")
        return
    shot(page, "06-quick-add")
    page.click(".quick button.mic")
    wait_for(page, "document.querySelector('.quick input.field').offsetParent?.querySelector('[data-heard] mark')", "live words in quick add")
    shot(page, "07-quick-add-live")
    page.wait_for_timeout(3000)
    heard.final = True
    page.click(".quick button.mic")
    wait_for(page, f"document.querySelector('.quick input.field').value === {json.dumps(WHOLE)}", "the task's words")
    say(f"quick add's line: {page.evaluate('() => document.querySelector(\".quick input.field\").value')!r}")
    shot(page, "08-quick-add-final")
    if heard.asked and "seconds" not in heard.asked[-1]:
        wrong("quick add's dictation never reached the transcriber")
    page.context.close()

def main() -> int:
    if WEBKIT:
        say("WebKit takes no recorded voice for its microphone, so there is nothing to hear")
        return DRIVE.verdict("nothing to drive in WebKit")
    with tempfile.TemporaryDirectory() as made:
        sound = bursts(Path(made) / "microphone.wav")
        with DRIVE.session(
            args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-audio-capture={sound}",
            ],
        ) as browser:
            composer(browser)
            dark(browser)
            quick_add(browser)

    return DRIVE.verdict("dictation into the composer and quick add, live words and final")

if __name__ == "__main__":
    raise SystemExit(main())
