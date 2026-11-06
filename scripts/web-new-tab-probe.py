from __future__ import annotations

import argparse
import atexit
import ctypes
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from ctypes import wintypes

from probe_app import close_app, run_probe, main_window

PORT_FROM = 23900
PORT_TO = 23919

SPACES_DIR = "NIB_SPACES_DIR"
SPACE = "New tab probe"
NOTE = "Idea"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

ASKING = """<!doctype html>
<title>Opener</title>
<body style="font:16px system-ui;padding:2rem">
<h1>Opener</h1>
<script>
  addEventListener('message', (event) => {
    if (event.data === 'opener-ok') document.title = 'Opener heard the popup'
  })
  const how = new URLSearchParams(location.search).get('how')
  const to = location.origin + '/target-' + how
  if (how === 'plain') window.open(to)
  if (how === 'behind') window.open(to, 'nib-behind')
  if (how === 'popup') window.open(location.origin + '/popup', 'signin', 'width=480,height=520,left=40,top=40')
</script>
"""

POPUP = """<!doctype html>
<title>Popup</title>
<body style="font:16px system-ui;padding:2rem">
<h1>Popup</h1>
<script>
  if (window.opener) window.opener.postMessage('opener-ok', '*')
  setTimeout(() => window.close(), 1500)
</script>
"""

def target(name: str) -> str:
    return f"<!doctype html><title>{name}</title><h1>{name}</h1>"

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = urllib.parse.urlparse(self.path).path
            if path == "/asking":
                body = ASKING
            elif path == "/popup":
                body = POPUP
            else:
                body = target(path.strip("/"))
            data = body.encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made

def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")

def space() -> pathlib.Path:

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-new-tab-probe-"))
    os.environ[SPACES_DIR] = str(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    made = root / SPACE
    made.mkdir(parents=True)
    (made / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", "utf-8")
    return made

def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier

def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier

def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(one, ignore_errors=True)

def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str, int]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"]), int(said.get("pid") or 0)
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")

def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))

def act(port: int, secret: str, verb: str, args: dict[str, object], seconds: float = 60) -> object:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=seconds) as answer:
            return json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return {"ok": False, "error": f"no answer: {error}"}

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def open(self, path: str, space: str) -> object:
        return act(self.port, self.secret, "open", {"path": path, "space": space})

    def ask(self, code: str) -> object:
        said = act(self.port, self.secret, "eval", {"code": code, "yes": True})
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value

STRIP = r"""
(() => {
  const ws = nib.workspace
  return JSON.stringify({
    strip: ws.tabs.map((one) => one.address || one.path),
    front: (ws.active && (ws.active.address || ws.active.path)) || null,
  })
})()
"""

OPEN = r"""
(() => {
  const ws = nib.workspace
  for (const one of [...ws.tabs]) { if (one.kind === 'web') ws.close(one.id) }
  ws.openPage(__URL__)
  return 'ok'
})()
"""

TITLED = r"""
(() => {
  const ws = nib.workspace
  const tab = ws.tabs.find((one) => (one.address || '').includes('/asking'))
  const bar = document.querySelector('.webbar input')
  return JSON.stringify({ bar: bar ? bar.value : null, tab: tab ? tab.name : null })
})()
"""

def windows_of(pid: int) -> list[str]:

    assert user32 is not None
    found: list[str] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            name = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, name, 256)
            found.append(name.value)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found

def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret, listening = endpoint(identifier, 90, unlike)
    if listening and listening != app.pid:
        raise SystemExit(f"another Orden is already listening (pid {listening}): close it first")

    until = time.perf_counter() + 90
    while time.perf_counter() < until and not main_window(app.pid):
        time.sleep(0.2)
    hwnd = main_window(app.pid)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    time.sleep(1.5)
    return app, App(port, secret)

def settled(app: App, want: int, seconds: float = 20) -> dict[str, object]:

    until = time.perf_counter() + seconds
    said: object = {}
    while time.perf_counter() < until:
        said = app.ask(STRIP)
        if isinstance(said, dict) and len(said.get("strip") or []) >= want:
            time.sleep(0.5)
            said = app.ask(STRIP)
            break
        time.sleep(0.3)
    return said if isinstance(said, dict) else {"error": said}

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.new-tab")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    space()
    base = f"http://127.0.0.1:{port}"
    note = f"{NOTE}.md"

    wrong: list[str] = []
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        close_app(running) or running.kill()
        allow_eval(args.identifier)
        time.sleep(1)

        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(note, SPACE)
        if not settled(app, 1, seconds=60).get("strip"):
            raise SystemExit("the window never answered with its note open")

        for how, front in (("plain", "target-plain"), ("behind", "asking")):
            asking = f"{base}/asking?how={how}"
            app.ask(OPEN.replace("__URL__", json.dumps(asking)))
            said = settled(app, 3)
            strip = [str(one) for one in said.get("strip") or []]
            print(f"{how:8} strip  {strip}")
            print(f"{how:8} front  {said.get('front')}")
            at = next((i for i, one in enumerate(strip) if "/asking" in one), -1)
            beside = at >= 0 and at + 1 < len(strip) and f"target-{how}" in strip[at + 1]
            if not beside:
                wrong.append(f"{how}: the tab did not land beside the page that asked")
            if front is None or front not in str(said.get("front")):
                wrong.append(f"{how}: {said.get('front')} is in front, not {front}")

        app.ask(OPEN.replace("__URL__", json.dumps(f"{base}/asking?how=popup")))
        seen_popup = False
        heard = False
        until = time.perf_counter() + 20
        while time.perf_counter() < until and not heard:
            titles = windows_of(running.pid)
            seen_popup = seen_popup or any("Popup" in one or "127.0.0.1" in one for one in titles)
            titled = app.ask(TITLED)
            heard = isinstance(titled, dict) and "heard the popup" in str(titled)
            time.sleep(0.3)
        time.sleep(2.5)
        left = windows_of(running.pid)
        said = app.ask(STRIP)
        strip = said.get("strip") if isinstance(said, dict) else said
        print(f"popup    window seen {seen_popup}, opener heard it {heard}")
        print(f"popup    windows after it closed {left}")
        print(f"popup    strip  {strip}")
        if not seen_popup:
            wrong.append("popup: no window of its own appeared")
        if not heard:
            wrong.append("popup: the opener never heard from it - window.opener is lost")
        if any("Popup" in one for one in left):
            wrong.append("popup: it did not close itself")
        if isinstance(strip, list) and any("/popup" in str(one) for one in strip):
            wrong.append("popup: it opened as a tab too")
    finally:
        if running and running.poll() is None and not close_app(running):
            running.kill()

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    sys.exit(main())
