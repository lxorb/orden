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

PAGE = b"""<!doctype html><meta name="viewport" content="width=device-width"><title>pinch</title>
<body style="margin:0;font:16px sans-serif">
<div style="height:3000px;background:linear-gradient(#fff,#88f)">two fingers</div>
<script>
const heard = { wheels: 0 }
addEventListener('wheel', (event) => { if (event.ctrlKey) heard.wheels++ }, { passive: true })
const tell = () => fetch('/said', {
  method: 'POST',
  body: JSON.stringify({
    scale: visualViewport.scale, seen: visualViewport.width, ratio: devicePixelRatio,
    wheels: heard.wheels,
  }),
}).catch(() => {})
setInterval(tell, 150)
</script>"""

SAID: dict[str, Any] = {}

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
            SAID.clear()
            SAID.update(json.loads(self.rfile.read(size) or b"{}"))
        except ValueError:
            pass
        self.send_response(204)
        self.end_headers()

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
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            return {"error": str(error)}

def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

def settled(seconds: float = 2.0) -> dict[str, Any]:
    time.sleep(seconds)
    return dict(SAID)

def waited(test: Any, seconds: float = 10.0) -> dict[str, Any]:
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        now = dict(SAID)
        if now and test(now):
            return now
        time.sleep(0.2)
    return dict(SAID)

INNER = (
    "const i = window.__TAURI_INTERNALS__;"
    "const at = await i.invoke('plugin:window|inner_position', { label: 'main' });"
    "const scale = await i.invoke('plugin:window|scale_factor', { label: 'main' });"
    "return { x: at.x, y: at.y, scale, ratio: devicePixelRatio }"
)

PANE = (
    "(() => { const all = nib.pages.each().map(([, one]) => one.sent)"
    ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
)

def middle_of_the_page(app: App) -> tuple[float, float]:
    pane = None
    until = time.monotonic() + 30
    while time.monotonic() < until and not isinstance(pane, dict):
        pane = app.eval(PANE)
        time.sleep(0.5)
    inner = app.eval(INNER)
    if not isinstance(pane, dict) or not isinstance(inner, dict):
        raise SystemExit(f"the page was never shown: {pane} {inner}")
    across = pane["x"] + pane["width"] / 2
    down = pane["y"] + pane["height"] / 2
    if sys.platform == "darwin":
        return inner["x"] / inner["scale"] + across, inner["y"] / inner["scale"] + down
    return inner["x"] + across * inner["ratio"], inner["y"] + down * inner["ratio"]

class Windows:
    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        self.ctypes, self.wintypes = ctypes, wintypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.WindowFromPoint.argtypes = [wintypes.POINT]
        self.user32.WindowFromPoint.restype = wintypes.HWND
        self.user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]

    def pinch(self, at: tuple[float, float]) -> None:
        x, y = round(at[0]), round(at[1])
        self.user32.SetCursorPos(x, y)
        time.sleep(0.3)
        under = self.user32.WindowFromPoint(self.wintypes.POINT(x, y))
        name = self.ctypes.create_unicode_buffer(128)
        self.user32.GetClassNameW(under, name, 128)
        print(f"under the fingers: {name.value}", flush=True)
        point = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
        for _ in range(6):
            self.user32.PostMessageW(under, 0x020A, (120 << 16) | 0x0008, point)
            time.sleep(0.05)

    def ctrl_wheel(self, at: tuple[float, float]) -> None:
        self.user32.SetCursorPos(round(at[0]), round(at[1]))
        time.sleep(0.3)
        self.user32.keybd_event(0x11, 0, 0, 0)
        time.sleep(0.1)
        self.user32.mouse_event(0x0800, 0, 0, 120, 0)
        time.sleep(0.3)
        self.user32.keybd_event(0x11, 0, 0x0002, 0)

