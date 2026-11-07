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
        for at in range(300):
            try:
                self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': f'word{at}\\n\\n'}}]})}\n\n".encode())
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
  const ai = window.ordenApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
}
"""

STATE = """async () => {
  const chat = await window.ordenApp.aiChats()
  return { running: [...chat.running], open: chat.head?.id ?? null, ids: chat.every.map((one) => one.id),
    archived: chat.every.filter((one) => one.archived).map((one) => one.id),
    stop: !!document.querySelector('.ask .go[aria-label="Stop"]'), trouble: chat.trouble }
}"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    page.evaluate(SETUP, ORIGIN)
    page.evaluate("async () => (await import('/src/lib/ai/quick.svelte.ts')).quick.show()")
    wait_for(page, "document.querySelector('.quick textarea')", "the quick question")
    page.locator(".quick textarea").click()
    page.keyboard.type("Tell me a long story")
    page.keyboard.press("Enter")
    wait_for(page, "(document.querySelector('.quick .talk')?.scrollHeight ?? 0) > (document.querySelector('.quick .talk')?.clientHeight ?? 0) + 300", "an answer longer than the sheet")
    page.evaluate("() => { document.querySelector('.quick .talk').scrollTop = 0 }")
    page.wait_for_timeout(1500)
    top = page.evaluate("() => { const box = document.querySelector('.quick .talk'); return { top: box.scrollTop, height: box.scrollHeight, room: box.clientHeight } }")
    say(f"scrolled to the top while the answer streams, 1.5 s on: {top}")
    if top["top"] > 50:
        wrong("the answer pulled the reader back down while they read above")
    page.evaluate("() => { const box = document.querySelector('.quick .talk'); box.scrollTop = box.scrollHeight }")
    page.wait_for_timeout(800)
    end = page.evaluate("() => { const box = document.querySelector('.quick .talk'); return box.scrollHeight - box.scrollTop - box.clientHeight }")
    say(f"back at the end, 0.8 s on, {end:.0f} px from it")
    if end > 30:
        wrong("back at the end, the answer is not followed")
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a quick question's answer is followed only while the reader is at its end"))
