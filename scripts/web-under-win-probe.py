from __future__ import annotations
import argparse
import ctypes
import importlib.util
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
import http.server
from ctypes import wintypes
from typing import Any
from PIL import ImageGrab

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("under_drive", HERE / "web-under-drive.py")
assert spec and spec.loader
drive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drive)
from probe_app import main_window, refuse_updating  # noqa: E402
from fresh_app import ended, fresh  # noqa: E402
from native_app import App, config_of, endpoint  # noqa: E402
user32 = drive.user32
COLOUR, LAYER = drive.COLOUR, drive.LAYER
MEASURED: list[str] = []
def measure(name: str, value: Any) -> None:
    MEASURED.append(f"{name}: {value}")
    print(f"[measure] {name}: {value}", flush=True)
WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
def tree(top: int) -> list[str]:
    lines: list[str] = []
    def walk(parent: int, depth: int) -> None:
        children: list[int] = []
        found = WNDENUMPROC(lambda hwnd, _: children.append(hwnd) or True)
        user32.EnumChildWindows(parent, found, 0)
        direct = [one for one in children if user32.GetParent(one) == parent]
        for one in direct:
            name = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(one, name, 256)
            rect = wintypes.RECT()
            user32.GetWindowRect(one, ctypes.byref(rect))
            owner = wintypes.DWORD()
            thread = user32.GetWindowThreadProcessId(one, ctypes.byref(owner))
            style = user32.GetWindowLongPtrW(one, -16) & 0xFFFFFFFF
            ex = user32.GetWindowLongPtrW(one, -20) & 0xFFFFFFFF
            seen = bool(user32.IsWindowVisible(one))
            lines.append(f"{'  ' * depth}{one:#x} {name.value} pid {owner.value} tid {thread} style {style:#x} ex {ex:#x} visible {seen} rect {(rect.left, rect.top, rect.right, rect.bottom)}")
            walk(one, depth + 1)
    walk(top, 0)
    return lines
LAYER_AT = (
    "(({x, y, size, colour, id}) => { const one = document.createElement('div'); one.className = 'orden-layer'; one.id = id;"
    " Object.assign(one.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px',"
    " background: colour, zIndex: 9999 }); one.addEventListener('click', () => { window.__layerHit = (window.__layerHit || 0) + 1 });"
    " document.body.append(one); window.__drawnAt = null;"
    " requestAnimationFrame(() => requestAnimationFrame(() => { window.__drawnAt = Date.now() })); return Date.now() })(ARGS)"
)
def layer_at(app: App, x: float, y: float, size: float, colour: str, name: str) -> Any:
    return app.eval(LAYER_AT.replace("ARGS", json.dumps({"x": x, "y": y, "size": size, "colour": colour, "id": name})))
