import http.server
import json
import re
import sys
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
def idOf(told: str, where: str) -> str:
    found = re.search(rf"^(s\d+) \| [^\n]*{re.escape(where)} \|", told, re.M)
    return found.group(1) if found else "missing"
class Model(http.server.BaseHTTPRequestHandler):
    told: list[str] = []
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
    def _json(self, value: object) -> None:
        raw = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self) -> None:  # noqa: N802
        self._json({"data": [{"id": "fake-small", "name": "Fake Small", "context_length": 32000}]})
    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        told = next((one["content"] for one in body.get("messages", []) if one.get("role") == "system"), "")
        Model.told.append(told)
        typewriter = idOf(told, "Typewriter mode")
        ligatures = idOf(told, "Ligatures")
        words = json.dumps({
            "say": "Typewriter mode is under Editor.",
            "show": [typewriter],
            "change": [{"id": typewriter, "to": True}, {"id": ligatures, "to": "all"}],
        })
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self._cors()
            self.end_headers()
            for event in [{"choices": [{"delta": {"content": words}}]}, {"choices": [{"delta": {}, "finish_reason": "stop"}]}]:
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            return
        self._json({"choices": [{"message": {"role": "assistant", "content": words}, "finish_reason": "stop"}]})
MODEL_ORIGIN = DRIVE.side(Model)
SETUP = """
async (base) => {
  const ai = window.ordenApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
}
"""
HELD = "() => ({ typewriter: window.ordenApp.modes.typewriter, ligatures: window.ordenApp.modes.ligatures })"
def waited(page: Page, expression: str, what: str, patience: float = 20) -> bool:
    return DRIVE.waited(page, expression, what, patience)
def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    page.evaluate(SETUP, MODEL_ORIGIN)
    before = page.evaluate(HELD)
    page.evaluate("() => window.ordenApp.settings.show('general')")
    if not waited(page, "document.querySelector('.asker input')", "the ask bar at the top of Settings"):
        wrong("Settings has no ask bar")
        page.context.close()
        return
    tag = f"{scheme}/"
    shot(page, f"{tag}01-bar")
    page.locator(".asker input").click()
    page.keyboard.type("Where is typewriter mode? Turn it on, and ligatures everywhere")
    page.keyboard.press("Enter")
    if not waited(page, "document.querySelector('.asker .answer')", "the agent's answer"):
        wrong("the ask bar showed no answer")
        page.context.close()
        return
    told = Model.told[-1] if Model.told else ""
    if "Typewriter mode | switch" not in told or "Ligatures | choice" not in told:
        wrong("the agent was not told the settings it may change")
    said = page.locator(".asker .said").inner_text()
    if "Typewriter mode is under Editor." not in said:
        wrong(f"the answer's words are missing: {said!r}")
    changes = page.locator(".asker .change").all_inner_texts()
    if len(changes) != 2:
        wrong(f"the answer does not offer the two changes: {changes}")
    if page.evaluate(HELD) != before:
        wrong("a setting changed before it was confirmed")
    else:
        say("offered                -> two changes, none made yet")
    page.wait_for_timeout(400)
    shot(page, f"{tag}02-answer")
    page.locator(".asker .answer button.row").first.click()
    if not waited(page, "window.ordenApp.settings.section === 'editor'", "Settings to open Editor"):
        wrong("showing the setting did not open its pane")
    waited(page, "!!document.querySelector('.orden-setting.landed')", "the setting lit where it lives", 5)
    page.locator(".asker .change", has_text="Typewriter mode").locator("button", has_text="Change").click()
    if not waited(page, f"({HELD})().typewriter === {json.dumps(not before['typewriter'])}", "Typewriter mode to change"):
        wrong("confirming the change did not make it")
    page.locator(".asker .change", has_text="Ligatures").locator("button", has_text="Skip").click()
    page.wait_for_timeout(300)
    if page.evaluate(HELD)["ligatures"] != before["ligatures"]:
        wrong("a skipped change was made anyway")
    else:
        say("confirmed one          -> made; the skipped one is not")
    shot(page, f"{tag}03-settled")
    page.context.close()
def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("Settings has an ask bar whose agent finds settings and changes one only once confirmed")
raise SystemExit(main())
