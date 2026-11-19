from __future__ import annotations
import argparse
import functools
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
from typing import Any, Callable
import mss
import numpy
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from drive_scheme import CLOSE, clicked  # noqa: E402
from fresh_app import ended, fresh  # noqa: E402
from native_app import App, config_of, endpoint  # noqa: E402

PLATFORM = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
WIDTH, HEIGHT = 1280, 800
CELL = 16
WIDE_CELL = 32
SLOW = 1.5
ROUNDS = 3
LOAD_ROUNDS = 2
PACE = 0.0
LIMITS = {
    "white cells": 0,
    "cut cells": 2,
    "stale ms": 350,
    "freeze over note ms": 100,
    "note freeze ms": 400,
    "corner share": 0.04,
    "shadow apart": 10,
    "edge apart": 16,
    "light cells": 0,
    "covered share": 0.05,
}
Box = tuple[float, float, float, float]
BEAT = "@keyframes parity-beat{0%{background:rgb(0,70,70)}50%{background:rgb(0,230,230)}100%{background:rgb(0,70,70)}}"
TEAL_PAGE = (
    "<!doctype html><title>{title}</title><style>html,body{{margin:0;height:100%;background:rgb(0,160,160);overflow:hidden}}"
    "#beat{{position:fixed;left:30px;bottom:30px;width:40px;height:40px;animation:parity-beat 600ms linear infinite}}"
    + BEAT.replace("{", "{{").replace("}", "}}")
    + "</style><div id=beat></div>{script}"
)
HEAR = "<script>addEventListener('pointerdown', () => fetch('/heard', { method: 'POST', body: 'down' }).catch(() => {}), true)</script>"
CRASH = "<script>setTimeout(() => { const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random())) }, 1200)</script>"
NOTE_STYLE = (
    '[data-pane] div.editor[data-region="editor"] { background: rgb(0,160,160) !important; position: relative !important }'
    ' [data-pane] div.editor[data-region="editor"] > * { visibility: hidden !important }'
    ' [data-pane] div.editor[data-region="editor"]::after { content: ""; position: absolute; left: 30px; bottom: 30px;'
    " width: 40px; height: 40px; visibility: visible; animation: parity-beat 600ms linear infinite }"
    f" {BEAT}"
)
CALM = (
    " footer[data-region='status'], .fab { visibility: hidden !important }"
    " *, *::before, *::after { caret-color: transparent !important }"
)
BACKDROP = "[data-panes] { background: #ff00ff !important }"
FLOATING = ".orden-layer, .orden-bubble, .orden-screen, .orden-swipe, .orden-flight, [data-covers]:not([data-covers='all']), [data-notices] > *"
SCRIMS = ".orden-scrim, .orden-swipe-room, [data-covers='all']"


class Site(http.server.BaseHTTPRequestHandler):
    downs = 0

    def log_message(self, *_: Any) -> None:
        pass

    def do_POST(self) -> None:  # noqa: N802 - the standard library's name
        self.rfile.read(int(self.headers.get("content-length") or 0))
        Site.downs += 1
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        path, _, query = self.path.partition("?")
        if path.startswith("/slow"):
            time.sleep(SLOW)
        if path.startswith("/plain"):
            ground = query.partition("bg=")[2][:6] or "202020"
            body = f"<!doctype html><title>plain</title><style>html,body{{margin:0;height:100%;background:#{ground}}}</style>"
        else:
            body = TEAL_PAGE.format(title=path.strip("/") or "teal", script=CRASH if path.startswith("/crash") else HEAR)
        data = body.encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes
    from probe_app import main_window

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

    class Desk:
        def __init__(self, app: App, pid: int) -> None:
            self.app, self.pid, self.hwnd = app, pid, 0

        def found(self) -> bool:
            self.hwnd = main_window(self.pid)
            return bool(self.hwnd)

        def placed(self) -> None:
            user32.SystemParametersInfoW(0x1043, 0, ctypes.c_void_p(1), 0x3)
            user32.ShowWindow(self.hwnd, 9)
            desk = wintypes.RECT()
            user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
            user32.SetWindowPos(self.hwnd, None, desk.left, desk.top, min(WIDTH, desk.right - desk.left), min(HEIGHT, desk.bottom - desk.top), 0x0004)

        def box(self) -> tuple[int, int, int, int]:
            rect = wintypes.RECT()
            user32.GetClientRect(self.hwnd, ctypes.byref(rect))
            origin = wintypes.POINT(0, 0)
            user32.ClientToScreen(self.hwnd, ctypes.byref(origin))
            return origin.x, origin.y, rect.right, rect.bottom

        def forward(self) -> None:
            front = user32.GetForegroundWindow()
            theirs = user32.GetWindowThreadProcessId(front, None)
            ours = ctypes.windll.kernel32.GetCurrentThreadId()
            user32.AttachThreadInput(ours, theirs, True)
            user32.SetForegroundWindow(self.hwnd)
            user32.BringWindowToTop(self.hwnd)
            user32.AttachThreadInput(ours, theirs, False)

        def move(self, x: float, y: float, ratio: float) -> None:
            left, top, _, _ = self.box()
            user32.SetCursorPos(left + round(x * ratio), top + round(y * ratio))

        def click(self, x: float, y: float, ratio: float) -> None:
            self.move(x, y, ratio)
            time.sleep(0.12)
            user32.mouse_event(0x2, 0, 0, 0, 0)
            time.sleep(0.05)
            user32.mouse_event(0x4, 0, 0, 0, 0)

elif sys.platform == "darwin":
    import Quartz

    class Desk:  # type: ignore[no-redef]
        def __init__(self, app: App, pid: int) -> None:
            self.app, self.pid = app, pid

        def bounds(self) -> dict[str, float] | None:
            found = [
                dict(one["kCGWindowBounds"])
                for one in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) or []
                if int(one.get("kCGWindowOwnerPID", 0)) == self.pid and int(one.get("kCGWindowLayer", 0)) == 0
            ]
            return max(found, key=lambda one: one["Width"] * one["Height"]) if found else None

        def found(self) -> bool:
            return self.bounds() is not None

        def placed(self) -> None:
            pass

        def box(self) -> tuple[int, int, int, int]:
            got = self.bounds() or {"X": 0, "Y": 0, "Width": WIDTH, "Height": HEIGHT}
            return round(got["X"]), round(got["Y"]), round(got["Width"]), round(got["Height"])

        def forward(self) -> None:
            self.app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")

        def move(self, x: float, y: float, ratio: float) -> None:
            left, top, _, _ = self.box()
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (left + x, top + y), Quartz.kCGMouseButtonLeft))

        def click(self, x: float, y: float, ratio: float) -> None:
            left, top, _, _ = self.box()
            at = (left + x, top + y)
            for kind in (Quartz.kCGEventMouseMoved, Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, kind, at, Quartz.kCGMouseButtonLeft))
                time.sleep(0.1 if kind == Quartz.kCGEventMouseMoved else 0.05)

else:

    def xdo(*words: str) -> str:
        return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout

    class Desk:  # type: ignore[no-redef]
        def __init__(self, app: App, pid: int) -> None:
            self.app, self.pid, self.window = app, pid, ""

        @staticmethod
        def geometry(window: str) -> dict[str, int]:
            said = dict(line.split("=", 1) for line in xdo("getwindowgeometry", "--shell", window).split() if "=" in line)
            return {key: int(value) for key, value in said.items() if value.lstrip("-").isdigit()}

        def found(self) -> bool:
            inner = self.app.eval("[innerWidth, innerHeight]")
            want = inner if isinstance(inner, list) else [WIDTH, HEIGHT]
            best, off = "", None
            for one in xdo("search", "--onlyvisible", "--pid", str(self.pid), "").split():
                got = self.geometry(one)
                if not got.get("WIDTH"):
                    continue
                apart = abs(got["WIDTH"] - want[0]) + abs(got.get("HEIGHT", 0) - want[1])
                if off is None or apart < off:
                    best, off = one, apart
            self.window = best
            return bool(best)

        def placed(self) -> None:
            xdo("windowmove", self.window, "0", "0")
            xdo("windowsize", self.window, str(WIDTH), str(HEIGHT))

        def box(self) -> tuple[int, int, int, int]:
            got = self.geometry(self.window)
            return got["X"], got["Y"], got["WIDTH"], got["HEIGHT"]

        def forward(self) -> None:
            xdo("windowactivate", self.window)

        def move(self, x: float, y: float, ratio: float) -> None:
            left, top, _, _ = self.box()
            xdo("mousemove", str(left + round(x)), str(top + round(y)))

        def click(self, x: float, y: float, ratio: float) -> None:
            self.move(x, y, ratio)
            time.sleep(0.12)
            xdo("click", "1")


