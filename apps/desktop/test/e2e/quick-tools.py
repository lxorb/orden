from __future__ import annotations

import http.server
import json
import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MODEL = "fake-small"
PLAN = "# Plan\n\nThe first line.\n\nThe heron line we ask about.\n\nThe last line.\n"

SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  if (!base) return ai.ready
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: '%s' })
  ai.setDefault(made.id)
  return ai.ready
}
""" % MODEL

ACTIVE = "() => window.nibApp.workspace.active?.path ?? ''"
TEXT = "() => window.nibApp.workspace.active?.note.latest ?? ''"
PAD_TEXT = """
async () => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find((one) => /Scratchpad\\.md$/.test(one.path ?? ''))
  if (tab) return tab.note.latest
  return (await ws.noteText('/.nib/Scratchpad.md')) ?? ''
}
"""
FOCUS_NOTE = "() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()"
PAD_TAB = '[data-tab="scratchpad"]'
CARD = "[data-scratchpad-card] .cm-content"

class Model(http.server.BaseHTTPRequestHandler):

    words: list[str] = ["A ", "heron ", "waits."]
    seen: list[dict] = []

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        body = json.dumps({"object": "list", "data": [{"id": "heron", "object": "model"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            Model.seen.append(json.loads(raw))
        except json.JSONDecodeError:
            Model.seen.append({})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        try:
            for word in Model.words:
                event = {"choices": [{"delta": {"content": word}}]}
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return

MODEL_ORIGIN = DRIVE.side(Model)

def wait_for(page: Page, expression: str, what: str) -> bool:
    return DRIVE.waited(page, expression, what)

def twice_ctrl(page: Page) -> None:
    page.keyboard.press("Control")
    page.keyboard.press("Control")

CHATS = "() => window.nibApp.aiChats()"

def last_messages() -> str:
    if not Model.seen:
        return ""
    return json.dumps(Model.seen[-1].get("messages", []))

def scratchpad(page: Page) -> None:
    DRIVE.open_note(page, "Plan")
    page.evaluate(FOCUS_NOTE)
    page.keyboard.press("Control+Shift+X")
    wait_for(page, f"document.querySelector('{CARD}')", "the scratchpad's card")
    tab = page.locator(PAD_TAB)
    if tab.count() != 1:
        wrong("the scratchpad is not a tab of the right side")
    elif tab.get_attribute("aria-selected") != "true":
        wrong("the scratchpad's tab is not the one chosen while the scratchpad is up")

    page.keyboard.type("call Anna about the heron count")
    wait_for(page, f"async () => (await ({PAD_TEXT})()).includes('heron count')", "it written down")
    shot(page, "01-scratchpad")

    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    after = page.evaluate(PAD_TEXT)
    say(f"after a reload it says {after!r}")
    if "heron count" not in after:
        wrong(f"the scratchpad lost its words over a reload: {after!r}")

    wait_for(page, f"document.querySelector('{CARD}')", "its card put back")
    page.keyboard.press("Control+Shift+X")
    wait_for(page, "!!document.activeElement?.closest('[data-scratchpad-card]')", "the keyboard in the card")
    page.keyboard.press("Control+Shift+X")
    wait_for(page, f"!document.querySelector('{CARD}')", "the card put away")
    say(f"the key again put the card away over {page.evaluate(ACTIVE)}")

    page.keyboard.press("Control+Shift+F")
    wait_for(page, "document.querySelector('.find input')", "the search field")
    page.locator(".find input").fill("heron count")
    found = wait_for(
        page,
        "[...document.querySelectorAll('.find ~ * *, .find *')].some((one) => /Scratchpad/.test(one.textContent ?? ''))"
        " || /Scratchpad/.test(document.querySelector('[data-panel=search]')?.textContent ?? '')",
        "a row of the scratchpad's in the search",
    )
    shot(page, "02-search")
    if not found:
        wrong("the search does not find the scratchpad's words")
    page.keyboard.press("Escape")

    page.keyboard.press("Control+Shift+X")
    wait_for(page, f"document.querySelector('{PAD_TAB}')", "the scratchpad's tab")
    page.locator(PAD_TAB).click(button="right")
    if page.locator(".menu").count():
        wrong("the scratchpad's tab has a menu")
        page.keyboard.press("Escape")

def nothing_set_up(page: Page) -> None:
    page.evaluate(SETUP, "")
    DRIVE.open_note(page, "Plan")
    page.evaluate(FOCUS_NOTE)
    twice_ctrl(page)
    if not wait_for(page, "document.querySelector('.quick')", "the quick question"):
        return
    words = page.locator(".quick").inner_text()
    if "Add an AI provider" not in words:
        wrong(f"with no provider it does not say where to add one: {words!r}")
    shot(page, "05-nothing-set-up")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.quick')", "it put away")

def asked(page: Page) -> None:
    page.evaluate(SETUP, MODEL_ORIGIN)
    DRIVE.open_note(page, "Plan")
    page.evaluate(
        """() => {
          const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
          const text = view.state.doc.toString()
          const from = text.indexOf('heron line')
          view.dispatch({ selection: { anchor: from, head: from + 'heron line'.length } })
          view.focus()
        }"""
    )
    twice_ctrl(page)
    if not wait_for(page, "document.querySelector('.quick textarea')", "the field"):
        return
    wait_for(page, "document.activeElement?.closest('.quick')", "the keyboard in it")
    chip = page.locator(".quick .chip")
    if chip.count() != 1 or "heron line" not in chip.inner_text():
        wrong(f"the selection is not the chip: {chip.all_inner_texts()}")

    open_before = page.evaluate(CHATS + ".then((chat) => chat.thread?.id ?? null)")
    page.keyboard.type("What is this?")
    page.keyboard.press("Enter")
    listed = page.evaluate(
        "(before) => new Promise((done) => setTimeout(done, 50)).then(() => window.nibApp.aiChats())"
        ".then((chat) => chat.every.some((one) => one.id !== before && (chat.running.includes(one.id)"
        " || one.words.includes('What is this?'))))",
        open_before,
    )
    if not listed:
        wrong("the quick question is not in the panel's list the moment it is asked")
    wait_for(page, "/heron waits/.test(document.querySelector('.quick .words')?.textContent ?? '')", "the answer")
    shot(page, "06-answered")
    request = Model.seen[-1] if Model.seen else {}
    rules = [one.get("content", "") for one in request.get("messages", []) if one.get("role") == "system"]
    if not rules or "agent inside nib" not in rules[0]:
        wrong(f"the quick question was not told the panel's rules: {rules[:1]}")
    if page.evaluate(CHATS + ".then((chat) => chat.thread?.id ?? null)") != open_before:
        wrong("the quick question took the panel's open chat away")
    said = last_messages()
    labelled = 'label=\\"selection\\"' in said or 'source=\\"selection\\"' in said
    if not labelled or "heron line" not in said:
        wrong(f"the request did not carry the selection: {said[-600:]}")

    Model.words = ["Then ", "it ", "strikes."]
    page.keyboard.type("And then?")
    page.keyboard.press("Enter")
    wait_for(page, "/strikes/.test(document.querySelector('.quick .talk')?.textContent ?? '')", "the follow-up")
    said = last_messages()
    if "What is this?" not in said or "A heron waits." not in said:
        wrong(f"the follow-up did not carry the turn before it: {said[:400]}")

    page.locator('.quick button[aria-label="Add to note"]').click()
    wait_for(page, "!document.querySelector('.quick')", "the field put away")
    text = page.evaluate(TEXT)
    say(f"the note now says {text!r}")
    if "The heron line we ask about.\n\nThen it strikes.\n\nThe last line." not in text:
        wrong(f"the answer is not under the selection's line: {text!r}")

    Model.words = ["Plain."]
    page.evaluate(FOCUS_NOTE)
    twice_ctrl(page)
    wait_for(page, "document.querySelector('.quick .chip')", "the chip again")
    page.locator(".quick .chip .drop").click()
    page.keyboard.type("Hello?")
    page.keyboard.press("Enter")
    wait_for(page, "/Plain/.test(document.querySelector('.quick .words')?.textContent ?? '')", "an answer")
    if "The first line." in last_messages() or "heron line" in last_messages():
        wrong("a chip taken off still sent the note")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.quick')", "Escape putting it away")

    page.evaluate(FOCUS_NOTE)
    page.keyboard.press("Control+D")
    wait_for(page, "!window.nibApp.workspace.active", "nothing in front")
    Model.words = ["Jotted."]
    twice_ctrl(page)
    wait_for(page, "document.querySelector('.quick textarea')", "the field")
    if page.locator(".quick .chip").count():
        wrong("with nothing in front the question still has a chip")
    page.keyboard.type("Anything?")
    page.keyboard.press("Enter")
    wait_for(page, "/Jotted/.test(document.querySelector('.quick .words')?.textContent ?? '')", "an answer")
    page.locator('.quick button[aria-label="Add to note"]').click()
    wait_for(page, "!document.querySelector('.quick')", "the field put away")
    pad = page.evaluate(PAD_TEXT)
    if "Jotted." not in pad:
        wrong(f"the answer did not go on the scratchpad's end: {pad!r}")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme="light")
    DRIVE.open(page)
    say(f"the space holds {DRIVE.seed(page, PLAN)}")
    say("--- the scratchpad ---")
    scratchpad(page)
    say("--- nothing set up ---")
    nothing_set_up(page)
    say("--- asked ---")
    asked(page)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the scratchpad keeps, finds and moves; the quick question answers in place"))
