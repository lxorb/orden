from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any

SPAN = """
(() => {
  const span = [...document.querySelectorAll('.pages .sheet .words span')].find((one) => one.textContent.startsWith(%s))
  if (!span) return null
  const box = span.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
})()
"""

CLOSE = """
(() => {
  const close = document.querySelector('.pages .sheet canvas.close.there')
  const box = close?.getBoundingClientRect()
  const sheet = document.querySelector('.pages .sheet')?.getBoundingClientRect()
  return { pixels: close ? close.width : 0, shown: box ? box.width * devicePixelRatio : 0, wide: sheet ? sheet.width : 0 }
})()
"""

ZOOM_IN = """
(() => {
  const host = document.querySelector('.pages')
  const box = host.getBoundingClientRect()
  for (let step = 0; step < %d; step++) {
    host.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: box.x + 120, clientY: box.y + 120, bubbles: true, cancelable: true }))
  }
  return true
})()
"""

UNDER = """
(() => {
  const host = document.querySelector('.pages').getBoundingClientRect()
  const spans = [...document.querySelectorAll('.pages .sheet .words span')]
  for (const span of spans) {
    const box = span.getBoundingClientRect()
    const top = Math.max(box.top, host.top + 40)
    const bottom = Math.min(box.bottom, host.bottom - 40)
    const left = Math.max(box.left + 1, host.left + 40)
    const right = Math.min(box.right - 1, host.right - 40)
    if (span.textContent.length > 10 && bottom - top > 4 && right - left > 80) {
      return { text: span.textContent, y: (top + bottom) / 2, left, right }
    }
  }
  return null
})()
"""

LOOKED = """
(() => ({
  pages: document.querySelectorAll('.pages').length,
  sheets: document.querySelectorAll('.pages .sheet').length,
  canvases: document.querySelectorAll('.pages .sheet canvas').length,
  layers: document.querySelectorAll('.pages .sheet .words').length,
  spans: document.querySelectorAll('.pages .sheet .words span').length,
  tab: orden.workspace.activeTab ? [orden.workspace.activeTab.kind, orden.workspace.activeTab.note?.path] : null,
  errors: (window.__errors ?? []).slice(0, 5),
}))()
"""

HEAR = """
(() => {
  window.__heard = []
  const note = (event) => window.__heard.push([event.type, event.pointerType ?? '', String(event.target?.className ?? '').slice(0, 24), Math.round(event.clientX ?? 0), Math.round(event.clientY ?? 0)].join(' '))
  for (const kind of ['pointerdown', 'pointerup', 'pointercancel', 'contextmenu', 'touchstart', 'touchcancel', 'mousedown', 'mouseup', 'selectstart']) addEventListener(kind, note, true)
  return true
})()
"""

HEARD = "(() => { const said = window.__heard.splice(0); return said.length > 24 ? [...said.slice(0, 12), '…', ...said.slice(-12)] : said })()"

INNER = (
    "const i = window.__TAURI_INTERNALS__;"
    "const at = await i.invoke('plugin:window|inner_position', { label: 'main' });"
    "const scale = await i.invoke('plugin:window|scale_factor', { label: 'main' });"
    "return { x: at.x, y: at.y, scale, ratio: devicePixelRatio }"
)