class Linux:
    def __init__(self) -> None:
        from evdev import AbsInfo, UInput, ecodes

        self.e = ecodes
        wide, tall = AbsInfo(0, 0, 4000, 0, 0, 40), AbsInfo(0, 0, 2500, 0, 0, 40)
        self.pad = UInput(
            {
                ecodes.EV_KEY: [
                    ecodes.BTN_LEFT, ecodes.BTN_TOOL_FINGER, ecodes.BTN_TOOL_DOUBLETAP,
                    ecodes.BTN_TOOL_TRIPLETAP, ecodes.BTN_TOUCH,
                ],
                ecodes.EV_ABS: [
                    (ecodes.ABS_X, wide), (ecodes.ABS_Y, tall),
                    (ecodes.ABS_MT_SLOT, AbsInfo(0, 0, 4, 0, 0, 0)),
                    (ecodes.ABS_MT_TRACKING_ID, AbsInfo(0, 0, 65535, 0, 0, 0)),
                    (ecodes.ABS_MT_POSITION_X, wide), (ecodes.ABS_MT_POSITION_Y, tall),
                ],
            },
            name="Orden drive touchpad",
            bustype=0x18,
            input_props=[ecodes.INPUT_PROP_POINTER, ecodes.INPUT_PROP_BUTTONPAD],
        )
        time.sleep(2)

    def fingers(self, at: list[tuple[int, int] | None]) -> None:
        e, pad = self.e, self.pad
        for slot, where in enumerate(at):
            pad.write(e.EV_ABS, e.ABS_MT_SLOT, slot)
            if where is None:
                pad.write(e.EV_ABS, e.ABS_MT_TRACKING_ID, -1)
                continue
            pad.write(e.EV_ABS, e.ABS_MT_TRACKING_ID, 100 + slot)
            pad.write(e.EV_ABS, e.ABS_MT_POSITION_X, where[0])
            pad.write(e.EV_ABS, e.ABS_MT_POSITION_Y, where[1])
        down = sum(1 for where in at if where)
        pad.write(e.EV_KEY, e.BTN_TOUCH, int(down > 0))
        pad.write(e.EV_KEY, e.BTN_TOOL_DOUBLETAP, int(down == 2))
        first = next((where for where in at if where), None)
        if first:
            pad.write(e.EV_ABS, e.ABS_X, first[0])
            pad.write(e.EV_ABS, e.ABS_Y, first[1])
        pad.syn()
        time.sleep(0.012)

    def pinch(self, at: tuple[float, float]) -> None:
        from Xlib import display

        shown = display.Display()
        shown.screen().root.warp_pointer(round(at[0]), round(at[1]))
        shown.sync()
        time.sleep(0.3)
        for step in range(60):
            apart = 300 + step * 15
            self.fingers([(2000 - apart, 1250), (2000 + apart, 1250)])
        self.fingers([None, None])

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    if sys.platform == "darwin":
        print("a Mac's trackpad magnify cannot be made from outside the app on this machine; not driven")
        return 0
    engine: Any = Windows() if sys.platform == "win32" else Linux()
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/pinch"

    config = config_of(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-pinch-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "NIB_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(2)
        app.eval(f"nib.workspace.openPage({json.dumps(url)}); return true")
        first = waited(lambda now: "scale" in now, 40)
        if not first:
            raise SystemExit("the page never said how it is drawn")
        before = settled()
        at = middle_of_the_page(app)
        print(f"before: {before}; the fingers at {at}", flush=True)

        engine.pinch(at)
        after = waited(lambda now: now["scale"] > 1.05 or now["seen"] < before["seen"] * 0.95)
        after = settled(1.0) or after
        kept = app.eval("localStorage.getItem('nib:web-zooms')")
        print(f"after a pinch: {after}; zooms kept: {kept!r}", flush=True)
        magnified = after.get("scale", 1) > 1.05 or after.get("seen", 0) < before["seen"] * 0.95
        if not magnified:
            wrong.append(f"a pinch did not magnify the page: {before} -> {after}")
        if abs(after.get("ratio", 0) - before["ratio"]) > 0.001:
            wrong.append(f"a pinch changed the page's zoom: {before['ratio']} -> {after.get('ratio')}")
        if kept not in (None, "{}"):
            wrong.append(f"a pinch was kept as the site's zoom: {kept!r}")
        if after.get("wheels", 0) <= before.get("wheels", 0):
            wrong.append(f"the page never heard the pinch as Ctrl and the wheel: {after}")

        if isinstance(engine, Windows):
            engine.ctrl_wheel(at)
            zoomed = waited(lambda now: now["ratio"] > before["ratio"] * 1.05)
            print(f"after Ctrl and the wheel: {zoomed}", flush=True)
            if zoomed.get("ratio", 0) <= before["ratio"] * 1.05:
                wrong.append(f"Ctrl and the wheel no longer zoom the page: {zoomed}")
    finally:
        process.kill()
        process.wait(20)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