def gone(app: App, name: str) -> None:
    app.eval(f"document.getElementById({json.dumps(name)})?.remove(); return true")
    time.sleep(0.8)
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--under", action="store_true")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), drive.Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/under"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-under-probe-"))
    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces), "ORDEN_PAGES_UNDER": "1" if args.under else "0"}
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    try:
        app = endpoint(config, process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        hwnd = 0
        while time.monotonic() < until and not hwnd:
            hwnd = main_window(process.pid)
            time.sleep(0.25)
        user32.ShowWindow(hwnd, 9)
        user32.SetWindowPos(hwnd, None, 0, 0, drive.WIDTH, drive.HEIGHT, 0x0004)
        drive.forward(hwnd)
        time.sleep(3)
        app.eval(f"orden.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until and app.eval("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is not True:
            time.sleep(0.5)
        time.sleep(3)
        measure("the engine lays the page under the app", app.eval("orden.pages.under"))
        for line in tree(hwnd):
            print(f"[tree] {line}", flush=True)
        pane = app.eval("(() => { const all = orden.pages.each().map(([, one]) => one.sent).filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()")
        if not isinstance(pane, dict):
            raise SystemExit(f"the page was never shown: {pane}")
        scale = float(app.eval("devicePixelRatio") or 1)
        left, top, _, _ = drive.client_box(hwnd)
        at = lambda x, y: (left + round((pane["x"] + x) * scale), top + round((pane["y"] + y) * scale))  # noqa: E731
        spot = (600, 470)
        image = ImageGrab.grab()
        image.save(args.out / "page.png")
        measure("the hole with the app's HTML drawn over it (page magenta)", drive.colour_at(image, *at(*spot)))
        app.eval("document.documentElement.style.opacity = '0'; return true")
        time.sleep(1)
        bare = ImageGrab.grab()
        bare.save(args.out / "bare.png")
        measure("the hole with the app's HTML at no opacity", drive.colour_at(bare, *at(*spot)))
        measure("outside any page with the app's HTML at no opacity", drive.colour_at(bare, left + 20, top + 200))
        app.eval("document.documentElement.style.opacity = ''; return true")
        time.sleep(1)
        layer_at(app, pane["x"] + spot[0] - 60, pane["y"] + spot[1] - 60, 120, "rgba(0,160,0,0.5)", "probe-glass")
        time.sleep(1.2)
        image = ImageGrab.grab()
        image.save(args.out / "glass.png")
        measure("half clear green layer over the page (blended over the page is (128, 80, 128))", drive.colour_at(image, *at(*spot)))
        gone(app, "probe-glass")
        box = (left, top, left + drive.WIDTH, top + drive.HEIGHT)
        film = drive.Film(box)
        time.sleep(0.6)
        added = layer_at(app, pane["x"] + spot[0] - 60, pane["y"] + spot[1] - 60, 120, "rgb(0,160,0)", "probe-first")
        time.sleep(1.5)
        frames = film.stop()
        drawn = app.eval("window.__drawnAt")
        local = (at(*spot)[0] - left, at(*spot)[1] - top)
        if isinstance(drawn, (int, float)) and isinstance(added, (int, float)):
            after = [(when, one) for when, one in frames if when >= drawn + 34]
            late = [when for when, one in after if not drive.near(drive.colour_at(one, *local), LAYER)]
            shown = next((when for when, one in frames if when >= added and drive.near(drive.colour_at(one, *local), LAYER)), None)
            measure("grabs after the app drew a layer over the page in which the page still shows there", f"{len(late)} of {len(after)}")
            measure("ms from the app's draw to the first grab with the layer", None if shown is None else round(shown - drawn))
        image = ImageGrab.grab()
        image.save(args.out / "layer.png")
        measure("opaque layer over the page", drive.colour_at(image, *at(*spot)))
        measure("the page beside the layer", drive.colour_at(image, *at(spot[0] - 100, spot[1])))
        app.eval("window.__layerHit = 0; return true")
        drive.press(*at(*spot))
        measure("clicks on the layer the app heard", app.eval("window.__layerHit"))
        gone(app, "probe-first")
        def told() -> dict:
            title = app.eval("orden.pages.each().map(([, one]) => one.title).find((one) => (one || '').startsWith('under ')) || ''")
            try:
                return json.loads(str(title)[len("under "):])
            except ValueError:
                return {"v": None, "y": None, "log": []}
        print(f"under the pointer at the field: {drive.window_at(*at(210, 62))}", flush=True)
        drive.press(*at(120, 60))
        drive.typed("under")
        heard = told()
        measure("a click on the page's field heard by the page", any(one[0] == "click" and one[1] == "field" for one in heard["log"]))
        measure("typed into the page's field", heard["v"])
        user32.SetCursorPos(*at(200, 60))
        time.sleep(0.4)
        user32.SetCursorPos(*at(210, 62))
        time.sleep(0.5)
        measure("the cursor over the page's field is the I-beam", drive.cursor_now() == user32.LoadCursorW(None, drive.IDC_IBEAM) if drive.cursor_shown() else "no cursor shown")
        user32.SetCursorPos(*at(600, 500))
        time.sleep(0.3)
        user32.mouse_event(drive.MOUSEEVENTF_WHEEL, 0, 0, ctypes.c_uint32(-360 & 0xFFFFFFFF).value, 0)
        time.sleep(1.2)
        measure("the page scrolled by the wheel", told()["y"])
    finally:
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "measured.json").write_text(json.dumps(MEASURED, indent=1), encoding="utf-8")
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
