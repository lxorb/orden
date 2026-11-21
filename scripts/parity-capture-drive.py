from __future__ import annotations
import argparse
import http.server
import json
import os
import pathlib
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from fresh_app import ended, fresh
from native_app import config_of, endpoint

BOUND = 1.0
SAID: list[tuple[float, str]] = []
PAGE = b"""<!doctype html><title>call</title><body style="margin:0;height:100vh;background:#def">
<video id="me" autoplay muted playsinline style="width:320px;height:240px;background:#000"></video>
<script>
const say = (what) => fetch('/said?' + encodeURIComponent(what)).catch(() => undefined)
say('webdriver ' + navigator.webdriver)
navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((got) => {
  document.getElementById('me').srcObject = got
  say('camera ' + got.getTracks().map((one) => one.kind + ':' + one.readyState).join(','))
  setInterval(() => fetch('/tick?' + got.getTracks().map((one) => one.kind + ':' + one.readyState).join(',')).catch(() => undefined), 100)
}, (error) => say('refused ' + error.name))
</script>"""
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass
    def do_GET(self) -> None:
        if self.path.startswith(("/said", "/tick")):
            SAID.append((time.monotonic(), self.path))
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE if self.path.startswith("/call") else b"<!doctype html><title>other</title><p>other")
def last(prefix: str) -> str:
    found = [path for _, path in SAID if path.startswith(prefix)]
    return found[-1] if found else ""
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{site.server_address[1]}"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    env = {
        **os.environ,
        "ORDEN_SPACES_DIR": tempfile.mkdtemp(prefix="orden-capture-"),
        "ORDEN_CEF_ARGS": ",".join(filter(None, ["use-fake-device-for-media-stream", os.environ.get("ORDEN_CEF_ARGS")])),
    }
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
    rows: list[dict[str, object]] = []
    try:
        app = endpoint(config, process.pid, secret, 60)
        app.until("!!orden.workspace?.activeSpace", 90)
        time.sleep(2)
        for way in ("shown", "behind another tab"):
            SAID.clear()
            tab = app.eval(f"return orden.workspace.openPage({json.dumps(base + '/call')})")
            asked = app.until(
                "const one = [...document.querySelectorAll('[role=alertdialog] button')].find((it) => it.textContent.trim() === 'Allow'); if (!one) return null; one.click(); return true",
                30,
            )
            stop = time.monotonic() + 20
            while time.monotonic() < stop and "video%3Alive" not in last("/said"):
                time.sleep(0.2)
            live = "video%3Alive" in last("/said")
            marked = last("/said?webdriver")
            if way != "shown":
                app.eval(f"return orden.workspace.openPage({json.dumps(base + '/other')})")
                time.sleep(2)
            stop = time.monotonic() + 5
            while time.monotonic() < stop and not any(path.startswith("/tick") for _, path in SAID):
                time.sleep(0.1)
            ticking = any(path.startswith("/tick") for _, path in SAID)
            app.eval(f"orden.workspace.close({json.dumps(tab)}); return true")
            closed = time.monotonic()
            time.sleep(BOUND + 3)
            late = [round(at - closed, 2) for at, path in SAID if at > closed + BOUND and path.startswith("/tick")]
            row = {"way": way, "asked": asked is True, "automation mark": marked, "live": live, "ticking": ticking, "ticks after the bound": len(late), "last tick after close s": late[-1] if late else None}
            unmarked = marked == "/said?webdriver%20false"
            deviceless = not live and "refused%20NotFoundError" in last("/said")
            row["ok"] = unmarked if deviceless else bool(unmarked and live and ticking and not late)
            if deviceless:
                row["camera"] = "not measured: this machine has no camera and a release build takes no fake one"
            print(f"a call page sees no automation mark and its capture ends within {BOUND} s of its tab closing ({way}): {json.dumps(row)}", flush=True)
            rows.append(row)
    finally:
        ended(process, gentle=True)
        (args.out / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    wrong = [row for row in rows if not row["ok"]] or ([] if rows else [{"why": "no round ran"}])
    for row in wrong:
        print(f"::error::a call page saw an automation mark or its capture did not end within {BOUND} s of its tab closing: {json.dumps(row)}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    sys.exit(main())