def long_paper(pages: int = 120, lines: int = 70) -> bytes:
    w, h = 595, 842
    words = "the kestrel hangs above the field while the river turns slowly under a grey and patient sky"
    objects: dict[int, bytes] = {1: b"<</Type/Catalog/Pages 2 0 R>>", 3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"}
    kids = []
    for at in range(pages):
        page, content = 4 + at * 2, 5 + at * 2
        kids.append(f"{page} 0 R")
        stream = "\n".join(f"BT /F1 7 Tf 36 {h - 40 - row * 11} Td (P{at + 1} L{row + 1}: {words}) Tj ET" for row in range(lines)).encode("latin-1")
        objects[page] = f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents {content} 0 R>>".encode("latin-1")
        objects[content] = b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream"
    objects[2] = f"<</Type/Pages/Kids[{' '.join(kids)}]/Count {pages}>>".encode("latin-1")
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    table = len(out)
    size = max(objects) + 1
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        out += b"%010d 00000 n \n" % places[number]
    out += b"trailer<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n" % (size, table)
    return bytes(out)


SCROLL = """
const [frames, step, hide] = %s
document.getElementById('no-words')?.remove()
if (hide) { const style = document.createElement('style'); style.id = 'no-words'; style.textContent = '.pages .sheet .words { display: none !important }'; document.head.append(style) }
await new Promise((done) => setTimeout(done, 800))
const host = document.querySelector('.pages')
const box = host.getBoundingClientRect()
const column = host.querySelector('.column')
const rise = () => new DOMMatrix(getComputedStyle(column).transform).f
const from = rise()
const gaps = []
let built = 0
const watching = new MutationObserver((changes) => { for (const change of changes) if (change.target.classList?.contains('words')) built += change.addedNodes.length })
watching.observe(host, { childList: true, subtree: true })
await new Promise((done) => {
  let last = 0
  let count = 0
  const frame = (now) => {
    if (last) gaps.push(now - last)
    last = now
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: step, deltaMode: 0, bubbles: true, cancelable: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }))
    if (++count < frames) requestAnimationFrame(frame)
    else done()
  }
  requestAnimationFrame(frame)
})
watching.disconnect()
document.getElementById('no-words')?.remove()
const sorted = [...gaps].sort((a, b) => a - b)
return { mean: gaps.reduce((sum, one) => sum + one, 0) / gaps.length, p95: sorted[Math.floor(sorted.length * 0.95)], long: gaps.filter((one) => one > 50).length, moved: from - rise(), built }
"""


def paper() -> bytes:
    w, h = 595, 842
    lines = [f"BT /F1 9 Tf 40 {h - 60 - row * 12} Td (Line {row + 1}: the kestrel hangs above the field.) Tj ET" for row in range(60)]
    stream = "\n".join(lines).encode("latin-1")
    objects = {
        1: b"<</Type/Catalog/Pages 2 0 R>>",
        2: b"<</Type/Pages/Kids[4 0 R]/Count 1>>",
        3: b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        4: f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 {w} {h}]/Resources<</Font<</F1 3 0 R>>>>/Contents 5 0 R>>".encode("latin-1"),
        5: b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream",
    }
    out = bytearray(b"%PDF-1.4\n")
    places: dict[int, int] = {}
    for number in sorted(objects):
        places[number] = len(out)
        out += b"%d 0 obj" % number + objects[number] + b"endobj\n"
    table = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n"
    for number in range(1, 6):
        out += b"%010d 00000 n \n" % places[number]
    out += b"trailer<</Root 1 0 R/Size 6>>\nstartxref\n%d\n%%%%EOF\n" % table
    return bytes(out)


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

    def until(self, code: str, seconds: float = 30) -> bool:
        ends = time.monotonic() + seconds
        while time.monotonic() < ends:
            if self.eval(code) is True:
                return True
            time.sleep(0.3)
        return False


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


