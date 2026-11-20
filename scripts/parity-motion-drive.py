from __future__ import annotations
import argparse
import http.server
import importlib
import json
import math
import os
import pathlib
import queue
import secrets
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable
import mss
import numpy
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint, forward

grabber = getattr(mss, "MSS", None) or mss.mss
PLATFORM = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
TOL = 2.0
KINDS = ("off", "blank", "stale", "jump")
EDGE = 4.0
SETTLE = 20.0
ROUNDS = 3
PAGE_LATE = 1.0
BARE = 0.5
HOVER_FRAMES = 8.0
HOVER_SLACK = 1.0
IDLE_CPU = 8.0
IDLE = 15.0
WIDTH, HEIGHT = 960, 680
SHRINK = (240, 160)
DRAG = 200
COLS, ROWS = 6, 4
BITS = 10
Box = tuple[float, float, float, float]
MOTION = b"""<!doctype html><title>motion</title><style>html,body{margin:0;height:100%;background:#ff00ff}
body{box-sizing:border-box;border:2px solid #00ff00}</style><body></body>"""
GRID = "#mo-grid{position:fixed;display:grid;grid-template-columns:repeat(%d,1fr);grid-template-rows:repeat(%d,1fr);background:#fff;z-index:2147483646}#mo-grid>div{border:1px solid #ccc}#mo-grid>div:hover{background:#000}" % (COLS, ROWS)
HOVER = (
    "<!doctype html><title>hover</title><style>html,body{margin:0;height:100%%}%s</style><body><div id=\"mo-grid\" style=\"inset:0\">%s</div></body>"
    % (GRID, "<div></div>" * (COLS * ROWS))
).encode()
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body = HOVER if self.path.startswith("/hover") else MOTION
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
class Site(http.server.ThreadingHTTPServer):
    def handle_error(self, *_: Any) -> None:
        pass
if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes
    from probe_app import main_window
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    try:
        import mss.windows
        mss.windows.CAPTUREBLT = 0
    except (ImportError, AttributeError):
        pass
    def pointed(x: float, y: float) -> None:
        user32.SetCursorPos(round(x), round(y))
    def pressed(down: bool) -> None:
        user32.mouse_event(0x2 if down else 0x4, 0, 0, 0, 0)
    class Window:
        def __init__(self, pid: int, app: App) -> None:
            self.pid, self.app, self.hwnd = pid, app, 0
        def found(self) -> bool:
            self.hwnd = main_window(self.pid)
            return bool(self.hwnd)
        def placed(self, width: int, height: int) -> None:
            user32.SystemParametersInfoW(0x1043, 0, ctypes.c_void_p(1), 0x3)
            user32.ShowWindow(self.hwnd, 9)
            user32.SetWindowPos(self.hwnd, None, 0, 0, width, height, 0x0004)
        def sized(self, width: int, height: int) -> None:
            user32.SetWindowPos(self.hwnd, None, 0, 0, width, height, 0x0002 | 0x0004 | 0x0010)
        def front(self) -> None:
            forward(self.app, self.pid)
    def cpu(root: int, seconds: float) -> float:
        return float(importlib.import_module("hover-drive").cpu_over(root, seconds))
elif sys.platform == "darwin":
    import Quartz
    import ApplicationServices as AS
    held = {"down": False, "at": (0.0, 0.0)}
    def post(kind: int, at: tuple[float, float]) -> None:
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, kind, at, Quartz.kCGMouseButtonLeft))
    def pointed(x: float, y: float) -> None:
        held["at"] = (float(x), float(y))
        post(Quartz.kCGEventLeftMouseDragged if held["down"] else Quartz.kCGEventMouseMoved, held["at"])
    def pressed(down: bool) -> None:
        held["down"] = down
        post(Quartz.kCGEventLeftMouseDown if down else Quartz.kCGEventLeftMouseUp, held["at"])
    class Window:  # type: ignore[no-redef]
        def __init__(self, pid: int, app: App) -> None:
            self.pid, self.app, self.window = pid, app, None
        def found(self) -> bool:
            error, windows = AS.AXUIElementCopyAttributeValue(AS.AXUIElementCreateApplication(self.pid), "AXWindows", None)
            self.window = windows[0] if error == 0 and windows else None
            listed = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) or []
            return self.window is not None or any(int(one.get("kCGWindowOwnerPID", 0)) == self.pid and int(one.get("kCGWindowLayer", 0)) == 0 for one in listed)
        def set(self, name: str, kind: str, value: Any) -> bool:
            typed = getattr(AS, f"kAXValue{kind}Type", None) or getattr(AS, f"kAXValueType{kind}")
            try:
                return self.window is not None and AS.AXUIElementSetAttributeValue(self.window, name, AS.AXValueCreate(typed, value)) == 0
            except Exception:  # noqa: BLE001 - any failure falls back to the app's own call
                return False
        def placed(self, width: int, height: int) -> None:
            if not self.set("AXPosition", "CGPoint", Quartz.CGPoint(0, 40)):
                self.app.eval("await orden.invoke('plugin:window|set_position', { label: 'main', value: { Logical: { x: 0, y: 40 } } }); return true")
            self.sized(width, height)
        def sized(self, width: int, height: int) -> None:
            if not self.set("AXSize", "CGSize", Quartz.CGSize(width, height)):
                self.app.eval(f"await orden.invoke('plugin:window|set_size', {{ label: 'main', value: {{ Logical: {{ width: {width}, height: {height} }} }} }}); return true")
        def front(self) -> None:
            forward(self.app, self.pid)
    def cpu(root: int, seconds: float) -> float:
        def tree() -> dict[int, float]:
            listed = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,time="], capture_output=True, text=True, check=False).stdout
            rows = [line.split() for line in listed.splitlines() if len(line.split()) == 3]
            kids: dict[int, list[int]] = {}
            used: dict[int, float] = {}
            for pid, parent, spent in rows:
                kids.setdefault(int(parent), []).append(int(pid))
                days, _, clock = spent.rpartition("-")
                parts = [float(one) for one in clock.split(":")]
                used[int(pid)] = (float(days or 0) * 86400) + sum(one * 60 ** (len(parts) - 1 - at) for at, one in enumerate(parts))
            found, todo = {}, [root]
            while todo:
                pid = todo.pop()
                found[pid] = used.get(pid, 0.0)
                todo += kids.get(pid, [])
            return found
        before = tree()
        start = time.perf_counter()
        time.sleep(seconds)
        took = time.perf_counter() - start
        after = tree()
        return sum(after[pid] - before.get(pid, 0.0) for pid in after) / took * 100