class Film:
    def __init__(self, desk: Desk, inner: tuple[int, int], judge: Callable[[numpy.ndarray], Any] | None = None) -> None:
        self.box, self.inner, self.judge = desk.box(), inner, judge
        self.frames: list[tuple[float, Any]] = []
        self.going = True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def css(self, raw: Any) -> numpy.ndarray:
        image = numpy.frombuffer(raw.bgra, dtype=numpy.uint8).reshape(raw.height, raw.width, 4)[:, :, 2::-1]
        width, height = self.inner
        scale = raw.width / width
        extra = max(0, round(raw.height - height * scale))
        image = image[extra:]
        if abs(scale - 1) > 0.01 or image.shape[0] != height:
            image = numpy.asarray(Image.fromarray(numpy.ascontiguousarray(image)).resize((width, height), Image.BOX))
        return numpy.ascontiguousarray(image)

    def run(self) -> None:
        left, top, width, height = self.box
        with mss.mss() as screen:
            while self.going:
                began = time.time()
                raw = screen.grab({"left": left, "top": top, "width": width, "height": height})
                at = time.time()
                if not self.frames:
                    print(f"film: window {self.box}, page {self.inner}, grabbed {raw.width}x{raw.height}", flush=True)
                frame = self.css(raw)
                self.frames.append((at, self.judge(frame) if self.judge else frame))
                time.sleep(max(0.0, PACE - (time.time() - began)))

    def stop(self) -> list[tuple[float, Any]]:
        self.going = False
        self.thread.join()
        return self.frames


def still(desk: Desk) -> tuple[Image.Image, float]:
    left, top, width, height = desk.box()
    with mss.mss() as screen:
        raw = screen.grab({"left": left, "top": top, "width": width, "height": height})
    return Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX"), raw.width / width


