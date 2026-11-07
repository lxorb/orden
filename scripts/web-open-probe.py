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
import urllib.request
from ctypes import wintypes

from probe_app import run_probe, sized

PORT_FROM = 23780
PORT_TO = 23799

SPACES_DIR = "ORDEN_SPACES_DIR"

SPACE = "Web open probe"
NOTE = "Idea"

SITES = 5

COLD_MS = 2500
OPEN_MS = 800
COVERED_MS = 1500

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

def clocked() -> bool:

    return os.environ.get("ORDEN_PERF") == "1"

def windows_of(pid: int) -> list[int]:

    assert user32 is not None
    found: list[int] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found

def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")

def titled(at: int) -> str:

    return f"Probe page{at}"

def page(name: str) -> bytes:

    return f"""<!doctype html>
<title>{name}</title>
<body style="margin:0;font:16px system-ui">
<h1 style="margin:0;padding:2rem">{name}</h1>
<div style="height:9000px;background:linear-gradient(#fff,#048)"></div>
</body>
""".encode()

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = page(f"Probe {self.path.strip('/')}")
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made

def spaces_root() -> pathlib.Path:

    made = pathlib.Path(tempfile.mkdtemp(prefix="orden-open-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made

def shortcut(url: str, title: str) -> str:
    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Orden-Added=2026-09-17T08:00:00.000Z\r\n"
    )

def space(port: int) -> pathlib.Path:
    made = spaces_root() / SPACE
    shutil.rmtree(made, ignore_errors=True)
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(
        f"# {NOTE}\n\nAn ordinary note, to open the space on.\n", encoding="utf-8"
    )
    for index in range(1, SITES + 1):
        (made / f"Site {index}.url").write_text(
            shortcut(f"http://127.0.0.1:{port}/page{index}", f"Site {index}"),
            encoding="utf-8",
        )
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
    raise SystemExit(
        f"the app never wrote {path} - if an Orden is already running, close it first:"
        " this is a single instance app and a second launch hands over and exits"
    )

def allow_eval(identifier: str) -> None:

    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))

def act(port: int, secret: str, verb: str, args: dict[str, object], seconds: float = 90) -> object:
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

    def open(self, path: str, space: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space:
            args["space"] = space
        return act(self.port, self.secret, "open", args)

    def ask(self, code: str, seconds: float = 90) -> object:
        said = act(self.port, self.secret, "eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value

OPEN = r"""
(async () => {
  const ws = nib.workspace
  const path = __PATH__
  const veiled = __VEIL__
  const named = __NAMED__

  let veil = null
  if (veiled) {
    veil = document.createElement('div')
    veil.style.cssText = 'position:fixed;inset:0;z-index:99999'
    document.body.append(veil)
    setTimeout(() => veil.remove(), 160)
  }

  const zero = performance.now()
  const said = (one) => (one && one.name) || ''
  ws.openWeb(path)

  const painted = await new Promise((go) => {
    const until = performance.now() + 20000
    const tick = () => {
      const tab = ws.tabs.find((one) => one.kind === 'web' && one.path === path)
      const bar = document.querySelector('.webbar input')
      // The field wears the site and the page's own name once the page has said what
      // it is called. See WebBar.svelte.
      if (tab && bar && bar.value.includes(named)) return go(Math.round(performance.now() - zero))
      if (performance.now() > until) return go(null)
      requestAnimationFrame(tick)
    }
    tick()
  })

  if (veil) veil.remove()
  const tab = ws.tabs.find((one) => one.kind === 'web' && one.path === path)
  return JSON.stringify({ ms: painted, name: said(tab) })
})()
"""

CLOSE_ALL = r"""
(() => {
  const ws = nib.workspace
  for (const one of [...ws.tabs]) { if (one.kind === 'web') ws.close(one.id) }
  return JSON.stringify({ left: ws.tabs.length })
})()
"""

def opened(app: App, space_dir: pathlib.Path, at: int, veiled: bool) -> int | None:

    code = (
        OPEN.replace("__PATH__", json.dumps(str(space_dir / f"Site {at}.url")))
        .replace("__VEIL__", "true" if veiled else "false")
        .replace("__NAMED__", json.dumps(titled(at)))
    )
    said = app.ask(code, seconds=60)
    if not isinstance(said, dict):
        return None
    ms = said.get("ms")
    return int(ms) if isinstance(ms, int) else None

def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret, listening = endpoint(identifier, 90, unlike)
    if listening and listening != app.pid:
        raise SystemExit(
            f"another Orden is already listening (pid {listening}, not {app.pid}): close it first."
            " A second launch of a single instance app hands over and exits, and every number"
            " below would be about that window and its space rather than this one's."
        )

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = windows_of(app.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    sized(hwnd, 1280, 860)
    time.sleep(1.5)
    return app, App(port, secret)

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="so.orden.Orden.probe")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    made = space(port)

    said: dict[str, object] = {}
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(args.identifier)
        time.sleep(1)

        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)

        said["cold ms"] = opened(app, made, 1, veiled=False)
        app.ask(CLOSE_ALL, seconds=30)
        time.sleep(1)

        said["open ms"] = opened(app, made, 2, veiled=False)
        app.ask(CLOSE_ALL, seconds=30)
        time.sleep(1)

        covered = opened(app, made, 3, veiled=True)
        said["covered ms"] = covered
        said["opened under a layer"] = covered is not None
    finally:
        if running:
            running.terminate()

    for name, value in said.items():
        print(f"{name:24} {value}")

    wrong: list[str] = []
    if said["opened under a layer"] is not True:
        wrong.append(
            "a web tab whose pane was covered when it mounted never showed its page:"
            " see `look` in lib/web-tab/WebTab.svelte"
        )

    for name, budget in (("cold ms", COLD_MS), ("open ms", OPEN_MS), ("covered ms", COVERED_MS)):
        value = said.get(name)
        if value is None:
            wrong.append(f"{name}: the page never arrived")
        elif clocked() and isinstance(value, int) and value > budget:
            wrong.append(f"{name}: {value} over a budget of {budget}")

    if not clocked():
        print("\nthe clocks were read and not asserted on; set ORDEN_PERF=1 to hold them to a budget")

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    sys.exit(main())
