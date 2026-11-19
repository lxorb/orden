from __future__ import annotations
import argparse
import ctypes
import hashlib
import http.server
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
import traceback
from typing import Any, Callable

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fresh_app import ended, fresh
from native_app import INNER, App, config_of, endpoint, forward

PLATFORM = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
PAGE = """<!doctype html><meta name="viewport" content="width=device-width"><title>parity @PATH@</title>
<style>
html,body{margin:0;font:20px sans-serif;color:#111;background:#f2f2f2}
body{height:7000px;background:linear-gradient(#f2f2f2 0 100vh,transparent 100vh),repeating-linear-gradient(#ddd 0 37px,#777 37px 80px)}
#top{position:absolute;left:0;top:0;width:100%;height:9vh;background:linear-gradient(#000,#fff)}
#words{position:absolute;left:6vw;top:12vh;margin:0;font-size:24px}
#link{position:absolute;left:6vw;top:21vh;font-size:24px}
#zone{position:absolute;left:24vw;top:34vh;width:52vw;height:30vh;background:#bde}
#hot{position:absolute;left:0;top:69vh;width:100%;height:29vh;background:#ccc}
#hot:hover{background:#555}
</style>
<div id="top"></div>
<p id="words">Pagewords to read and carry</p>
<a id="link" href="/linked">a link to carry</a>
<div id="zone">a place to drop</div>
<div id="hot">hover here</div>
<script>
const now = () => performance.timeOrigin + performance.now()
const st = { path: location.pathname, moves: 0, last: 0, hotMoves: 0, hot: false, entered: null, drops: [], wheels: 0, ctrl: 0, rects: {} }
let track = []
const rect = (one) => { const r = one.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }
addEventListener('pointermove', (e) => {
  st.moves++
  st.last = now()
  if (e.target instanceof Element && e.target.closest('#hot')) st.hotMoves++
}, { capture: true, passive: true })
addEventListener('wheel', (e) => { st.wheels++; if (e.ctrlKey) st.ctrl++ }, { capture: true, passive: true })
addEventListener('dragenter', (e) => { st.entered = [...e.dataTransfer.types] }, true)
const zone = document.getElementById('zone')
zone.addEventListener('dragover', (e) => e.preventDefault())
zone.addEventListener('drop', (e) => {
  e.preventDefault()
  st.drops.push({ types: [...e.dataTransfer.types], files: [...e.dataTransfer.files].map((f) => f.name), plain: e.dataTransfer.getData('text/plain').slice(0, 200) })
})
let lastY = null
const tick = () => {
  if (scrollY !== lastY) { lastY = scrollY; track.push([now(), scrollY]) }
  st.hot = document.getElementById('hot').matches(':hover')
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
const send = () => {
  st.y = scrollY
  st.at = now()
  st.scale = visualViewport.scale
  st.ratio = devicePixelRatio
  st.inner = [innerWidth, innerHeight]
  for (const id of ['words', 'link', 'zone', 'hot', 'top']) st.rects[id] = rect(document.getElementById(id))
  const range = document.createRange()
  const text = document.getElementById('words').firstChild
  range.setStart(text, 0)
  range.setEnd(text, 9)
  st.rects.word = rect(range)
  const body = JSON.stringify(Object.assign({}, st, { track }))
  track = []
  fetch('/said', { method: 'POST', body }).then((r) => r.json()).then((asked) => {
    for (const one of asked) {
      if (one.scroll !== undefined) scrollTo({ top: one.scroll, behavior: 'instant' })
      if (one.clear) { st.moves = 0; st.hotMoves = 0; st.drops = []; st.entered = null; st.wheels = 0; st.ctrl = 0 }
    }
  }).catch(() => {}).finally(() => setTimeout(send, 60))
}
send()
</script>"""
LINKED = b"<!doctype html><title>linked</title><p>a linked page</p>"
class Site:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.said: dict[str, Any] = {}
        self.track: list[list[float]] = []
        self.asks: list[dict[str, Any]] = []
        self.gets: list[str] = []
        self.posts = 0
        site = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_: Any) -> None:
                pass
            def do_GET(self) -> None:  # noqa: N802 - the standard library's name
                path = self.path.split("?")[0]
                with site.lock:
                    site.gets.append(path)
                body = LINKED if path == "/linked" else PAGE.replace("@PATH@", path).encode()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def do_POST(self) -> None:  # noqa: N802 - the standard library's name
                size = int(self.headers.get("content-length") or 0)
                try:
                    one = json.loads(self.rfile.read(size) or b"{}")
                except ValueError:
                    one = {}
                with site.lock:
                    site.track.extend(one.pop("track", []))
                    del site.track[:-4000]
                    site.said = one
                    site.posts += 1
                    asks, site.asks = site.asks, []
                body = json.dumps(asks).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
    def now(self) -> dict[str, Any]:
        with self.lock:
            return json.loads(json.dumps(self.said))
    def ask(self, one: dict[str, Any], seconds: float = 3) -> bool:
        with self.lock:
            self.asks.append(one)
            seen = self.posts
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            time.sleep(0.05)
            with self.lock:
                if self.posts >= seen + 2:
                    return True
        return False
    def fresh(self, seconds: float = 2) -> dict[str, Any]:
        with self.lock:
            seen = self.posts
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            time.sleep(0.05)
            with self.lock:
                if self.posts >= seen + 1:
                    break
        return self.now()
    def tracked(self, since: float) -> list[list[float]]:
        with self.lock:
            return [one for one in self.track if one[0] >= since]
def epoch() -> float:
    return time.time() * 1000
class Windows:
    def __init__(self) -> None:
        from ctypes import wintypes
        self.w = wintypes
        self.u = ctypes.WinDLL("user32", use_last_error=True)
        self.u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        self.u.WindowFromPoint.argtypes = [wintypes.POINT]
        self.u.WindowFromPoint.restype = wintypes.HWND
        self.u.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.u.LoadCursorW.argtypes = [wintypes.HINSTANCE, ctypes.c_void_p]
        self.u.LoadCursorW.restype = ctypes.c_void_p
        self.u.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_long, ctypes.c_size_t]
        class Info(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD), ("hCursor", ctypes.c_void_p), ("pt", wintypes.POINT)]
        self.Info = Info
        named = {"arrow": 32512, "ibeam": 32513, "wait": 32514, "cross": 32515, "resize-nwse": 32642, "resize-nesw": 32643,
                 "resize-we": 32644, "resize-ns": 32645, "move": 32646, "no": 32648, "hand": 32649, "busy": 32650}
        self.cursors = {self.u.LoadCursorW(None, ctypes.c_void_p(code)): name for name, code in named.items()}
        self.at = (0, 0)
    def move(self, x: float, y: float) -> None:
        self.at = (round(x), round(y))
        self.u.SetCursorPos(*self.at)
    def down(self) -> None:
        self.u.mouse_event(0x0002, 0, 0, 0, 0)
    def up(self) -> None:
        self.u.mouse_event(0x0004, 0, 0, 0, 0)
    def click(self, times: int) -> None:
        for _ in range(times):
            self.down()
            time.sleep(0.03)
            self.up()
            time.sleep(0.06)
    def wheel(self, notches: int) -> None:
        for _ in range(abs(notches)):
            self.u.mouse_event(0x0800, 0, 0, -120 if notches > 0 else 120, 0)
            time.sleep(0.03)
    def fine(self, down: float, steps: int) -> None:
        step = round(-down / steps)
        for _ in range(steps):
            self.u.mouse_event(0x0800, 0, 0, step, 0)
            time.sleep(0.012)
    def sideways(self, across: float, steps: int) -> None:
        step = round(across / steps)
        for _ in range(steps):
            self.u.mouse_event(0x01000, 0, 0, step, 0)
            time.sleep(0.012)
    def pinch(self, at: tuple[float, float], out: bool) -> None:
        x, y = round(at[0]), round(at[1])
        self.move(x, y)
        time.sleep(0.3)
        under = self.u.WindowFromPoint(self.w.POINT(x, y))
        point = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
        delta = 120 if out else (-120 & 0xFFFF)
        for _ in range(6):
            self.u.PostMessageW(under, 0x020A, (delta << 16) | 0x0008, point)
            time.sleep(0.05)
    def cursor(self) -> str:
        info = self.Info()
        info.cbSize = ctypes.sizeof(self.Info)
        if not self.u.GetCursorInfo(ctypes.byref(info)):
            return "unknown"
        if not info.flags & 1:
            return "hidden"
        return self.cursors.get(info.hCursor, f"custom:{info.hCursor or 0:#x}")
