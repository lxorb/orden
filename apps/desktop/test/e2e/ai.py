from __future__ import annotations

import http.server
import json
import re
import time

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

MODEL = "fake-small"

NOTE = """# Herons

A heron stands still in the shallows for a long time.

```ai
Summarise @note
```

After the block.
"""

PLAIN = """# Plain

```ai
Say something
```
"""

SEED = """
async ([first, second]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(first, root)
  await ws.noteFrom(second, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

OPEN = """
async (name) => {
  const ws = window.nibApp.workspace
  const note = ws.notes.find((one) => one.name.startsWith(name))
  await ws.openEntry(note.path, { activate: true })
}
"""

SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: '%s' })
  ai.setDefault(made.id)
  return { id: made.id, ready: ai.ready }
}
""" % MODEL

STATE = """
() => {
  const text = window.nib?.state.doc.toString() ?? ''
  const glyph = document.querySelector('.orden-fence-run')
  return {
    text,
    glyph: glyph ? glyph.title : null,
    glyphs: document.querySelectorAll('.orden-fence-run').length,
    trouble: window.nibApp.busy.trouble,
  }
}
"""

PRESS = """
() => {
  const button = document.querySelector('.orden-fence-run')
  const box = button.getBoundingClientRect()
  const where = {
    bubbles: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  }
  button.dispatchEvent(new MouseEvent('mousedown', where))
  button.dispatchEvent(new MouseEvent('mouseup', { ...where, buttons: 0 }))
  return button.title
}
"""

class Model(http.server.BaseHTTPRequestHandler):

    words: list[str] = ["Herons ", "stand ", "still."]
    pause: float = 0.0
    refuse: str | None = None
    seen: list[dict] = []

    def log_message(self, format: str, *args: object) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self) -> None:  # noqa: N802 - the name http.server wants
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self.path.endswith("/models"):
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        body = json.dumps({"data": [{"id": MODEL}, {"id": "fake-large"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            Model.seen.append(json.loads(raw))
        except json.JSONDecodeError:
            Model.seen.append({})

        if Model.refuse is not None:
            body = json.dumps({"error": {"message": Model.refuse}}).encode()
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()

        for word in Model.words:
            event = {"choices": [{"delta": {"content": word}}]}
            try:
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionAbortedError, OSError):
                return
            if Model.pause:
                time.sleep(Model.pause)

        try:
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionAbortedError, OSError):
            return

MODEL_ORIGIN = DRIVE.side(Model)

def state(page: Page) -> dict:
    return page.evaluate(STATE)

NOT_OURS = re.compile(r"Failed to load resource.*\b(401|403|404|500)\b")

def fresh(browser: Browser, label: str) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 860},
        color_scheme="light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error" and not NOT_OURS.search(message.text)
        else None,
    )
    DRIVE.open(page)
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE, PLAIN])}")
    page.wait_for_timeout(400)
    return page

def answered(text: str) -> str | None:
    found = re.search(r"<!--nib:ai-->\n(.*?)\n<!--/nib:ai-->", text, re.S)
    return found.group(1) if found else None