else:
    from Xlib import X, display as xdisplay
    from Xlib.ext import xtest
    screen_x = xdisplay.Display()
    def xdo(*words: str) -> str:
        return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout
    def pointed(x: float, y: float) -> None:
        xtest.fake_input(screen_x, X.MotionNotify, x=round(x), y=round(y))
        screen_x.sync()
    def pressed(down: bool) -> None:
        xtest.fake_input(screen_x, X.ButtonPress if down else X.ButtonRelease, 1)
        screen_x.sync()
    class Window:  # type: ignore[no-redef]
        def __init__(self, pid: int, app: App) -> None:
            self.pid, self.app, self.window = pid, app, None
        def found(self) -> bool:
            root = screen_x.screen().root
            listed = root.get_full_property(screen_x.intern_atom("_NET_CLIENT_LIST"), X.AnyPropertyType)
            owner = screen_x.intern_atom("_NET_WM_PID")
            best, area = None, 0
            for one in listed.value if listed else []:
                window = screen_x.create_resource_object("window", one)
                try:
                    pid = window.get_full_property(owner, X.AnyPropertyType)
                    shape = window.get_geometry()
                except Exception:  # noqa: BLE001 - a window that went away is skipped
                    continue
                if pid is not None and int(pid.value[0]) != self.pid:
                    continue
                if shape.width * shape.height > area:
                    best, area = window, shape.width * shape.height
            self.window = best
            return best is not None
        def placed(self, width: int, height: int) -> None:
            self.window.configure(x=0, y=0, width=width, height=height)
            screen_x.sync()
        def sized(self, width: int, height: int) -> None:
            self.window.configure(width=width, height=height)
            screen_x.sync()
        def front(self) -> None:
            xdo("windowactivate", str(self.window.id))
            forward(self.app, self.pid)
    def cpu(root: int, seconds: float) -> float:
        hz = os.sysconf("SC_CLK_TCK")
        def tree() -> dict[int, float]:
            kids: dict[int, list[int]] = {}
            used: dict[int, float] = {}
            for name in os.listdir("/proc"):
                if not name.isdigit():
                    continue
                try:
                    text = open(f"/proc/{name}/stat").read()
                except OSError:
                    continue
                rest = text.rsplit(")", 1)[1].split()
                kids.setdefault(int(rest[1]), []).append(int(name))
                used[int(name)] = (int(rest[11]) + int(rest[12])) / hz
            found, todo = {}, [root]
            while todo:
                pid = todo.pop()
                found[pid] = used.get(pid, 0.0)
                todo += kids.get(pid, [])
            return found
        before = tree()
        start = time.perf_counter()
        time.sleep(seconds)
        took = time.perf_counter() - start
        after = tree()
        return sum(after[pid] - before.get(pid, 0.0) for pid in after) / took * 100
