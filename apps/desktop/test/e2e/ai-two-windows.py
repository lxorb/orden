from __future__ import annotations

import http.server
import json
import threading
import time

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong



class Model(http.server.BaseHTTPRequestHandler):

    held = threading.Lock()
    now = 0
    most = 0

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

    def do_POST(self) -> None:  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        with Model.held:
            Model.now += 1
            Model.most = max(Model.most, Model.now)
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        try:
            time.sleep(1.5)
            for event in ({"choices": [{"delta": {"content": "Herons sleep standing."}}]}, {"choices": [{"delta": {}, "finish_reason": "stop"}]}):
                self.wfile.write(f"data: {json.dumps({'model': 'fake-small', **event})}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            pass
        finally:
            with Model.held:
                Model.now -= 1


SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
  return made.id
}
"""

SEED = """async (provider) => {
  const chat = await window.nibApp.aiChats()
  const { writeThread } = await import('/src/lib/ai/chat/threads.ts')
  const space = chat.space || chat.spaces[0]
  const now = Date.now()
  await writeThread({ id: 'twin', space, title: 'Herons', provider, model: 'fake-small', effort: 'medium', mode: 'ask',
    turns: [{ id: 'u1', role: 'you', at: now - 2000, parts: [], draft: { text: 'Where do herons sleep?', attachments: [] } },
            { id: 'm1', role: 'model', at: now - 1000, parts: [{ kind: 'text', text: 'In trees.' }] }],
    usage: { input: 0, output: 0 }, created: now - 3000, updated: now - 1000 })
  return space
}"""

OPEN = """async () => { const chat = await window.nibApp.aiChats(); await chat.openThread('twin', false); return chat.thread?.title }"""
STORED = """async (space) => { const { readThread } = await import('/src/lib/ai/chat/threads.ts'); const t = await readThread(space, 'twin'); return t ? { title: t.title, pinned: !!t.pinned, archived: !!t.archived } : null }"""
STORED_TURNS = """async (space) => { const { readThread } = await import('/src/lib/ai/chat/threads.ts'); const t = await readThread(space, 'twin'); return t ? t.turns.map((turn) => turn.role === 'you' ? 'you' : 'model:' + turn.parts.map((part) => part.text || '').join('')) : null }"""
BUSY = """async () => (await window.nibApp.aiChats()).running.length > 0"""
HEADS = """async () => (await window.nibApp.aiChats()).heads.map((one) => one.id)"""


def drive(browser: Browser) -> None:
    a = DRIVE.page(browser, viewport={"width": 1200, "height": 800})
    DRIVE.open(a)
    provider = a.evaluate(SETUP, DRIVE.side(Model))
    a.keyboard.press("Control+Shift+A")
    a.wait_for_timeout(800)
    space = a.evaluate(SEED, provider)
    b = a.context.new_page()
    b.on("pageerror", lambda error: wrong(f"page error in B: {error}"))
    DRIVE.open(b)
    b.keyboard.press("Control+Shift+A")
    b.wait_for_timeout(800)
    say(f"A opened {a.evaluate(OPEN)!r}, B opened {b.evaluate(OPEN)!r}")
    a.evaluate("async () => (await window.nibApp.aiChats()).rename('Herons at night', 'twin')")
    a.wait_for_timeout(600)
    b.evaluate("async () => (await window.nibApp.aiChats()).pin('twin')")
    b.wait_for_timeout(600)
    kept = a.evaluate(STORED, space)
    say(f"after a rename in A and a pin in B: {kept}")
    if not kept or kept["title"] != "Herons at night" or not kept["pinned"]:
        wrong(f"one window wrote over the other: {kept}")
    asks = "async (words) => (await window.nibApp.aiChats()).send(words)"
    a.evaluate(asks, "Asked in A")
    b.evaluate(asks, "Asked in B")
    for _ in range(100):
        told = a.evaluate(STORED_TURNS, space)
        if told and told.count("you") == 3 and told[-1] == "model:Herons sleep standing." and not a.evaluate(BUSY) and not b.evaluate(BUSY):
            break
        a.wait_for_timeout(200)
    told = a.evaluate(STORED_TURNS, space)
    say(f"after a send in A and in B at once: {Model.most} answered at a time, stored {told}")
    if Model.most != 1:
        wrong(f"two windows answered the same chat at once ({Model.most} at a time)")
    if not told or told.count("you") != 3:
        wrong(f"a message sent in one window was lost: {told}")
    a.evaluate("async (space) => { const { deleteThread } = await import('/src/lib/ai/chat/threads.ts'); await deleteThread(space, 'twin') }", space)
    a.wait_for_timeout(600)
    b.evaluate("async () => (await window.nibApp.aiChats()).pin('twin', false)")
    b.wait_for_timeout(600)
    gone = a.evaluate(STORED, space)
    say(f"after a delete in A and an unpin in B: stored {gone}, B lists {b.evaluate(HEADS)}")
    if gone is not None:
        wrong(f"a chat deleted in one window came back from the other: {gone}")
    if "twin" in b.evaluate(HEADS):
        wrong("a chat deleted in one window is still listed in the other")
    a.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "two windows on one AI chat keep each other's changes"))