def drive_block(browser: Browser) -> None:
    page = fresh(browser, "block")
    say(f"[block] the provider: {json.dumps(page.evaluate(SETUP, MODEL_ORIGIN))}")
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(500)

    before = state(page)
    say(f"[block] the glyph reads {before['glyph']!r}, and there are {before['glyphs']} of them")
    shot(page, "01-before")

    if before["glyphs"] != 1:
        wrong(f"[block] an ai fence should wear one glyph, not {before['glyphs']}")
    if answered(before["text"]) is not None:
        wrong("[block] the note had an answer in it before anything was asked")

    Model.seen.clear()
    Model.words = ["Herons ", "stand ", "still."]
    pressed = page.evaluate(PRESS)
    say(f"[block] pressed while the glyph read {pressed!r}")
    page.wait_for_timeout(1200)

    after = state(page)
    answer = answered(after["text"])
    say(f"[block] the answer is {answer!r}")
    shot(page, "02-answered")

    if answer is None:
        wrong("[block] nothing was written under the fence")
        page.context.close()
        return

    if "Herons stand still." not in answer:
        wrong(f"[block] the words that arrived are not in the note: {answer!r}")
    if f"*answered by {MODEL}," not in answer:
        wrong(f"[block] the line over the answer does not say which model: {answer!r}")
    if not re.search(r"\*answered by .+, \d{4}-\d{2}-\d{2}\*", answer):
        wrong(f"[block] the line over the answer carries no date: {answer!r}")
    if "```" in answer:
        wrong(f"[block] the answer went in as a code fence: {answer!r}")
    if "After the block." not in after["text"]:
        wrong("[block] the answer ate the prose that was under the fence")

    sent = Model.seen[-1] if Model.seen else {}
    carried = json.dumps(sent.get("messages", []))
    if "A heron stands still in the shallows" not in carried:
        wrong("[block] the prompt said @note and the note was not sent")
    if sent.get("stream") is not True:
        wrong(f"[block] the request did not ask for a stream: {sent.get('stream')!r}")
    if sent.get("model") != MODEL:
        wrong(f"[block] the request named the wrong model: {sent.get('model')!r}")

    Model.words = ["Quite ", "different."]
    page.evaluate(PRESS)
    page.wait_for_timeout(1200)

    again = state(page)
    second = answered(again["text"])
    say(f"[block] asked again, the answer is {second!r}")
    shot(page, "03-asked-again")

    if again["text"].count("<!--nib:ai-->") != 1:
        wrong(f"[block] a second press left {again['text'].count('<!--nib:ai-->')} answers")
    if second is None or "Quite different." not in second:
        wrong(f"[block] the second answer did not replace the first: {second!r}")
    if second is not None and "Herons stand still." in second:
        wrong("[block] the first answer is still in the note")

    page.context.close()

def drive_stop(browser: Browser) -> None:
    page = fresh(browser, "stop")
    page.evaluate(SETUP, MODEL_ORIGIN)
    page.evaluate(OPEN, "Plain")
    page.wait_for_timeout(500)

    Model.words = ["One. ", "Two. ", "Three. ", "Four. ", "Five."]
    Model.pause = 0.45
    page.evaluate(PRESS)
    page.wait_for_timeout(700)

    running = state(page)
    say(f"[stop] while it runs the glyph reads {running['glyph']!r}")
    shot(page, "10-running")

    if running["glyph"] is None or running["glyph"].lower() not in {"stop", "anhalten"}:
        wrong(f"[stop] the glyph did not become a stop: {running['glyph']!r}")

    page.evaluate(PRESS)
    page.wait_for_timeout(600)

    stopped = state(page)
    kept = answered(stopped["text"])
    say(f"[stop] what was kept: {kept!r}")
    shot(page, "11-stopped")
    Model.pause = 0.0

    if kept is None or "One." not in kept:
        wrong(f"[stop] a stop threw away what had already arrived: {kept!r}")
    if kept is not None and "Five." in kept:
        wrong("[stop] the whole answer arrived, so nothing was actually stopped")
    if not stopped["text"].endswith("<!--/nib:ai-->\n"):
        wrong("[stop] the answer was left without its closing mark")
    if stopped["glyph"] is None or stopped["glyph"].lower() in {"stop", "anhalten"}:
        wrong(f"[stop] the glyph stayed a stop after stopping: {stopped['glyph']!r}")
    if stopped["trouble"]:
        wrong(f"[stop] stopping was reported as a failure: {stopped['trouble']!r}")

    page.context.close()

def drive_refusal(browser: Browser) -> None:
    page = fresh(browser, "refusal")
    page.evaluate(SETUP, MODEL_ORIGIN)
    page.evaluate(OPEN, "Plain")
    page.wait_for_timeout(500)

    Model.refuse = "this key cannot use that model"
    page.evaluate(PRESS)
    page.wait_for_timeout(1000)

    after = state(page)
    say(f"[refusal] the line across the top says {after['trouble']!r}")
    shot(page, "20-refused")
    Model.refuse = None

    if answered(after["text"]) is not None:
        wrong("[refusal] a refused question still wrote an answer into the note")
    if "<!--nib:ai-->" in after["text"]:
        wrong("[refusal] a refused question left a mark in the note")
    if after["trouble"] != "this key cannot use that model":
        wrong(f"[refusal] the provider's own words were not shown: {after['trouble']!r}")

    page.context.close()

