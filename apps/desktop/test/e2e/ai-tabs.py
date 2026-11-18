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

CHATS = """
() => window.ordenApp.workspace.tabs
  .filter((one) => one.kind === 'chat')
  .map((one) => ({ id: one.id, name: one.name, thread: one.address ?? null }))
"""

ACTIVE = "() => window.ordenApp.workspace.active?.id ?? null"

SAID = "() => [...document.querySelectorAll('.ask.wide .said .bubble')].map((one) => one.textContent.trim())"

def waited(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)

def idle(page: Page) -> bool:
    return waited(page, "!document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the answer to end")

def send(page: Page, field: str, words: str) -> None:
    page.locator(field).click()
    page.keyboard.type(words)
    page.keyboard.press("Enter")
    waited(page, f"[...document.querySelectorAll('.said .bubble')].some((one) => one.textContent.includes({json.dumps(words)}))", f"{words!r} sent")
    idle(page)

def drag_row(page: Page, title: str) -> None:
    page.locator(".ask:not(.wide) .row", has_text=title).first.drag_to(
        page.locator(".tabs").first, target_position={"x": 40, "y": 12}
    )

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
    send(page, ".ask textarea", "What does a heron do?")
    page.locator('.ask .top button[aria-label="Back"]').click()
    waited(page, "document.querySelector('.ask .home')", "a fresh side chat")
    Model.words = ["Kestrels ", "hover."]
    send(page, ".ask textarea", "Where do kestrels hover?")
    page.locator('.ask .top button[aria-label="Back"]').click()
    waited(page, "document.querySelectorAll('.ask .home .recent .row').length >= 2", "both chats listed")
    shot(page, f"{tag}01-side-list")

    drag_row(page, "What does a heron do?")
    if not waited(page, f"({CHATS})().length === 1", "a chat tab from the drag"):
        wrong(f"dragging a chat onto the tab bar made no chat tab: {page.evaluate(CHATS)}")
        page.context.close()
        return
    waited(page, f"({SAID})().some((one) => one.includes('What does a heron do?'))", "the heron chat in its tab")
    first = page.evaluate(CHATS)[0]
    if first["name"] != "What does a heron do?" or not first["thread"]:
        wrong(f"the dragged chat's tab is not named and bound to its chat: {first}")
    else:
        say(f"dragged                -> {first['name']!r}")
    if not waited(page, "document.querySelector('.ask:not(.wide) .threads')", "the side back to its list", 5):
        wrong("the side still shows the chat that moved into a tab")
    shot(page, f"{tag}02-dragged")

    drag_row(page, "Where do kestrels hover?")
    waited(page, f"({CHATS})().length === 2", "a second chat tab")
    waited(page, f"({SAID})().some((one) => one.includes('Where do kestrels hover?'))", "the kestrel chat in its tab")
    second = next((one for one in page.evaluate(CHATS) if one["id"] != first["id"]), None)
    if not second or second["thread"] == first["thread"]:
        wrong(f"the second chat did not get a tab of its own: {page.evaluate(CHATS)}")

    page.locator(f'.pick[data-tab="{first["id"]}"]').click()
    if not waited(page, f"({SAID})().some((one) => one.includes('What does a heron do?'))", "the heron chat back"):
        wrong(f"going back to the first chat tab does not show its chat: {page.evaluate(SAID)}")
    if any("kestrels" in one for one in page.evaluate(SAID)):
        wrong("the first chat tab still shows the second chat")
    shot(page, f"{tag}03-two-tabs")

    drag_row(page, "What does a heron do?")
    page.wait_for_timeout(400)
    if len(page.evaluate(CHATS)) != 2:
        wrong(f"dragging a chat that has a tab made another: {page.evaluate(CHATS)}")

    page.keyboard.press("Control+KeyT")
    waited(page, "document.querySelector('[data-new-here] .kind')", "the new tab's kinds")
    page.locator('[data-new-here] .kind:has-text("New AI chat")').first.click()
    if not waited(page, f"({CHATS})().length === 3", "a new AI chat tab"):
        wrong(f"New AI chat made no chat tab: {page.evaluate(CHATS)}")
    waited(page, "document.activeElement?.matches('.ask.wide textarea')", "the new chat's field")
    if page.evaluate(SAID):
        wrong(f"a new AI chat tab is not empty: {page.evaluate(SAID)}")
    shot(page, f"{tag}04-new-ai-chat")
    Model.words = ["Owls ", "hoot."]
    send(page, ".ask.wide textarea", "Why do owls hoot?")
    active = page.evaluate(ACTIVE)
    made = next((one for one in page.evaluate(CHATS) if one["id"] == active), None)
    if not waited(page, f"({CHATS})().some((one) => one.id === {json.dumps(active)} && one.thread && one.name === 'Why do owls hoot?')", "the new chat named"):
        wrong(f"the new chat's tab did not take its chat's name: {made}")
    shot(page, f"{tag}05-new-chat-answered")

    page.locator(f'.pick[data-tab="{second["id"] if second else first["id"]}"]').click()
    waited(page, f"({SAID})().some((one) => one.includes('Where do kestrels hover?'))", "the kestrel chat back")
    page.locator(f'.pick[data-tab="{active}"]').click()
    if not waited(page, f"({SAID})().some((one) => one.includes('Why do owls hoot?'))", "the owl chat back"):
        wrong(f"the new chat's tab lost its chat: {page.evaluate(SAID)}")
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("an AI chat opens as its own tab, dragged from the side or made from a new tab")

raise SystemExit(main())