class Mac:
    def __init__(self) -> None:
        import Quartz
        self.Q = Quartz
        self.at = (0.0, 0.0)
        self.held = False
        self.refs: dict[str, str] | None = None
    def post(self, kind: int, clicks: int = 0) -> None:
        Q = self.Q
        made = Q.CGEventCreateMouseEvent(None, kind, self.at, Q.kCGMouseButtonLeft)
        if clicks:
            Q.CGEventSetIntegerValueField(made, Q.kCGMouseEventClickState, clicks)
        Q.CGEventPost(Q.kCGHIDEventTap, made)
    def move(self, x: float, y: float) -> None:
        self.at = (float(x), float(y))
        self.post(self.Q.kCGEventLeftMouseDragged if self.held else self.Q.kCGEventMouseMoved)
    def down(self, clicks: int = 1) -> None:
        self.held = True
        self.post(self.Q.kCGEventLeftMouseDown, clicks)
    def up(self, clicks: int = 1) -> None:
        self.held = False
        self.post(self.Q.kCGEventLeftMouseUp, clicks)
    def click(self, times: int) -> None:
        for one in range(1, times + 1):
            self.down(one)
            time.sleep(0.03)
            self.up(one)
            time.sleep(0.06)
    def event(self, up: float, left: float, pixels: bool, phase: int = 0) -> None:
        Q = self.Q
        unit = Q.kCGScrollEventUnitPixel if pixels else Q.kCGScrollEventUnitLine
        try:
            made = Q.CGEventCreateScrollWheelEvent(None, unit, 2, int(up), int(left))
        except Exception:
            made = Q.CGEventCreateScrollWheelEvent(None, unit, 1, int(up))
        if pixels:
            for field, value in ((88, 1), (96, int(up)), (97, int(left)), (11, int(up) // 10), (12, int(left) // 10)):
                Q.CGEventSetIntegerValueField(made, field, value)
            Q.CGEventSetDoubleValueField(made, 93, float(up))
            Q.CGEventSetDoubleValueField(made, 94, float(left))
            Q.CGEventSetIntegerValueField(made, 99, phase)
        Q.CGEventSetLocation(made, self.at)
        Q.CGEventPost(Q.kCGHIDEventTap, made)
    def wheel(self, notches: int) -> None:
        for _ in range(abs(notches)):
            self.event(-1 if notches > 0 else 1, 0, False)
            time.sleep(0.03)
    def stream(self, up: float, left: float, steps: int) -> None:
        self.event(0, 0, True, 128)
        time.sleep(0.012)
        for one in range(steps):
            self.event(up / steps, left / steps, True, 1 if one == 0 else 2)
            time.sleep(0.012)
        self.event(0, 0, True, 4)
    def fine(self, down: float, steps: int) -> None:
        self.stream(-down, 0, steps)
    def sideways(self, across: float, steps: int) -> None:
        self.stream(0, -across, steps)
    def pinch(self, at: tuple[float, float], out: bool) -> None:
        Q = self.Q
        self.move(*at)
        time.sleep(0.3)
        for phase, value in [(1, 0.0)] + [(2, 0.06 if out else -0.06)] * 14 + [(4, 0.0)]:
            made = Q.CGEventCreate(None)
            Q.CGEventSetType(made, 29)
            Q.CGEventSetLocation(made, self.at)
            Q.CGEventSetIntegerValueField(made, 110, 8)
            Q.CGEventSetIntegerValueField(made, 132, phase)
            Q.CGEventSetDoubleValueField(made, 113, value)
            Q.CGEventPost(Q.kCGHIDEventTap, made)
            time.sleep(0.016)
    def cursor(self) -> str:
        from AppKit import NSCursor
        def sign(one: Any) -> str:
            data = one.image().TIFFRepresentation()
            spot = one.hotSpot()
            return hashlib.md5(bytes(data) + f"{spot.x},{spot.y}".encode()).hexdigest()[:10]
        if self.refs is None:
            self.refs = {}
            for name, made in (("arrow", "arrowCursor"), ("ibeam", "IBeamCursor"), ("hand", "pointingHandCursor"),
                               ("resize-we", "resizeLeftRightCursor"), ("resize-ns", "resizeUpDownCursor"),
                               ("cross", "crosshairCursor"), ("open-hand", "openHandCursor"), ("no", "operationNotAllowedCursor"),
                               ("resize-we", "columnResizeCursor"), ("resize-ns", "rowResizeCursor")):
                try:
                    self.refs.setdefault(sign(getattr(NSCursor, made)()), name)
                except Exception:
                    pass
        try:
            now = NSCursor.currentSystemCursor()
        except Exception as error:
            return f"unknown:{error}"
        if now is None:
            return "unknown"
        signed = sign(now)
        return self.refs.get(signed, f"custom:{signed}")
class XFixesImage(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_short), ("y", ctypes.c_short), ("width", ctypes.c_ushort), ("height", ctypes.c_ushort),
        ("xhot", ctypes.c_ushort), ("yhot", ctypes.c_ushort), ("serial", ctypes.c_ulong),
        ("pixels", ctypes.POINTER(ctypes.c_ulong)), ("atom", ctypes.c_ulong), ("name", ctypes.c_char_p),
    ]
X_NAMES = {
    "xterm": "ibeam", "text": "ibeam", "ibeam": "ibeam", "hand2": "hand", "hand1": "hand", "pointer": "hand", "pointing_hand": "hand",
    "left_ptr": "arrow", "default": "arrow", "arrow": "arrow", "top_left_arrow": "arrow", "col-resize": "resize-we",
    "sb_h_double_arrow": "resize-we", "ew-resize": "resize-we", "h_double_arrow": "resize-we", "row-resize": "resize-ns",
    "sb_v_double_arrow": "resize-ns", "ns-resize": "resize-ns", "v_double_arrow": "resize-ns",
}
class Linux:
    def __init__(self) -> None:
        from Xlib import X, display
        from Xlib.ext import xtest
        self.X, self.xtest = X, xtest
        self.d = display.Display()
        self.root = self.d.screen().root
        self.how = "xtest"
        self.at = (0, 0)
        try:
            self.x11 = ctypes.CDLL("libX11.so.6")
            self.xf = ctypes.CDLL("libXfixes.so.3")
            self.x11.XOpenDisplay.restype = ctypes.c_void_p
            self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
            self.x11.XFree.argtypes = [ctypes.c_void_p]
            self.xf.XFixesGetCursorImage.restype = ctypes.POINTER(XFixesImage)
            self.xf.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
            self.dpy = self.x11.XOpenDisplay(None)
        except OSError as error:
            print(f"no XFixes: {error}", flush=True)
            self.dpy = None
    def move(self, x: float, y: float) -> None:
        self.at = (round(x), round(y))
        if self.how == "xdotool":
            subprocess.run(["xdotool", "mousemove", str(self.at[0]), str(self.at[1])], check=False)
        elif self.how == "warp":
            self.root.warp_pointer(*self.at)
            self.d.sync()
        else:
            self.xtest.fake_input(self.d, self.X.MotionNotify, x=self.at[0], y=self.at[1])
            self.d.sync()
    def button(self, number: int, press: bool) -> None:
        if self.how == "xdotool":
            subprocess.run(["xdotool", "mousedown" if press else "mouseup", str(number)], check=False)
            return
        self.xtest.fake_input(self.d, self.X.ButtonPress if press else self.X.ButtonRelease, number)
        self.d.sync()
    def down(self) -> None:
        self.button(1, True)
    def up(self) -> None:
        self.button(1, False)
    def click(self, times: int) -> None:
        for _ in range(times):
            self.down()
            time.sleep(0.03)
            self.up()
            time.sleep(0.06)
    def wheel(self, notches: int) -> None:
        for _ in range(abs(notches)):
            self.button(5 if notches > 0 else 4, True)
            self.button(5 if notches > 0 else 4, False)
            time.sleep(0.03)
    def cursor(self) -> str:
        if not self.dpy:
            return "unknown"
        made = self.xf.XFixesGetCursorImage(self.dpy)
        if not made:
            return "unknown"
        one = made.contents
        name = (one.name or b"").decode("utf-8", "replace")
        size = one.width * one.height
        pixels = bytes(ctypes.cast(one.pixels, ctypes.POINTER(ctypes.c_ulong * size)).contents) if size else b""
        shape = hashlib.md5(pixels + f"{one.xhot},{one.yhot}".encode()).hexdigest()[:10]
        self.x11.XFree(made)
        if name in X_NAMES:
            return X_NAMES[name]
        return f"{name}:{shape}" if name else f"shape:{shape}"
class LinuxPad(Linux):
    def __init__(self) -> None:
        super().__init__()
        from evdev import AbsInfo, UInput, ecodes
        self.e = ecodes
        wide, tall = AbsInfo(0, 0, 4000, 0, 0, 40), AbsInfo(0, 0, 2500, 0, 0, 40)
        self.pad = UInput(
            {
                ecodes.EV_KEY: [ecodes.BTN_LEFT, ecodes.BTN_TOOL_FINGER, ecodes.BTN_TOOL_DOUBLETAP, ecodes.BTN_TOOL_TRIPLETAP, ecodes.BTN_TOUCH],
                ecodes.EV_ABS: [
                    (ecodes.ABS_X, wide), (ecodes.ABS_Y, tall),
                    (ecodes.ABS_MT_SLOT, AbsInfo(0, 0, 4, 0, 0, 0)),
                    (ecodes.ABS_MT_TRACKING_ID, AbsInfo(0, 0, 65535, 0, 0, 0)),
                    (ecodes.ABS_MT_POSITION_X, wide), (ecodes.ABS_MT_POSITION_Y, tall),
                ],
            },
            name="Orden parity touchpad",
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
    def two(self, dx: float, dy: float, steps: int) -> None:
        x, y = 2000.0, 1250.0
        for step in range(steps + 1):
            at = (round(x + dx * step / steps), round(y + dy * step / steps))
            self.fingers([(at[0] - 300, at[1]), (at[0] + 300, at[1])])
        self.fingers([None, None])
        time.sleep(0.05)
    def fine(self, down: float, steps: int) -> None:
        self.two(0, max(-1100.0, min(1100.0, down * 2)), steps)
    def sideways(self, across: float, steps: int) -> None:
        self.two(max(-1600.0, min(1600.0, across * 1.5)), 0, steps)
    def pinch(self, at: tuple[float, float], out: bool) -> None:
        self.move(*at)
        time.sleep(0.3)
        for step in range(60):
            apart = 300 + (step if out else 59 - step) * 15
            self.fingers([(2000 - apart, 1250), (2000 + apart, 1250)])
        self.fingers([None, None])
def linux_hand() -> Any:
    if os.access("/dev/uinput", os.W_OK):
        try:
            return LinuxPad()
        except (ImportError, OSError) as error:
            print(f"::warning::no touchpad could be made: {error}", flush=True)
    return Linux()
NAMED_CURSORS = {"arrow", "ibeam", "hand", "resize-we", "resize-ns", "resize-nwse", "resize-nesw", "move", "no", "wait", "busy", "cross"}
def named(cursor: Any) -> bool:
    return isinstance(cursor, str) and cursor in NAMED_CURSORS
def x_client(pid: int, size: list[float] | None) -> tuple[int, int] | None:
    found = subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(pid)], capture_output=True, text=True, check=False).stdout.split()
    best, off = None, None
    for window in found:
        said = subprocess.run(["xdotool", "getwindowgeometry", "--shell", window], capture_output=True, text=True, check=False).stdout
        got = {key: int(value) for key, _, value in (line.partition("=") for line in said.split()) if value.lstrip("-").isdigit()}
        if not got.get("WIDTH"):
            continue
        apart = abs(got["WIDTH"] - size[0]) + abs(got["HEIGHT"] - size[1]) if size else -got["WIDTH"] * got["HEIGHT"]
        if off is None or apart < off:
            best, off = (got["X"], got["Y"]), apart
    return best