def drive_no_provider(browser: Browser) -> None:
    page = fresh(browser, "empty")
    page.evaluate("() => { const ai = window.nibApp.ai; for (const one of [...ai.providers]) ai.remove(one.id) }")
    page.evaluate(OPEN, "Plain")
    page.wait_for_timeout(400)

    before = state(page)
    if before["glyphs"] != 1:
        wrong("[empty] the glyph is not there when no provider is set up")

    page.evaluate(PRESS)
    page.wait_for_timeout(400)

    after = state(page)
    say(f"[empty] the line across the top says {after['trouble']!r}")
    shot(page, "30-no-provider")

    if not after["trouble"]:
        wrong("[empty] a press with no provider said nothing at all")
    if answered(after["text"]) is not None:
        wrong("[empty] a press with no provider wrote into the note")

    page.context.close()

def drive_rewrite(browser: Browser) -> None:
    page = fresh(browser, "rewrite")
    page.evaluate(SETUP, MODEL_ORIGIN)
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(500)

    picked = page.evaluate(
        """() => {
          const text = window.nib.state.doc.toString()
          const from = text.indexOf('A heron stands')
          const to = text.indexOf('\\n', from)
          window.nib.dispatch({ selection: { anchor: from, head: to } })
          window.nib.focus()
          return text.slice(from, to)
        }"""
    )
    say(f"[rewrite] selected {picked!r}")

    Model.seen.clear()
    Model.words = ["A heron ", "waits."]
    page.evaluate("() => window.nibApp.rewriting.show(window.nib)")
    page.wait_for_timeout(300)

    if not page.evaluate("() => window.nibApp.rewriting.open"):
        wrong("[rewrite] the sheet did not open on a selection")
        page.context.close()
        return

    shot(page, "40-verbs")
    verbs = page.evaluate(
        "() => [...document.querySelectorAll('.verbs button')].map((one) => one.textContent.trim())"
    )
    say(f"[rewrite] the verbs offered: {verbs}")
    if len(verbs) != 4:
        wrong(f"[rewrite] four verbs were expected, not {len(verbs)}: {verbs}")

    page.locator(".verbs button").first.click()
    page.wait_for_timeout(1200)
    shot(page, "41-diff")

    rows = page.evaluate(
        """() => [...document.querySelectorAll('.diff .change')].map((one) => ({
          change: [...one.classList].filter((c) => c !== 'change')[0] ?? 'same',
          text: one.textContent,
        }))"""
    )
    say(f"[rewrite] the diff: {json.dumps(rows)}")

    if not any(one["change"] == "added" for one in rows):
        wrong("[rewrite] the diff shows nothing added")
    if not any(one["change"] == "removed" for one in rows):
        wrong("[rewrite] the diff shows nothing removed")
    if not any("waits." in one["text"] for one in rows):
        wrong("[rewrite] what came back is not in the diff")

    sent = Model.seen[-1] if Model.seen else {}
    carried = json.dumps(sent.get("messages", []))
    if "fewer words" not in carried:
        wrong(f"[rewrite] the shorter verb did not ask for fewer words: {carried[:200]}")
    if "A heron stands still" not in carried:
        wrong("[rewrite] the selection was not sent")
    if "# Herons" in carried:
        wrong("[rewrite] a rewrite sent the whole note rather than the selection")

    midway = state(page)
    if "A heron waits." in midway["text"]:
        wrong("[rewrite] the rewrite was written before it was accepted")

    page.locator(".answers .orden-button:not(.is-quiet)").click()
    page.wait_for_timeout(400)

    after = state(page)
    say(f"[rewrite] the line now reads {after['text'].splitlines()[2]!r}")
    shot(page, "42-replaced")

    if "A heron waits." not in after["text"]:
        wrong("[rewrite] the rewrite was not written over the selection")
    if "A heron stands still in the shallows" in after["text"]:
        wrong("[rewrite] the old sentence is still there")
    if page.evaluate("() => window.nibApp.rewriting.open"):
        wrong("[rewrite] the sheet stayed open after the rewrite was kept")

    page.context.close()

