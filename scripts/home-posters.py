#!/usr/bin/env python3
import functools
import http.server
import io
import re
import socketserver
import sys
import threading
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

DIST, OUT = Path(sys.argv[1]), Path(sys.argv[2])
CUE = Path(__file__).resolve().parent.parent / "apps/desktop/src/lib/showcase/src/demo-cue.ts"
SCENES = re.findall(r"'(\w+)'", re.search(r"DEMO_LOOP_SCENES = \[([^\]]*)\]", CUE.read_text()).group(1))
SIZES = {"desktop": (1280, 800), "phone": (390, 844)}
PORT = 8791
HEARD = """window.__ready = false
addEventListener('message', (event) => {
  if (event.data && event.data.orden === 'demo' && event.data.ready === true) window.__ready = true
})"""
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
class Serving(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
server = Serving(("127.0.0.1", PORT), functools.partial(Quiet, directory=str(DIST)))
threading.Thread(target=server.serve_forever, daemon=True).start()
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    for device, (wide, tall) in SIZES.items():
        for theme in ("light", "dark"):
            context = browser.new_context(viewport={"width": wide, "height": tall}, color_scheme=theme, device_scale_factor=2)
            context.add_init_script(HEARD)
            for scene in SCENES:
                page = context.new_page()
                phone = "&phone" if device == "phone" else ""
                page.goto(f"http://127.0.0.1:{PORT}/?demo={scene}&loop&hold{phone}", wait_until="load")
                page.wait_for_function("window.__ready === true", timeout=60000)
                page.wait_for_timeout(1500)
                shot = Image.open(io.BytesIO(page.screenshot()))
                shot.convert("RGB").save(OUT / f"{scene}-{device}-{theme}.webp", "WEBP", quality=72, method=6)
                print(scene, device, theme, flush=True)
                page.close()
            context.close()
    browser.close()
server.shutdown()
