import http.server
import json
import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERONS = "# Herons\n\nA heron stands still in the shallows for a long time.\n"

class Model(http.server.BaseHTTPRequestHandler):

    words: list[str] = ["Still."]
    bodies: list[str] = []

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
        Model.bodies.append(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8", "replace"))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        events = [{"choices": [{"delta": {"content": word}}]} for word in Model.words]
        events.append({"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
        try:
            for event in events:
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return

MODEL_ORIGIN = DRIVE.side(Model)

SETUP = """
async (base) => {
  const ai = window.ordenApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
  return made.id
}
"""

MAIN = "() => [...document.querySelectorAll('.ask .room > .talk > *')].map((one) => one.textContent.trim()).filter(Boolean)"

SIDE = "() => [...document.querySelectorAll('.ask .side .talk > *')].map((one) => one.textContent.trim()).filter(Boolean)"

def waited(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)

def idle(page: Page) -> bool:
    return waited(page, "!document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the answer to end")

def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    DRIVE.seed(page, HERONS)
    page.evaluate(SETUP, MODEL_ORIGIN)
    DRIVE.open_note(page, "Herons")
    page.evaluate("() => window.orden.focus()")
    page.keyboard.press("Control+Shift+A")
    waited(page, "document.querySelector('.ask textarea')", "the side chat")
    tag = f"{scheme}/"

    Model.words = ["Herons ", "wait."]
    page.locator(".ask .composer textarea").click()
    page.keyboard.type("What does a heron do?")
    page.keyboard.press("Enter")
    waited(page, f"({MAIN})().some((one) => one.includes('Herons wait.'))", "the main answer")
    idle(page)

    Model.bodies.clear()
    Model.words = ["Egrets ", "too."]
    page.locator(".ask .composer textarea").click()
    page.keyboard.type("/btw And egrets?")
    page.keyboard.press("Enter")
    if not waited(page, "document.querySelector('.ask .side')", "the side chat to open"):
        wrong("/btw opened no side chat beside the chat")
        page.context.close()
        return
    if not waited(page, f"({SIDE})().some((one) => one.includes('Egrets too.'))", "the side answer"):
        wrong(f"the side chat did not answer: {page.evaluate(SIDE)}")
    if any("egrets" in one.lower() for one in page.evaluate(MAIN)):
        wrong(f"the side question went into the main chat: {page.evaluate(MAIN)}")
    else:
        say("side answered          -> the main chat is as it was")
    if not any("What does a heron do?" in one and "Herons wait." in one for one in Model.bodies):
        wrong("the side question did not carry the chat it was asked beside")
    else:
        say("side carried           -> the main chat as context")
    if page.locator(".orden-scrim").count():
        wrong("the side chat covers the app with a scrim")
    shot(page, f"{tag}01-side-open")

    Model.words = ["Herons ", "also ", "fish."]
    page.locator(".ask .composer textarea").click()
    page.keyboard.type("And what else?")
    page.keyboard.press("Enter")
    if not waited(page, f"({MAIN})().some((one) => one.includes('Herons also fish.'))", "the main chat going on beside it"):
        wrong(f"the main chat did not go on while the side chat was open: {page.evaluate(MAIN)}")
    idle(page)

    page.locator('.ask .side button[aria-label="Hide the side chat"]').click()
    if not waited(page, "!document.querySelector('.ask .side') && !!document.querySelector('.ask .tucked')", "the side chat hidden to its pill"):
        wrong("hiding the side chat left no way back to it")
    shot(page, f"{tag}02-side-hidden")

    page.locator(".ask .tucked .orden-chip").click()
    if not waited(page, f"({SIDE})().some((one) => one.includes('Egrets too.'))", "the side chat back as it was"):
        wrong(f"the side chat came back without its chat: {page.evaluate(SIDE)}")
    Model.words = ["In ", "reeds."]
    page.locator('.ask .side textarea').click()
    page.keyboard.type("Where do they nest?")
    page.keyboard.press("Enter")
    if not waited(page, f"({SIDE})().some((one) => one.includes('In reeds.'))", "the side chat going on"):
        wrong(f"the side chat did not go on after it came back: {page.evaluate(SIDE)}")
    shot(page, f"{tag}03-side-continued")

    page.keyboard.press("Escape")
    waited(page, "!document.querySelector('.ask .side')", "Escape to hide the side chat")
    page.locator(".ask .tucked button[aria-label='End the side chat']").click()
    if not waited(page, "!document.querySelector('.ask .tucked') && !document.querySelector('.ask .side')", "the side chat ended"):
        wrong("ending the side chat left it behind")
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("/btw opens a side chat beside the chat, which hides and comes back where it was")

raise SystemExit(main())
