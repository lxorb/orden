from __future__ import annotations

import argparse
import http.server
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from typing import Any

import crash_told

PAGE = b"<!doctype html><title>a page</title><p>a page"
STORM = (
    b"<!doctype html><title>a storm</title><script>let n = 0; const every = setInterval(() => {"
    b" for (let i = 0; i < 20; i++) window.open(location.origin + '/opened' + n++);"
    b" if (n >= 400) clearInterval(every) }, 1)</script><p>a storm"
)
TABS = 3
WATCHED = 10.0

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body = STORM if self.path == "/storm" else PAGE
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def config_of(identifier: str) -> pathlib.Path:
    if sys.platform == "win32":
        return pathlib.Path(os.environ["APPDATA"]) / identifier
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier

def window_answers(pid: int) -> str | None:

    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from probe_app import main_window

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = main_window(pid)
    if not hwnd:
        return "the app has no window"
    result = wintypes.DWORD()
    if not user32.SendMessageTimeoutW(hwnd, 0, 0, 0, 0x0002, 3000, ctypes.byref(result)):
        return "the window does not answer Windows"
    return None

def forward(pid: int) -> None:

    if sys.platform != "win32":
        return
    import ctypes

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from probe_app import main_window

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = main_window(pid)
    theirs = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
    ours = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(ours, theirs, True)
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(ours, theirs, False)

def watched(app: App, pid: int, count: int) -> list[str]:

    opened, live = time.monotonic(), False
    while time.monotonic() - opened < WATCHED:
        asked = time.monotonic()
        said = app.eval(f"nib.pages.each().filter(([, page]) => page.live).length >= {count}")
        at = f"web tab {count}, {asked - opened:4.1f} s after it opened"
        if "error" in said:
            return [f"{at}: the endpoint did not answer: {said['error']}"]
        live = live or said.get("value") is True
        if why := window_answers(pid):
            return [f"{at}: {why}"]
        time.sleep(0.5)
    print(f"web tab {count}: answered for {WATCHED:.0f} s, its page up: {live}", flush=True)
    return [] if live else [f"web tab {count}: its page never came up in {WATCHED:.0f} s"]

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 8) -> dict[str, Any]:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                return json.loads(said.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            return {"error": f"{error.code} {error.read().decode('utf-8', 'replace')[:200]}"}
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}

def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                for _ in range(40):
                    if crash_told.tell(int(said["port"]), secret):
                        break
                    time.sleep(0.5)
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

def stalls(identifier: str) -> list[str]:

    home = pathlib.Path.home()
    folders = [
        pathlib.Path(os.environ.get("LOCALAPPDATA") or home) / identifier,
        home / "Library" / "Logs" / identifier,
        pathlib.Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share") / identifier,
    ]
    lines: list[str] = []
    for log in (one for folder in folders for one in folder.glob("**/nib.log")):
        lines += [line for line in log.read_text(encoding="utf-8", errors="replace").splitlines() if "stall" in line]
    return lines[-20:]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/"

    config = config_of(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-web-tab-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace").get("value") is not True:
            time.sleep(1)
        time.sleep(2)
        said = app.eval("nib.workspace.openBlank('One', '# One\\n\\nSome words.'); return true", 20)
        if said.get("value") is not True:
            raise SystemExit(f"no note was opened: {said}")
        time.sleep(2)
        if why := window_answers(process.pid):
            raise SystemExit(f"before any web tab: {why}")

        for count in range(1, TABS + 1):
            forward(process.pid)
            time.sleep(1)
            said = app.eval(f"nib.workspace.openPage({json.dumps(f'{url}{count}')}); return true", 20)
            if said.get("value") is not True:
                raise SystemExit(f"web tab {count} was not opened: {said}")
            wrong += watched(app, process.pid, count)
            if wrong:
                break

        if not wrong:
            before = app.eval("return orden.workspace.tabs.length", 20).get("value")
            app.eval(f"orden.workspace.openPage({json.dumps(f'{url}storm')}); return true", 20)
            time.sleep(8)
            after = app.eval("return orden.workspace.tabs.length", 20).get("value")
            if not isinstance(before, int) or after != before + 1:
                wrong.append(f"400 window.open calls without a gesture: {before} tabs became {after}, not {before} + the storm's own")
            if why := window_answers(process.pid):
                wrong.append(f"after the window.open storm: {why}")
    finally:
        process.kill()
        process.wait(20)
        site.shutdown()
        if wrong:
            for line in stalls(args.identifier):
                print(line, flush=True)
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
