
from __future__ import annotations

import http.server
import json
import threading

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

FIELD = ".ask textarea"
SETUP = """(base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
}"""
IDLE = "() => !document.querySelector('.ask .go[aria-label=\"Stop\"]')"
PANEL = "document.querySelector('.ask')?.innerText ?? ''"


class Model(http.server.BaseHTTPRequestHandler):

    mode = "whole"
    words = ["Herons ", "stand ", "still."]
    gate = threading.Event()

    def log_message(self, format: str, *args: object) -> None:
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
        raw = json.dumps({"data": [{"id": "fake-small", "name": "Fake Small", "context_length": 32000}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _send(self, event: dict) -> None:
        self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
        self.wfile.flush()

    def do_POST(self) -> None:  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        try:
            if Model.mode != "nothing":
                for word in Model.words:
                    self._send({"model": "fake-small", "choices": [{"delta": {"content": word}}]})
            if Model.mode == "cut":
                return
            if Model.mode == "held":
                Model.gate.wait(60)
                return
            self._send({"model": "fake-small", "choices": [{"delta": {}, "finish_reason": "stop"}]})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return


def send(page: Page, words: str) -> None:
    page.locator(FIELD).click()
    page.keyboard.type(words, delay=1)
    page.keyboard.press("Enter")


def panel_says(page: Page, *words: str) -> None:
    page.wait_for_function(
        f"(words) => words.every((one) => ({PANEL}).includes(one))", arg=list(words), timeout=30000
    )


def drive(browser: Browser) -> None:
    origin = DRIVE.side(Model)
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme="light")
    DRIVE.open(page)
    DRIVE.seed(page, "# Herons\n\nA heron stands still.\n")
    page.evaluate(SETUP, origin)
    DRIVE.open_note(page, "Herons")
    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+Shift+A")
    page.wait_for_selector(FIELD)

    say("a whole answer is told nothing")
    send(page, "a whole one")
    panel_says(page, "Herons stand still.")
    page.wait_for_function(IDLE)
    if "connection closed" in page.evaluate(f"() => {PANEL}"):
        wrong("a whole answer is told the connection closed")

    say("a connection that closes mid-answer keeps the words and says so")
    Model.mode = "cut"
    send(page, "a cut one")
    panel_says(page, "a cut one", "connection closed", "Ask again")
    shot(page, "cut")

    say("an answer of nothing says so")
    Model.mode = "nothing"
    send(page, "an empty one")
    panel_says(page, "an empty one", "The model did not answer.")

    say("a reload mid-answer leaves the message and the words that arrived")
    Model.mode = "held"
    Model.words = ["Kept ", "these ", "words."]
    send(page, "a long one")
    panel_says(page, "Kept these words.")

    say("a second window sees the answer going on, and no Stopped row with an Ask again")
    other = page.context.new_page()
    DRIVE.open(other)
    other.evaluate("() => window.nib?.focus()")
    other.keyboard.press("Control+Shift+A")
    panel_says(other, "a long one")
    if "Stopped" in other.evaluate(f"() => {PANEL}"):
        wrong("a second window says an answer still going on has stopped")
    other.close()

    page.reload()
    DRIVE.ready(page)
    Model.gate.set()
    page.evaluate("() => window.nib?.focus()")
    page.keyboard.press("Control+Shift+A")
    panel_says(page, "a long one", "Kept these words.", "Stopped")
    shot(page, "after-reload")

    say("and the thread goes on from there")
    Model.mode = "whole"
    Model.words = ["Going ", "on."]
    send(page, "go on")
    panel_says(page, "a long one", "Going on.")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