def borrowed(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
APP_WATCH = """
if (!window.__pp) {
  const pp = { moves: [], watch: {}, hits: {}, sampling: null, list: [] }
  window.__pp = pp
  const now = () => performance.timeOrigin + performance.now()
  addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target : null
    const where = !t ? '' : t.closest('#drive-notices') ? 'layer' : t.closest('.cm-editor') ? 'note' : ''
    pp.moves.push([now(), e.clientX, e.clientY, e.isTrusted ? 1 : 0, where])
    if (pp.moves.length > 600) pp.moves.splice(0, 300)
  }, { capture: true, passive: true })
  const tick = () => {
    for (const name in pp.watch) {
      if (pp.hits[name]) continue
      const [sel, how] = pp.watch[name]
      const one = document.querySelector(sel)
      if (one && (how === 'there' || one.matches(':hover'))) pp.hits[name] = now()
    }
    if (pp.sampling) {
      const one = document.querySelector(pp.sampling)
      if (one) {
        const y = one.scrollTop
        const last = pp.list[pp.list.length - 1]
        if (!last || last[1] !== y) pp.list.push([now(), y])
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
return true
"""
GEOMETRY = """
const S = @S@, O = @O@, W = @W@, T = @T@
const r = (one) => { if (!one) return null; const b = one.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null }
const pane = document.querySelector('[data-pane="' + S + '"]')
const card = pane ? pane.querySelector('.card') : null
const words = (needle) => {
  const content = pane ? pane.querySelector('.cm-content') : null
  if (!content) return null
  const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walk.nextNode())) {
    const at = node.data.indexOf(needle)
    if (at >= 0) { const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + needle.length); return r(range) }
  }
  return null
}
const page = orden.pages.of(W)
const other = document.querySelector('[data-pane="' + O + '"]')
return {
  pane: r(pane), card: r(card), editor: r(pane ? pane.querySelector('.cm-scroller') : null),
  hole: page && page.sent && page.sent.visible ? page.sent.pane : null,
  divider: r(document.querySelector('.divider')),
  tab: r(pane ? pane.querySelector('.tab[data-box="' + T + '"] .pick') : null),
  strip: r(other ? other.querySelector('.tabs') : null),
  other: r(other ? other.querySelector('.cm-scroller') : null),
  radius: card ? parseFloat(getComputedStyle(card).borderBottomRightRadius) || 0 : 0,
  word: words('Notewords'), address: words('/linked'),
  shown: S ? (orden.workspace.showing(S) || {}).id : null,
}
"""
SAME = "const same = (a, b) => !!a && !!b && a.split(/[\\\\/]/).pop() === b.split(/[\\\\/]/).pop();"
def code(text: str, **values: Any) -> str:
    for name, value in values.items():
        text = text.replace(f"@{name}@", json.dumps(value))
    return text
def middle(box: dict[str, float]) -> tuple[float, float]:
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
def ms(value: float | None) -> float | None:
    return None if value is None else round(max(value, 0.0), 1)
def soon(web: float | None, note: float | None) -> bool:
    return note is not None and web is not None and web <= note + max(120.0, note)
class Drive:
    def __init__(self, app: App, pid: int, hand: Any, site: Site, out: pathlib.Path, spaces: pathlib.Path) -> None:
        self.app, self.pid, self.hand, self.site, self.out, self.spaces = app, pid, hand, site, out, spaces
        self.rows: list[dict[str, Any]] = []
        self.unmeasured: list[str] = []
        self.ids: dict[str, str] = {}
        self.paths: dict[str, str] = {}
        self.where: dict[str, float] = {}
        self.words: dict[str, str] = {}
    def js(self, text: str, seconds: float | None = None, **values: Any) -> Any:
        return self.app.eval(code(SAME + text if "same(" in text else text, **values), seconds)
    def until(self, text: str, seconds: float = 20, **values: Any) -> Any:
        said = None
        stop = time.monotonic() + seconds
        while time.monotonic() < stop:
            said = self.js(text, **values)
            if said not in (None, False) and not (isinstance(said, dict) and "error" in said):
                return said
            time.sleep(0.2)
        return None
    def row(self, item: int, check: str, web: Any, note: Any, ok: bool) -> None:
        one = {"item": item, "check": check, "platform": PLATFORM, "web": web, "note": note, "ok": bool(ok)}
        self.rows.append(one)
        print(f"{'ok ' if ok else 'BAD'} [{item}] {check}: web {json.dumps(web)} note {json.dumps(note)}", flush=True)
    def cursor_row(self, check: str, web: Any, note: Any, ok: bool) -> None:
        if not named(note):
            self.unmeasurable(3, check, f"this machine shows no cursor the drive can name (the note side reads {note!r})")
        else:
            self.row(3, check, web, note, ok)
    def answering(self, seconds: float = 90) -> float | None:
        began = time.monotonic()
        while time.monotonic() - began < seconds:
            if self.app.eval("1 + 1", 10) == 2:
                return time.monotonic() - began
            time.sleep(1)
        return None
    def unmeasurable(self, item: int, check: str, why: str) -> None:
        self.unmeasured.append(f"[{item}] {check}: {why}")
        print(f"::notice::not measured on {PLATFORM}: [{item}] {check}: {why}", flush=True)
    def inner(self) -> dict[str, float]:
        said = self.app.eval(INNER)
        if not isinstance(said, dict) or "x" not in said:
            raise SystemExit(f"where the window is was not said: {said}")
        if sys.platform == "darwin":
            import Quartz
            seen = [
                dict(one["kCGWindowBounds"])
                for one in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) or []
                if int(one.get("kCGWindowOwnerPID", 0)) == self.pid and int(one.get("kCGWindowLayer", 0)) == 0
            ]
            if seen:
                bounds = max(seen, key=lambda one: one["Width"] * one["Height"])
                if (bounds["X"], bounds["Y"]) != (said["x"] / said["scale"], said["y"] / said["scale"]):
                    print(f"the app says its window is at {said}, the screen shows it at {bounds}", flush=True)
                said = {**said, "x": bounds["X"] * said["scale"], "y": bounds["Y"] * said["scale"]}
        elif PLATFORM == "linux":
            size = self.app.eval("[innerWidth, innerHeight]")
            client = x_client(self.pid, size if isinstance(size, list) else None)
            if client and (client[0], client[1]) != (said["x"], said["y"]):
                print(f"the app says its window is at {said}, X shows its client area at {client}", flush=True)
            if client:
                said = {**said, "x": client[0], "y": client[1]}
        return said
    def screen(self, x: float, y: float) -> tuple[float, float]:
        inner = self.where
        if sys.platform == "darwin":
            return inner["x"] / inner["scale"] + x, inner["y"] / inner["scale"] + y
        return inner["x"] + x * inner["ratio"], inner["y"] + y * inner["ratio"]
    def to(self, x: float, y: float) -> None:
        self.hand.move(*self.screen(x, y))
    def glide(self, start: tuple[float, float], end: tuple[float, float], steps: int = 10, pause: float = 0.015) -> float:
        for one in range(1, steps + 1):
            self.to(start[0] + (end[0] - start[0]) * one / steps, start[1] + (end[1] - start[1]) * one / steps)
            time.sleep(pause)
        return epoch()
    def geometry(self) -> dict[str, Any]:
        said = self.js(GEOMETRY, S=self.ids["S"], O=self.ids["O"], W=self.ids["W"], T=self.ids["T"])
        if not isinstance(said, dict):
            raise SystemExit(f"the panes could not be measured: {said}")
        return said
    def content(self, kind: str, geo: dict[str, Any]) -> dict[str, float]:
        box = geo["hole"] if kind == "web" else geo["editor"]
        if not box:
            raise SystemExit(f"the {kind} pane shows nothing to point at: {geo}")
        return box
    def page_point(self, geo: dict[str, Any], name: str, along: float = 0.5) -> tuple[float, float] | None:
        said = self.site.fresh()
        box, inner = said.get("rects", {}).get(name), said.get("inner")
        hole = geo["hole"]
        if not box or not inner or not hole:
            return None
        scale = hole["width"] / inner[0]
        return hole["x"] + (box[0] + box[2] * along) * scale, hole["y"] + (box[1] + box[3] / 2) * scale
    def watch(self, **watched: list[str]) -> None:
        self.js(APP_WATCH)
        self.js("__pp.hits = {}; __pp.watch = @W@; __pp.moves = []; return true", W=watched)
    def heard(self) -> dict[str, Any]:
        said = self.js("return { hits: __pp.hits, moves: __pp.moves }")
        return said if isinstance(said, dict) else {"hits": {}, "moves": []}
    def setup(self) -> None:
        self.js(APP_WATCH)
        root = self.js(
            "if (!orden.workspace.spaces.length) await orden.workspace.addSpace('Parity');"
            "return orden.workspace.activeSpace ? orden.workspace.activeSpace.root : null",
            60,
        )
        if not isinstance(root, str):
            raise SystemExit(f"no space: {root}")
        filler = "".join(f"Line {one} of a long note to scroll through, with words enough to wrap now and then.\n\n" for one in range(400))
        notes = {
            "N": ("Parity note.md", f"# Parity\n\nNotewords to read and carry\n\n{self.site.base}/linked\n\n{filler}"),
            "T": ("Hover tab.md", "# Hover tab\n\nA tab to point at.\n"),
            "O1": ("Other one.md", "# Other one\n\nWords beside.\n\n" + filler),
            "O2": ("Other two.md", "# Other two\n\nThe tab that is carried.\n\n" + filler),
            "F": ("Listed.md", "# Listed\n\nA note dragged from the file list.\n"),
            "S1": ("Swipe one.md", "# Swipe one\n\nThe first.\n"),
            "S2": ("Swipe two.md", "# Swipe two\n\nThe second.\n"),
        }
        for key, (_, words) in notes.items():
            path = self.js("return await orden.workspace.noteFrom(@T@, @R@)", 30, T=words, R=root)
            if not isinstance(path, str):
                raise SystemExit(f"the app put no note in the space at {root}: {path}")
            self.paths[key] = path
        self.words = {key: words for key, (_, words) in notes.items()}
        listed = self.until(
            "void orden.workspace.loadTree(); return @P@.every((one) => !!orden.workspace.entryAt(one))", 40, P=list(self.paths.values())
        )
        if not listed:
            raise SystemExit("the file list never showed the notes put in the space")
        self.js(
            "for (const one of document.querySelectorAll('button')) if (one.textContent.trim() === 'Keep running') one.click();"
            "for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false);"
            "document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true"
        )
        time.sleep(1)
        made = self.js(
            "const P = @P@, url = @U@, ws = orden.workspace;"
            "const find = (path, pane) => ws.tabs.find((one) => same(one.path, path) && (!pane || one.paneId === pane));"
            "await ws.open(P.N); await ws.open(P.T);"
            "const W = ws.openPage(url);"
            "const N = find(P.N), T = find(P.T);"
            "if (!N || !T || !W) return { error: 'tabs', tabs: ws.tabs.map((one) => [one.id, one.kind, one.path]) };"
            "const S = N.paneId;"
            "ws.split('row', T.id);"
            "const copy = ws.tabs.find((one) => same(one.path, P.T) && one.paneId !== S);"
            "if (!copy) return { error: 'split', panes: ws.tabs.map((one) => [one.id, one.paneId, one.path]) };"
            "const O = copy.paneId; ws.focusPane(O);"
            "await ws.open(P.O1); await ws.open(P.O2);"
            "const O1 = find(P.O1, O), O2 = find(P.O2, O);"
            "ws.close(copy.id, false); ws.focusPane(S); ws.activate(N.id);"
            "return { S, O, W, N: N.id, T: T.id, O1: O1 && O1.id, O2: O2 && O2.id }",
            60,
            P=self.paths,
            U=f"{self.site.base}/p",
        )
        if not isinstance(made, dict) or "error" in made or not all(made.values()):
            raise SystemExit(f"the panes were not laid out: {made}")
        self.ids.update(made)
        print(f"laid out: {made}", flush=True)
        self.show("web")
        if not self.site.fresh(20).get("rects"):
            raise SystemExit("the page never said where it is")
        self.show("note")
    def sidebar(self, shown: bool) -> None:
        self.js("orden.workspace.panes.fills = null; if (!!orden.workspace.panel !== @V@) orden.workspace.toggleSidebar('left'); return true", V=shown)
        time.sleep(1.2)
    def show(self, kind: str) -> dict[str, Any]:
        tab = self.ids["W"] if kind == "web" else self.ids["N"]
        if self.answering(60) is None:
            raise SystemExit(f"the app stopped answering before the {kind} tab was shown")
        self.js("orden.workspace.focusPane(@S@); orden.workspace.activate(@T@); return true", S=self.ids["S"], T=tab)
        if kind == "web":
            ready = self.until("const p = orden.pages.of(@W@); return !!(p && p.sent && p.sent.visible && p.live)", 40, W=tab)
        else:
            ready = self.until("return !!document.querySelector('[data-pane=\"' + @S@ + '\"] .cm-content')", 20, S=self.ids["S"])
        if not ready:
            seen = self.js("return orden.pages.each().map(([id, one]) => [id, one.url, one.live, one.sent && one.sent.visible, one.layering])")
            raise SystemExit(f"the {kind} tab never showed: {seen}")
        time.sleep(1.0)
        self.where = self.inner()
        return self.geometry()
    def control(self) -> bool:
        forward(self.app, self.pid)
        time.sleep(0.6)
        self.where = self.inner()
        geo = self.geometry()
        start = middle(geo["strip"]) if geo["strip"] else (200.0, 20.0)
        hows = ["xtest", "xdotool", "warp"] if PLATFORM == "linux" else [""]
        for how in hows:
            if how:
                self.hand.how = how
            self.watch()
            self.glide((start[0] - 60, start[1]), start, 8, 0.03)
            time.sleep(0.6)
            trusted = [one for one in self.heard()["moves"] if one[3]]
            print(f"control {how or 'input'}: the app heard {len(trusted)} moves over its own strip", flush=True)
            if len(trusted) >= 4:
                return True
        if PLATFORM == "linux":
            shown = subprocess.run(["xdotool", "getmouselocation"], capture_output=True, text=True, check=False).stdout.strip()
            print(f"the pointer is at {shown}; the window at {self.where}", flush=True)
        return False
    def probe(self, start: tuple[float, float], end: tuple[float, float], hover: str | None = None, kind: str = "hover") -> dict[str, Any]:
        self.to(*start)
        time.sleep(0.4)
        self.watch(**({"h": [hover, kind]} if hover else {}))
        arrived = self.glide(start, end)
        time.sleep(0.9)
        cursor = self.hand.cursor()
        said = self.heard()
        first = next((one for one in said["moves"] if one[3] and abs(one[1] - end[0]) <= 3 and abs(one[2] - end[1]) <= 3), None)
        if first is None:
            print(f"nothing heard at {end}: the last moves {[one[1:4] for one in said['moves'][-3:]]}", flush=True)
        hit = said["hits"].get("h")
        return {
            "heard ms": ms(first[0] - arrived) if first else None,
            "hover ms": ms(hit - arrived) if hit else None,
            "cursor": cursor,
        }
    def pointer(self) -> None:
        self.sidebar(False)
        got: dict[str, dict[str, Any]] = {}
        for kind in ("note", "web"):
            geo = self.show(kind)
            box = self.content(kind, geo)
            mid = middle(box)
            one: dict[str, Any] = {}
            if geo["pane"]["x"] > 2:
                print(f"::warning::the {kind} pane is not at the window's left edge: {geo['pane']}", flush=True)
            self.to(*mid)
            time.sleep(0.4)
            self.watch(peek=[".column.peek", "there"])
            arrived = self.glide(mid, (1, mid[1]), 12)
            time.sleep(2.5)
            said = self.heard()
            hit = said["hits"].get("peek")
            one["left edge"] = ms(hit - arrived) if hit else None
            if not hit:
                print(f"{kind}: no peek; the last moves the app heard {[one[1:4] for one in said['moves'][-3:]]}, the window at {self.where}, the pane at {geo['pane']}", flush=True)
            self.glide((1, mid[1]), mid, 12)
            self.until("return !document.querySelector('.column.peek')", 5)
            if geo["tab"]:
                one["tab"] = self.probe(mid, middle(geo["tab"]), '.tab[data-box="' + self.ids["T"] + '"]')
            if geo["divider"]:
                d = geo["divider"]
                line = d["x"] + d["width"] / 2
                one["divider"] = self.probe(mid, (line, mid[1]), ".divider")
                band = []
                self.to(*mid)
                time.sleep(0.3)
                self.glide(mid, (line - 6, mid[1]))
                for off in range(-6, 7):
                    self.to(line + off, mid[1])
                    time.sleep(0.25)
                    band.append(self.hand.cursor())
                one["band"] = band
            card = geo["card"]
            inset = max(1.5, geo["radius"] * 0.25)
            corner = (card["x"] + card["width"] - inset, card["y"] + card["height"] - inset)
            one["corner"] = self.probe(mid, corner) | {"radius": geo["radius"]}
            if kind == "web":
                word = self.page_point(geo, "word")
                link = self.page_point(geo, "link", 0.3)
            else:
                word = middle(geo["word"]) if geo["word"] else None
                link = None
                hand = self.js(
                    "const one = document.createElement('div'); one.id = 'drive-hand';"
                    "Object.assign(one.style, { position: 'fixed', left: @X@ + 'px', top: @Y@ + 'px', width: '60px', height: '30px', cursor: 'pointer', zIndex: 2147483647 });"
                    "document.body.append(one); return true",
                    X=box["x"] + box["width"] * 0.3, Y=box["y"] + box["height"] * 0.25,
                )
                if hand is True:
                    link = (box["x"] + box["width"] * 0.3 + 30, box["y"] + box["height"] * 0.25 + 15)
            one["text"] = self.probe(mid, word)["cursor"] if word else None
            one["link"] = self.probe(mid, link)["cursor"] if link else None
            self.js("document.getElementById('drive-hand')?.remove(); return true")
            self.js("orden.workspace.panes.fills = @S@; return true", S=self.ids["S"])
            if self.until("return !!document.querySelector('.bar[data-covers]')", 10):
                time.sleep(1.5)
                geo = self.geometry()
                box = self.content(kind, geo)
                mid = middle(box)
                self.to(*mid)
                time.sleep(0.6)
                shown_early = self.js("return !!document.querySelector('.bar.shown[data-covers]')")
                self.watch(bar=[".bar.shown[data-covers]", "there"])
                arrived = self.glide(mid, (mid[0], 1), 12)
                time.sleep(2.5)
                hit = self.heard()["hits"].get("bar")
                one["top edge"] = {"ms": ms(hit - arrived) if hit else None, "shown before": shown_early}
                self.glide((mid[0], 1), mid, 12)
            else:
                one["top edge"] = {"ms": None, "shown before": None, "filled": False}
            self.js("orden.workspace.panes.fills = null; return true")
            time.sleep(1.2)
            geo = self.geometry()
            box = self.content(kind, geo)
            one["leak"] = self.leak(kind, box)
            got[kind] = one
            print(f"{kind}: {json.dumps(one)}", flush=True)
        web, note = got["web"], got["note"]
        edgeless = "the app heard no pointer there over the note either, so this machine gives the drive no way to reach that spot"
        if note["left edge"] is None:
            self.unmeasurable(3, "the left edge over the pane brings the shut sidebar out", edgeless)
        else:
            self.row(3, "the left edge over the pane brings the shut sidebar out (ms)", web["left edge"], note["left edge"], soon(web["left edge"], note["left edge"]))
        if note["top edge"]["ms"] is None:
            self.unmeasurable(3, "the top edge over a filled pane brings the bar out", edgeless)
        else:
            self.row(3, "the top edge over a filled pane brings the bar out (ms)", web["top edge"], note["top edge"],
                     soon(web["top edge"]["ms"], note["top edge"]["ms"]) and not web["top edge"]["shown before"])
        for name, what in (("tab", "a tab in the strip"), ("divider", "the divider")):
            w, n = web.get(name), note.get(name)
            if not w or not n:
                self.unmeasurable(3, f"from the pane onto {what}", "there is none on screen")
                continue
            self.row(3, f"from the pane onto {what}: the app hears the pointer (ms)", w["heard ms"], n["heard ms"], soon(w["heard ms"], n["heard ms"]))
            self.row(3, f"from the pane onto {what}: its hover shows (ms)", w["hover ms"], n["hover ms"], soon(w["hover ms"], n["hover ms"]))
            self.cursor_row(f"from the pane onto {what}: the cursor", w["cursor"], n["cursor"], w["cursor"] == n["cursor"])
        w, n = web["corner"], note["corner"]
        if n["heard ms"] is None:
            self.unmeasurable(3, "at the pane's rounded corner: the app hears the pointer", edgeless)
        else:
            self.row(3, "at the pane's rounded corner: the app hears the pointer (ms)", w["heard ms"], n["heard ms"], soon(w["heard ms"], n["heard ms"]))
        self.cursor_row("at the pane's rounded corner: the cursor", w["cursor"], n["cursor"], w["cursor"] == n["cursor"])
        if web.get("band") and note.get("band"):
            def wide(band: list[str]) -> int:
                return sum(1 for one in band if one.startswith("resize"))
            if not any(named(one) for one in note["band"]):
                self.unmeasurable(3, "the divider's resize cursor band", f"this machine names no cursor the drive can read: {sorted(set(note['band']))}")
            else:
                self.row(3, "the divider's resize cursor band, px of -6..6 around its line", {"px": wide(web["band"]), "cursors": web["band"]},
                         {"px": wide(note["band"]), "cursors": note["band"]}, wide(note["band"]) > 0 and wide(web["band"]) == wide(note["band"]))
        self.cursor_row("the cursor over the pane's words", web["text"], note["text"], note["text"] == "ibeam" and web["text"] == note["text"])
        self.cursor_row("the cursor over a link (the page's link, the app's own pointer cursor)", web["link"], note["link"],
                        note["link"] == "hand" and web["link"] == note["link"])
        w, n = web["leak"], note["leak"]
        self.row(3, "an app layer over the pane keeps the pane's hover from showing through", w, n,
                 n["layer heard"] > 0 and n["pane heard"] == 0 and w["layer heard"] > 0 and w["pane heard"] == 0 and not w.get("page hover"))
    def leak(self, kind: str, box: dict[str, float]) -> dict[str, Any]:
        left, top = box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.74
        wide, tall = box["width"] * 0.8, box["height"] * 0.16
        self.js(
            "const row = document.createElement('div'); row.dataset.notices = ''; row.id = 'drive-notices';"
            "Object.assign(row.style, { position: 'fixed', left: @L@ + 'px', top: @T@ + 'px', width: @W@ + 'px', height: @H@ + 'px', zIndex: 9999 });"
            "const card = document.createElement('div');"
            "Object.assign(card.style, { width: '100%', height: '100%', background: 'rgb(0,160,0)', borderRadius: '8px' });"
            "row.append(card); document.body.append(row); return true",
            L=left, T=top, W=wide, H=tall,
        )
        time.sleep(1.5)
        start, end = (left + 20, top + tall / 2), (left + wide - 20, top + tall / 2)
        self.to(*start)
        time.sleep(0.5)
        self.watch()
        if kind == "web":
            self.site.ask({"clear": True})
        self.glide(start, end, 16, 0.04)
        time.sleep(0.6)
        moves = self.heard()["moves"]
        said = self.site.fresh() if kind == "web" else {}
        self.js("document.getElementById('drive-notices')?.remove(); return true")
        time.sleep(0.8)
        got = {
            "layer heard": sum(1 for one in moves if one[3] and one[4] == "layer"),
            "pane heard": said.get("moves", 0) if kind == "web" else sum(1 for one in moves if one[3] and one[4] == "note"),
        }
        if kind == "web":
            got["page hover"] = said.get("hotMoves", 0) > 0 or said.get("hot", False)
        return got
    def drag(self, start: tuple[float, float], end: tuple[float, float], midway: Callable[[], Any] | None = None, steps: int = 30) -> Any:
        self.to(*start)
        time.sleep(0.4)
        self.hand.down()
        time.sleep(0.4)
        nudge = 14
        self.to(start[0] + nudge / 2, start[1])
        time.sleep(0.1)
        self.to(start[0] + nudge, start[1])
        time.sleep(0.2)
        for one in range(1, steps + 1):
            self.to(start[0] + nudge + (end[0] - start[0] - nudge) * one / steps, start[1] + (end[1] - start[1]) * one / steps)
            time.sleep(0.04)
        for turn in range(10):
            self.to(end[0] + turn % 2, end[1])
            time.sleep(0.08)
        seen = midway() if midway else None
        self.to(*end)
        time.sleep(0.1)
        self.hand.up()
        time.sleep(1.5)
        return seen
    def tabs_like(self, test: str) -> list[str]:
        said = self.js("return orden.workspace.tabs.filter((one) => " + test + ").map((one) => one.id)")
        return said if isinstance(said, list) else []
    def close_like(self, test: str) -> None:
        self.js("for (const one of [...orden.workspace.tabs].filter((one) => " + test + ")) orden.workspace.close(one.id, false); return true")
        time.sleep(1)
    def row_box(self, path: str) -> dict[str, float] | None:
        said = self.until(
            "const one = document.querySelector('.row[data-path=\"' + CSS.escape(@P@) + '\"]'); if (!one) return null;"
            "one.scrollIntoView({ block: 'center' }); const b = one.getBoundingClientRect();"
            "return b.width > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null",
            10, P=path,
        )
        return said if isinstance(said, dict) else None
    def doc(self, tab: str) -> Any:
        return self.js("return (orden.workspace.tabs.find((one) => one.id === @T@) || {}).doc || ''", T=tab)
    def put_back(self, tab: str, text: str) -> None:
        self.js("const tab = orden.workspace.tabs.find((one) => one.id === @T@); if (tab) orden.workspace.replace(@B@, tab); return true", T=tab, B=text)
    def drags(self, dropper: Any, pdf_of: Callable[[str], pathlib.Path]) -> None:
        self.sidebar(True)
        got: dict[str, dict[str, Any]] = {}
        S, O, O2, F, N = self.ids["S"], self.ids["O"], self.ids["O2"], self.paths["F"], self.ids["N"]
        landing = lambda: self.js("return orden.workspace.panes.landing")  # noqa: E731
        for kind in ("note", "web"):
            one: dict[str, Any] = {}
            geo = self.show(kind)
            box = self.content(kind, geo)
            pick = self.until("const b = document.querySelector('.tab[data-box=\"' + @T@ + '\"] .pick')?.getBoundingClientRect();"
                              " return b && b.width > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null", 10, T=O2)
            one["tab"] = None
            if pick:
                seen = self.drag(middle(pick), middle(box), landing)
                landed = self.js("return (orden.workspace.tabs.find((one) => one.id === @T@) || {}).paneId === @S@", T=O2, S=S)
                one["tab"] = {"landing": seen, "landed": landed}
                self.js("orden.workspace.moveTab(@T@, @O@); return true", T=O2, O=O)
                time.sleep(0.6)
            one["row middle"] = one["row edge"] = None
            geo = self.show(kind)
            box = self.content(kind, geo)
            row = self.row_box(F)
            if row:
                if kind == "web":
                    self.site.ask({"clear": True})
                    target = self.page_point(geo, "zone") or middle(box)
                else:
                    target = middle(box)
                before = self.doc(N)
                self.drag(middle(row), target)
                if kind == "web":
                    drops = self.site.fresh().get("drops", [])
                    one["row middle"] = {"page took": any("Listed" in name for drop in drops for name in drop.get("files", []))}
                else:
                    after = self.doc(N)
                    one["row middle"] = {"note took": isinstance(after, str) and isinstance(before, str) and after.count("Listed") > before.count("Listed")}
                    if isinstance(before, str) and isinstance(after, str) and after != before:
                        self.put_back(N, before)
                self.close_like(f"same(one.path, {json.dumps(F)})")
                geo = self.show(kind)
                box = self.content(kind, geo)
                row = self.row_box(F)
            if row:
                panes = self.js("return new Set(orden.workspace.tabs.map((one) => one.paneId)).size")
                edge = (box["x"] + box["width"] * 0.93, box["y"] + box["height"] / 2)
                seen = self.drag(middle(row), edge, landing)
                opened = self.js("const one = orden.workspace.tabs.find((tab) => same(tab.path, @F@)); return one ? one.paneId : null", F=F)
                after = self.js("return new Set(orden.workspace.tabs.map((one) => one.paneId)).size")
                one["row edge"] = {"landing": seen, "split": isinstance(after, int) and isinstance(panes, int) and after > panes and opened not in (None, S, O)}
                self.close_like(f"same(one.path, {json.dumps(F)})")
            one["words"] = None
            geo = self.show(kind)
            other = geo["other"]
            word = self.page_point(geo, "word") if kind == "web" else (middle(geo["word"]) if geo["word"] else None)
            if other and word:
                before = self.doc(O2)
                self.to(*word)
                time.sleep(0.4)
                self.hand.click(2)
                time.sleep(0.6)
                self.drag(word, middle(other), steps=24)
                after = self.doc(O2)
                needle = "Pagewords" if kind == "web" else "Notewords"
                one["words"] = {"carried": isinstance(after, str) and isinstance(before, str) and after.count(needle) > before.count(needle)}
                if isinstance(before, str) and isinstance(after, str) and after != before:
                    self.put_back(O2, before)
                now = self.doc(N)
                if isinstance(now, str) and "Notewords" not in now:
                    self.put_back(N, self.words["N"])
            one["link"] = None
            geo = self.show(kind)
            strip = geo["strip"]
            link = self.page_point(geo, "link", 0.3) if kind == "web" else (middle(geo["address"]) if geo["address"] else None)
            if strip and link:
                test = "one.kind === 'web' && (orden.workspace.webAddressOf(one) || '').includes('/linked')"
                if kind == "note":
                    self.to(*link)
                    time.sleep(0.4)
                    self.hand.click(3)
                    time.sleep(1.2)
                before = len(self.tabs_like(test))
                self.drag(link, (strip["x"] + strip["width"] * 0.9, strip["y"] + strip["height"] / 2), steps=24)
                time.sleep(1.5)
                one["link"] = {"opened": len(self.tabs_like(test)) > before}
                self.close_like(test)
            one["system file"] = None
            geo = self.show(kind)
            box = self.content(kind, geo)
            target = self.page_point(geo, "zone") if kind == "web" else middle(box)
            if target and dropper is not None:
                pdf = pdf_of(kind)
                pages = len(self.tabs_like("one.kind === 'pages'"))
                if kind == "web":
                    self.site.ask({"clear": True})
                end = self.screen(*target)
                how = dropper.drop(pdf, dropper.away(), (round(end[0]), round(end[1])))
                time.sleep(3)
                opened = len(self.tabs_like("one.kind === 'pages'")) > pages
                drops = self.site.fresh().get("drops", []) if kind == "web" else []
                one["system file"] = {"how": how, "page note opened": opened, "page took": any(pdf.name in drop.get("files", []) for drop in drops)}
                self.close_like("one.kind === 'pages'")
                waited = self.answering()
                if waited is None or waited > 2:
                    print(f"::warning::after a file dropped from the system on the {kind}, the app took {waited} s to answer again", flush=True)
                    one["system file"]["app answered after s"] = None if waited is None else round(waited, 1)
            got[kind] = one
            print(f"{kind}: {json.dumps(one)}", flush=True)
        web, note = got["web"], got["note"]
        def lands(seen: Any) -> bool:
            return isinstance(seen, dict) and seen.get("paneId") == S
        if web["tab"] and note["tab"]:
            self.row(3, "a tab carried across the pane shows where it lands and lands there", web["tab"], note["tab"],
                     note["tab"]["landed"] is True and lands(note["tab"]["landing"]) and web["tab"]["landed"] is True and lands(web["tab"]["landing"]))
        else:
            self.unmeasurable(3, "a tab carried across the pane", "the tab to carry was not on screen")
        if web["row middle"] is not None and note["row middle"] is not None:
            self.row(3, "a note from the file list let go in the pane's middle is taken (by the note, by the page)", web["row middle"], note["row middle"],
                     note["row middle"].get("note took") is True and web["row middle"].get("page took") is True)
        else:
            self.unmeasurable(3, "a note from the file list let go in the pane's middle", "the file list row was not on screen")
        if note["row edge"] is not None and note["row edge"]["split"] is not True:
            self.unmeasurable(3, "a note from the file list let go at the pane's right edge", f"the note pane did not split either, so the app splits no pane for a file let go over a note's text: note {note['row edge']}, web {web['row edge']}")
        elif web["row edge"] is not None and note["row edge"] is not None:
            self.row(3, "a note from the file list let go at the pane's right edge splits the pane", web["row edge"], note["row edge"],
                     note["row edge"]["split"] is True and web["row edge"]["split"] is True)
        else:
            self.unmeasurable(3, "a note from the file list let go at the pane's right edge", "the file list row was not on screen")
        if web["words"] and note["words"]:
            self.row(3, "selected words dragged from the pane into another note", web["words"], note["words"],
                     note["words"]["carried"] is True and web["words"]["carried"] is True)
        else:
            self.unmeasurable(3, "selected words dragged into another note", "no words or no note to drop on")
        if web["link"] and note["link"]:
            self.row(3, "an address dragged from the pane onto the tab strip opens it", web["link"], note["link"],
                     note["link"]["opened"] is True and web["link"]["opened"] is True)
        else:
            self.unmeasurable(3, "an address dragged onto the tab strip", "no address or no strip on screen")
        if web["system file"] and note["system file"]:
            w, n = web["system file"], note["system file"]
            self.row(3, "a PDF from the system let go on the pane is taken (a page note, or the page's own drop)", w, n,
                     n["page note opened"] is True and (w["page took"] is True or w["page note opened"] is True))
        else:
            self.unmeasurable(3, "a PDF from the system dropped on the pane", "no drop target or no system drag on this machine")
    def scroll_to(self, kind: str, y: float) -> None:
        if kind == "web":
            self.site.ask({"scroll": y})
        else:
            self.js("const one = document.querySelector('[data-pane=\"' + @S@ + '\"] .cm-scroller'); if (one) one.scrollTop = @Y@; return true", S=self.ids["S"], Y=y)
        time.sleep(0.8)
    def scrolled(self, kind: str, act: Callable[[], None], seconds: float = 1.6) -> dict[str, Any]:
        scroller = "document.querySelector('[data-pane=\"' + @S@ + '\"] .cm-scroller')"
        if kind == "note":
            self.js(APP_WATCH)
            self.js("__pp.list = []; __pp.sampling = '[data-pane=\"' + @S@ + '\"] .cm-scroller'; return true", S=self.ids["S"])
            start = self.js("return " + scroller + ".scrollTop", S=self.ids["S"])
        else:
            start = self.site.fresh().get("y")
        time.sleep(0.2)
        began = epoch()
        act()
        time.sleep(seconds)
        if kind == "note":
            track = self.js("const list = __pp.list; __pp.sampling = null; return list") or []
        else:
            self.site.fresh()
            track = self.site.tracked(began)
        moving = [one for one in track if isinstance(one, list) and one[0] >= began]
        if not isinstance(start, (int, float)) or not moving:
            return {"px": 0, "frames": 0, "ms": 0}
        return {"px": round(moving[-1][1] - start, 1), "frames": len(moving), "ms": round(moving[-1][0] - moving[0][0])}
    def shifted(self, kind: str, box: dict[str, float], act: Callable[[], None]) -> float | None:
        try:
            import mss
            import numpy
        except ImportError:
            return None
        left, top = self.screen(box["x"] + box["width"] * 0.3, box["y"] + 2)
        right, bottom = self.screen(box["x"] + box["width"] * 0.7, box["y"] + min(box["height"] - 4, 260))
        region = {"left": int(left), "top": int(top), "width": max(8, int(right - left)), "height": max(8, int(bottom - top))}
        frames: list[Any] = []
        stop = threading.Event()
        def grabbing() -> None:
            with mss.mss() as grab:
                while not stop.is_set():
                    shot = grab.grab(region)
                    frames.append(numpy.asarray(shot, dtype=numpy.float32)[:, :, :3].mean(axis=(1, 2)))
                    time.sleep(0.01)
        thread = threading.Thread(target=grabbing, daemon=True)
        thread.start()
        time.sleep(0.3)
        act()
        time.sleep(1.2)
        stop.set()
        thread.join(5)
        if len(frames) < 3:
            return None
        first = frames[0]
        tall = first.shape[0]
        css = (bottom - top) / (1 if sys.platform == "darwin" else self.where["ratio"])
        scale = tall / max(1.0, css)
        most = 0
        reach = min(90, tall // 3)
        for frame in frames[1:]:
            if frame.shape != first.shape:
                continue
            best, at = None, 0
            for shift in range(-reach, reach + 1):
                a = first[max(0, -shift): tall - max(0, shift)]
                b = frame[max(0, shift): tall - max(0, -shift)]
                gap = float(numpy.abs(a - b).mean())
                if best is None or gap < best - 0.05 or (abs(gap - best) <= 0.05 and abs(shift) < abs(at)):
                    best, at = gap, shift
            most = max(most, abs(at))
        return round(most / max(scale, 0.01), 1)
    def scrolls(self) -> None:
        self.sidebar(False)
        got: dict[str, dict[str, Any]] = {}
        fine = hasattr(self.hand, "fine")
        for kind in ("note", "web"):
            one: dict[str, Any] = {}
            geo = self.show(kind)
            box = self.content(kind, geo)
            mid = middle(box)
            self.to(*mid)
            time.sleep(0.5)
            self.scroll_to(kind, 1500)
            one["notch"] = self.scrolled(kind, lambda: self.hand.wheel(1))
            self.scroll_to(kind, 1500)
            one["three notches"] = self.scrolled(kind, lambda: self.hand.wheel(3))
            if fine:
                self.scroll_to(kind, 1500)
                one["touchpad"] = self.scrolled(kind, lambda: self.hand.fine(240, 16))
            self.scroll_to(kind, 0)
            if fine:
                one["overscroll"] = self.shifted(kind, box, lambda: self.hand.fine(-600, 24))
            else:
                one["overscroll"] = self.shifted(kind, box, lambda: self.hand.wheel(-4))
            self.scroll_to(kind, 0)
            got[kind] = one
            print(f"{kind}: {json.dumps(one)}", flush=True)
        web, note = got["web"], got["note"]
        def near(w: dict[str, Any], n: dict[str, Any]) -> bool:
            return abs(n["px"]) > 0 and 0.8 <= w["px"] / n["px"] <= 1.25
        def smooth(w: dict[str, Any], n: dict[str, Any]) -> bool:
            if n["frames"] == 0 or w["frames"] == 0:
                return False
            if (w["frames"] > 2) != (n["frames"] > 2):
                return False
            return n["frames"] <= 2 or 0.5 <= (w["ms"] or 1) / (n["ms"] or 1) <= 2
        self.row(8, "one wheel notch scrolls as far", {"px": web["notch"]["px"]}, {"px": note["notch"]["px"]}, near(web["notch"], note["notch"]))
        self.row(8, "one wheel notch glides alike (frames, ms)", web["notch"], note["notch"], smooth(web["notch"], note["notch"]))
        self.row(8, "three wheel notches scroll as far", web["three notches"], note["three notches"], near(web["three notches"], note["three notches"]))
        if fine:
            self.row(8, "a touchpad's fine scroll goes as far", web["touchpad"], note["touchpad"], near(web["touchpad"], note["touchpad"]))
        else:
            self.unmeasurable(8, "a touchpad's fine scroll", "XTest only sends whole wheel clicks; a touchpad needs uinput and libinput")
        w, n = web["overscroll"], note["overscroll"]
        if w is None or n is None:
            self.unmeasurable(8, "overscroll at the top", f"the screen could not be read (web {w}, note {n})")
        else:
            self.row(8, "scrolling past the top moves the content alike (largest shift, px)", w, n, abs(w - n) <= 4)
    def swipes(self) -> None:
        if not hasattr(self.hand, "sideways"):
            self.unmeasurable(8, "a back swipe", "XTest only sends whole wheel clicks; a touchpad needs uinput and libinput")
            return
        got: dict[str, Any] = {}
        S = self.ids["S"]
        self.show("note")
        made = self.js(
            "const ws = orden.workspace; ws.focusPane(@S@);"
            "await ws.open(@A@, { preview: true }); await ws.open(@B@, { preview: true });"
            "const tab = ws.tabs.find((one) => one.id === ws.previewTabId);"
            "return tab ? { id: tab.id, back: tab.canGoBack, path: tab.path, pane: tab.paneId } : null",
            30, S=S, A=self.paths["S1"], B=self.paths["S2"],
        )
        print(f"the note with history: {made}", flush=True)
        if isinstance(made, dict) and made.get("back"):
            time.sleep(1.2)
            self.where = self.inner()
            box = self.geometry()["editor"]
            mid = middle(box)
            self.to(*mid)
            time.sleep(0.5)
            self.watch(arrow=[".orden-swipe", "there"])
            self.hand.sideways(-900, 40)
            time.sleep(2)
            back = self.js("return same((orden.workspace.tabs.find((one) => one.id === @T@) || {}).path, @A@)", T=made["id"], A=self.paths["S1"])
            got["note"] = {"went back": back is True, "arrow": "arrow" in self.heard()["hits"]}
            self.js("orden.workspace.close(@T@, false); return true", T=made["id"])
            time.sleep(0.8)
        else:
            got["note"] = None
        self.show("web")
        self.js("orden.pages.go(@W@, @U@); return true", W=self.ids["W"], U=f"{self.site.base}/p2")
        if self.until("const p = orden.pages.of(@W@); return !!(p && p.back && p.live)", 20, W=self.ids["W"]) and self.site.fresh(10).get("path") == "/p2":
            time.sleep(1.0)
            mid = middle(self.content("web", self.geometry()))
            self.to(*mid)
            time.sleep(0.5)
            self.watch(arrow=[".orden-swipe", "there"])
            self.hand.sideways(-900, 40)
            time.sleep(2.5)
            got["web"] = {"went back": self.site.fresh(5).get("path") == "/p", "arrow": "arrow" in self.heard()["hits"]}
            if self.site.now().get("path") != "/p":
                self.js("orden.pages.go(@W@, @U@); return true", W=self.ids["W"], U=f"{self.site.base}/p")
                self.until("const p = orden.pages.of(@W@); return !!(p && p.live)", 20, W=self.ids["W"])
                time.sleep(1.5)
        else:
            got["web"] = None
        if got["note"] is None or got["web"] is None:
            self.unmeasurable(8, "a back swipe", f"a tab with somewhere to go back to could not be made (note {got['note']}, web {got['web']})")
            return
        self.row(8, "a sideways two-finger swipe goes back", got["web"], got["note"], got["note"]["went back"] is True and got["web"]["went back"] is True)
    def pinches(self) -> None:
        if not hasattr(self.hand, "pinch"):
            self.unmeasurable(8, "a pinch", "XTest has no touchpad; a pinch needs uinput and libinput under Xorg")
            return
        got: dict[str, Any] = {}
        size = "return parseFloat(getComputedStyle(document.querySelector('[data-pane=\"' + @S@ + '\"] .cm-content')).fontSize)"
        for kind in ("note", "web"):
            geo = self.show(kind)
            at = self.screen(*middle(self.content(kind, geo)))
            if kind == "note":
                before = self.js(size, S=self.ids["S"])
                self.hand.pinch(at, True)
                time.sleep(1.5)
                after = self.js(size, S=self.ids["S"])
                got[kind] = {"font px": [before, after]}
                self.hand.pinch(at, False)
                time.sleep(1)
            else:
                before = self.site.fresh()
                self.hand.pinch(at, True)
                time.sleep(2)
                after = self.site.fresh()
                got[kind] = {"scale": [before.get("scale"), after.get("scale")], "ratio": [before.get("ratio"), after.get("ratio")], "ctrl wheels": after.get("ctrl", 0)}
        n, w = got["note"]["font px"], got["web"]["scale"]
        note_ok = all(isinstance(one, (int, float)) for one in n) and n[1] > n[0]
        web_ok = all(isinstance(one, (int, float)) for one in w) and w[1] > w[0] * 1.05
        self.row(8, "a pinch magnifies the pane (the note's text size, the page's scale)", got["web"], got["note"], note_ok and web_ok)
def table(rows: list[dict[str, Any]]) -> str:
    lines = ["| item | check | platform | ok | web | note |", "| --- | --- | --- | --- | --- | --- |"]
    for one in rows:
        lines.append(
            f"| {one['item']} | {one['check']} | {one['platform']} | {'yes' if one['ok'] else 'no'} |"
            f" `{json.dumps(one['web'])}` | `{json.dumps(one['note'])}` |"
        )
    return "\n".join(lines)
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    site = Site()
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-parity-pointer-spaces-"))
    outside = pathlib.Path(tempfile.mkdtemp(prefix="orden-parity-pointer-files-"))
    hand: Any = Windows() if sys.platform == "win32" else Mac() if sys.platform == "darwin" else linux_hand()
    print(f"the hand: {type(hand).__name__}", flush=True)
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    drive: Drive | None = None
    failed: str | None = None
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        drops = borrowed("outside-drop-drive")
        dropper = None
        try:
            dropper = drops.screen_of(process.pid)
        except (SystemExit, Exception) as error:
            print(f"::warning::no system drag on this machine: {error}", flush=True)
        forward(app, process.pid)
        time.sleep(2)
        drive = Drive(app, process.pid, hand, site, args.out, spaces)
        drive.setup()
        def pdf_of(kind: str) -> pathlib.Path:
            path = outside / f"Dropped on the {kind}.pdf"
            path.write_bytes(drops.a_pdf(f"Dropped on the {kind}"))
            return path
        reached = drive.control()
        steps: list[tuple[str, Callable[[], None]]] = []
        if reached:
            steps += [("pointer", drive.pointer)]
        else:
            drive.unmeasurable(3, "the hover, edge and cursor checks", "the pointer moves this machine posts do not reach the app over its own tab strip (fewer than 4 of 8 heard)")
        steps += [("scrolls", drive.scrolls), ("swipes", drive.swipes), ("pinches", drive.pinches)]
        steps += [("drags", lambda: drive.drags(dropper, pdf_of))]
        for name, step in steps:
            try:
                forward(app, process.pid)
                time.sleep(0.5)
                step()
            except (SystemExit, Exception) as error:
                traceback.print_exc()
                print(f"::error::the {name} checks stopped: {error}", flush=True)
                drive.unmeasurable(3 if name in ("pointer", "drags") else 8, f"the {name} checks", f"stopped: {error}")
    except (SystemExit, Exception) as error:
        traceback.print_exc()
        failed = str(error)
    finally:
        ended(process)
        site.server.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        shutil.rmtree(outside, ignore_errors=True)
    rows = drive.rows if drive else []
    unmeasured = drive.unmeasured if drive else []
    (args.out / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    (args.out / "unmeasured.json").write_text(json.dumps(unmeasured, indent=1), encoding="utf-8")
    text = table(rows)
    if unmeasured:
        text += "\n\nNot measured on " + PLATFORM + ":\n" + "\n".join(f"- {one}" for one in unmeasured)
    print(text, flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as told:
            told.write(f"\n### Pointer and scroll parity on {PLATFORM}\n\n{text}\n")
    if failed:
        print(f"::error::{failed}", flush=True)
        return 1
    bad = [one for one in rows if not one["ok"]]
    for one in bad:
        print(f"::error::[{one['item']}] {one['check']}: web {json.dumps(one['web'])}, note {json.dumps(one['note'])}", flush=True)
    return 1 if bad or not rows else 0
if __name__ == "__main__":
    raise SystemExit(main())
