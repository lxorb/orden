from __future__ import annotations

import http.server
import io
import json

from PIL import Image, ImageChops
from playwright.sync_api import Browser, Page

from harness import Drive
from settling import HIDE_CARET

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

THEMES = ("default", "glass", "wallpaper", "contrast")
SCHEMES = ("light", "dark")
SHEET = "document.getElementById('orden-user-theme')?.textContent ?? ''"
SETUP = """(base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
}"""
IDLE = "!document.querySelector('.ask .go[aria-label=\"Stop\"]')"

BOX = """(selector) => {
  const one = [...document.querySelectorAll(selector)].at(-1)
  if (!one) return null
  one.scrollIntoView({ block: 'center' })
  const box = one.getBoundingClientRect()
  const corner = Math.ceil(parseFloat(getComputedStyle(one).borderTopLeftRadius) || 0)
  return { x: Math.ceil(box.left), y: Math.ceil(box.top), width: Math.floor(box.width), height: Math.floor(box.height), corner }
}"""

SHOWN = """([selector, how]) => {
  const one = [...document.querySelectorAll(selector)].at(-1)
  one.style.setProperty('color', 'transparent', 'important')
  one.style.setProperty('visibility', how, 'important')
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
                {"model": "fake-small", "choices": [{"delta": {"content": "Herons wait."}}]},
                {"model": "fake-small", "choices": [{"delta": {}, "finish_reason": "stop"}]},
            ):
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return

def look(page: Page, theme: str, scheme: str) -> None:
    page.evaluate(f"() => window.nibApp.theme.select('{theme}')")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    if theme == "wallpaper":
        wait_for(page, f"{SHEET}.includes('--wallpaper-field')", "the wallpaper's sheet")
    page.wait_for_timeout(400)

def framed(page: Page, name: str, selector: str) -> None:
    page.mouse.move(1, 1)
    box = page.evaluate(BOX, selector)
    if not box or box["width"] < 20 or box["height"] < 12:
        wrong(f"{name}: no message to look at ({box})")
        return
    page.wait_for_timeout(150)
    corner = box.pop("corner")
    left, top = max(0, box["x"] - 48), max(0, box["y"] - 32)
    view = page.viewport_size or {"width": 1280, "height": 820}
    right = min(view["width"], box["x"] + box["width"] + 48)
    bottom = min(view["height"], box["y"] + box["height"] + 32)
    around = {"x": left, "y": top, "width": right - left, "height": bottom - top}
    DRIVE.shot(page, name, clip=around, animations="disabled")
    page.evaluate(SHOWN, [selector, "visible"])
    shown = Image.open(io.BytesIO(page.screenshot(clip=box, animations="disabled"))).convert("RGB")
    page.evaluate(SHOWN, [selector, "hidden"])
    bare = Image.open(io.BytesIO(page.screenshot(clip=box, animations="disabled"))).convert("RGB")
    page.evaluate(f"(selector) => [...document.querySelectorAll(selector)].at(-1).removeAttribute('style')", selector)
    difference = ImageChops.difference(shown, bare)
    width, height = difference.size
    inside = [
        max(difference.getpixel((x, y)))
        for y in range(corner, height - corner)
        for x in range(corner, width - corner)
    ]
    apart = sum(1 for one in inside if one >= 6) / max(1, len(inside))
    say(f"{name}: {apart:.0%} of the message stands apart from its ground")
    if apart < 0.9:
        wrong(f"{name}: the reader's message has no frame, {apart:.0%} of it stands apart from what is under it")

def every_look(page: Page, where: str, selector: str) -> None:
    for theme in THEMES:
        for scheme in SCHEMES:
            look(page, theme, scheme)
            framed(page, f"{where}-{theme}-{scheme}", selector)
    look(page, "default", "light")

def drive(browser: Browser) -> None:
    origin = DRIVE.side(Model)
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme="light")
    page.context.add_init_script(HIDE_CARET)
    DRIVE.open(page)
    DRIVE.seed(page, "# Herons\n\nA heron stands still.\n")
    page.evaluate(SETUP, origin)
    wait_for(page, "window.nibApp.wallpaper", "the wallpaper store on the handle")
    DRIVE.open_note(page, "Herons")

    say("the side's chat")
    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+Shift+A")
    page.wait_for_selector(".ask textarea")
    page.locator(".ask textarea").click()
    page.keyboard.type("What does a heron do?")
    page.keyboard.press("Enter")
    wait_for(page, "document.querySelector('.ask .said .bubble')", "the message")
    wait_for(page, IDLE, "the answer to end")
    every_look(page, "side", ".ask .said .bubble")

    say("the chat as a tab")
    page.locator(".ask .title").click()
    page.locator(".menu [role=menuitem]").filter(has_text="Open in new tab").first.click()
    wait_for(page, "document.querySelector('.ask.wide .said .bubble')", "the chat in a tab")
    every_look(page, "tab", ".ask.wide .said .bubble")

    say("the quick question")
    DRIVE.open_note(page, "Herons")
    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control")
    page.keyboard.press("Control")
    wait_for(page, "document.querySelector('.quick textarea')", "the quick question")
    page.locator(".quick textarea").fill("What do herons eat?")
    page.locator(".quick textarea").press("Enter")
    wait_for(page, "document.querySelector('.quick .acts')", "the quick answer")
    every_look(page, "quick", ".quick .said")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
