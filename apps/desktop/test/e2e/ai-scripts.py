import http.server
import json
from playwright.sync_api import Browser
from harness import Drive
from settling import HIDE_CARET

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
ANSWER = (
    "MAD ≈ P<sub>diast</sub> + ⅓ × (P<sub>syst</sub> − P<sub>diast</sub>)\n\n"
    "Water is H~2~O, and the area is r^2^ times π.\n\n"
    "In maths: $MAP = P_{diast} + \\frac{1}{3}(P_{syst} - P_{diast})$\n"
)
SETUP = """(base) => {
  const ai = window.ordenApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
}"""
IDLE = "!document.querySelector('.ask .go[aria-label=\"Stop\"]')"
SCRIPTS = """() => {
  const answer = [...document.querySelectorAll('.ask .answer, .ask .reply, .ask .model')].at(-1)
    ?? document.querySelector('.ask')
  return {
    sub: [...answer.querySelectorAll('sub')].map((one) => one.textContent),
    sup: [...answer.querySelectorAll('sup')].map((one) => one.textContent),
    maths: answer.querySelectorAll('.math-inline').length,
    raw: /&lt;su[bp]|<su[bp]>|~2~|\\^2\\^/.test(answer.textContent),
  }
}"""
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
        raw = json.dumps({"data": [{"id": "fake-small", "name": "Fake Small", "context_length": 32000}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)
    def do_POST(self) -> None:  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        try:
            for event in (
                {"model": "fake-small", "choices": [{"delta": {"content": ANSWER}}]},
                {"model": "fake-small", "choices": [{"delta": {}, "finish_reason": "stop"}]},
            ):
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return
def drive(browser: Browser) -> None:
    origin = DRIVE.side(Model)
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 760}, color_scheme=scheme)
        page.context.add_init_script(HIDE_CARET)
        DRIVE.open(page)
        page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")
        DRIVE.seed(page, "# Pressure\n\nMean arterial pressure.\n")
        page.evaluate(SETUP, origin)
        DRIVE.open_note(page, "Pressure")
        page.evaluate("() => window.orden.focus()")
        page.keyboard.press("Control+Shift+A")
        page.wait_for_selector(".ask textarea")
        page.locator(".ask textarea").click()
        page.keyboard.type("What is the mean arterial pressure?")
        page.keyboard.press("Enter")
        wait_for(page, "document.querySelector('.ask .said .bubble')", "the message")
        wait_for(page, IDLE, "the answer to end")
        wait_for(page, "document.querySelectorAll('.ask sub').length >= 3", "the subscripts")
        found = page.evaluate(SCRIPTS)
        say(f"{scheme}: {found}")
        if found["sub"][:4] != ["diast", "syst", "diast", "2"]:
            wrong(f"{scheme}: the subscripts read {found['sub']}")
        if "2" not in found["sup"]:
            wrong(f"{scheme}: the superscripts read {found['sup']}")
        if found["maths"] < 1:
            wrong(f"{scheme}: the maths was not drawn")
        if found["raw"]:
            wrong(f"{scheme}: a tag or marker shows as text")
        DRIVE.settled(page)
        DRIVE.shot(page, f"{scheme}-answer")
        page.context.close()
raise SystemExit(DRIVE.run(drive, "an answer's subscripts and superscripts are drawn, whichever way they are written"))