class Windows:
    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        self.ctypes = ctypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

        class PointerInfo(ctypes.Structure):
            _fields_ = [
                ("pointerType", wintypes.DWORD),
                ("pointerId", ctypes.c_uint32),
                ("frameId", ctypes.c_uint32),
                ("pointerFlags", ctypes.c_uint32),
                ("sourceDevice", wintypes.HANDLE),
                ("hwndTarget", wintypes.HWND),
                ("ptPixelLocation", wintypes.POINT),
                ("ptHimetricLocation", wintypes.POINT),
                ("ptPixelLocationRaw", wintypes.POINT),
                ("ptHimetricLocationRaw", wintypes.POINT),
                ("dwTime", wintypes.DWORD),
                ("historyCount", ctypes.c_uint32),
                ("InputData", ctypes.c_int32),
                ("dwKeyStates", wintypes.DWORD),
                ("PerformanceCount", ctypes.c_uint64),
                ("ButtonChangeType", ctypes.c_int),
            ]

        class PenInfo(ctypes.Structure):
            _fields_ = [
                ("pointerInfo", PointerInfo),
                ("penFlags", ctypes.c_uint32),
                ("penMask", ctypes.c_uint32),
                ("pressure", ctypes.c_uint32),
                ("rotation", ctypes.c_uint32),
                ("tiltX", ctypes.c_int32),
                ("tiltY", ctypes.c_int32),
            ]

        class TouchInfo(ctypes.Structure):
            _fields_ = [
                ("pointerInfo", PointerInfo),
                ("touchFlags", ctypes.c_uint32),
                ("touchMask", ctypes.c_uint32),
                ("rcContact", wintypes.RECT),
                ("rcContactRaw", wintypes.RECT),
                ("orientation", ctypes.c_uint32),
                ("pressure", ctypes.c_uint32),
            ]

        class Either(ctypes.Union):
            _fields_ = [("touchInfo", TouchInfo), ("penInfo", PenInfo)]

        class TypeInfo(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("u", Either)]

        self.TypeInfo = TypeInfo
        self.user32.CreateSyntheticPointerDevice.restype = wintypes.HANDLE
        self.user32.CreateSyntheticPointerDevice.argtypes = [wintypes.DWORD, wintypes.ULONG, wintypes.DWORD]
        self.user32.InjectSyntheticPointerInput.argtypes = [wintypes.HANDLE, ctypes.POINTER(TypeInfo), ctypes.c_uint32]
        self.devices: dict[int, Any] = {}

    def drag(self, start: tuple[float, float], end: tuple[float, float]) -> None:
        user32 = self.user32
        user32.SetCursorPos(round(start[0]), round(start[1]))
        time.sleep(0.2)
        user32.mouse_event(0x0002, 0, 0, 0, 0)
        for step in range(1, 13):
            user32.SetCursorPos(round(start[0] + (end[0] - start[0]) * step / 12), round(start[1] + (end[1] - start[1]) * step / 12))
            time.sleep(0.03)
        user32.mouse_event(0x0004, 0, 0, 0, 0)
        time.sleep(0.4)

    def wheel(self, at: tuple[float, float], turn: int, ctrl: bool = False) -> None:
        user32 = self.user32
        user32.SetCursorPos(round(at[0]), round(at[1]))
        time.sleep(0.2)
        if ctrl:
            user32.keybd_event(0x11, 0, 0, 0)
            time.sleep(0.05)
        for _ in range(3):
            user32.mouse_event(0x0800, 0, 0, turn, 0)
            time.sleep(0.08)
        if ctrl:
            user32.keybd_event(0x11, 0, 0x0002, 0)
        time.sleep(0.5)

    def _device(self, kind: int) -> Any:
        if kind not in self.devices:
            made = self.user32.CreateSyntheticPointerDevice(kind, 1, 1)
            if not made:
                raise OSError(f"CreateSyntheticPointerDevice({kind}) failed: {self.ctypes.get_last_error()}")
            self.devices[kind] = made
        return self.devices[kind]

    def _send(self, kind: int, at: tuple[float, float], flags: int) -> None:
        one = self.TypeInfo()
        one.type = kind
        info = one.u.penInfo.pointerInfo if kind == 3 else one.u.touchInfo.pointerInfo
        info.pointerType = kind
        info.pointerId = 0
        info.pointerFlags = flags
        info.ptPixelLocation.x = round(at[0])
        info.ptPixelLocation.y = round(at[1])
        if kind == 3:
            one.u.penInfo.penMask = 0x1
            one.u.penInfo.pressure = 512 if flags & 0x4 else 0
        else:
            one.u.touchInfo.touchMask = 0x4
            one.u.touchInfo.pressure = 512
            box = one.u.touchInfo.rcContact
            box.left, box.top, box.right, box.bottom = round(at[0]) - 2, round(at[1]) - 2, round(at[0]) + 2, round(at[1]) + 2
        if not self.user32.InjectSyntheticPointerInput(self._device(kind), self.ctypes.byref(one), 1):
            raise OSError(f"InjectSyntheticPointerInput failed: {self.ctypes.get_last_error()}")

    def stroke(self, kind: int, start: tuple[float, float], end: tuple[float, float], hold: float = 0) -> None:
        down = 0x2 | 0x4 | 0x2000
        if kind == 3:
            self._send(kind, start, 0x2 | 0x20000)
            time.sleep(0.05)
        self._send(kind, start, down | 0x10000)
        waited = 0.0
        while waited < hold:
            time.sleep(0.05)
            waited += 0.05
            self._send(kind, start, down | 0x20000)
        for step in range(1, 13):
            at = (start[0] + (end[0] - start[0]) * step / 12, start[1] + (end[1] - start[1]) * step / 12)
            self._send(kind, at, down | 0x20000)
            time.sleep(0.03)
        self._send(kind, end, (0x2 if kind == 3 else 0) | 0x2000 | 0x40000)
        if kind == 3:
            time.sleep(0.05)
            self._send(kind, end, 0x20000)
        time.sleep(0.5)

    def pen(self, start: tuple[float, float], end: tuple[float, float]) -> None:
        self.stroke(3, start, end)

    def finger(self, start: tuple[float, float], end: tuple[float, float], hold: float = 0) -> None:
        self.stroke(2, start, end, hold)


