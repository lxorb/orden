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
        attachments = idOf(told, "Attachments")
        words = json.dumps({
            "say": "Typewriter mode is under Editor.",
            "show": [typewriter],
            "change": [{"id": typewriter, "to": True}, {"id": attachments, "to": "note"}],
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
SEARCH = '[aria-label=Settings] nav .search input'
ASK = ".orden-setting.setting.ask"
HELD = "() => ({ typewriter: window.ordenApp.modes.typewriter, attachments: window.ordenApp.modes.attachments })"
def waited(page: Page, expression: str, what: str, patience: float = 20) -> bool:
    return DRIVE.waited(page, expression, what, patience)
def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    page.evaluate(SETUP, MODEL_ORIGIN)
    before = page.evaluate(HELD)
    page.evaluate("() => window.ordenApp.settings.show('general')")
    if not waited(page, f"document.querySelector('{SEARCH}')", "the search field of Settings"):
        wrong("Settings has no search field")
        page.context.close()
        return
    tag = f"{scheme}/"
    question = "Where is typewriter mode? Turn it on, and save attachments next to the note"
    page.locator(SEARCH).click()
    page.keyboard.type(question)
    if not waited(page, f"document.querySelector('{ASK}')", "the Ask AI row under the results"):
        wrong("the search shows no Ask AI row")
        page.context.close()
        return
    offered = page.locator(ASK).inner_text().strip()
    if offered != f"Ask AI “{question}”":
        wrong(f"the Ask AI row reads {offered!r}")
    last = page.evaluate(
        f"() => {{ const rows = [...document.querySelectorAll('[role=\"region\"][aria-label=\"Settings\"] .orden-setting')];"
        f" return rows.at(-1) === document.querySelector('{ASK}') }}"
    )
    if not last:
        wrong("Ask AI is not the last row of the search")
    shot(page, f"{tag}01-search")
    page.locator(ASK).click()
    if not waited(page, "document.querySelector('.asker .answer')", "the agent's answer"):
        wrong("asking showed no answer")
        page.context.close()
        return
    told = Model.told[-1] if Model.told else ""
    if "Typewriter mode | switch" not in told or "Attachments | choice" not in told:
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
    page.locator(".asker .change", has_text="Typewriter mode").locator("button", has_text="Change").click()
    if not waited(page, f"({HELD})().typewriter === {json.dumps(not before['typewriter'])}", "Typewriter mode to change"):
        wrong("confirming the change did not make it")
    page.locator(".asker .change", has_text="Attachments").locator("button", has_text="Skip").click()
    page.wait_for_timeout(300)
    if page.evaluate(HELD)["attachments"] != before["attachments"]:
        wrong("a skipped change was made anyway")
    else:
        say("confirmed one          -> made; the skipped one is not")
    shot(page, f"{tag}03-settled")
    page.locator(".asker .answer button.row").first.click()
    if not waited(page, "window.ordenApp.settings.section === 'editor'", "Settings to open Editor"):
        wrong("showing the setting did not open its pane")
    waited(page, "!!document.querySelector('.orden-setting.landed')", "the setting lit where it lives", 5)
    page.locator(SEARCH).fill("zqxw vbnj")
    if not waited(page, f"document.querySelector('{ASK}')", "the Ask AI row for a search that finds nothing"):
        wrong("a search that finds nothing offers no Ask AI row")
    else:
        asked = len(Model.told)
        page.locator(SEARCH).press("Enter")
        if not waited(page, "!!document.querySelector('.asker .answer')", "Enter to ask") or len(Model.told) <= asked:
            wrong("Enter in a search that finds nothing did not ask")
        else:
            say("enter on no results    -> asked")
    page.context.close()
def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("the search of Settings ends in Ask AI, whose agent finds settings and changes one only once confirmed")
raise SystemExit(main())
