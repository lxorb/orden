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
from typing import Any, Callable
from fresh_app import ended, fresh
from native_app import INNER, App, config_of, endpoint, forward

COLOURS = {"red": (255, 0, 0), "green": (0, 160, 0), "blue": (0, 0, 255)}
SWITCHES = 10
WITHIN = 1.0
ARRIVES = 1.0
WATCHED = 2.5
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        name = self.path.strip("/")
        r, g, b = COLOURS.get(name, (255, 255, 255))
        body = f"<!doctype html><title>{name}</title><body style='margin:0;height:100vh;background:rgb({r},{g},{b})'>".encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
def named(pixel: tuple[int, int, int]) -> str:
    for name, colour in COLOURS.items():
        if all(abs(one - other) <= 40 for one, other in zip(pixel, colour)):
            return name
    return "other"
def reader() -> Callable[[int, int], tuple[int, int, int]]:
    if sys.platform == "win32":
        import ctypes
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        user32.GetDC.restype = ctypes.c_void_p
        gdi32.GetPixel.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
        gdi32.GetPixel.restype = ctypes.c_uint32
        screen_dc = user32.GetDC(None)
        def windows(x: int, y: int) -> tuple[int, int, int]:
            said = gdi32.GetPixel(screen_dc, x, y)
            return said & 0xFF, (said >> 8) & 0xFF, (said >> 16) & 0xFF
        return windows
    from Xlib import X, display
    root = display.Display().screen().root
    def x11(x: int, y: int) -> tuple[int, int, int]:
        data = root.get_image(x, y, 1, 1, X.ZPixmap, 0xFFFFFFFF).data
        return data[2], data[1], data[0]
    return x11
def presser() -> Callable[[int, int], None]:
    import ctypes
    if sys.platform == "win32":
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        user32.mouse_event.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_size_t]
        def windows(x: int, y: int) -> None:
            user32.SetCursorPos(x, y)
            user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(0.02)
            user32.mouse_event(0x0004, 0, 0, 0, 0)
        return windows
    x11 = ctypes.CDLL("libX11.so.6")
    test = ctypes.CDLL("libXtst.so.6")
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    test.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    test.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    shown = x11.XOpenDisplay(os.environ.get("DISPLAY", ":0").encode())
    def linux(x: int, y: int) -> None:
        test.XTestFakeMotionEvent(shown, -1, x, y, 0)
        test.XTestFakeButtonEvent(shown, 1, 1, 0)
        x11.XFlush(shown)
        time.sleep(0.02)
        test.XTestFakeButtonEvent(shown, 1, 0, 0)
        x11.XFlush(shown)
    return linux
class Watch:
    def __init__(self, at: tuple[int, int]) -> None:
        self.at = at
        self.seen: list[tuple[float, str]] = []
        self.going = True
        self.thread = threading.Thread(target=self.run, daemon=True)
    def run(self) -> None:
        read = reader()
        while self.going:
            self.seen.append((time.monotonic(), named(read(*self.at))))
            time.sleep(0.002)
    def __enter__(self) -> Watch:
        self.thread.start()
        return self
    def __exit__(self, *_: Any) -> None:
        self.going = False
        self.thread.join(5)
def runs(seen: list[tuple[float, str]], since: float) -> list[tuple[float, str]]:
    out: list[tuple[float, str]] = []
    for at, name in seen:
        if at >= since and (not out or out[-1][1] != name):
            out.append((at, name))
    return out
BURST = """
const ids = %s
const pane = document.querySelector('.sidebar') || document.body
const started = performance.now()
for (let i = 0; i < ids.length; i++) {
  if (i) await new Promise((go) => setTimeout(go, %d))
  pane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  orden.workspace.front(ids[i])
}
return performance.now() - started
"""
def pressed(spots: dict[str, tuple[int, int]], order: list[str]) -> float:
    press = presser()
    started = time.monotonic()
    for at, name in enumerate(order):
        if at:
            time.sleep(max(0.0, started + at * WITHIN / SWITCHES - time.monotonic()))
        press(*spots[name])
    return (time.monotonic() - started) * 1000