LOG = """
const m = (window.__mo ??= {})
m.orden = orden
m.target = %s
if (!m.bar) {
  const style = document.createElement('style')
  style.textContent = '.mo-target{background:#ff00ff!important;box-shadow:inset 0 0 0 2px #00ff00!important}.mo-target>*{visibility:hidden!important}'
  document.head.appendChild(style)
  const bar = document.createElement('div')
  Object.assign(bar.style, { position: 'fixed', left: '112px', top: '0px', width: '96px', height: '6px', zIndex: '2147483647', display: 'none', pointerEvents: 'none' })
  for (let i = 0; i < %d; i++) { const one = document.createElement('div'); Object.assign(one.style, { width: '8px', height: '6px' }); bar.appendChild(one) }
  bar.firstChild.style.background = '#ff0000'
  bar.lastChild.style.background = '#0000ff'
  const probe = document.createElement('div')
  Object.assign(probe.style, { position: 'fixed', left: '0px', top: '0px', width: '1px', height: '1px', visibility: 'hidden', pointerEvents: 'none' })
  document.documentElement.append(bar, probe)
  m.bar = bar
  m.bits = [...bar.children].slice(1, -1)
  m.probe = probe
  new ResizeObserver(() => { if (m.on) m.saw() }).observe(probe)
  const pages = orden.pages
  if (pages && !pages.__mo) {
    const send = pages.send
    pages.send = function (...said) {
      const one = said[2] || {}
      const row = [performance.timeOrigin + performance.now(), one.pane ? [one.pane.x, one.pane.y, one.pane.width, one.pane.height] : null, null, !!one.visible && !one.away]
      if (m.on) m.sends.push(row)
      const done = send.apply(this, said)
      Promise.resolve(done).finally(() => { row[2] = performance.timeOrigin + performance.now() })
      return done
    }
    pages.__mo = true
  }
}
const box = (one) => { if (!one) return null; const r = one.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? [r.x, r.y, r.width, r.height] : null }
m.saw = () => {
  const t = m.target
  const pane = document.querySelector(`[data-pane="${t.pane}"]`)
  const showing = m.orden.workspace.panes.at(t.pane)?.activeTabId === t.tab
  const want = showing && pane ? pane.querySelector(t.kind === 'note' ? '.card .editor' : '.card .hole') : null
  for (const one of document.querySelectorAll('.mo-target')) if (one !== want) one.classList.remove('mo-target')
  if (want && t.kind === 'note') want.classList.add('mo-target')
  m.bits.forEach((one, i) => { one.style.background = (m.n >> i) & 1 ? '#ffffff' : '#000000' })
  m.log.push([m.n, performance.timeOrigin + performance.now(), box(want), box(pane?.querySelector('.card')), innerWidth, innerHeight])
}
m.start = () => {
  m.n = 0; m.log = []; m.sends = []; m.on = true; m.bar.style.display = 'flex'
  const tick = () => { if (!m.on) return; m.n++; m.probe.style.width = (m.n %% 2 ? 2 : 1) + 'px'; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
}
m.stop = () => {
  m.on = false
  m.bar.style.display = 'none'
  for (const one of document.querySelectorAll('.mo-target')) one.classList.remove('mo-target')
  return { log: m.log, sends: m.sends }
}
return true
"""
SETUP = """
for (const one of document.querySelectorAll('button')) if (one.textContent.trim() === 'Keep running') one.click()
const w = orden.workspace
w.panes.fills = null
for (const tab of [...w.tabs]) w.close(tab.id, false)
while (w.panes.all.length > 1) w.panes.close(w.panes.all.at(-1).id)
if (!w.panel) w.toggleSidebar('left')
w.openBlank('Other', '# Other\\n\\n' + 'Words of another note. '.repeat(80))
const other = w.active.id
let target
if (%s) target = w.openPage(%s)
else { w.openBlank('Target', '# Target\\n\\n' + 'Words of the target note. '.repeat(80)); target = w.active.id }
const pane = w.tabs.find((one) => one.id === target).paneId
w.panes.activate(pane, target)
return { pane, other, target }
"""
SEEN = """
const pane = document.querySelector('[data-pane="%s"]')
const one = pane && pane.querySelector(%s)
const r = one && one.getBoundingClientRect()
const live = %s ? orden.pages.each().some(([id, page]) => id === %s && page.live && page.sent && page.sent.visible) : true
return r && r.width > 0 && live ? [r.x, r.y, r.width, r.height] : null
"""
FRAME = "return await new Promise((done) => { const all = []; const f = (t) => { all.push(t); if (all.length > 60) done(all); else requestAnimationFrame(f) }; requestAnimationFrame(f) })"
def ltrb(rect: Any) -> Box | None:
    return None if not rect else (rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3])
def apart(one: Box, other: Box, edges: tuple[int, ...] = (0, 1, 2, 3)) -> float:
    return max((abs(one[i] - other[i]) for i in edges), default=0.0)
def inside(want: Box, row: list[Any]) -> tuple[int, ...]:
    wide, tall = (row[4], row[5]) if len(row) > 5 else (math.inf, math.inf)
    return tuple(i for i, free in enumerate((want[0] > EDGE, want[1] > EDGE, want[2] < wide - EDGE, want[3] < tall - EDGE)) if free)
def runs(counts: numpy.ndarray) -> tuple[int, int] | None:
    held = numpy.flatnonzero(counts >= max(3, 0.25 * int(counts.max(initial=0))))
    if not len(held):
        return None
    parts = numpy.split(held, numpy.flatnonzero(numpy.diff(held) > 1) + 1)
    best = max(parts, key=len)
    return int(best[0]), int(best[-1]) + 1
class Place:
    def __init__(self, origin: tuple[float, float], unit: float) -> None:
        self.origin, self.unit = origin, unit
    def screen(self, x: float, y: float) -> tuple[float, float]:
        return self.origin[0] + x * self.unit, self.origin[1] + y * self.unit
    def region(self, width: float, height: float) -> dict[str, int]:
        return {"left": round(self.origin[0]), "top": round(self.origin[1]), "width": round(width * self.unit), "height": round(height * self.unit)}
