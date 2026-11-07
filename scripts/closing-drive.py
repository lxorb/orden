#!/usr/bin/env python3

import http.server
import json
import os
import socketserver
import sys
import threading
import time
import urllib.request
from pathlib import Path

OUT, PHASE = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "so.orden.Orden"
PORT_PAGES = 8768
SITE = f"http://127.0.0.1:{PORT_PAGES}"
PAGES = ["plain?1", "slow?1", "plain?2", "slow?2", "plain?3", "slow?3", "plain?4", "slow?4"]

class Pages(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        try:
            if self.path.startswith("/slow"):
                self.wfile.write(b"<!doctype html><title>slow</title><body>loading ")
                for _ in range(200):
                    self.wfile.write(b".")
                    self.wfile.flush()
                    time.sleep(0.1)
            else:
                self.wfile.write(b"<!doctype html><title>plain</title><body>a page")
        except OSError:
            pass

class Serving(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")

PORT, SECRET = endpoint()

def run(code, timeout=10.0):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(asked, timeout=timeout) as answer:
            said = json.loads(answer.read())
        return said.get("value") if said.get("ok") else said.get("error")
    except (TimeoutError, OSError):
        return None

WEB_TABS = "nib.workspace.tabs.filter((tab) => tab.kind === 'web').length"

threading.Thread(target=Serving(("127.0.0.1", PORT_PAGES), Pages).serve_forever, daemon=True).start()

for _ in range(60):
    if run("1 + 1") == 2:
        break
    time.sleep(0.5)
else:
    raise SystemExit(f"::error::{PHASE}: the window never answered")

if PHASE == "open":
    for page in PAGES:
        run("(nib.workspace.openWebsite(), 'opened')")
        time.sleep(0.3)
        run(f"(nib.pages.go(nib.workspace.activeTabId, {json.dumps(f'{SITE}/{page}')}), 'sent')")
        time.sleep(0.4)
    opened = run(WEB_TABS)
    print(f"open: {opened} web tabs")
    if opened != len(PAGES):
        raise SystemExit(f"::error::open: {opened} web tabs of {len(PAGES)}")
    sys.exit(0)

restored = run(WEB_TABS)
print(f"close: {restored} web tabs came back")
if not restored:
    raise SystemExit("::error::close: no web tab came back to close")
run(
    "(async () => { for (let i = 0; i < "
    + str(restored)
    + "; i++) { void nib.workspace.closeActive(); await new Promise((done) => setTimeout(done, 60)) } })()"
    ".then(() => 'closing')",
    20,
)

worst = 0.0
for i in range(50):
    began = time.monotonic()
    if run("1 + 1", 10) != 2:
        (OUT / "closing-stalled.txt").write_text(f"no answer after {i * 0.2:.1f} s\n")
        raise SystemExit(f"::error::close: the window stopped answering {i * 0.2:.1f} s after the tabs were closed")
    worst = max(worst, time.monotonic() - began)
    time.sleep(0.2)
print(f"close: the window answered for ten seconds, the slowest in {worst * 1000:.0f} ms")

left = run(WEB_TABS)
if left != 0:
    raise SystemExit(f"::error::close: {left} web tabs are still open")
print("close: every web tab is gone")