class Mac:
    def __init__(self) -> None:
        import Quartz

        self.q = Quartz

    def _post(self, kind: int, at: tuple[float, float]) -> None:
        event = self.q.CGEventCreateMouseEvent(None, kind, at, self.q.kCGMouseButtonLeft)
        self.q.CGEventPost(self.q.kCGHIDEventTap, event)

    def drag(self, start: tuple[float, float], end: tuple[float, float]) -> None:
        q = self.q
        self._post(q.kCGEventMouseMoved, start)
        time.sleep(0.2)
        self._post(q.kCGEventLeftMouseDown, start)
        for step in range(1, 13):
            self._post(q.kCGEventLeftMouseDragged, (start[0] + (end[0] - start[0]) * step / 12, start[1] + (end[1] - start[1]) * step / 12))
            time.sleep(0.03)
        self._post(q.kCGEventLeftMouseUp, end)
        time.sleep(0.4)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if sys.platform not in ("win32", "darwin"):
        print("this drive is for WebView2 and WKWebView; the Linux engines are driven by test/e2e/pages-words.py")
        return 0
    engine: Any = Windows() if sys.platform == "win32" else Mac()

    config = config_of(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-words-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    unverified: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        if not app.until("!!orden.workspace && !!orden.workspace.activeSpace", 90):
            raise SystemExit("the app never had a space")
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(2)
        root = app.eval("orden.workspace.activeSpace.root.replace(/[\\\\/]+$/, '')")
        if not isinstance(root, str):
            raise SystemExit(f"no space root: {root}")
        pdf = f"{root}/Words.pdf"
        put = app.eval(
            f"orden.invoke('write_bytes', {{ path: {json.dumps(pdf)}, base64: {json.dumps(base64.b64encode(paper()).decode())} }})"
            ".then(() => 'done', (error) => 'refused: ' + error)"
        )
        if put != "done":
            raise SystemExit(f"the app put no PDF in the space: {put}")
        app.eval("window.__errors = []; addEventListener('error', (e) => window.__errors.push(String(e.message))); addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && (e.reason.stack || e.reason)).slice(0, 400))); return true")
        app.eval("await orden.workspace.loadTree(); return true")
        app.eval(f"await orden.workspace.openPdf({json.dumps(pdf)}, 1); return true")
        if not app.until("document.querySelectorAll('.pages .sheet .words span').length >= 60", 60):
            raise SystemExit(f"the page note never showed the PDF's words: {app.eval(LOOKED)}")
        time.sleep(1)
        inner = app.eval(INNER)
        touchy = app.eval("'ontouchstart' in window")
        print(f"engine: {app.eval('navigator.userAgent')}; touch events: {touchy}; window: {inner}", flush=True)

        def screen(x: float, y: float) -> tuple[float, float]:
            if sys.platform == "darwin":
                return inner["x"] / inner["scale"] + x, inner["y"] / inner["scale"] + y
            return inner["x"] + x * inner["ratio"], inner["y"] + y * inner["ratio"]

        def line(number: int) -> dict[str, float]:
            box = app.eval(SPAN % json.dumps(f"Line {number}:"))
            if not isinstance(box, dict):
                raise SystemExit(f"no words for line {number}: {box}")
            return box

        def chosen() -> str:
            said = app.eval("String(getSelection())")
            return said if isinstance(said, str) else ""

        def menu() -> list[str]:
            rows = app.eval("[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((one) => one.innerText.trim())")
            return rows if isinstance(rows, list) else []

        def shut_menu() -> None:
            app.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); getSelection().removeAllRanges(); return true")
            time.sleep(0.3)

        app.eval(HEAR)
        box = line(3)
        middle = box["y"] + box["height"] / 2
        said = ""
        for attempt in range(3):
            engine.drag(screen(box["x"] + 1, middle), screen(box["x"] + box["width"] + 4, middle))
            said = chosen()
            print(f"the mouse dragged over line 3 ({attempt + 1}): {said!r}; heard {app.eval(HEARD)}; menu {menu()}", flush=True)
            if said:
                break
            shut_menu()
        if "Line 3: the kestrel hangs above the field." not in said:
            wrong.append(f"a mouse drag over a line of the PDF chose {said!r}")
        shut_menu()

        if isinstance(engine, Windows):
            try:
                box = line(8)
                middle = box["y"] + box["height"] / 2
                engine.pen(screen(box["x"] + 1, middle), screen(box["x"] + box["width"] - 1, middle))
                said, rows = chosen(), menu()
                print(f"a pen over line 8: {said!r}; menu {rows}; heard {app.eval(HEARD)}", flush=True)
                if "Line 8: the kestrel hangs above the field." not in said:
                    wrong.append(f"a pen in Select over a line of the PDF chose {said!r}")
                if not any(one.startswith("Copy") for one in rows):
                    wrong.append(f"after a pen chose words its menu has no Copy: {rows}")
                shut_menu()

                box = line(10)
                middle = box["y"] + box["height"] / 2
                start = box["x"] + box["width"] * 0.38
                engine.finger(screen(start, middle), screen(box["x"] + box["width"] - 1, middle), hold=0.9)
                said, rows = chosen(), menu()
                print(f"a finger held on 'kestrel' and dragged: {said!r}; menu {rows}; heard {app.eval(HEARD)}", flush=True)
                if "kestrel" not in said or "Line 10" in said:
                    wrong.append(f"a finger held on a word chose {said!r}")
                elif "hangs above" not in said:
                    unverified.append(f"a finger held on a word chose {said!r}; dragging on did not reach further, as this engine hands the touch to its own selection")
                if not any(one.startswith("Copy") for one in rows):
                    wrong.append(f"after a finger chose words its menu has no Copy: {rows}")
                shut_menu()
            except OSError as error:
                unverified.append(f"pen and touch could not be made on this machine: {error}")
        else:
            unverified.append("a Mac has no pen or touch to make from outside the app; only the mouse was driven")

        if isinstance(engine, Windows):
            sheet = "(() => { const b = document.querySelector('.pages .sheet').getBoundingClientRect(); return { top: b.top, width: b.width } })()"
            host = app.eval("(() => { const b = document.querySelector('.pages').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()")
            before = app.eval(sheet)
            engine.wheel(screen(host["x"], host["y"]), -120)
            after = app.eval(sheet)
            print(f"a mouse wheel over the page note, with two-finger pans heard: {before} -> {after}", flush=True)
            if after["top"] >= before["top"]:
                wrong.append(f"a mouse wheel no longer scrolls a page note: {before} -> {after}")
            before = after
            engine.wheel(screen(host["x"], host["y"]), 120, ctrl=True)
            after = app.eval(sheet)
            print(f"Ctrl and the wheel, as a touchpad's pinch comes: {before} -> {after}", flush=True)
            if after["width"] <= before["width"]:
                wrong.append(f"Ctrl and the wheel no longer zoom a page note: {before} -> {after}")

        for wanted in (8, 16, 32):
            first = app.eval(CLOSE)
            for _ in range(40):
                now = app.eval(CLOSE)
                if now["wide"] >= first["wide"] * wanted / 2:
                    break
                app.eval(ZOOM_IN % 3)
                time.sleep(0.05)
            time.sleep(1.2)
            seen = app.eval(CLOSE)
            stretch = seen["shown"] / seen["pixels"] if seen["pixels"] else 99
            print(f"zoomed in about {wanted}x: the close-up is {seen['pixels']} pixels for {seen['shown']:.0f} on screen ({stretch:.2f}x)", flush=True)
            if stretch > 1.15:
                wrong.append(f"zoomed in about {wanted}x the words are stretched {stretch:.2f}x")

        under = app.eval(UNDER)
        if isinstance(under, dict):
            middle = under["y"]
            engine.drag(screen(under["left"], middle), screen(under["right"], middle))
            said = chosen()
            print(f"zoomed in, the mouse dragged over {under['text'][:30]!r}: {said[:40]!r}", flush=True)
            if not said.strip() or said not in under["text"]:
                wrong.append(f"zoomed in, a drag over words chose {said!r}")
        else:
            unverified.append(f"no words under the middle of the page zoomed in: {under}")

        long = f"{root}/Long.pdf"
        put = app.eval(
            f"orden.invoke('write_bytes', {{ path: {json.dumps(long)}, base64: {json.dumps(base64.b64encode(long_paper()).decode())} }})"
            ".then(() => 'done', (error) => 'refused: ' + error)"
        )
        app.eval("await orden.workspace.loadTree(); return true")
        app.eval(f"await orden.workspace.openPdf({json.dumps(long)}, 1); return true")
        if put != "done" or not app.until("[...document.querySelectorAll('.pages .sheet .words span')].some((one) => one.textContent.startsWith('P1 L1:'))", 60):
            unverified.append(f"the long PDF was not shown ({put}): {app.eval(LOOKED)}")
        else:
            time.sleep(1.5)
            for step, hide in ((40, False), (40, True), (-40, False), (-40, True)):
                got = app.eval(SCROLL % json.dumps([300, step, hide]))
                print(f"a 120-page PDF scrolled {step:+d}px a frame {'without' if hide else 'with'} its words: mean {got['mean']:.1f} ms, p95 {got['p95']:.1f} ms, {got['long']} frames over 50 ms, moved {got['moved']:.0f}, {got['built']} word nodes laid out", flush=True)
                if got["built"]:
                    wrong.append(f"words were laid out for {got['built']} nodes while a long PDF scrolled")
    finally:
        process.kill()
        process.wait(20)
        shutil.rmtree(spaces, ignore_errors=True)

    for one in unverified:
        print(f"::warning::{one}", flush=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
