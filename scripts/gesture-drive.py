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
from fresh_app import ended, fresh

PAGE = b"""<!doctype html><title>gestures</title>
<body style="margin:0">
<button id="press" style="position:fixed;inset:0;width:100%;height:100%;font:24px sans-serif">press</button>
<p id="words" style="position:fixed;left:0;top:0;margin:0">some words to copy</p>
<script>
let pressed = false
addEventListener('mousedown', (event) => { if (event.isTrusted) pressed = true }, true)
const tell = (when, what, answer) => fetch('/said', {
  method: 'POST',
  body: JSON.stringify({ when, what, answer: String(answer) }),
}).catch(() => {})
const settle = (when, what, asked) => {
  let answer
  try { answer = asked() } catch (error) { tell(when, what, 'no: ' + (error && error.name)); return }
  if (answer && typeof answer.then === 'function') {
    answer.then(() => tell(when, what, 'yes'), (error) => tell(when, what, 'no: ' + (error && error.name)))
  } else tell(when, what, answer === false ? 'no: false' : answer === 'unsupported' ? answer : 'yes')
}
const tried = (when, only) => {
  if (!only || only === 'copy') settle(when, 'copy', () => {
    getSelection().selectAllChildren(document.getElementById('words'))
    return document.execCommand('copy')
  })
  if (!only || only === 'clipboard') settle(when, 'clipboard', () => navigator.clipboard ? navigator.clipboard.writeText('gestures ' + when) : 'unsupported')
  if (!only || only === 'fullscreen') settle(when, 'fullscreen', () => {
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) return 'unsupported'
    const filled = document.documentElement.requestFullscreen().then(() => document.exitFullscreen())
    return Promise.race([filled, new Promise((done) => setTimeout(() => done('pending'), 3000))]).then((answer) => {
      if (answer === 'pending') throw { name: 'pending' }
    })
  })
}
let active = 0
setInterval(() => {
  if (pressed) return
  if (navigator.userActivation && navigator.userActivation.isActive) active++
  tried('unasked')
}, 100)
setInterval(() => tell('engine', 'active', active), 500)
const kinds = ['copy', 'clipboard', 'fullscreen']
let next = 0
document.getElementById('press').addEventListener('click', (event) => {
  if (!event.isTrusted) return
  tell('pressed', 'heard', next + 1)
  tried('pressed', kinds[next++])
})
</script>"""

SAID: dict[str, dict[str, list[str]]] = {}
LOCK = threading.Lock()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def do_POST(self) -> None:  # noqa: N802 - the standard library's name
        size = int(self.headers.get("content-length") or 0)
        try:
            one = json.loads(self.rfile.read(size) or b"{}")
            with LOCK:
                SAID.setdefault(one["when"], {}).setdefault(one["what"], []).append(one["answer"])
        except (ValueError, KeyError):
            pass
        self.send_response(204)
        self.end_headers()

def heard(when: str) -> dict[str, list[str]]:
    with LOCK:
        return {what: list(answers) for what, answers in SAID.get(when, {}).items()}

def config_of(identifier: str) -> pathlib.Path:
    if sys.platform == "win32":
        return pathlib.Path(os.environ["APPDATA"]) / identifier
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 20) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                return json.loads(said.read().decode("utf-8", "replace")).get("value")
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            return None

def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                crash_told.told(int(said["port"]), secret)
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

INNER = (
    "const i = window.__TAURI_INTERNALS__;"
    "const at = await i.invoke('plugin:window|inner_position', { label: 'main' });"
    "const scale = await i.invoke('plugin:window|scale_factor', { label: 'main' });"
    "return { x: at.x, y: at.y, scale, ratio: devicePixelRatio }"
)

SHOWN = (
    "(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible);"
    " return all[0] ? { tab: all[0][0], pane: all[0][1].sent.pane } : null })()"
)