def sheet(frames: list[tuple[float, numpy.ndarray]], path: pathlib.Path) -> None:
    if not frames:
        return
    every = max(1, len(frames) // 40)
    kept = frames[::every]
    across, w, h = 8, 320, 200
    out = Image.new("RGB", (across * w, ((len(kept) + across - 1) // across) * h))
    for index, (_, one) in enumerate(kept):
        out.paste(Image.fromarray(one).resize((w, h)), ((index % across) * w, (index // across) * h))
    out.save(path, quality=80)


def cells(mask: numpy.ndarray, box: Box, size: int = CELL) -> numpy.ndarray:
    left, top, right, bottom = (max(0, int(-(-box[0] // 1))), max(0, int(-(-box[1] // 1))), int(box[2]), int(box[3]))
    right, bottom = min(right, mask.shape[1]), min(bottom, mask.shape[0])
    across, down = (right - left) // size, (bottom - top) // size
    if across <= 0 or down <= 0:
        return numpy.zeros((0, 0))
    part = mask[top : top + down * size, left : left + across * size]
    shape = (down, size, across, size) + part.shape[2:]
    return part.reshape(shape).mean(axis=(1, 3))


def lowest(frame: numpy.ndarray) -> numpy.ndarray:
    return numpy.minimum(numpy.minimum(frame[:, :, 0], frame[:, :, 1]), frame[:, :, 2])


def white(frame: numpy.ndarray) -> numpy.ndarray:
    return lowest(frame) >= 235


def teal(frame: numpy.ndarray) -> numpy.ndarray:
    r, g, b = (frame[:, :, k].astype(numpy.int16) for k in range(3))
    return (r < 70) & (g - r > 25) & (b - r > 25) & (numpy.abs(g - b) < 40)


def grid(box: Box, size: int, shape: tuple[int, ...]) -> tuple[int, int, int, int]:
    left, top = max(0, int(-(-box[0] // 1))), max(0, int(-(-box[1] // 1)))
    right, bottom = min(int(box[2]), shape[1]), min(int(box[3]), shape[0])
    return left, top, max(0, (right - left) // size), max(0, (bottom - top) // size)


@functools.lru_cache(maxsize=512)
def free(box: Box, size: int, shape: tuple[int, ...], layers: tuple[Box, ...], by: float) -> numpy.ndarray:
    left, top, across, down = grid(box, size, shape)
    x0 = left + numpy.arange(across) * size
    y0 = top + numpy.arange(down) * size
    kept = numpy.ones((down, across), dtype=bool)
    for one in layers:
        hit_x = (x0 < one[2] + by) & (one[0] - by < x0 + size)
        hit_y = (y0 < one[3] + by) & (one[1] - by < y0 + size)
        kept &= ~(hit_y[:, None] & hit_x[None, :])
    return kept


STEADY: dict[tuple[int, Box], numpy.ndarray] = {}


def steady_cells(key: int, frame: numpy.ndarray, box: Box) -> numpy.ndarray:
    if (key, box) not in STEADY:
        if len(STEADY) > 64:
            STEADY.clear()
        STEADY[(key, box)] = cells(white(frame), box)
    return STEADY[(key, box)]


def white_cells(frame: numpy.ndarray, box: Box, steady: list[numpy.ndarray] | None = None, layers: list[Box] | None = None) -> int:
    found = cells(white(frame), box)
    if not found.size:
        return 0
    lit = found >= 0.8
    if layers:
        kept = free(tuple(box), CELL, frame.shape[:2], tuple(tuple(one) for one in layers), 8.0)
        if kept.shape == lit.shape:
            lit &= kept
    for one in steady or []:
        was = steady_cells(id(one), one, tuple(box))
        if was.shape == found.shape:
            lit &= was < 0.8
    return int(lit.sum())


def inside(one: Box, other: Box) -> bool:
    return one[0] < other[2] and other[0] < one[2] and one[1] < other[3] and other[1] < one[3]


def grown(box: Box, by: float) -> Box:
    return box[0] - by, box[1] - by, box[2] + by, box[3] + by


def cut_cells(frame: numpy.ndarray, content: Box, layers: list[Box]) -> int:
    shares = cells(teal(frame), content)
    if not shares.size:
        return 0
    kept = free(tuple(content), CELL, frame.shape[:2], tuple(tuple(one) for one in layers), 48.0)
    if kept.shape != shares.shape:
        return int((shares < 0.5).sum())
    return int(((shares < 0.5) & kept).sum())


def beat_of(content: Box, scale: float = 1.0) -> Box:
    left, bottom = content[0], content[3]
    return left + 40 * scale, bottom - 60 * scale, left + 60 * scale, bottom - 40 * scale


def colour(frame: numpy.ndarray, box: Box) -> numpy.ndarray:
    part = frame[max(0, int(box[1])) : int(box[3]), max(0, int(box[0])) : int(box[2])]
    return part.reshape(-1, 3).mean(axis=0) if part.size else numpy.zeros(3)


def longest_still(samples: list[tuple[float, numpy.ndarray]]) -> float:
    worst = 0.0
    since = None
    last = None
    for at, seen in samples:
        if last is None or float(numpy.abs(seen - last).max()) > 6:
            if since is not None:
                worst = max(worst, at - since)
            since = at
        last = seen
    if since is not None and samples:
        worst = max(worst, samples[-1][0] - since)
    return worst * 1000


RECTS = f"""(() => {{
  const ws = orden.workspace
  const id = ws.panes.focusedId
  const pane = document.querySelector(`[data-pane="${{CSS.escape(id)}}"]`)
  const seen = (one) => one && one.getClientRects().length > 0 && (!one.checkVisibility || one.checkVisibility({{ visibilityProperty: true }}))
  const box = (one) => {{ if (!seen(one)) return null; const r = one.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? [r.left, r.top, r.right, r.bottom] : null }}
  const first = (selector) => [...(pane ? pane.querySelectorAll(selector) : [])].find(seen) || null
  const hole = first('.hole')
  const layers = [...document.querySelectorAll({json.dumps(FLOATING)})].filter((one) => !(hole && hole.contains(one))).map(box).filter(Boolean).concat(window.__parityBoxes || [])
  const scrims = [...document.querySelectorAll({json.dumps(SCRIMS)})].map(box).filter(Boolean).length
  return {{ pane: box(pane), hole: box(hole), editor: box(first('div.editor[data-region="editor"]')), layers, scrims,
    inner: [innerWidth, innerHeight], kind: ws.showing(id)?.kind ?? null, ratio: devicePixelRatio }}
}})()"""
PROBE = """(() => {
  if (!window.__parityHeard) {
    window.__parityHeard = true
    document.addEventListener('pointerdown', (e) => {
      const aimed = window.__parityAim ? [...document.querySelectorAll(window.__parityAim)].map((one) => one.getBoundingClientRect()) : []
      ;(window.__parityDowns ||= []).push([aimed.some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom), Math.round(e.clientX), Math.round(e.clientY), aimed.length])
    }, true)
  }
  const p = window.__parity = { gaps: [], last: 0 }
  const tick = (now) => { if (window.__parity !== p) return; if (p.last) p.gaps.push([Date.now(), now - p.last]); p.last = now; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return true
})()"""
TAKE = "(() => { const p = window.__parity; window.__parity = null; return p ? p.gaps : [] })()"
PRESSED = "document.querySelector('button.orden-glyph.overview')?.getAttribute('aria-pressed') === 'true'"
ACCOUNT = "[data-region=foot] button.who"
MENU = "[role=menu] [role=menuitem]"
PICKER = "[role=dialog][aria-label='Themes']"
SHEET = ".orden-screen.sheet[role=dialog]"


def at_middle(target: str, kind: str = "contextmenu") -> str:
    return f"""(() => {{
  const target = {target}
  if (!target) return 'nothing to aim at'
  const pane = document.querySelector(`[data-pane="${{CSS.escape(orden.workspace.panes.focusedId)}}"]`)
  const r = (pane.querySelector('.hole') || pane.querySelector('[data-region="editor"]') || pane).getBoundingClientRect()
  const x = r.left + r.width * 0.45, y = r.top + r.height * 0.35
  target.dispatchEvent(new MouseEvent({json.dumps(kind)}, {{ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 0, view: window }}))
  return 'aimed'
}})()"""


ROW = "[...document.querySelectorAll('.row[data-path]')].find((one) => /[\\\\/]Box$/.test(one.dataset.path))"
TAB = "[...document.querySelectorAll('.tab')].find((one) => (one.querySelector('.pick')?.getAttribute('aria-label') || '').startsWith('Other'))"
NOTICE = """(() => {
  const row = document.querySelector('[data-notices]')
  if (!row) return 'no notices row'
  const card = document.createElement('div')
  card.id = 'parity-notice'
  Object.assign(card.style, { gridColumn: '3', justifySelf: 'end', maxWidth: '22rem', display: 'flex', alignItems: 'center',
    gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius-md)', background: 'var(--surface-3)', boxShadow: 'var(--shadow-lg)',
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-sm)', color: 'var(--text)' })
  card.innerHTML = '<p style="margin:0">Orden 99.0.1 is ready to install.</p><button class="orden-button is-quiet">Later</button><button class="orden-button">Restart now</button>'
  row.append(card)
  card.animate([{ transform: 'translateY(12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' })
  return 'shown'
})()"""
NOTICE_GONE = """(() => {
  const card = document.getElementById('parity-notice')
  if (!card) return 'gone'
  card.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(12px)', opacity: 0 }], { duration: 220, easing: 'ease-in' }).finished.then(() => card.remove())
  return 'going'
})()"""
THEMES = f"""(async () => {{
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))
  const account = document.querySelector({json.dumps(ACCOUNT)})
  if (!account) return 'no account button'
  account.click()
  for (let i = 0; i < 40 && !document.querySelector({json.dumps(MENU)}); i++) await wait(25)
  const row = [...document.querySelectorAll({json.dumps(MENU)})].find((one) => one.textContent.trim() === 'Themes')
  if (!row) return 'no Themes in the account menu'
  row.click()
  return 'asked'
}})()"""
DELETE = f"""(async () => {{
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))
  const ask = {at_middle(ROW)}
  if (ask !== 'aimed') return ask
  for (let i = 0; i < 40 && !document.querySelector({json.dumps(MENU)}); i++) await wait(25)
  const row = [...document.querySelectorAll({json.dumps(MENU)})].find((one) => one.textContent.trim() === 'Delete')
  if (!row) return 'no Delete in the row menu'
  const menu = row.closest('[role=menu]').getBoundingClientRect()
  window.__parityBoxes = [[menu.left, menu.top, menu.right, menu.bottom]]
  row.click()
  return 'asked'
}})()"""
CANCEL = f"(() => {{ const one = [...document.querySelectorAll({json.dumps(SHEET + ' button')})].find((b) => b.textContent.trim() === 'Cancel'); if (one) one.click(); return !!one }})()"
TOAST_UP = "[...document.querySelectorAll('[data-notices] > *')].some((one) => /Deleted/.test(one.textContent))"
UNDO = "(() => { const one = [...document.querySelectorAll('[data-notices] button')].find((b) => b.textContent.trim() === 'Undo'); if (one) one.click(); return !!one })()"
PALETTE = (
    "(() => { const mac = navigator.platform.startsWith('Mac');"
    " window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));"
    " return 'pressed' })()"
)
LAYERS: list[dict[str, Any]] = [
    {"name": "context menu", "open": at_middle("document.querySelector('.tab.active .pick[data-tab]')"), "up": "!!document.querySelector('[role=menu]')", "close": CLOSE, "down": "!document.querySelector('[role=menu]')"},
    {"name": "hover card", "open": f"(() => {{ const one = {TAB}; if (!one) return 'no other tab'; one.dispatchEvent(new PointerEvent('pointerenter', {{ pointerType: 'mouse' }})); return 'entered' }})()", "up": "!!document.querySelector('.orden-bubble.card')", "close": f"(() => {{ const one = {TAB}; one?.dispatchEvent(new PointerEvent('pointerleave', {{ pointerType: 'mouse' }})); return true }})()", "down": "!document.querySelector('.orden-bubble.card')"},
    {"name": "toast", "open": "(async () => { const ws = orden.workspace; const path = await ws.noteFrom('# Gone\\n\\nA note to delete.\\n'); if (!path) return 'no note made'; await ws.removeMany([path]); return 'deleted' })()", "up": TOAST_UP, "close": UNDO, "down": f"!({TOAST_UP})", "hold": 1.2, "wait": 8.0},
    {"name": "update notice", "open": NOTICE, "up": "!!document.getElementById('parity-notice')", "close": NOTICE_GONE, "down": "!document.getElementById('parity-notice')"},
    {"name": "palette", "open": PALETTE, "up": "!!document.querySelector('.orden-screen.palette')", "close": CLOSE, "down": "!document.querySelector('.orden-screen.palette')"},
    {"name": "overview", "open": "(() => { document.querySelector('button.orden-glyph.overview')?.click(); return true })()", "up": PRESSED, "close": "(() => { document.querySelector('button.orden-glyph.overview')?.click(); return true })()", "down": f"!({PRESSED}) && !document.documentElement.hasAttribute('data-overview')", "whole": True, "hold": 2.0},
    {"name": "Settings", "open": "(orden.settings.show('general'), true)", "up": "orden.settings.open === true", "close": "(() => { orden.settings.open = false; if (TAB_ID) orden.workspace.activate(TAB_ID); return true })()", "down": "orden.settings.open === false", "away": True},
    {"name": "row menu", "open": at_middle(ROW), "up": "!!document.querySelector('[role=menu]')", "close": CLOSE, "down": "!document.querySelector('[role=menu]')", "sidebar": True},
    {"name": "popup", "open": THEMES, "up": f"!!document.querySelector({json.dumps(PICKER)})", "close": CLOSE, "down": f"!document.querySelector({json.dumps(PICKER)}) && !document.querySelector({json.dumps(MENU)})", "sidebar": True},
    {"name": "dialog", "open": DELETE, "up": f"!!document.querySelector({json.dumps(SHEET)})", "close": CANCEL, "down": f"!document.querySelector({json.dumps(SHEET)})", "sidebar": True},
]


LAYERS[:0] = [
    {"name": "left peek", "open": "peek in", "up": "!!document.querySelector('.column.peek')", "close": "peek out", "down": "!document.querySelector('.column.peek')", "box": ".column.peek aside", "at": (0.5, 0.8, 0, 0)},
    {"name": "right sidebar", "open": "(orden.workspace.showRight('outline'), true)", "up": "!!document.querySelector('.panels.right.open')", "close": "(orden.workspace.closeRight(), true)", "down": "!document.querySelector('.panels.right.open')", "box": ".panels.right.open", "at": (0.5, 0.8, 0, 0), "moves": True},
]
OWN = {
    "context menu": ("[role=menu]", (0.5, 0, 0, 3)),
    "row menu": ("[role=menu]", (0.5, 0, 0, 3)),
    "hover card": (".orden-bubble.card", (0.5, 0.5, 0, 0)),
    "toast": ("[data-notices] > *", (0, 0.5, 6, 0)),
    "update notice": ("#parity-notice", (0, 0.5, 6, 0)),
    "palette": (".orden-screen.palette", (0.5, 0, 0, 3)),
    "popup": (PICKER, (0.5, 0, 0, 20)),
    "dialog": (SHEET, (0.5, 0, 0, 6)),
    "overview": ("corners", None),
    "Settings": ("content", None),
}
for _one in LAYERS:
    if _one["name"] in OWN:
        _one["box"], _one["at"] = OWN[_one["name"]]


def own_of(selector: str) -> str:
    return (
        f"[...document.querySelectorAll({json.dumps(selector)})].filter((one) => one.getClientRects().length)"
        ".map((one) => { const r = one.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }).filter((r) => r[2] > r[0] && r[3] > r[1])"
    )


class Drive:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.out: pathlib.Path = args.out
        self.rows: list[dict[str, Any]] = []
        self.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Site)
        threading.Thread(target=self.site.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.site.server_address[1]}"
        self.app: App
        self.desk: Desk
        self.process: subprocess.Popen[bytes] | None = None
        self.refuser: Any = None
        self.spaces: pathlib.Path | None = None
        self.current = ""
        self.dispatched = False

    def row(self, item: int, check: str, web: Any, note: Any, ok: bool, detail: str = "") -> None:
        one = {"item": item, "check": check, "platform": PLATFORM, "web": web, "note": note, "ok": bool(ok)}
        if detail:
            one["detail"] = detail
        self.rows.append(one)
        print(f"[{'ok' if ok else 'WRONG'}] {item} {check}: web {web}, note {note} {detail}", flush=True)

    def eval(self, code: str, seconds: float | None = None) -> Any:
        return self.app.eval(code, seconds)

    def until(self, code: str, seconds: float = 3.0, every: float = 0.03) -> float | None:
        stop = time.time() + seconds
        while time.time() < stop:
            if self.eval(code) is True:
                return time.time()
            time.sleep(every)
        return None

    def start(self) -> None:
        config = config_of(self.args.identifier)
        fresh(config)
        secret = secrets.token_hex(32)
        (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
        self.spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-parity-look-"))
        said = open(self.out / "app.log", "wb")
        env = {**os.environ, "ORDEN_SPACES_DIR": str(self.spaces)}
        self.process = subprocess.Popen([str(self.args.exe)], env=env, cwd=str(self.args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
        self.app = endpoint(config, self.process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and self.eval("!!orden.workspace && !!orden.workspace.activeSpace") is not True:
            time.sleep(1)
        self.desk = Desk(self.app, self.process.pid)
        while time.monotonic() < until and not self.desk.found():
            time.sleep(0.25)
        if not self.desk.found():
            raise SystemExit("the app put up no window")
        self.desk.placed()
        self.desk.forward()
        time.sleep(3)
        if sys.platform == "darwin":
            spec = importlib.util.spec_from_file_location("web_under_mac_drive", HERE / "web-under-mac-drive.py")
            mac = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mac)
            self.refuser = mac.Refuser()

    def stop(self) -> None:
        if self.process is not None:
            ended(self.process, gentle=True)
        if self.refuser is not None:
            self.refuser.stop()
        self.site.shutdown()
        if self.spaces is not None:
            shutil.rmtree(self.spaces, ignore_errors=True)

    def sidebar(self, open_: bool) -> None:
        if (self.eval("!!orden.workspace.panel") is True) != open_:
            self.eval("orden.workspace.toggleSidebar('left'); return true")
        if open_ and self.eval("orden.workspace.panel === 'tree'") is not True:
            self.eval("orden.workspace.showPanel('tree'); return true")
        time.sleep(1.0)

    def dark(self) -> None:
        self.sidebar(True)
        said = "not tried"
        for _ in range(3):
            said = clicked(self.eval, "dark")
            if self.eval("document.documentElement.dataset.theme") == "dark":
                break
            time.sleep(1)
        if self.eval("document.documentElement.dataset.theme") != "dark":
            raise SystemExit(f"the app would not go dark: {said}")
        print("the app is dark", flush=True)

    def style(self, name: str, css: str | None) -> None:
        self.eval(
            f"(() => {{ let one = document.getElementById({json.dumps(name)}); if ({json.dumps(css)} === null) {{ one?.remove(); return true }}"
            f" if (!one) {{ one = document.createElement('style'); one.id = {json.dumps(name)}; document.head.append(one) }} one.textContent = {json.dumps(css)}; return true }})()"
        )

    def tab_of(self, kind: str, pane: str | None = None) -> str | None:
        found = self.eval(
            f"(() => {{ const ws = orden.workspace; const pane = {json.dumps(pane)} ?? ws.panes.focusedId;"
            f" const one = [...ws.tabs].reverse().find((t) => t.paneId === pane && t.kind === {json.dumps(kind)}); return one ? one.id : null }})()"
        )
        return found if isinstance(found, str) else None

    def show(self, kind: str) -> None:
        tab = self.tab_of(kind)
        if tab is None:
            raise SystemExit(f"no {kind} tab in the pane")
        self.eval(f"orden.workspace.activate({json.dumps(tab)}); return true")
        if kind == "web":
            self.web_shown()
        else:
            self.until(f"orden.workspace.showing(orden.workspace.panes.focusedId)?.kind === 'note'", 5)
        time.sleep(1.2)

    def web_shown(self, count: int = 1, seconds: float = 40) -> bool:
        return self.until(f"orden.pages.each().filter(([, one]) => one.live && one.sent && one.sent.visible).length >= {count}", seconds, 0.3) is not None

    def scene(self) -> None:
        self.dark()
        self.eval("for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false); return true")
        time.sleep(1)
        root = self.eval("orden.workspace.activeSpace.root")
        if not isinstance(root, str):
            raise SystemExit(f"no space to work in: {root}")
        self.made_box()
        self.eval("orden.workspace.openBlank('Other', '# Other\\n\\nA tab to hover.\\n'); return true")
        time.sleep(0.5)
        self.eval("orden.workspace.openBlank('Parity', '# Parity\\n\\nA note beside a page.\\n'); return true")
        time.sleep(1)
        self.eval(f"orden.workspace.openPage({json.dumps(self.base + '/teal')}); return true")
        if not self.web_shown():
            raise SystemExit("the web tab's page was never shown")
        time.sleep(2)

    def made_box(self) -> None:
        said = self.eval(
            "(async () => { const ws = orden.workspace; const root = ws.activeSpace.root; const sep = root.includes('\\\\') ? '\\\\' : '/';"
            " const box = root + sep + 'Box'; await orden.invoke('create_folder', { path: box });"
            " for (const name of ['Inside', 'Also']) await ws.noteFrom(`# ${name}\\n\\nKept in a box.\\n`, box);"
            " await ws.loadTree(); const row = [...document.querySelectorAll('.row[data-path]')].find((one) => /[\\\\/]Box$/.test(one.dataset.path));"
            " const path = row ? row.dataset.path : box; if (!ws.isExpanded(path)) ws.toggleFolder(path); return path })()"
        )
        print(f"the folder for the dialog: {said}", flush=True)
        time.sleep(0.5)

    def box_gone(self) -> bool:
        return self.eval(f"!({ROW})") is True

    def opened(self, layer: dict[str, Any], click: bool = True) -> tuple[float, float | None, float, float | None, Any]:
        self.eval("window.__parityBoxes = []; return true")
        t_open = time.time()
        said = self.peek(True) if layer["open"] == "peek in" else self.eval(layer["open"])
        early = self.eval(RECTS)
        t_up = self.until(layer["up"], layer.get("wait", 3.0))
        time.sleep(layer.get("hold", 0.7))
        rects = self.eval(RECTS)
        if not isinstance(rects, dict):
            rects = {"layers": []}
        if isinstance(early, dict):
            rects["layers"] = rects.get("layers", []) + [one for one in early.get("layers", []) if one not in rects.get("layers", [])]
        box = layer.get("box")
        own = self.eval(own_of(box)) if box and box not in ("content", "corners") else []
        rects["own"] = own if isinstance(own, list) else []
        rects["layers"] = rects["layers"] + rects["own"]
        rects["t_click"], rects["clicked"] = self.clicked(layer, rects["own"], rects.get("ratio") or 1) if click else (time.time(), None)
        t_close = time.time()
        if layer["close"] == "peek out":
            self.peek(False)
        else:
            self.eval(layer["close"].replace("TAB_ID", json.dumps(self.current)))
        t_down = self.until(layer["down"], 3.0)
        if t_down is None:
            self.eval(CLOSE)
            self.until(layer["down"], 2.0)
        if layer["name"] == "toast" and self.eval(TOAST_UP) is True:
            self.until(f"!({TOAST_UP})", 15, 0.25)
        if layer["name"] == "dialog" and self.box_gone():
            self.made_box()
        if t_up is None:
            print(f"[{layer['name']}] did not come up: {said}", flush=True)
        return t_open, t_up, t_close, t_down, rects

    def peek(self, out: bool) -> str:
        inner = self.eval("[innerWidth, innerHeight, devicePixelRatio]") or [WIDTH, HEIGHT, 1]
        middle = inner[1] / 2
        path = [(inner[0] * 0.4 - step * inner[0] * 0.4 / 6, middle) for step in range(7)] if out else [(inner[0] * 0.5, middle)]
        for x, y in path:
            self.desk.move(max(1.0, x), y, inner[2])
            time.sleep(0.04)
        if not out or self.until("!!document.querySelector('.column.peek')", 1.0) is not None:
            return "moved"
        self.eval(
            "(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: innerHeight / 2, buttons: 0, pointerType: 'mouse', bubbles: true })); return true })()"
        )
        self.dispatched = True
        print("the OS pointer at the left edge did not reach the app, so the move was dispatched in the app", flush=True)
        return "dispatched"

    def clicked(self, layer: dict[str, Any], own: list[list[float]], ratio: float) -> tuple[float, str | None]:
        at = layer.get("at")
        if not at or not own:
            return time.time(), None
        left, top, right, bottom = own[0]
        x = left + at[0] * (right - left) + at[2]
        y = top + at[1] * (bottom - top) + at[3]
        self.eval(f"window.__parityDowns = []; window.__parityAim = {json.dumps(layer['box'])}; return true")
        before = Site.downs
        t_click = time.time()
        self.desk.click(x, y, ratio)
        time.sleep(0.5)
        downs = self.eval("window.__parityDowns || []")
        page = Site.downs - before
        downs = downs if isinstance(downs, list) else []
        app = "layer" if any(one[0] for one in downs) else "app" if downs else None
        said = "both" if app and page else app or ("page" if page else "none")
        print(f"[{layer['name']}] a click at {round(x)},{round(y)} reached {said}; the app heard {downs}", flush=True)
        return t_click, said

    def back_to(self, kind: str) -> None:
        if self.eval("orden.workspace.showing(orden.workspace.panes.focusedId)?.kind") != kind:
            self.show(kind)

    @staticmethod
    def middle(turns: list[dict[str, Any]]) -> dict[str, Any]:
        turns = [one for one in turns if one["up"]] or turns
        out = dict(turns[0])
        out["rounds"] = turns
        for key in ("white cells", "cut cells", "stale ms", "freeze ms", "stale limit", "covered share", "lag ms"):
            values = sorted(one[key] for one in turns if one[key] is not None)
            out[key] = values[(len(values) - 1) // 2] if values else None
        clicks = [one.get("clicked") for one in turns]
        out["clicked"] = max(set(clicks), key=clicks.count) if clicks else None
        out["up"] = any(one["up"] for one in turns)
        return out

    def layered(self, layer: dict[str, Any], kind: str, turn: int = 0) -> dict[str, Any]:
        began = time.time()
        self.back_to(kind)
        self.desk.forward()
        self.current = self.tab_of(kind) or ""
        time.sleep(0.6)
        base = self.eval(RECTS)
        self.eval(PROBE)
        film = Film(self.desk, tuple(base["inner"]))
        time.sleep(0.3)
        t_open, t_up, t_close, t_down, rects = self.opened(layer)
        time.sleep(0.6)
        frames = film.stop()
        gaps = self.eval(TAKE) or []
        self.back_to(kind)
        filmed = time.time()
        sheet(frames, self.out / f"look-{layer['name'].replace(' ', '-')}-{kind}-{turn + 1}.jpg")
        judged = judge_layer(layer, kind, base, rects, frames, gaps, t_open, t_up, t_close, t_down)
        print(f"[{layer['name']} {kind}] filmed in {filmed - began:.1f} s, judged in {time.time() - filmed:.1f} s", flush=True)
        return judged

    def layers(self) -> None:
        self.style("parity-note", NOTE_STYLE + CALM)
        names = set(self.args.layers.split(",")) if self.args.layers else None
        chosen = [one for one in LAYERS if names is None or one["name"] in names]
        for wants in (False, True):
            group = [one for one in chosen if bool(one.get("sidebar")) == wants]
            if not group:
                continue
            self.sidebar(wants)
            for layer in group:
                for kind in ("note",):
                    self.back_to(kind)
                    self.desk.forward()
                    self.current = self.tab_of(kind) or ""
                    time.sleep(0.5)
                    self.opened(layer, False)
                    self.back_to(kind)
            for layer in group:
                seen = {kind: self.middle([self.layered(layer, kind, turn) for turn in range(ROUNDS)]) for kind in ("note", "web")}
                for check in ("white cells", "cut cells", "stale ms", "freeze ms"):
                    web, note = seen["web"][check], seen["note"][check]
                    if check == "freeze ms":
                        ok = note <= LIMITS["note freeze ms"] and web <= note + LIMITS["freeze over note ms"]
                    else:
                        limit = seen["note"]["stale limit"] if check == "stale ms" else LIMITS[check]
                        ok = note <= limit and web <= limit
                    came = seen["web"]["up"] and seen["note"]["up"]
                    detail = "" if came else f"came up: web {seen['web']['up']}, note {seen['note']['up']}"
                    if layer["open"] == "peek in" and self.dispatched:
                        detail = (detail + "; " if detail else "") + "the pointer's move to the edge was dispatched in the app"
                    rounds = {kind: [round(one[check]) for one in seen[kind]["rounds"]] for kind in ("web", "note")}
                    if len(set(rounds["web"])) > 1 or len(set(rounds["note"])) > 1:
                        detail = (detail + "; " if detail else "") + f"rounds web {rounds['web']}, note {rounds['note']}"
                    self.row(1, f"{layer['name']}: {check}", round(web), round(note), ok and came, detail)
                self.extra_rows(layer, seen)
        self.style("parity-note", None)
        self.sidebar(False)

    def extra_rows(self, layer: dict[str, Any], seen: dict[str, dict[str, Any]]) -> None:
        web, note = seen["web"], seen["note"]
        name = layer["name"]
        if web["covered share"] is None or note["covered share"] is None:
            self.row(1, f"{name}: page over the layer", "-", "-", False, "the layer's own box was not found to look in")
        else:
            ok = note["covered share"] <= LIMITS["covered share"] and web["covered share"] <= note["covered share"] + LIMITS["covered share"]
            self.row(1, f"{name}: page over the layer", f"{web['covered share']:.1%}", f"{note['covered share']:.1%}", ok, f"share of the layer's box showing the page; limit {LIMITS['covered share']:.0%} over the note")
        frame = web["frame ms"] or 16.7
        rates = f"capture every {web['capture ms']:.0f} ms (web) and {note['capture ms']:.0f} ms (note), app frames {frame:.1f} ms"
        if web["lag ms"] is None or note["lag ms"] is None:
            self.row(1, f"{name}: frames until the page yields", "-", 0, False, f"the layer or the page's leaving was not seen: web {web['lag ms']}, note {note['lag ms']}; {rates}")
        else:
            frames = int(max(0.0, web["lag ms"] - note["lag ms"]) // frame)
            raw = {kind: [None if one["lag ms"] is None else round(one["lag ms"]) for one in seen[kind]["rounds"]] for kind in ("web", "note")}
            late = "; a frame late" if frames == 1 else ""
            self.row(1, f"{name}: frames until the page yields", frames, 0, frames < 2, f"median of the rounds, layer first drawn to the page gone from its box: web {web['lag ms']:.0f} ms, note {note['lag ms']:.0f} ms (rounds web {raw['web']}, note {raw['note']}){late}; {rates}")
        if layer.get("at") is None:
            return
        want = ("app", "page") if layer.get("through") else ("layer", "layer")
        ok = (note["clicked"], web["clicked"]) == want
        rounds = {kind: [one.get("clicked") for one in seen[kind]["rounds"]] for kind in ("web", "note")}
        self.row(1, f"{name}: a click on the layer", web["clicked"], note["clicked"], ok, f"wanted note {want[0]}, web {want[1]}; most rounds count (web {rounds['web']}, note {rounds['note']})")

    def cards(self) -> list[dict[str, Any]]:
        said = self.eval(
            "(() => { const round = parseFloat(getComputedStyle(document.querySelector('main')).getPropertyValue('--card-radius')) || 0;"
            " const all = [...document.querySelectorAll('[data-pane]')].filter((one) => one.getClientRects().length);"
            " return all.map((pane) => { const box = pane.getBoundingClientRect(); const head = pane.querySelector(':scope > .head');"
            " return { id: pane.dataset.pane, kind: orden.workspace.showing(pane.dataset.pane)?.kind ?? 'empty', left: box.left, right: box.right,"
            " top: head ? head.getBoundingClientRect().bottom : box.top, bottom: box.bottom, round } }) })()"
        )
        return said if isinstance(said, list) else []

    def fill(self, kind: str, ground: str) -> bool:
        panes = self.eval("orden.workspace.panes.all.map((one) => one.id)") or []
        for pane in panes:
            if self.tab_of(kind, pane) is None:
                self.eval(f"orden.workspace.focusPane({json.dumps(pane)}); return true")
                if kind == "web":
                    self.eval(f"orden.workspace.openPage({json.dumps(self.base + '/plain?bg=' + ground)}); return true")
                else:
                    self.eval("orden.workspace.openBlank('Shape', ''); return true")
                time.sleep(0.8)
            tab = self.tab_of(kind, pane)
            if tab:
                self.eval(
                    f"const ws = orden.workspace; ws.moveTab({json.dumps(tab)}, {json.dumps(pane)}, 0);"
                    f" ws.focusPane({json.dumps(pane)}); ws.activate({json.dumps(tab)}); return true"
                )
        time.sleep(1)
        if kind == "web" and not self.web_shown(len(panes)):
            return False
        time.sleep(2.5)
        return True

    def shapes(self) -> None:
        self.eval("for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false); return true")
        time.sleep(1)
        self.style("parity-shape", BACKDROP + CALM)
        self.eval("orden.workspace.openBlank('Shape', ''); return true")
        time.sleep(1.5)
        shot, scale = still(self.desk)
        first = self.cards()
        ground = "202020"
        if first:
            card = first[0]
            x, y = (card["left"] + card["right"]) / 2 * scale, (card["top"] + card["bottom"]) / 2 * scale
            patch = numpy.asarray(shot.crop((int(x) - 20, int(y) - 20, int(x) + 20, int(y) + 20))).reshape(-1, 3)
            ground = "".join(f"{int(v):02x}" for v in numpy.median(patch, axis=0))
        print(f"the note's ground: #{ground}", flush=True)
        steps = [("one", None), ("side by side", ("row", 0)), ("three", ("column", 1)), ("stacked", "collapse")]
        for name, step in steps:
            if step == "collapse":
                self.eval("orden.workspace.collapsePanes(); return true")
                time.sleep(1)
                self.eval("orden.workspace.split('column'); return true")
            elif step:
                along, at = step
                self.eval(f"const ws = orden.workspace; ws.focusPane(ws.panes.all[{at}].id); ws.split('{along}'); return true")
            time.sleep(1.5)
            shots: dict[str, list[tuple[Image.Image, float, list[dict[str, Any]]]]] = {"note": [], "web": []}
            for kind in ("note", "web"):
                if not self.fill(kind, ground):
                    self.row(2, f"{name}: corners", "no page", "-", False, "the web pages were never all shown")
                    break
                for _ in range(2):
                    image, scale = still(self.desk)
                    shots[kind].append((image, scale, self.cards()))
                    image.save(self.out / f"shape-{name.replace(' ', '-')}-{kind}-{len(shots[kind])}.png")
                    time.sleep(0.5)
            if len(shots["web"]) == 2:
                self.shaped(name, shots)
        self.style("parity-shape", None)

    def shaped(self, name: str, shots: dict[str, list[tuple[Image.Image, float, list[dict[str, Any]]]]]) -> None:
        note, again = shots["note"]
        web = shots["web"][0]
        if len(note[2]) != len(web[2]):
            self.row(2, f"{name}: corners", f"{len(web[2])} panes", f"{len(note[2])} panes", False, "the two sides hold different panes")
            return
        floor = corner_gap(note, again)
        gap = corner_gap(note, web)
        ok = floor[0] <= LIMITS["corner share"] and gap[0] <= LIMITS["corner share"]
        self.row(2, f"{name}: corners", f"{gap[0]:.1%}", f"{floor[0]:.1%}", ok, f"worst at {gap[2]}; limit {LIMITS['corner share']:.0%} of each corner's square")
        ok = floor[1] <= LIMITS["shadow apart"] and gap[1] <= LIMITS["shadow apart"]
        self.row(2, f"{name}: shadow", round(gap[1], 1), round(floor[1], 1), ok, f"worst at {gap[3]}; limit {LIMITS['shadow apart']} a channel")
        floor_edge = edge_gap(note, again)
        edge = edge_gap(note, web)
        ok = floor_edge[0] <= LIMITS["edge apart"] and edge[0] <= LIMITS["edge apart"]
        self.row(2, f"{name}: edge line", round(edge[0], 1), round(floor_edge[0], 1), ok, f"worst at {edge[1]}; limit {LIMITS['edge apart']} a channel")

    def loading(self) -> None:
        self.eval("orden.workspace.collapsePanes(); for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false); return true")
        time.sleep(1)
        self.eval("orden.workspace.openBlank('Rest', '# Rest\\n\\nA note at rest.\\n'); return true")
        self.eval(f"orden.workspace.openPage({json.dumps(self.base + '/teal')}); return true")
        self.web_shown()
        time.sleep(1.5)
        for name in ("new tab", "navigation", "crash"):
            seen = {kind: self.load_worst([self.loaded(name, kind) for _ in range(LOAD_ROUNDS)]) for kind in ("note", "web")}
            for check in ("white cells", "light cells"):
                web, note = seen["web"][check], seen["note"][check]
                ok = web <= LIMITS[check] and note <= LIMITS[check] and not seen["web"]["failed"]
                self.row(6, f"{name}: {check}", web, note, ok, seen["web"]["detail"])

    @staticmethod
    def load_worst(turns: list[dict[str, Any]]) -> dict[str, Any]:
        out = dict(turns[0])
        for one in turns[1:]:
            out["white cells"] = max(out["white cells"], one["white cells"])
            out["light cells"] = max(out["light cells"], one["light cells"])
            out["failed"] = out["failed"] or one["failed"]
            out["detail"] = out["detail"] if out["detail"] == one["detail"] else f"{out['detail']}; {one['detail']}"
        return out

    def visible_page(self) -> str:
        return "(orden.pages.each().find(([, one]) => one.live && one.sent && one.sent.visible) || [])[0]"

    def loaded(self, name: str, kind: str) -> dict[str, Any]:
        if not (name == "crash" and kind == "web"):
            self.back_to(kind)
            time.sleep(1)
        if kind == "note":
            code = {
                "new tab": "orden.workspace.openBlank('Fresh', '# Fresh\\n'); return true",
                "navigation": f"orden.workspace.activate({json.dumps(self.other_note())}); return true",
            }.get(name)
        else:
            code = {
                "new tab": f"orden.workspace.openPage({json.dumps(self.base + '/slow-new')}); return true",
                "navigation": f"(() => {{ const id = {self.visible_page()}; if (id) orden.pages.go(id, {json.dumps(self.base + '/slow-next')}); return !!id }})()",
            }.get(name)
        detail, failed = "", False
        base = self.eval(RECTS)
        inner = tuple(base["inner"])
        if name == "crash" and kind == "web":
            self.eval(f"orden.workspace.openPage({json.dumps(self.base + '/teal')}); return true")
            self.web_shown()
            time.sleep(1.5)
            self.eval(f"(() => {{ const id = {self.visible_page()}; if (id) orden.pages.go(id, {json.dumps(self.base.replace('127.0.0.1', 'localhost') + '/crash')}); return !!id }})()")
            self.until("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible && one.title === 'crash')", 10, 0.2)
            rects = self.eval(RECTS)
            area = tuple(rects.get("hole") or rects.get("pane"))
            film = Film(self.desk, inner, lambda frame: lit_cells(frame, area))
            crashed = self.until("orden.pages.each().some(([, one]) => one.crashed)", 30, 0.25)
            time.sleep(3.0 if crashed else 0.5)
            card = self.eval("(() => { const one = document.querySelector('[data-pane] .card'); if (!one) return null; const r = one.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] })()")
            own = [tuple(card)] if isinstance(card, list) else []
            stats = [counted(one, area, own, (inner[1], inner[0])) for _, one in film.stop()]
            if crashed is None:
                failed = True
                detail = "the page did not crash; the app has no way to end a page's renderer (web_navigate opens only http and https, no CDP verb is exposed), so the page uses up its memory itself"
            else:
                detail = "the app shows its crashed card" if self.eval("!!document.querySelector('[data-pane] .card .name')") is True else "no crashed card"
        else:
            film = Film(self.desk, inner)
            time.sleep(0.25)
            if code:
                self.eval(code)
            time.sleep(SLOW + 1.9)
            frames = film.stop()
            sheet(frames, self.out / f"load-{name.replace(' ', '-')}-{kind}.jpg")
            rects = self.eval(RECTS)
            area = tuple((rects.get("hole") if kind == "web" else rects.get("editor")) or rects.get("pane"))
            stats = [judged_load(frame, area) for _, frame in frames]
            if kind == "web" and name != "crash":
                loaded = self.eval(f"orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible && one.title === {json.dumps(name.replace('new tab', 'slow-new').replace('navigation', 'slow-next'))})")
                if loaded is not True:
                    failed, detail = True, "the slow page never showed"
        return {
            "white cells": max((one[0] for one in stats), default=0),
            "light cells": max((one[1] for one in stats), default=0),
            "detail": detail,
            "failed": failed,
        }

    def other_note(self) -> str:
        found = self.eval(
            "(() => { const ws = orden.workspace; const pane = ws.panes.focusedId;"
            " const one = [...ws.tabs].reverse().find((t) => t.paneId === pane && t.kind === 'note' && t.id !== ws.activeTabId); return one ? one.id : null })()"
        )
        return found if isinstance(found, str) else ""

    def table(self) -> None:
        (self.out / "results.json").write_text(json.dumps(self.rows, indent=1), encoding="utf-8")
        lines = ["| item | check | platform | web | note | ok |", "|---|---|---|---|---|---|"]
        for one in self.rows:
            lines.append(f"| {one['item']} | {one['check']} | {one['platform']} | {one['web']} | {one['note']} | {'yes' if one['ok'] else 'no'} |")
        limits = ", ".join(f"{name} {value}" for name, value in LIMITS.items())
        lines += ["", f"Limits: {limits}. Each layer is filmed {ROUNDS} times a side and each check takes the median round (a click, the most rounds); the page's yield fails from two whole app frames late, one being noted as a frame late. Each load is filmed {LOAD_ROUNDS} times a side and keeps its worst round."]
        text = "\n".join(lines)
        print(text, flush=True)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as out:
                out.write(f"\n### parity look on {PLATFORM}\n\n{text}\n")


def lit_cells(frame: numpy.ndarray, area: Box) -> tuple[numpy.ndarray, numpy.ndarray]:
    return cells(white(frame), area) >= 0.8, cells(lowest(frame).astype(numpy.float32), area, WIDE_CELL) >= 150


def counted(lit: tuple[numpy.ndarray, numpy.ndarray], area: Box, own: list[Box], shape: tuple[int, int]) -> tuple[int, int]:
    out = []
    for mask, size in zip(lit, (CELL, WIDE_CELL)):
        kept = free(tuple(area), size, shape, tuple(tuple(one) for one in own), 8.0)
        out.append(int((mask & kept).sum()) if kept.shape == mask.shape else int(mask.sum()))
    return out[0], out[1]


def judged_load(frame: numpy.ndarray, area: Box) -> tuple[int, int]:
    lows = cells(lowest(frame).astype(numpy.float32), area, WIDE_CELL)
    return white_cells(frame, area), int((lows >= 150).sum()) if lows.size else 0


def judge_layer(layer: dict[str, Any], kind: str, base: dict[str, Any], rects: dict[str, Any], frames: list[tuple[float, numpy.ndarray]], gaps: list[list[float]], t_open: float, t_up: float | None, t_close: float, t_down: float | None) -> dict[str, Any]:
    STEADY.clear()
    inner = base["inner"]
    whole = (0, 0, inner[0], inner[1])
    area = whole if layer.get("whole") else tuple(base["pane"] or whole)
    content = tuple((base["hole"] if kind == "web" else base["editor"]) or base["pane"] or whole)
    shown = tuple((rects or {}).get("hole" if kind == "web" else "editor") or content)
    layers = [tuple(one) for one in (rects or {}).get("layers", [])]
    end = frames[-1][0] if frames else t_close
    gone = t_down or t_close
    if layer.get("whole"):
        windows = [(0.0, t_open, content, []), ((t_up or t_open) + 0.8, t_close, shown, layers), (gone + 0.8, end + 1, content, [])]
    elif layer.get("away"):
        windows = [(0.0, t_open, content, []), (gone + 0.15, end + 1, content, [])]
    elif layer.get("moves"):
        windows = [(0.0, t_open, content, []), ((t_up or t_open) + 0.6, t_close, shown, layers), (gone + 0.6, end + 1, content, [])]
    else:
        windows = [(0.0, t_open, content, []), (t_open, gone + 0.4, content, layers), (gone + 0.4, end + 1, content, [])]
    steady = [frame for at, frame in frames[:1]] + [frame for at, frame in frames if at <= t_close][-1:] + [frame for _, frame in frames[-1:]]
    during = (t_open, gone + 0.4)
    whites = 0 if layer.get("whole") else max((white_cells(frame, area, steady, layers if during[0] <= at < during[1] else None) for at, frame in frames), default=0)
    cut = 0
    stale = 0.0
    for start, stop, rect, over in windows:
        inside_window = [(at, frame) for at, frame in frames if start <= at < stop]
        for _, frame in inside_window:
            cut = max(cut, cut_cells(frame, rect, over))
            if layer.get("whole"):
                whites = max(whites, white_cells(frame, rect))
        scale = (rect[2] - rect[0]) / max(1.0, content[2] - content[0])
        beat = beat_of(rect, scale)
        if any(inside(beat, grown(one, 4)) for one in over):
            continue
        samples = [(at, colour(frame, beat)) for at, frame in inside_window]
        if len(samples) > 2:
            stale = max(stale, longest_still(samples))
    steps = [b[0] - a[0] for a, b in zip(frames, frames[1:])]
    pace = float(numpy.median(steps)) * 1000 if steps else 0.0
    freeze = max((gap for at, gap in gaps if at / 1000 >= t_open - 0.05), default=0.0)
    print(f"[{layer['name']} {kind}] {len(frames)} frames every {pace:.0f} ms; up {t_up is not None}, down {t_down is not None}; layers {len(layers)}", flush=True)
    t_click = (rects or {}).get("t_click") or t_close
    regions = region_of(layer, rects or {}, content)
    covered, lag = None, None
    if regions:
        shares = [(at, max(teal_share(frame, one) for one in regions)) for at, frame in frames]
        held = [share for at, share in shares if (t_up or t_open) + 0.3 <= at < t_click]
        covered = max(held, default=None)
        lag = yield_lag(frames, shares, regions, t_open, t_click)
    rafs = [gap for _, gap in gaps if gap > 0]
    return {
        "covered share": covered,
        "lag ms": lag,
        "frame ms": float(numpy.median(rafs)) if rafs else 16.7,
        "capture ms": pace,
        "clicked": (rects or {}).get("clicked"),
        "white cells": whites,
        "cut cells": cut,
        "stale ms": stale,
        "freeze ms": freeze,
        "stale limit": max(LIMITS["stale ms"], 3 * pace),
        "up": t_up is not None,
    }


def region_of(layer: dict[str, Any], rects: dict[str, Any], content: Box) -> list[Box]:
    box = layer.get("box")
    if box == "content":
        return [grown(content, -8)]
    if box == "corners":
        left, top, right, bottom = content
        return [(x, y, x + 24, y + 24) for x in (left + 8, right - 32) for y in (top + 8, bottom - 32)]
    return [grown(tuple(one), -4) for one in rects.get("own", [])[:1] if one[2] - one[0] > 12 and one[3] - one[1] > 12]


def teal_share(frame: numpy.ndarray, box: Box) -> float:
    part = frame[max(0, int(box[1])) : max(0, int(box[3])), max(0, int(box[0])) : max(0, int(box[2]))]
    return float(teal(part).mean()) if part.size else 0.0


def yield_lag(frames: list[tuple[float, numpy.ndarray]], shares: list[tuple[float, float]], regions: list[Box], t_open: float, t_click: float) -> float | None:
    if not frames:
        return None
    first = frames[0][1]
    settled = [share for at, share in shares if at < t_click][-1:]
    if not settled:
        return None
    clean = settled[0] + 0.02
    appear = None
    for (at, frame), (_, share) in zip(frames, shares):
        if at < t_open or at >= t_click:
            continue
        if appear is None:
            moved = max(float(numpy.abs(frame_part(frame, one).astype(numpy.int16) - frame_part(first, one).astype(numpy.int16)).mean()) for one in regions)
            if moved > 8:
                appear = at
        if appear is not None and share <= clean:
            return (at - appear) * 1000
    return None


def frame_part(frame: numpy.ndarray, box: Box) -> numpy.ndarray:
    return frame[max(0, int(box[1])) : max(0, int(box[3])), max(0, int(box[0])) : max(0, int(box[2]))]


def magenta(image: numpy.ndarray) -> numpy.ndarray:
    r, g, b = (image[:, :, k].astype(numpy.int16) for k in range(3))
    return (r - g > 60) & (b - g > 60)


def corner_squares(shot: tuple[Image.Image, float, list[dict[str, Any]]]) -> list[tuple[str, numpy.ndarray]]:
    image, scale, cards = shot
    pixels = numpy.asarray(image.convert("RGB"))
    found = []
    for at, card in enumerate(cards):
        side = max(4, round((card["round"] + 4) * scale))
        x0, y0 = int(card["left"] * scale), int(card["top"] * scale)
        x1, y1 = -int(-card["right"] * scale), -int(-card["bottom"] * scale)
        for name, (x, y) in {"top left": (x0, y0), "top right": (x1 - side, y0), "bottom left": (x0, y1 - side), "bottom right": (x1 - side, y1 - side)}.items():
            part = pixels[max(0, y) : y + side, max(0, x) : x + side]
            found.append((f"pane {at + 1} {name}", part))
    return found


def corner_gap(one: tuple[Image.Image, float, list[dict[str, Any]]], other: tuple[Image.Image, float, list[dict[str, Any]]]) -> tuple[float, float, str, str]:
    worst_share, worst_shade, share_at, shade_at = 0.0, 0.0, "-", "-"
    for (name, a), (_, b) in zip(corner_squares(one), corner_squares(other)):
        if a.shape != b.shape or not a.size:
            continue
        ma, mb = magenta(a), magenta(b)
        share = float((ma != mb).mean())
        both = ma & mb
        shade = float(numpy.abs(a.astype(numpy.int16) - b.astype(numpy.int16))[both].max(axis=1).mean()) if both.any() else 0.0
        if share > worst_share:
            worst_share, share_at = share, name
        if shade > worst_shade:
            worst_shade, shade_at = shade, name
    return worst_share, worst_shade, share_at, shade_at


def edge_profiles(shot: tuple[Image.Image, float, list[dict[str, Any]]]) -> list[tuple[str, numpy.ndarray]]:
    image, scale, cards = shot
    pixels = numpy.asarray(image.convert("RGB")).astype(numpy.int16)
    height, width = pixels.shape[:2]
    out, depth, along = [], round(4 * scale), round(20 * scale)
    reach = round(6 * scale)
    for at, card in enumerate(cards):
        left, right, top, bottom = (round(card[k] * scale) for k in ("left", "right", "top", "bottom"))
        middle_y, middle_x = (top + bottom) // 2, (left + right) // 2
        cuts = {
            "left": pixels[middle_y - along : middle_y + along, max(0, left - reach) : left + depth].mean(axis=0),
            "right": pixels[middle_y - along : middle_y + along, right - depth : min(width, right + reach)].mean(axis=0),
            "bottom": pixels[bottom - depth : min(height, bottom + reach), middle_x - along : middle_x + along].mean(axis=1),
        }
        for name, profile in cuts.items():
            out.append((f"pane {at + 1} {name}", profile))
    return out


def edge_gap(one: tuple[Image.Image, float, list[dict[str, Any]]], other: tuple[Image.Image, float, list[dict[str, Any]]]) -> tuple[float, str]:
    worst, where = 0.0, "-"
    for (name, a), (_, b) in zip(edge_profiles(one), edge_profiles(other)):
        if a.shape != b.shape or not a.size:
            continue
        apart = float(numpy.abs(a - b).max())
        if apart > worst:
            worst, where = apart, name
    return worst, where


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--items", default="1,2,6")
    parser.add_argument("--layers", default="")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    items = set(args.items.split(","))
    drive = Drive(args)
    try:
        drive.start()
        print(f"the engine: {drive.eval('navigator.userAgent')}; pages cut: {drive.eval('orden.pages.cuts')}", flush=True)
        drive.scene()
        if "1" in items:
            drive.layers()
        if "2" in items:
            drive.shapes()
        if "6" in items:
            drive.loading()
    finally:
        drive.stop()
        drive.table()
    wrong = [one for one in drive.rows if not one["ok"]]
    for one in wrong:
        print(f"::error::{one['platform']}: item {one['item']} {one['check']}: web {one['web']}, note {one['note']} {one.get('detail', '')}", flush=True)
    print(f"{len(wrong)} of {len(drive.rows)} checks wrong", flush=True)
    return 1 if wrong or not drive.rows else 0


if __name__ == "__main__":
    raise SystemExit(main())