def calibrated(app: App) -> Place:
    app.eval(
        "const one = document.createElement('div'); one.id = 'mo-find';"
        " Object.assign(one.style, { position: 'fixed', left: '300px', top: '200px', width: '40px', height: '40px', background: '#00ffff', zIndex: '2147483647' });"
        " document.documentElement.append(one); return true"
    )
    time.sleep(0.8)
    with grabber() as screen:
        whole = screen.monitors[0]
        shot = screen.grab(whole)
        app.eval("document.getElementById('mo-find')?.remove(); return true")
        time.sleep(0.8)
        bare = screen.grab(whole)
    a = numpy.frombuffer(shot.bgra, numpy.uint8).reshape(shot.height, shot.width, 4)
    before = numpy.frombuffer(bare.bgra, numpy.uint8).reshape(bare.height, bare.width, 4)
    changed = numpy.abs(a[..., :3].astype(numpy.int16) - before[..., :3]).sum(axis=2) > 90
    mask = changed & (a[..., 2] < 100) & (a[..., 1] > 180) & (a[..., 0] > 180)
    xs = numpy.flatnonzero(mask.sum(0) >= 10)
    ys = numpy.flatnonzero(mask.sum(1) >= 10)
    if not len(xs) or not len(ys):
        raise SystemExit("the drive found no mark of the app's on the screen")
    ratio = shot.width / whole["width"]
    unit = (xs[-1] + 1 - xs[0]) / ratio / 40
    origin = (whole["left"] + xs[0] / ratio - 300 * unit, whole["top"] + ys[0] / ratio - 200 * unit)
    print(f"the window's page begins at {origin} on the screen, {unit:.2f} screen units a CSS pixel, {ratio:.2f} pixels a unit", flush=True)
    return Place(origin, unit)
def marker(a: numpy.ndarray, k: float) -> int | None:
    y = int(3 * k)
    def at(x: float) -> tuple[int, int, int]:
        one = a[y, int(x * k)]
        return int(one[2]), int(one[1]), int(one[0])
    red, blue = at(116), at(204)
    if not (red[0] > 160 and red[1] < 100 and red[2] < 100 and blue[2] > 160 and blue[0] < 100 and blue[1] < 100):
        return None
    n = 0
    for i in range(BITS):
        light = sum(at(124 + 8 * i)) / 3
        if 70 < light < 180:
            return None
        if light >= 180:
            n |= 1 << i
    return n
class Film:
    def __init__(self, region: dict[str, int], inner: float) -> None:
        self.region, self.inner = region, inner
        self.raw: queue.Queue[Any] = queue.Queue()
        self.frames: list[dict[str, Any]] = []
        self.going = True
        self.taking = threading.Thread(target=self.grab, daemon=True)
        self.reducer = threading.Thread(target=self.reduce, daemon=True)
        self.taking.start()
        self.reducer.start()
    def grab(self) -> None:
        with grabber() as screen:
            while self.going:
                at = time.time() * 1000
                shot = screen.grab(self.region)
                self.raw.put((at, shot.width, shot.height, shot.bgra))
        self.raw.put(None)
    def reduce(self) -> None:
        while (one := self.raw.get()) is not None:
            at, width, height, data = one
            k = width / self.inner
            a = numpy.frombuffer(data, numpy.uint8).reshape(height, width, 4)
            b, g, r = a[..., 0], a[..., 1], a[..., 2]
            mask = ((r > 190) & (g < 90) & (b > 190)) | ((r < 90) & (g > 170) & (b < 90))
            across = runs(mask.sum(0))
            down = runs(mask[:, across[0]:across[1]].sum(1)) if across else None
            box = (across[0] / k, down[0] / k, across[1] / k, down[1] / k) if across and down else None
            step = max(1, round(4 * k))
            self.frames.append({
                "at": at, "k": k, "step": step, "n": marker(a, k), "box": box,
                "small": mask[::step, ::step].copy(), "thumb": a[::step, ::step, 2::-1].copy(),
            })
    def stop(self) -> list[dict[str, Any]]:
        self.going = False
        self.taking.join()
        self.reducer.join()
        return self.frames