RUN_IN_THE_PAGE = (
    "const shown = {shown}; if (!shown) return false;"
    " await window.__TAURI_INTERNALS__.invoke('web_pause', {{ tab: shown.tab, paused: false }}); return true"
)

def the_page(app: App) -> tuple[str, tuple[float, float]]:
    shown = None
    until = time.monotonic() + 30
    while time.monotonic() < until and not isinstance(shown, dict):
        shown = app.eval(SHOWN)
        time.sleep(0.5)
    inner = app.eval(INNER)
    if not isinstance(shown, dict) or not isinstance(inner, dict):
        raise SystemExit(f"the page was never shown: {shown} {inner}")
    pane = shown["pane"]
    across, down = pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2
    if sys.platform == "darwin":
        return shown["tab"], (inner["x"] / inner["scale"] + across, inner["y"] / inner["scale"] + down)
    return shown["tab"], (inner["x"] + across * inner["ratio"], inner["y"] + down * inner["ratio"])

def pressed_at(at: tuple[float, float]) -> None:
    x, y = round(at[0]), round(at[1])
    if sys.platform == "win32":
        import ctypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.SetCursorPos(x, y)
        time.sleep(0.3)
        user32.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.08)
        user32.mouse_event(0x0004, 0, 0, 0, 0)
    elif sys.platform == "darwin":
        import Quartz

        for kind in (Quartz.kCGEventMouseMoved, Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
            made = Quartz.CGEventCreateMouseEvent(None, kind, (x, y), Quartz.kCGMouseButtonLeft)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, made)
            time.sleep(0.15)
    else:
        from Xlib import X, display
        from Xlib.ext import xtest

        shown = display.Display()
        shown.screen().root.warp_pointer(x, y)
        shown.sync()
        time.sleep(0.3)
        xtest.fake_input(shown, X.ButtonPress, 1)
        shown.sync()
        time.sleep(0.08)
        xtest.fake_input(shown, X.ButtonRelease, 1)
        shown.sync()

def forward(app: App, pid: int) -> None:
    app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
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

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/gestures"

    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-gesture-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        forward(app, process.pid)
        time.sleep(2)
        app.eval(f"orden.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until and "engine" not in SAID:
            time.sleep(0.5)
        if "engine" not in SAID:
            raise SystemExit("the page never said what it heard")
        tab, at = the_page(app)

        for _ in range(12):
            if app.eval(RUN_IN_THE_PAGE.format(shown=SHOWN)) is not True:
                wrong.append("Orden's own script could not be run in the page")
                break
            time.sleep(0.5)
        time.sleep(2)
        unasked = heard("unasked")
        active = heard("engine").get("active", ["0"])[-1]
        print(f"web tab {tab}: activation the engine gave the page with no press: {active} times", flush=True)
        print(f"with no press: {json.dumps(unasked)}", flush=True)
        for what in ("fullscreen", "clipboard", "copy"):
            if not unasked.get(what):
                wrong.append(f"the page never tried {what} with no press")
            elif "yes" in unasked[what]:
                wrong.append(f"{what} was let through with no press, after a script Orden ran in the page")

        for count in range(1, 4):
            for _ in range(3):
                forward(app, process.pid)
                time.sleep(1)
                pressed_at(at)
                until = time.monotonic() + 6
                while time.monotonic() < until and len(heard("pressed")) < count + 1:
                    time.sleep(0.25)
                if len(heard("pressed")) >= count + 1:
                    break
                print(f"press {count} was not heard, pressing again", flush=True)
            time.sleep(1.5)
        after = heard("pressed")
        print(f"after a real press for each at {at}: {json.dumps(after)}", flush=True)
        if not after:
            wrong.append("the page never heard the real press")
        for what in ("fullscreen", "clipboard", "copy"):
            answers = after.get(what, [])
            through = ("yes", "unsupported", "no: pending") if sys.platform == "darwin" else ("yes", "unsupported")
            if after and not any(one in through for one in answers):
                wrong.append(f"{what} was refused after a real press: {answers}")
    finally:
        ended(process)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
