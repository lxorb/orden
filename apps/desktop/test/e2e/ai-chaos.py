from __future__ import annotations

import http.server
import json
import time

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


class Model(http.server.BaseHTTPRequestHandler):
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
        raw = json.dumps({"data": [{"id": "fake-small", "name": "Fake", "context_length": 32000}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        for at in range(120):
            try:
                self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': f'word{at} '}}]})}\n\n".encode())
                self.wfile.flush()
            except OSError:
                return
            time.sleep(0.03)
        try:
            self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return


ORIGIN = DRIVE.side(Model)

SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
}
"""

STATE = """async () => {
  const chat = await window.nibApp.aiChats()
  return { running: [...chat.running], open: chat.head?.id ?? null, ids: chat.every.map((one) => one.id),
    archived: chat.every.filter((one) => one.archived).map((one) => one.id),
    stop: !!document.querySelector('.ask .go[aria-label="Stop"]'), trouble: chat.trouble }
}"""


def send(page, words: str) -> None:
    page.locator(".ask textarea").click()
    page.keyboard.type(words)
    page.keyboard.press("Enter")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    DRIVE.open(page)
    page.evaluate(SETUP, ORIGIN)
    page.keyboard.press("Control+Shift+A")
    wait_for(page, "document.querySelector('.ask textarea')", "the composer")

    send(page, "first question")
    wait_for(page, "document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the first answer")
    first = page.evaluate(STATE)["open"]
    page.evaluate("async () => (await window.nibApp.aiChats()).newThread()")
    page.wait_for_timeout(100)
    send(page, "second question")
    page.wait_for_timeout(200)
    if page.evaluate(STATE)["open"] == first:
        wrong("New chat right after the first question kept the first chat open")
    second = page.evaluate(STATE)["open"]
    page.evaluate("async () => (await window.nibApp.aiChats()).newThread()")
    send(page, "third question")
    page.wait_for_timeout(200)
    third = page.evaluate(STATE)["open"]
    say(f"three chats answering: {page.evaluate(STATE)}")

    for at in range(30):
        target = [first, second, third][at % 3]
        page.evaluate("async (id) => { const chat = await window.nibApp.aiChats(); void chat.openThread(id, false) }", target)
        page.wait_for_timeout(15)
    page.evaluate("async (id) => (await window.nibApp.aiChats()).archive(id)", first)
    page.evaluate("async (id) => { void (await window.nibApp.aiChats()).remove(id) }", second)
    page.get_by_role("button", name="Delete").last.click(timeout=5000)
    page.keyboard.press("Escape")
    send(page, "again while the others go")
    page.wait_for_timeout(200)
    for at in range(10):
        page.evaluate("async () => { const chat = await window.nibApp.aiChats(); chat.stop() }")
        send(page, f"once more {at}")
        page.wait_for_timeout(30)

    deadline = time.time() + 30
    state = page.evaluate(STATE)
    while time.time() < deadline and (state["running"] or state["stop"]):
        page.wait_for_timeout(500)
        state = page.evaluate(STATE)
    say(f"after the storm: {state}")
    if state["running"]:
        wrong(f"chats still running 30 s on: {state['running']}")
    if state["stop"]:
        wrong("the Stop button stayed")
    if second in state["ids"]:
        wrong("the deleted chat is still listed")
    if first not in state["archived"]:
        wrong("the archived chat is not archived")
    page.wait_for_timeout(1500)
    again = page.evaluate("async () => { const chat = await window.nibApp.aiChats(); await chat.refresh?.(); return chat.every.map((one) => one.id) }")
    if second in again:
        wrong("the deleted chat came back from storage")
    if errors:
        wrong(f"page errors: {errors[:5]}")
    DRIVE.shot(page, "after")
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the AI panel through three chats answering at once, switched, archived, deleted and stopped"))