def burst(app: App, at: tuple[int, int], tabs: dict[str, str], order: list[str], spots: dict[str, tuple[int, int]] | None) -> list[str]:
    last, before = order[-1], order[-2]
    gap = round(WITHIN * 1000 / SWITCHES)
    code = BURST % (json.dumps([tabs[name] for name in order]), gap)
    with Watch(at) as watch:
        time.sleep(0.3)
        took = pressed(spots, order) if spots else app.eval(code, 20)
        stopped = time.monotonic()
        time.sleep(WATCHED)
    if not isinstance(took, (int, float)) or took > WITHIN * 1000 + 400:
        return [f"the {SWITCHES} switches did not run within a second: {took}"]
    after = runs(watch.seen, stopped)
    line = ", ".join(f"{name} at {round((when - stopped) * 1000)} ms" for when, name in after)
    print(f"{'pressed' if spots else 'told'}: {SWITCHES} switches in {round(took)} ms ending on {last}, then: {line}", flush=True)
    wrong: list[str] = []
    came = next((when for when, name in after if name == last), None)
    if came is None or came - stopped > ARRIVES:
        return [f"{last} was not in the pane within {ARRIVES} s of the last switch: {line}"]
    strays = [name for when, name in after if when >= came and name != last]
    early = [name for when, name in after if when < came and name not in (before, last, "other")]
    if strays:
        wrong.append(f"after {last} came, the pane showed {', '.join(strays)} again: {line}")
    if early:
        wrong.append(f"before {last} came, the pane showed {', '.join(early)}, switched away from earlier: {line}")
    return wrong
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if sys.platform == "darwin":
        print("this drive reads the screen on Windows and Linux only", flush=True)
        return 0
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-web-switch-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret, 8)
        if app.until("orden.workspace ? true : null", 90) is not True:
            raise SystemExit("the app never answered")
        time.sleep(2)
        tabs: dict[str, str] = {}
        for name in COLOURS:
            tab = app.eval(f"return orden.workspace.openPage({json.dumps(url + name)})", 20)
            if not isinstance(tab, str):
                raise SystemExit(f"the {name} tab was not opened: {tab}")
            tabs[name] = tab
            live = app.until(f"orden.pages.of({json.dumps(tab)}).live && orden.pages.of({json.dumps(tab)}).shown ? true : null", 30)
            if live is not True:
                raise SystemExit(f"the {name} page never came up")
            time.sleep(1.5)
        forward(app, process.pid)
        time.sleep(1)
        box = app.eval(f"const p = orden.pages.of({json.dumps(tabs['blue'])}); return p.sent && p.sent.pane")
        inner = app.eval(INNER)
        if not isinstance(box, dict) or not isinstance(inner, dict):
            raise SystemExit(f"no pane to watch: {box} {inner}")
        at = (
            round(inner["x"] + (box["x"] + box["width"] / 2) * inner["ratio"]),
            round(inner["y"] + (box["y"] + box["height"] / 2) * inner["ratio"]),
        )
        shown = named(reader()(*at))
        if shown != "blue":
            raise SystemExit(f"the pane shows {shown} at {at}, not the blue page in front")
        spots: dict[str, tuple[int, int]] = {}
        for name, tab in tabs.items():
            pick = app.eval(
                f"const b = document.querySelector('.pick[data-tab=\"{tab}\"]')?.getBoundingClientRect();"
                " return b && b.width > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null"
            )
            if isinstance(pick, dict):
                spots[name] = (round(inner["x"] + pick["x"] * inner["ratio"]), round(inner["y"] + pick["y"] * inner["ratio"]))
        if len(spots) != len(tabs):
            wrong.append(f"the tabs have no place in the strip to press: {spots}")
        names = list(COLOURS)
        front = "blue"
        for frozen in (False, True):
            for way in (None, spots if len(spots) == len(tabs) else None):
                start = names.index(front) + 1
                order = [names[(start + one) % len(names)] for one in range(SWITCHES)]
                if frozen:
                    for name, tab in tabs.items():
                        if name != front:
                            app.eval(f"orden.pages.freeze({json.dumps(tab)}); return true")
                    time.sleep(1)
                forward(app, process.pid)
                time.sleep(0.5)
                said = burst(app, at, tabs, order, way)
                wrong += [f"{'frozen' if frozen else 'running'} pages, {'pressed' if way else 'told'}: {one}" for one in said]
                front = order[-1]
                time.sleep(1)
    finally:
        ended(process)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