def drive_discard(browser: Browser) -> None:
    page = fresh(browser, "discard")
    page.evaluate(SETUP, MODEL_ORIGIN)
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(500)

    before = state(page)["text"]
    page.evaluate(
        """() => {
          const text = window.nib.state.doc.toString()
          const from = text.indexOf('A heron stands')
          const to = text.indexOf('\\n', from)
          window.nib.dispatch({ selection: { anchor: from, head: to } })
        }"""
    )
    Model.words = ["Something ", "else."]
    page.evaluate("() => window.nibApp.rewriting.show(window.nib)")
    page.wait_for_timeout(200)
    page.locator(".verbs button").first.click()
    page.wait_for_timeout(1000)

    page.locator(".answers .orden-button.is-quiet").click()
    page.wait_for_timeout(300)
    shot(page, "50-discarded")

    after = state(page)["text"]
    if after != before:
        wrong("[discard] discarding a rewrite changed the note")
    if page.evaluate("() => window.nibApp.rewriting.open"):
        wrong("[discard] the sheet stayed open after discarding")

    page.context.close()

def drive_pane(browser: Browser) -> None:
    page = fresh(browser, "pane")
    page.evaluate("() => { const ai = window.nibApp.ai; for (const one of [...ai.providers]) ai.remove(one.id) }")
    page.evaluate("() => window.nibApp.settings.show('ai')")
    page.wait_for_selector(".orden-screen.sheet", timeout=15000)
    page.wait_for_timeout(400)
    shot(page, "60-pane-empty")

    adds = page.evaluate(
        "() => [...document.querySelectorAll('.orden-action')].map((one) => one.textContent.trim())"
    )
    say(f"[pane] the kinds offered: {adds}")
    if adds != ["Add Claude", "Add OpenAI", "Add Gemini", "Add OpenAI-compatible"]:
        wrong(f"[pane] Claude, OpenAI, Gemini and OpenAI-compatible were expected: {adds}")

    page.locator(".orden-action").last.click()
    page.wait_for_timeout(300)

    page.evaluate(
        """(base) => {
          const ai = window.nibApp.ai
          ai.update(ai.providers[0].id, { name: 'Fake', baseUrl: base })
        }""",
        MODEL_ORIGIN,
    )
    page.wait_for_timeout(200)

    page.locator(".orden-chip", has_text=re.compile("model", re.I)).first.click()
    page.wait_for_timeout(900)
    shot(page, "61-models-listed")

    chosen = page.evaluate("() => window.nibApp.ai.providers[0].model")
    offered = page.evaluate(
        "() => [...document.querySelectorAll('.pick button, .pick select option')]"
        ".map((one) => one.textContent.trim())"
    )
    say(f"[pane] the model chosen for it: {chosen!r}, from {offered}")
    if chosen not in {MODEL, "fake-large"}:
        wrong(f"[pane] listing the models did not choose one: {chosen!r}")
    if not page.evaluate("() => window.nibApp.ai.ready"):
        wrong("[pane] the provider is not usable after being set up")

    key_field = page.locator("input[type=password]")
    if key_field.count():
        key_field.first.fill("sk-not-a-real-key")
        key_field.first.dispatch_event("change")
        page.wait_for_timeout(900)
        shot(page, "62-key-set")

        said = page.evaluate(
            "() => [...document.querySelectorAll('.hint')].map((one) => one.textContent.trim())"
        )
        say(f"[pane] the pane says: {said}")
        if not any("evice" in one or "ppareil" in one or "端末" in one for one in said):
            wrong(f"[pane] the pane never says where the key went: {said}")
        if "sk-not-a-real-key" in page.content():
            wrong("[pane] the key is on the screen after being set")
    else:
        wrong("[pane] there is no field to type a key into")

    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        say("--- the block ---")
        drive_block(browser)
        say("--- stopping ---")
        drive_stop(browser)
        say("--- a refusal ---")
        drive_refusal(browser)
        say("--- nothing set up ---")
        drive_no_provider(browser)
        say("--- a rewrite ---")
        drive_rewrite(browser)
        say("--- a rewrite thrown away ---")
        drive_discard(browser)
        say("--- the pane ---")
        drive_pane(browser)

    return DRIVE.verdict("a block is asked, answered, replaced and stopped; a selection is rewritten")

if __name__ == "__main__":
    raise SystemExit(main())
