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

PORT_FROM = 22300
PORT_TO = 22399

SPACES_DIR = "ORDEN_SPACES_DIR"

SPACE = "Web switch probe"
NOTE = "Idea"
WEB = "A page in a tab"
OTHER = "Another page in a tab"

DOWN = 1200

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

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
    pages = {"/page": page(WEB), "/other": page(OTHER)}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = pages.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made

def spaces_root() -> pathlib.Path:

    made = pathlib.Path(tempfile.mkdtemp(prefix="orden-switch-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made

def shortcut(url: str, title: str) -> str:
    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Nib-Added=2026-09-13T08:00:00.000Z\r\n"
    )

def space(port: int) -> pathlib.Path:
    made = spaces_root() / SPACE
    shutil.rmtree(made, ignore_errors=True)
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(
        f"# {NOTE}\n\nAn ordinary note, to switch away to.\n", encoding="utf-8"
    )
    (made / f"{WEB}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/page", WEB), encoding="utf-8"
    )
    (made / f"{OTHER}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/other", OTHER), encoding="utf-8"
    )
    for index in range(10):
        (made / f"Site {index}.url").write_text(
            shortcut(f"http://127.0.0.1:{port}/page?{index}", f"Site {index}"),
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

def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")

def allow_eval(identifier: str) -> None:

    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")

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

TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  id: one.id, kind: one.kind, name: one.name, path: one.path,
  showing: one.id === nib.workspace.activeTabId, address: one.address ?? null,
})))"""

def tab_of(app: App, name: str) -> str | None:
    said = app.ask(TABS)
    if not isinstance(said, list):
        return None
    for one in said:
        if isinstance(one, dict) and str(one.get("name", "")).startswith(name):
            return str(one.get("id"))
    return None

LIVE = """(async () => {
  try {
    await window.__TAURI_INTERNALS__.invoke('web_place', {
      tab: '%s', pane: { x: 0, y: 0, width: 10, height: 10 }, visible: false,
    })
    return JSON.stringify({ live: true })
  } catch (error) {
    return JSON.stringify({ live: false, said: String(error) })
  }
})()"""

def live(app: App, tab: str) -> bool:
    said = app.ask(LIVE % tab)
    return isinstance(said, dict) and said.get("live") is True

def until_live(app: App, tab: str, seconds: float) -> float | None:
    began = time.perf_counter()
    while time.perf_counter() - began < seconds:
        if live(app, tab):
            return (time.perf_counter() - began) * 1000
        time.sleep(0.05)
    return None

def place(app: App, tab: str) -> object:
    return app.ask(
        """(async () => {
  try {
    return JSON.stringify(await window.__TAURI_INTERNALS__.invoke('web_look', { tab: '%s' }))
  } catch (error) {
    return JSON.stringify({ error: String(error) })
  }
})()"""
        % tab
    )

def scroll(app: App, tab: str, down: int) -> object:

    return app.ask(
        """(async () => {
  try {
    await window.__TAURI_INTERNALS__.invoke('web_scroll', { tab: '%s', x: 0, y: %d })
    return JSON.stringify({ ok: true })
  } catch (error) {
    return JSON.stringify({ error: String(error) })
  }
})()"""
        % (tab, down)
    )

def lit(app: App) -> object:

    return app.ask(
        "JSON.stringify(!document.querySelector('.webbar button[aria-label=\"Back\"]').disabled)"
    )

def memory(pid: int) -> int:

    script = (
        "$all = Get-CimInstance Win32_Process |"
        " Select-Object ProcessId,ParentProcessId,WorkingSetSize;"
        f" $mine = @({pid}); $grew = $true;"
        " while ($grew) { $grew = $false;"
        "  foreach ($one in $all) {"
        "   if ($mine -contains $one.ParentProcessId -and -not ($mine -contains $one.ProcessId))"
        "    { $mine += $one.ProcessId; $grew = $true } } }"
        " ($all | Where-Object { $mine -contains $_.ProcessId -and $_.ProcessId -ne "
        + str(pid)
        + " } | Measure-Object WorkingSetSize -Sum).Sum"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        return int((out.stdout or "0").strip() or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0

def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App, int]:
    app = run_probe(exe, quiet=True)
    port, secret = endpoint(identifier, 90, unlike)

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
    return app, App(port, secret), hwnd

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    server = serve(port)
    made = space(port)

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(args.identifier)
        time.sleep(1)

        running, app, _ = launch(args.exe, args.identifier, unlike=app.port)

        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)

        began = time.perf_counter()
        app.open(f"{WEB}.url")
        web = None
        until = time.perf_counter() + 20
        while web is None and time.perf_counter() < until:
            web = tab_of(app, WEB)
        if web is None:
            raise SystemExit("the app never opened the website")
        said["cold ms"] = until_live(app, web, 90)
        said["cold total ms"] = (time.perf_counter() - began) * 1000

        time.sleep(2)
        said["scrolled"] = scroll(app, web, DOWN)
        time.sleep(1)
        said["the place"] = place(app, web)

        app.open(f"{NOTE}.md")
        time.sleep(1.5)
        said["kept on a switch"] = live(app, web)

        began = time.perf_counter()
        app.open(f"{WEB}.url")
        said["note to web ms"] = until_live(app, web, 90)
        time.sleep(1.5)
        said["note to web kept the place"] = place(app, web)

        app.open(f"{OTHER}.url")
        other = tab_of(app, OTHER)
        said["web to web ms"] = until_live(app, other, 90) if other else None
        time.sleep(1)
        began = time.perf_counter()
        app.open(f"{WEB}.url")
        said["back to the first ms"] = until_live(app, web, 90)
        said["back to the first kept the place"] = place(app, web)

        app.ask(
            "window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '"
            + web
            + "', url: 'http://127.0.0.1:"
            + str(port)
            + "/other' })"
        )
        time.sleep(4)
        said["the trail after following a link"] = place(app, web)
        said["back is lit"] = lit(app)

        for index in range(10):
            app.open(f"Site {index}.url")
            time.sleep(1.5)
        time.sleep(5)
        said["bytes with ten"] = memory(running.pid)
        said["live with ten"] = app.ask(
            "JSON.stringify(nib.workspace.tabs.filter((one) => one.kind === 'web').length)"
        )

        said["the file"] = (made / f"{WEB}.url").read_text(encoding="utf-8").replace("\r\n", " | ")

        running.terminate()
        running.wait(timeout=30)
        time.sleep(2)
        running, app, _ = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{WEB}.url")
        web = None
        until = time.perf_counter() + 20
        while web is None and time.perf_counter() < until:
            web = tab_of(app, WEB)
        said["relaunch ms"] = until_live(app, web, 90) if web else None
        time.sleep(3)
        said["relaunch kept the place"] = place(app, web) if web else None
        said["relaunch: back is lit"] = lit(app)
    finally:
        if running is not None:
            running.terminate()
        server.shutdown()

    for name, value in said.items():
        shown = f"{value:.0f}" if isinstance(value, float) else json.dumps(value)
        print(f"{name}: {shown}")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
