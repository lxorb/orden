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
import urllib.parse
from fresh_app import ended, fresh
from native_app import config_of, endpoint

KEPT = 35
SAID: list[tuple[float, str]] = []
PAGE = b"""<!doctype html><title>session</title><body>
<script>
const say = (what) => fetch('/said?' + encodeURIComponent(what)).catch(() => undefined)
const stored = () => new Promise((done) => {
  const asked = indexedDB.open('session', 1)
  asked.onupgradeneeded = () => asked.result.createObjectStore('kept')
  asked.onerror = () => done(null)
  asked.onsuccess = () => {
    const db = asked.result
    if (location.pathname === '/login') {
      const writing = db.transaction('kept', 'readwrite')
      writing.objectStore('kept').put('signed-in', 'token')
      writing.oncomplete = () => done('signed-in')
      writing.onerror = () => done(null)
      return
    }
    const reading = db.transaction('kept').objectStore('kept').get('token')
    reading.onsuccess = () => done(reading.result ?? null)
    reading.onerror = () => done(null)
  }
})
if (location.pathname === '/login') localStorage.setItem('token', 'signed-in')
stored().then((kept) => say(JSON.stringify({ page: location.pathname, local: localStorage.getItem('token'), indexed: kept, webdriver: navigator.webdriver })))
</script>"""
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass
    def do_GET(self) -> None:
        if self.path.startswith("/said"):
            SAID.append((time.monotonic(), self.path + "|cookie=" + (self.headers.get("Cookie") or "")))
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "text/html")
        if self.path.startswith("/login"):
            self.send_header("set-cookie", "session=signed-in; Path=/; HttpOnly; SameSite=Lax")
            self.send_header("set-cookie", "kept=signed-in; Path=/; Max-Age=31536000; SameSite=Lax")
        self.end_headers()
        self.wfile.write(PAGE)
def heard(since: float, page: str, seconds: float = 30) -> dict[str, object] | None:
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        for at, path in SAID:
            if at < since:
                continue
            body, _, cookie = path.partition("|cookie=")
            try:
                said = json.loads(urllib.parse.unquote(body.split("?", 1)[1]))
            except (ValueError, IndexError):
                continue
            if said.get("page") == page:
                said["cookies"] = sorted(one.strip() for one in cookie.split(";") if one.strip())
                return said
        time.sleep(0.2)
    return None
def kept(said: dict[str, object] | None) -> bool:
    return bool(
        said
        and said.get("local") == "signed-in"
        and said.get("indexed") == "signed-in"
        and "session=signed-in" in said.get("cookies", [])
        and "kept=signed-in" in said.get("cookies", [])
    )
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
    env = {**os.environ, "ORDEN_SPACES_DIR": tempfile.mkdtemp(prefix="orden-session-")}
    log = open(args.out / "app.log", "wb")
    running: list[subprocess.Popen[bytes]] = []
    def launch():
        (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
        process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
        running.append(process)
        app = endpoint(config, process.pid, secret, 60)
        app.until("!!orden.workspace?.activeSpace", 90)
        time.sleep(2)
        return app
    rows: list[dict[str, object]] = []
    def row(what: str, said: dict[str, object] | None) -> None:
        one = {"what": what, "said": said, "ok": kept(said)}
        print(f"a signed-in site stays signed in {what}: {json.dumps(one)}", flush=True)
        rows.append(one)
    try:
        app = launch()
        since = time.monotonic()
        tab = app.eval(f"return orden.workspace.openPage({json.dumps(base + '/login')})")
        row("as it signs in", heard(since, "/login"))
        since = time.monotonic()
        app.eval(f"return orden.workspace.openPage({json.dumps(base + '/check')})")
        row("in another tab", heard(since, "/check"))
        app.eval(f"await orden.pages.park({json.dumps(tab)}, true); return true")
        time.sleep(2)
        since = time.monotonic()
        app.eval(f"orden.workspace.activate({json.dumps(tab)}); return true")
        app.eval(f"return orden.workspace.openPage({json.dumps(base + '/check')})")
        row("after its tab is put to sleep and woken", heard(since, "/check"))
        time.sleep(KEPT)
        ended(running.pop(), gentle=True)
        time.sleep(3)
        app = launch()
        since = time.monotonic()
        app.eval(f"return orden.workspace.openPage({json.dumps(base + '/check')})")
        row("after Orden is started again", heard(since, "/check", 60))
    finally:
        for process in running:
            ended(process, gentle=True)
        (args.out / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    wrong = [one for one in rows if not one["ok"]] or ([] if rows else [{"why": "no step ran"}])
    for one in wrong:
        print(f"::error::a signed-in site did not stay signed in: {json.dumps(one)}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    sys.exit(main())