def uncovered(frame: dict[str, Any], want: Box, room: tuple[float, float]) -> float:
    k, step, small = frame["k"], frame["step"], frame["small"]
    want = (want[0], want[1], min(want[2], room[0]), min(want[3], room[1]))
    x0, y0 = math.ceil((want[0] + 3) * k / step), math.ceil((want[1] + 3) * k / step)
    x1, y1 = math.floor((want[2] - 3) * k / step), math.floor((want[3] - 3) * k / step)
    part = small[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
    return float((~part).sum()) * (step / k) ** 2
def judged(frames: list[dict[str, Any]], log: list[list[Any]], sends: list[list[Any]]) -> dict[str, Any]:
    by_n = {row[0]: row for row in log}
    rects = [ltrb(row[2]) for row in log if row[2]]
    times = [row[1] for row in log]
    frame_ms = statistics.median([b - a for a, b in zip(times, times[1:])]) if len(times) > 2 else 16.7
    net = [rects[-1][i] - rects[0][i] for i in range(4)] if rects else [0.0] * 4
    rooms = [(row[4], row[5]) for row in log if len(row) > 5]
    room = (min(one[0] for one in rooms), min(one[1] for one in rooms)) if rooms else (math.inf, math.inf)
    said: dict[str, Any] = {"frames": len(frames), "off_px": 0.0, "bad": []}
    flagged: dict[int, list[set[str]]] = {}
    last: tuple[Box, Box] | None = None
    for index, frame in enumerate(frames):
        row = by_n.get(frame["n"]) if frame["n"] is not None else None
        if row is None:
            continue
        want = ltrb(row[2])
        seen = frame["box"]
        if seen and (seen[2] - seen[0]) * (seen[3] - seen[1]) < 400:
            seen = None
        flags: set[str] = set()
        if want is None:
            if seen:
                flags.add("stale")
            last = None
        elif seen is None:
            flags.add("blank")
            last = None
        else:
            edges = inside(want, row)
            gap = apart(seen, want, edges)
            if gap > TOL:
                flags.add("off")
                said["off_px"] = max(said["off_px"], round(gap, 1))
                near = [(apart(seen, ltrb(by_n[frame["n"] + j][2]), edges), j) for j in range(-10, 11) if j and by_n.get(frame["n"] + j, [None] * 3)[2]]
                best = min(near, default=(math.inf, 0))
                if best[0] <= TOL:
                    flags.add("behind" if best[1] < 0 else "ahead")
            bare = uncovered(frame, want, room)
            area = max(1.0, (min(want[2], room[0]) - want[0]) * (min(want[3], room[1]) - want[1]))
            if bare > BARE * area:
                flags.add("blank")
            elif bare > TOL * max(want[2] - want[0], want[3] - want[1]):
                flags.add("behind")
            if last is not None:
                for i in edges:
                    moved, meant = seen[i] - last[0][i], want[i] - last[1][i]
                    if abs(net[i]) > TOL and abs(moved) > TOL and moved * net[i] < 0 and meant * net[i] >= -TOL:
                        flags.add("jump")
                        break
            last = (seen, want)
        flagged.setdefault(frame["n"], []).append(flags)
        if flags:
            said["bad"].append(index)
    said["read"] = len(flagged)
    for key in KINDS + ("behind", "ahead"):
        said[key] = sum(1 for seen in flagged.values() if 2 * sum(key in one for one in seen) > len(seen))
    ends = [ltrb(log[0][2]), ltrb(log[-1][2])] if log else [None, None]
    said["moved"] = round(apart(ends[0], ends[1]), 1) if ends[0] and ends[1] else (0.0 if ends[0] is ends[1] else 999.0)
    span = (frames[-1]["at"] - frames[0]["at"]) / 1000 if len(frames) > 1 else 0
    said["fps"] = round(len(frames) / span, 1) if span else 0
    said["app_fps"] = round(1000 / frame_ms, 1) if frame_ms else 0
    lags: list[float] = []
    answers: list[float] = []
    for at, rect, done, visible in sends:
        if not visible or not rect:
            continue
        first = next((row for row in log if row[2] and apart(ltrb(row[2]), ltrb(rect)) <= 0.5), None)
        if first is None or (rects and apart(ltrb(rect), rects[0]) <= 0.5):
            continue
        lags.append((at - first[1]) / frame_ms)
        if done:
            answers.append((done - first[1]) / frame_ms)
    if lags:
        said["sent_frames"] = round(statistics.median(lags), 2)
    if answers:
        said["placed_frames"] = round(statistics.median(answers), 2)
    return said
def sheet(frames: list[dict[str, Any]], bad: list[int], path: pathlib.Path) -> None:
    seen: set[Any] = set()
    picked = []
    for index, one in enumerate(frames):
        if one["n"] not in seen or index in bad:
            seen.add(one["n"])
            picked.append(index)
    picked = picked[:240]
    bad = [at for at, index in enumerate(picked) if index in set(bad)]
    frames = [frames[index] for index in picked]
    if not frames:
        return
    shown = [Image.fromarray(one["thumb"]) for one in frames]
    w, h = shown[0].width, shown[0].height
    across = 8
    out = Image.new("RGB", (across * w, ((len(shown) + across - 1) // across) * h))
    draw = ImageDraw.Draw(out)
    for index, one in enumerate(shown):
        x, y = (index % across) * w, (index // across) * h
        out.paste(one, (x, y))
        draw.text((x + 4, y + 8), str(frames[index]["n"]), fill=(255, 0, 0))
        if index in bad:
            draw.rectangle((x, y, x + w - 1, y + h - 1), outline=(255, 0, 0), width=3)
    out.save(path, quality=80)
def merged(parts: list[dict[str, Any]]) -> dict[str, Any]:
    still = [one for one in parts if one["moved"] <= TOL]
    if still:
        return {"error": f"the app's layout did not move in {len(still)} of {len(parts)} steps"}
    said: dict[str, Any] = {}
    for key in ("frames", "read", "off", "blank", "stale", "jump", "behind", "ahead"):
        said[key] = sum(one[key] for one in parts)
    said["off_px"] = max((one["off_px"] for one in parts), default=0.0)
    said["fps"] = round(statistics.mean(one["fps"] for one in parts), 1) if parts else 0
    said["app_fps"] = round(statistics.mean(one["app_fps"] for one in parts), 1) if parts else 0
    for key in ("sent_frames", "placed_frames"):
        found = [one[key] for one in parts if key in one]
        if found:
            said[key] = round(max(found), 2)
    return said
def steady(rounds: list[dict[str, Any]]) -> dict[str, Any]:
    wrong = [one for one in rounds if "error" in one]
    if wrong:
        return wrong[0]
    said: dict[str, Any] = {key: int(statistics.median(one[key] for one in rounds)) for key in KINDS + ("behind", "ahead")}
    said["off_px"] = max(one["off_px"] for one in rounds)
    said["read"] = sum(one["read"] for one in rounds)
    said["frames"] = sum(one["frames"] for one in rounds)
    said["fps"] = round(statistics.mean(one["fps"] for one in rounds), 1)
    said["app_fps"] = round(statistics.mean(one["app_fps"] for one in rounds), 1)
    said["rounds"] = [{key: one[key] for key in KINDS} for one in rounds]
    for key in ("sent_frames", "placed_frames"):
        found = [one[key] for one in rounds if key in one]
        if found:
            said[key] = round(statistics.median(found), 2)
    return said
class Run:
    def __init__(self, app: App, window: Window, place: Place, out: pathlib.Path, kind: str, target: dict[str, str]) -> None:
        self.app, self.window, self.place, self.out, self.kind, self.target = app, window, place, out, kind, target
        self.size = (WIDTH, HEIGHT)
        self.full = [float(WIDTH), float(HEIGHT)]
    def park(self) -> None:
        with grabber() as screen:
            whole = screen.monitors[1]
        pointed(whole["left"] + whole["width"] - 4, whole["top"] + whole["height"] // 2)
    def seen(self) -> Any:
        page = "true" if self.kind == "web" else "false"
        return self.app.eval(SEEN % (self.target["pane"], json.dumps(".card .hole" if self.kind == "web" else ".card .editor"), page, json.dumps(self.target["target"])))
    def segment(self, name: str, step: str, act: Callable[[], Any], settle: float = 1.2) -> dict[str, Any]:
        film = Film(self.place.region(*self.full), self.full[0])
        self.app.eval("window.__mo.target = " + json.dumps({"pane": self.target["pane"], "tab": self.target["target"], "kind": self.kind}) + "; window.__mo.start(); return true")
        time.sleep(0.35)
        act()
        time.sleep(settle)
        logged = self.app.eval("return window.__mo.stop()", 30)
        frames = film.stop()
        logged = logged if isinstance(logged, dict) else {"log": [], "sends": []}
        said = judged(frames, logged.get("log") or [], logged.get("sends") or [])
        folder = self.out / self.kind
        folder.mkdir(parents=True, exist_ok=True)
        sheet(frames, said["bad"], folder / f"{name}-{step}.jpg")
        (folder / f"{name}-{step}.json").write_text(json.dumps({
            "said": said, "log": logged.get("log"), "sends": logged.get("sends"),
            "frames": [{"at": one["at"], "n": one["n"], "box": one["box"]} for one in frames],
        }), encoding="utf-8")
        print(f"[{self.kind}] {name} {step}: {json.dumps({key: value for key, value in said.items() if key != 'bad'})}", flush=True)
        return said
    def eval_act(self, code: str) -> Callable[[], Any]:
        return lambda: self.app.eval(code)
    def dragged(self, by: float) -> Callable[[], Any]:
        def act() -> None:
            line = self.app.eval("const one = document.querySelector('[data-panes] .divider') || document.querySelector('.split > .divider'); const r = one && one.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + r.height / 2] : null")
            if not line:
                print("::warning::no splitter to drag", flush=True)
                return
            start = self.place.screen(*line)
            pointed(*start)
            time.sleep(0.15)
            pressed(True)
            for one in range(1, 26):
                pointed(start[0] + by * self.place.unit * one / 25, start[1])
                time.sleep(0.016)
            pressed(False)
            time.sleep(0.1)
            self.park()
        return act
    def resized(self, to: tuple[int, int]) -> Callable[[], Any]:
        def act() -> None:
            was = self.size
            for one in range(1, 21):
                self.window.sized(round(was[0] + (to[0] - was[0]) * one / 20), round(was[1] + (to[1] - was[1]) * one / 20))
                time.sleep(0.016)
            self.size = to
        return act
    def motions(self) -> dict[str, list[dict[str, Any]]]:
        if not self.seen():
            raise SystemExit(f"[{self.kind}] the target is not shown before the motions")
        self.full = self.app.eval("return [innerWidth, innerHeight]")
        done: dict[str, list[dict[str, Any]]] = {}
        for at in range(ROUNDS):
            for check, parts in self.round(at).items():
                done.setdefault(check, []).append(merged(parts))
        return done
    def round(self, at: int) -> dict[str, list[dict[str, Any]]]:
        pane, tab, other = json.dumps(self.target["pane"]), json.dumps(self.target["target"]), json.dumps(self.target["other"])
        shows = f"orden.workspace.focusPane({pane}); orden.workspace.panes.activate({pane}, {tab}); return true"
        step = lambda name, what, act, settle=1.2: self.segment(name, f"{what}-{at + 1}", act, settle)  # noqa: E731
        done: dict[str, list[dict[str, Any]]] = {}
        done["split"] = [step("split", "split", self.eval_act(f"orden.workspace.split('row', {other}); {shows}"))]
        beside = self.app.eval(f"return orden.workspace.panes.all.map((one) => one.id).find((one) => one !== {pane}) ?? null")
        self.app.eval(shows)
        time.sleep(1)
        done["splitter"] = [step("splitter", "narrower", self.dragged(-DRAG)), step("splitter", "wider", self.dragged(DRAG))]
        done["tabs"] = [
            step("tabs", "away", self.eval_act(f"orden.workspace.panes.activate({pane}, {other}); return true")),
            step("tabs", "back", self.eval_act(shows), 1.6),
        ]
        toggle = self.eval_act("orden.workspace.toggleSidebar('left'); return true")
        done["sidebar"] = [step("sidebar", "close", toggle), step("sidebar", "open", toggle)]
        done["fill"] = [
            step("fill", "in", self.eval_act(f"orden.workspace.panes.fills = {pane}; return true")),
            step("fill", "out", self.eval_act("orden.workspace.panes.fills = null; return true")),
        ]
        done["window"] = [
            step("window", "smaller", self.resized((WIDTH - SHRINK[0], HEIGHT - SHRINK[1]))),
            step("window", "larger", self.resized((WIDTH, HEIGHT))),
        ]
        copy = json.dumps(self.app.eval(f"return orden.workspace.panes.at({json.dumps(beside)})?.activeTabId ?? null")) if isinstance(beside, str) else "null"
        done["split"].append(step("split", "join", self.eval_act(
            f"orden.workspace.close({copy}, false); if (orden.workspace.panes.all.length > 1) orden.workspace.panes.close({json.dumps(beside)}); {shows}"
        )))
        self.app.eval(shows)
        time.sleep(1)
        return done
def hover_cells(rect: list[float]) -> list[tuple[float, float]]:
    x, y, w, h = rect
    cells = []
    for row in range(ROWS):
        for column in range(COLS) if row % 2 == 0 else reversed(range(COLS)):
            cells.append((x + (column + 0.5) * w / COLS, y + (row + 0.5) * h / ROWS))
    return cells
def hovered(place: Place, rect: list[float]) -> list[float]:
    took: list[float] = []
    half = 12 * place.unit
    with grabber() as screen:
        for x, y in hover_cells(rect):
            at = place.screen(x, y)
            box = {"left": round(at[0] - half), "top": round(at[1] - half / 2), "width": round(half * 2), "height": round(half)}
            before = numpy.frombuffer(screen.grab(box).bgra, numpy.uint8).astype(numpy.int16)
            start = time.perf_counter()
            pointed(*at)
            while time.perf_counter() - start < 1.0:
                now = numpy.frombuffer(screen.grab(box).bgra, numpy.uint8).astype(numpy.int16)
                if numpy.abs(now - before).mean() > 40:
                    took.append((time.perf_counter() - start) * 1000)
                    break
            time.sleep(0.15)
    return took
def frame_ms(app: App) -> float:
    times = app.eval(FRAME, 10)
    if not isinstance(times, list) or len(times) < 3:
        return 16.7
    return float(statistics.median([b - a for a, b in zip(times, times[1:])]))
def hover_said(took: list[float], frame: float) -> dict[str, Any]:
    ms = statistics.median(took) if took else math.inf
    return {"ms": round(ms, 1), "frames": round(ms / frame, 2), "cells": len(took), "frame_ms": round(frame, 2)}
def pointer_reaches(app: App, place: Place, rect: list[float]) -> bool:
    app.eval("window.__moMoved = 0; if (!window.__moHeard) { addEventListener('pointermove', () => window.__moMoved++, true); window.__moHeard = true } return true")
    for one in range(8):
        pointed(*place.screen(rect[0] + rect[2] * (0.3 + one * 0.05), rect[1] - 12))
        time.sleep(0.05)
    time.sleep(0.3)
    heard = app.eval("return window.__moMoved")
    return isinstance(heard, int) and heard > 0
def staged(app: App, window: Window, place: Place, out: pathlib.Path, kind: str, base: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, list[dict[str, Any]]], bool]:
    web = kind == "web"
    target = app.eval(SETUP % ("true" if web else "false", json.dumps(base + "/hover" if web else "")))
    if not isinstance(target, dict):
        raise SystemExit(f"[{kind}] the layout was not built: {target}")
    run = Run(app, window, place, out, kind, target)
    rect = app.until(SEEN % (target["pane"], json.dumps(".card .hole" if web else ".card .editor"), "true" if web else "false", json.dumps(target["target"])), 40)
    if not isinstance(rect, list):
        raise SystemExit(f"[{kind}] the hover target was never shown: {rect}")
    window.front()
    time.sleep(2)
    reaches = pointer_reaches(app, place, rect)
    print(f"[{kind}] the OS pointer reaches the app: {reaches}", flush=True)
    if not web:
        app.eval(
            "const one = document.createElement('div'); one.id = 'mo-grid';"
            f" Object.assign(one.style, {{ left: '{rect[0]}px', top: '{rect[1]}px', width: '{rect[2]}px', height: '{rect[3]}px' }});"
            f" for (let i = 0; i < {COLS * ROWS}; i++) one.appendChild(document.createElement('div'));"
            f" const style = document.createElement('style'); style.id = 'mo-grid-style'; style.textContent = {json.dumps(GRID)};"
            " document.head.appendChild(style); document.documentElement.appendChild(one); return true"
        )
    time.sleep(1)
    frame = frame_ms(app)
    hover = hover_said(hovered(place, rect), frame)
    print(f"[{kind}] hover: {hover}", flush=True)
    app.eval("document.getElementById('mo-grid')?.remove(); document.getElementById('mo-grid-style')?.remove(); return true")
    if web:
        hover_tab = target["target"]
        target["target"] = app.eval(f"return orden.workspace.openPage({json.dumps(base + '/motion')})")
        app.eval(f"orden.workspace.close({json.dumps(hover_tab)}, false); orden.workspace.panes.activate({json.dumps(target['pane'])}, {json.dumps(target['target'])}); return true")
        if not isinstance(app.until(SEEN % (target["pane"], json.dumps(".card .hole"), "true", json.dumps(target["target"])), 40), list):
            raise SystemExit("[web] the motion page was never shown")
    time.sleep(3)
    run.park()
    time.sleep(SETTLE)
    idle = {"cpu": round(cpu(window.pid, IDLE), 2)}
    print(f"[{kind}] idle: {idle}", flush=True)
    return hover, idle, run.motions(), reaches
def row(item: int, check: str, web: Any, note: Any, ok: bool) -> dict[str, Any]:
    return {"item": item, "check": check, "platform": PLATFORM, "web": web, "note": note, "ok": bool(ok)}
def motion_ok(web: dict[str, Any], note: dict[str, Any]) -> bool:
    if "error" in web or "error" in note or web["read"] < 5 * ROUNDS or note["read"] < 5 * ROUNDS:
        return False
    late = web.get("placed_frames", web.get("sent_frames"))
    return (late is None or late <= PAGE_LATE) and all(side[key] == 0 for side in (web, note) for key in ("blank", "jump"))
def shown(said: Any) -> str:
    if not isinstance(said, dict):
        return str(said)
    if "error" in said:
        return said["error"]
    if "off" in said:
        text = f"off {said['off']} (max {said['off_px']} px), blank {said['blank']}, stale {said['stale']}, jump {said['jump']}, behind {said['behind']}, ahead {said['ahead']}, {said['read']} app frames seen in {said['frames']} shots at {said['fps']} a second, app {said['app_fps']} fps"
        if "sent_frames" in said:
            text += f", sent {said['sent_frames']} and placed {said.get('placed_frames', '?')} frames after the app's layout"
        return text
    return ", ".join(f"{key} {value}" for key, value in said.items())
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    site = Site(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{site.server_address[1]}"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-motion-spaces-"))
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    refuser = importlib.import_module("web-under-mac-drive").Refuser() if sys.platform == "darwin" else None
    rows: list[dict[str, Any]] = []
    try:
        app = endpoint(config, process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        window = Window(process.pid, app)
        while time.monotonic() < until and not window.found():
            time.sleep(0.25)
        if not window.found():
            raise SystemExit("the app put up no window")
        window.placed(WIDTH, HEIGHT)
        window.front()
        time.sleep(3)
        print(f"the window is {app.eval('return [innerWidth, innerHeight]')} CSS pixels inside, asked for {WIDTH} by {HEIGHT}", flush=True)
        if app.eval(LOG % ("null", BITS + 2)) is not True:
            raise SystemExit("the frame log was not put in the app")
        engine = app.eval("navigator.userAgent")
        under = app.eval("orden.pages.under")
        still = app.eval("matchMedia('(prefers-reduced-motion: reduce)').matches")
        print(f"the engine: {engine}; pages under the app: {under}; reduced motion: {still}", flush=True)
        place = calibrated(app)
        note_hover, note_idle, note_motion, note_reaches = staged(app, window, place, args.out, "note", base)
        window.placed(WIDTH, HEIGHT)
        time.sleep(1)
        place = calibrated(app)
        web_hover, web_idle, web_motion, web_reaches = staged(app, window, place, args.out, "web", base)
        for check, name in (("split", "split and join"), ("splitter", "resize by the splitter"), ("tabs", "switch tabs"), ("sidebar", "open and close the sidebar"), ("fill", "full window in and out"), ("window", "resize the window")):
            web, note = steady(web_motion[check]), steady(note_motion[check])
            rows.append(row(5, name, web, note, motion_ok(web, note)))
        reaches = web_reaches and note_reaches
        hover_ok = reaches and web_hover["cells"] >= COLS * ROWS // 2 and note_hover["cells"] >= COLS * ROWS // 2 and web_hover["frames"] <= HOVER_FRAMES and web_hover["frames"] <= note_hover["frames"] + HOVER_SLACK
        rows.append(row(10, "hover latency", web_hover if reaches else {"error": "the OS pointer does not reach the app"}, note_hover, hover_ok))
        rows.append(row(10, "idle CPU", web_idle, note_idle, web_idle["cpu"] <= IDLE_CPU and note_idle["cpu"] <= IDLE_CPU))
    finally:
        ended(process, gentle=True)
        if refuser:
            refuser.stop()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print("\n| item | check | platform | ok | web | note |\n|---|---|---|---|---|---|", flush=True)
    for one in rows:
        print(f"| {one['item']} | {one['check']} | {one['platform']} | {'yes' if one['ok'] else 'no'} | {shown(one['web'])} | {shown(one['note'])} |", flush=True)
    wrong = [one for one in rows if not one["ok"]]
    for one in wrong:
        print(f"::error::item {one['item']}, {one['check']}: web {shown(one['web'])}; note {shown(one['note'])}", flush=True)
    return 1 if wrong or not rows else 0
if __name__ == "__main__":
    raise SystemExit(main())
