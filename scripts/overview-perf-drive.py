from __future__ import annotations
import argparse
import ctypes
import http.server
import importlib
import io
import json
import os
import pathlib
import re
import secrets
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from typing import Any, Callable
import numpy
from PIL import Image
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint
import devtools

drive = importlib.import_module("overview-drive")
ROUNDS = 5
CLICKS = 3
IDLE = 10.0
STEADY = ("hover", "keys", "zoom", "pan")
OPENS = 1800.0
AHEAD = 250.0
DEBUG_PORT = 9339
FRAME = 16.7
LIMITS = {
    "windows-arm64": {
        "open: second Alt keyup to first screen change": 535.0,
        "open: frame gap p95": 70.0,
        "hover: SendInput to screen change": 220.0,
        "click on a card: to screen change": 350.0,
        "keydown: event to next frame": 2 * FRAME,
        "pointerover: event to next frame": 2 * FRAME,
    },
    "windows-x64": {
        "open: second Alt keyup to first screen change": 420.0,
        "open: frame gap p95": 70.0,
        "hover: SendInput to screen change": 150.0,
        "click on a card: to screen change": 215.0,
        "keydown: event to next frame": 2 * FRAME,
        "pointerover: event to next frame": 2 * FRAME,
    },
}
IDLE_CPU = 8.0
BURDEN = """
(ms) => {
  const busy = () => { const until = performance.now() + ms; while (performance.now() < until) {} }
  const frame = () => { if (document.documentElement.hasAttribute('data-overview')) busy(); requestAnimationFrame(frame) }
  requestAnimationFrame(frame)
  for (const kind of ['keydown', 'keyup', 'pointerover']) addEventListener(kind, busy, true)
  return true
}
"""
WORDS = (
    "overview layout frame paint native page tab space window card shot zoom scroll pan close open measure"
    " render style script quiet steady spring motion picture corner shadow border river stone garden"
).split()
SPACES = (("Reading", 3, 1, False), ("Writing", 4, 1, False), ("Research", 6, 4, True))
TRACED = ["devtools.timeline", "blink", "cc", "viz", "gpu", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame"]
if sys.platform == "win32":
    hover = importlib.import_module("hover-drive")
    KEYS = {"Right": 0x27, "Left": 0x25, "Down": 0x28, "Tab": 0x09}
    LINES = (
        "$ids = @(IDS); Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId }"
        " | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"
    )
    COUNTER = (
        "try { Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples SECONDS -ErrorAction SilentlyContinue | ForEach-Object {"
        " $ms = [DateTimeOffset]::new($_.Timestamp).ToUnixTimeMilliseconds();"
        " $lines = foreach ($one in $_.CounterSamples) { if ($one.CookedValue -gt 0) { \"$ms`t$($one.InstanceName)`t$($one.CookedValue)\" } };"
        " if ($lines) { Add-Content -LiteralPath 'PATH' -Value $lines } } } catch { Add-Content -LiteralPath 'PATH' -Value 'none' }"
    )
    def point(x: int, y: int) -> None:
        hover.move(x, y)
    def button(down: bool) -> None:
        hover.u32.mouse_event(0x2 if down else 0x4, 0, 0, 0, 0)
    def key(name: str) -> None:
        hover.u32.keybd_event(KEYS[name], 0, 0, 0)
        time.sleep(0.03)
        hover.u32.keybd_event(KEYS[name], 0, 2, 0)
    def family(root: int) -> set[int]:
        return hover.family(root)
    def spent(pid: int) -> float:
        return hover.spent(pid)
    def lines(pids: set[int]) -> dict[int, tuple[str, str]]:
        names = hover.processes()
        asked = subprocess.run(["powershell", "-NoProfile", "-Command", LINES.replace("IDS", ",".join(map(str, sorted(pids))))], capture_output=True, text=True, timeout=120, check=False)
        said = dict(line.split("\t", 1) for line in asked.stdout.splitlines() if "\t" in line)
        return {pid: (names.get(pid, (0, "?"))[1], said.get(str(pid), "")) for pid in pids}
    def ping(hwnd: int) -> float | None:
        return hover.ping(hwnd)
    def screen() -> tuple[int, int]:
        return hover.WIDE, hover.HIGH
    def filled(desk: Any) -> None:
        hover.u32.ShowWindow(desk.hwnd, 3)
    def handle(desk: Any) -> int:
        return desk.hwnd
    def calm() -> None:
        hover.clear_screen()
    def exes() -> dict[int, str]:
        return {pid: exe for pid, (_, exe) in hover.processes().items()}
    class Mode(ctypes.Structure):
        _fields_ = [
            ("name", ctypes.c_wchar * 32), ("spec", ctypes.c_uint16), ("driver", ctypes.c_uint16), ("size", ctypes.c_uint16),
            ("extra", ctypes.c_uint16), ("fields", ctypes.c_uint32), ("position", ctypes.c_int32 * 2), ("orientation", ctypes.c_uint32),
            ("output", ctypes.c_uint32), ("printing", ctypes.c_int16 * 5), ("form", ctypes.c_wchar * 32), ("pixels", ctypes.c_uint16),
            ("bits", ctypes.c_uint32), ("width", ctypes.c_uint32), ("height", ctypes.c_uint32), ("flags", ctypes.c_uint32),
            ("frequency", ctypes.c_uint32), ("rest", ctypes.c_uint32 * 8),
        ]
    def widened(width: int, height: int) -> str:
        mode = Mode(size=ctypes.sizeof(Mode))
        if not hover.u32.EnumDisplaySettingsW(None, -1, ctypes.byref(mode)):
            return "the display mode could not be read"
        if mode.width >= width and mode.height >= height:
            return f"already {mode.width}x{mode.height}"
        mode.width, mode.height, mode.fields = width, height, 0x80000 | 0x100000
        said = hover.u32.ChangeDisplaySettingsW(ctypes.byref(mode), 0)
        hover.WIDE, hover.HIGH = hover.u32.GetSystemMetrics(0), hover.u32.GetSystemMetrics(1)
        return f"asked {width}x{height}: {said}, now {hover.WIDE}x{hover.HIGH}"
    class Gpu:
        def __init__(self, seconds: float, out: pathlib.Path) -> None:
            self.path = (out / "gpu.tsv").resolve()
            self.path.write_text("", encoding="utf-8")
            asked = COUNTER.replace("SECONDS", str(int(seconds))).replace("PATH", str(self.path))
            self.counter = subprocess.Popen(["powershell", "-NoProfile", "-Command", asked], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def rows(self) -> list[tuple[float, int, str, float]] | None:
            if self.counter.poll() is None:
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.counter.pid)], capture_output=True, check=False)
            self.counter.wait(30)
            out = self.path.read_text(encoding="utf-8-sig", errors="replace")
            found = []
            for line in out.splitlines():
                parts = line.split("\t")
                named = re.search(r"pid_(\d+)_.*engtype_(\w+)", parts[1]) if len(parts) == 3 else None
                if named:
                    found.append((float(parts[0]), int(named.group(1)), named.group(2), float(parts[2])))
            return found or None
elif sys.platform == "darwin":
    import Quartz
    KEYS = {"Right": 124, "Left": 123, "Down": 125, "Tab": 48}
    def where() -> tuple[float, float]:
        at = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
        return at.x, at.y
    def point(x: int, y: int) -> None:
        drive.mouse(Quartz.kCGEventMouseMoved, x, y)
    def button(down: bool) -> None:
        drive.mouse(Quartz.kCGEventLeftMouseDown if down else Quartz.kCGEventLeftMouseUp, *where())
    def key(name: str) -> None:
        for down in (True, False):
            drive.posted(Quartz.CGEventCreateKeyboardEvent(None, KEYS[name], down))
            time.sleep(0.03)
    def table_of(fields: str) -> list[list[str]]:
        said = subprocess.run(["ps", "-A", "-o", fields], capture_output=True, text=True, check=False).stdout
        return [line.split(None, len(fields.split(",")) - 1) for line in said.splitlines() if line.strip()]
    def family(root: int) -> set[int]:
        parents = {int(row[0]): int(row[1]) for row in table_of("pid=,ppid=") if len(row) == 2}
        kept, grew = {root}, True
        while grew:
            grew = False
            for pid, parent in parents.items():
                if pid not in kept and parent in kept:
                    kept.add(pid)
                    grew = True
        return kept
    def spent(pid: int) -> float:
        said = subprocess.run(["ps", "-o", "time=", "-p", str(pid)], capture_output=True, text=True, check=False).stdout.strip()
        total = 0.0
        for part in said.replace("-", ":").split(":"):
            try:
                total = total * 60 + float(part)
            except ValueError:
                return 0.0
        return total
    def lines(pids: set[int]) -> dict[int, tuple[str, str]]:
        found = {}
        for row in table_of("pid=,comm=,args="):
            if len(row) == 3 and int(row[0]) in pids:
                found[int(row[0])] = (pathlib.Path(row[1]).name, row[2])
        return {pid: found.get(pid, ("?", "")) for pid in pids}
    def ping(hwnd: int) -> float | None:
        return None
    def screen() -> tuple[int, int]:
        bounds = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())
        return int(bounds.size.width), int(bounds.size.height)
    def filled(desk: Any) -> None:
        desk.filled()
    def handle(desk: Any) -> int:
        return 0
    def calm() -> None:
        pass
    def exes() -> dict[int, str]:
        return {}
    def widened(width: int, height: int) -> str:
        return "the screen is left as it is"
    class Gpu:  # type: ignore[no-redef]
        def __init__(self, seconds: float, out: pathlib.Path) -> None:
            pass
        def rows(self) -> list[tuple[float, int, str, float]] | None:
            return None
else:
    def point(x: int, y: int) -> None:
        drive.xdo("mousemove", str(x), str(y))
    def button(down: bool) -> None:
        drive.xdo("mousedown" if down else "mouseup", "1")
    def key(name: str) -> None:
        drive.xdo("key", name)
    def stat(pid: int) -> list[str]:
        try:
            return (pathlib.Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            return []
    def family(root: int) -> set[int]:
        parents = {int(one.name): stat(int(one.name)) for one in pathlib.Path("/proc").iterdir() if one.name.isdigit()}
        kept, grew = {root}, True
        while grew:
            grew = False
            for pid, fields in parents.items():
                if pid not in kept and len(fields) > 1 and int(fields[1]) in kept:
                    kept.add(pid)
                    grew = True
        return kept
    def spent(pid: int) -> float:
        fields = stat(pid)
        return (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK") if len(fields) > 12 else 0.0
    def lines(pids: set[int]) -> dict[int, tuple[str, str]]:
        found = {}
        for pid in pids:
            try:
                base = pathlib.Path("/proc") / str(pid)
                found[pid] = ((base / "comm").read_text().strip(), (base / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace"))
            except OSError:
                found[pid] = ("?", "")
        return found
    def ping(hwnd: int) -> float | None:
        return None
    def screen() -> tuple[int, int]:
        said = drive.xdo("getdisplaygeometry").split()
        return (int(said[0]), int(said[1])) if len(said) == 2 else (0, 0)
    def filled(desk: Any) -> None:
        drive.xdo("windowsize", desk.window, "100%", "100%")
    def handle(desk: Any) -> int:
        return 0
    def calm() -> None:
        pass
    def exes() -> dict[int, str]:
        return {}
    def widened(width: int, height: int) -> str:
        return "the screen is left as it is"
    class Gpu:  # type: ignore[no-redef]
        def __init__(self, seconds: float, out: pathlib.Path) -> None:
            pass
        def rows(self) -> list[tuple[float, int, str, float]] | None:
            return None
PROBE = """
(() => {
  if (window.__perf) return true
  const perf = (window.__perf = { on: false, turn: 0, skew: 0, watched: [], missing: [] })
  const KEPT = ['frames', 'keys', 'inputs', 'loaf', 'long', 'events', 'calls', 'invokes']
  const at = (stamp) => performance.timeOrigin + stamp + perf.skew
  const shownNow = () => __SHOWN__
  let holder = null
  const openNow = () => {
    if (!holder || !holder.isConnected)
      holder = document.querySelector("header[data-chrome='top'] :is(button, [role='button'])") || document.querySelector('.canvas [style*="--overview-open"]')
    const value = holder ? holder.style.getPropertyValue('--overview-open') : ''
    return value === '' ? -1 : Number(value)
  }
  const loop = (turn) => (now) => {
    if (!perf.on || perf.turn !== turn) return
    perf.frames.push([at(now), document.documentElement.hasAttribute('data-overview') ? 1 : 0, openNow(), shownNow() ? 1 : 0])
    requestAnimationFrame(loop(turn))
  }
  perf.start = () => {
    perf.skew = 0
    perf.skew = Date.now() - at(performance.now())
    for (const one of KEPT) perf[one] = []
    perf.on = true
    perf.turn++
    requestAnimationFrame(loop(perf.turn))
    return perf.skew
  }
  perf.stop = () => {
    perf.on = false
    const got = { watched: perf.watched, missing: perf.missing }
    for (const one of KEPT) got[one] = perf[one]
    for (const one of KEPT) perf[one] = []
    return got
  }
  for (const type of ['keydown', 'keyup'])
    addEventListener(type, (event) => { if (perf.on) perf.keys.push([type, event.key, at(event.timeStamp), at(performance.now())]) }, { capture: true })
  for (const type of ['pointerover', 'pointerdown', 'click', 'keydown', 'wheel'])
    addEventListener(type, (event) => {
      if (!perf.on) return
      const row = [type, at(event.timeStamp), at(performance.now()), 0, type === 'keydown' ? event.key : '']
      perf.inputs.push(row)
      requestAnimationFrame((now) => (row[3] = at(now)))
    }, { capture: true, passive: true })
  const watch = (type, keep, more) => {
    try {
      new PerformanceObserver((list) => { if (perf.on) for (const one of list.getEntries()) keep(one) }).observe({ type, buffered: false, ...more })
      perf.watched.push(type)
    } catch (error) {
      perf.missing.push(type + ': ' + error)
    }
  }
  const supported = (PerformanceObserver.supportedEntryTypes || [])
  for (const type of ['long-animation-frame', 'longtask', 'event']) if (!supported.includes(type)) perf.missing.push(type + ': not supported')
  watch('long-animation-frame', (one) => perf.loaf.push({
    start: at(one.startTime), duration: one.duration, blocking: one.blockingDuration,
    render: one.renderStart ? at(one.renderStart) : 0, style: one.styleAndLayoutStart ? at(one.styleAndLayoutStart) : 0,
    input: one.firstUIEventTimestamp ? at(one.firstUIEventTimestamp) : 0,
    scripts: (one.scripts || []).map((script) => ({
      url: script.sourceURL, fn: script.sourceFunctionName, char: script.sourceCharPosition, invoker: script.invoker,
      type: script.invokerType, duration: script.duration, forced: script.forcedStyleAndLayoutDuration, pause: script.pauseDuration,
      start: at(script.startTime),
    })),
  }))
  watch('longtask', (one) => perf.long.push([at(one.startTime), one.duration, one.name]))
  watch('event', (one) => perf.events.push({
    name: one.name, start: at(one.startTime), delay: one.processingStart - one.startTime,
    processing: one.processingEnd - one.processingStart, presentation: one.startTime + one.duration - one.processingEnd,
    duration: one.duration, interaction: one.interactionId,
    target: one.target ? one.target.tagName + '.' + String(one.target.className || '').split(' ')[0] : '',
  }), { durationThreshold: 16 })
  const pages = orden.pages
  if (pages && !pages.__perf) {
    for (const name of ['holdStill', 'letGo', 'shoot', 'put', 'photograph']) {
      const was = pages[name]
      if (typeof was !== 'function') {
        perf.missing.push('pages.' + name)
        continue
      }
      pages[name] = function (...args) {
        const row = [name, at(performance.now()), 0, typeof args[0] === 'string' ? args[0] : '']
        const said = was.apply(this, args)
        if (perf.on) perf.calls.push(row)
        if (said && typeof said.then === 'function') said.then(() => (row[2] = at(performance.now())), () => (row[2] = -at(performance.now())))
        else row[2] = at(performance.now())
        return said
      }
    }
    pages.__perf = true
    perf.watched.push('pages')
  }
  try {
    const inner = window.__TAURI_INTERNALS__
    const told = inner && Object.getOwnPropertyDescriptor(inner, 'invoke')
    if (told && (told.writable || told.configurable)) {
      const was = inner.invoke
      const wrapped = function (command, ...rest) {
        const start = at(performance.now())
        const said = was.call(this, command, ...rest)
        if (perf.on && typeof command === 'string' && command.startsWith('web_')) {
          const row = [command, start, 0]
          perf.invokes.push(row)
          Promise.resolve(said).then(() => (row[2] = at(performance.now())), () => (row[2] = -at(performance.now())))
        }
        return said
      }
      if (told.writable) inner.invoke = wrapped
      else Object.defineProperty(inner, 'invoke', { ...told, value: wrapped })
      perf.watched.push('invoke')
    } else perf.missing.push('__TAURI_INTERNALS__.invoke cannot be wrapped')
  } catch (error) {
    perf.missing.push('invoke: ' + error)
  }
  return true
})()
""".replace("__SHOWN__", drive.SHOWN)
NOTE = """
const words = WORDS
const text = (count, seed) => {
  let out = ''
  let k = seed
  for (let i = 0; i < count; i++) {
    k = (k * 1103515245 + 12345) & 0x7fffffff
    out += words[k % words.length] + (i % 14 === 13 ? '. ' : ' ')
  }
  return out.trim()
}
const note = (name, seed) => {
  const parts = ['# ' + name]
  for (let s = 0; s < 12; s++) {
    parts.push('## Part ' + (s + 1), text(220, seed + s))
    for (let i = 0; i < 6; i++) parts.push('- ' + text(10, seed * 7 + s * 11 + i))
    parts.push('```js\\n' + Array.from({ length: 8 }, (_, i) => 'const v' + i + ' = frames.map((one) => one * ' + (i + 1) + ')').join('\\n') + '\\n```')
    parts.push('1. ' + text(12, s) + '\\n2. ' + text(12, s + 1) + '\\n3. ' + text(12, s + 2))
  }
  return parts.join('\\n\\n')
}
""".replace("WORDS", json.dumps(WORDS))
CARDS = """[...document.querySelectorAll('.canvas .window')].map((one) => {
  const box = one.getBoundingClientRect()
  return { name: one.getAttribute('aria-label'), x: box.x, y: box.y, w: box.width, h: box.height }
}).filter((one) => one.w > 8 && one.h > 8 && one.x >= 0 && one.y >= 0 && one.x + one.w <= innerWidth && one.y + one.h <= innerHeight)"""
def heavy_page(number: int, images: int) -> bytes:
    spin = "<div class=spin></div>" if number == 1 else ""
    parts = [
        f"<!doctype html><html><head><meta charset=utf-8><title>Heavy {number}</title><style>"
        "body{font:16px/1.5 Georgia,serif;margin:0 auto;max-width:960px;padding:24px;background:#fbfaf7;color:#222}"
        "img{width:100%;height:auto;display:block;margin:16px 0;border-radius:8px;box-shadow:0 4px 18px #0003}"
        "table{border-collapse:collapse;width:100%}td{border:1px solid #ccc;padding:2px 6px}"
        ".spin{position:fixed;top:12px;right:12px;width:36px;height:36px;border-radius:6px;background:#c33;animation:spin 1.2s linear infinite}"
        f"@keyframes spin{{to{{transform:rotate(360deg)}}}}</style></head><body>{spin}<h1>Heavy page {number}</h1>"
    ]
    for section in range(20):
        words = " ".join(WORDS[(number * 31 + section * 7 + i * 13) % len(WORDS)] for i in range(260))
        cells = "".join("<tr>" + "".join(f"<td>{WORDS[(row + col + section) % len(WORDS)]} {row * col}</td>" for col in range(6)) + "</tr>" for row in range(10))
        parts.append(f"<h2>Section {section + 1}</h2><p>{words}.</p><img src=/img/{(number + section) % images}.jpg alt=''><table>{cells}</table>")
    parts.append("</body></html>")
    return "".join(parts).encode()
def site_of(images: int = 6) -> http.server.ThreadingHTTPServer:
    noise = numpy.random.default_rng(2279)
    pictures = []
    for index in range(images):
        ramp = numpy.linspace(0, 255, 1200, dtype=numpy.float32)[None, :, None]
        made = (ramp * numpy.array([index % 3 == 0, index % 3 == 1, 1.0])[None, None, :] + noise.integers(0, 90, (800, 1200, 3))).clip(0, 255).astype(numpy.uint8)
        kept = io.BytesIO()
        Image.fromarray(made).save(kept, "JPEG", quality=92)
        pictures.append(kept.getvalue())
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_: Any) -> None:
            pass
        def do_GET(self) -> None:  # noqa: N802 - the standard library's name
            asked = self.path.strip("/").split("/")
            if len(asked) == 2 and asked[0] == "img":
                body, kind = pictures[int(asked[1].split(".")[0]) % images], "image/jpeg"
            else:
                body, kind = heavy_page(int(asked[-1]) if asked[-1].isdigit() else 0, images), "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "max-age=3600")
            self.end_headers()
            self.wfile.write(body)
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    return site
def stats(values: list[float]) -> dict[str, Any]:
    kept = sorted(one for one in values if one is not None)
    if not kept:
        return {"n": 0, "median": None, "p95": None, "max": None}
    return {"n": len(kept), "median": round(statistics.median(kept), 1), "p95": round(kept[min(len(kept) - 1, int(len(kept) * 0.95))], 1), "max": round(kept[-1], 1)}
def gaps(frames: list[list[float]], start: float, end: float) -> dict[str, Any]:
    times = [one[0] for one in frames if start <= one[0] <= end]
    steps = [b - a for a, b in zip(times, times[1:])]
    return {**stats(steps), "over_16_7": sum(one > 16.7 for one in steps)}
def first(frames: list[list[float]], start: float, test: Callable[[list[float]], bool]) -> float | None:
    return next((one[0] for one in frames if one[0] >= start and test(one)), None)
def since(later: float | None, earlier: float | None) -> float | None:
    return round(later - earlier, 1) if later is not None and earlier is not None else None
class Band:
    def __init__(self, box: tuple[int, int, int, int]) -> None:
        self.box, self.frames, self.going = box, [], True
        self.film = None if sys.platform == "win32" else drive.Film(box)
        if self.film is None:
            self.grab = hover.Grab(box[2] - box[0], box[3] - box[1])
            self.thread = threading.Thread(target=self.run, daemon=True)
            self.thread.start()
    def run(self) -> None:
        wide, high = self.box[2] - self.box[0], self.box[3] - self.box[1]
        step = 2 if wide * high > 20000 else 1
        while self.going:
            at = time.time() * 1000
            raw = self.grab.at(self.box[0], self.box[1])
            self.frames.append((at, numpy.frombuffer(raw, dtype=numpy.uint8).reshape(high, wide, 4)[::step, ::step, 1].astype(numpy.int16)))
    def stop(self) -> list[tuple[float, numpy.ndarray]]:
        if self.film is not None:
            return [(at, numpy.asarray(one.convert("L"), dtype=numpy.int16)) for at, one in self.film.stop()]
        self.going = False
        self.thread.join()
        return self.frames
def filmed(frames: list[tuple[float, numpy.ndarray]], pressed: float, until: float) -> dict[str, Any]:
    if len(frames) < 3:
        return {"first": None, "settled": None, "frames": len(frames)}
    looks = [(at, one) for at, one in frames if at <= until]
    base = max((index for index, (at, _) in enumerate(looks) if at < pressed), default=0)
    def moved(a: numpy.ndarray, b: numpy.ndarray) -> bool:
        return float((numpy.abs(a - b) > 24).mean()) > 0.003
    after = [index for index in range(base + 1, len(looks))]
    begun = next((index for index in after if moved(looks[base][1], looks[index][1])), None)
    settled = max((index for index in after if moved(looks[index - 1][1], looks[index][1])), default=None)
    every = [b[0] - a[0] for a, b in zip(looks, looks[1:])]
    return {
        "first": since(looks[begun][0], pressed) if begun is not None else None,
        "settled": since(looks[settled][0], pressed) if settled is not None else None,
        "frames": len(looks),
        "capture_ms": round(statistics.median(every), 2) if every else None,
    }
def watched_box(left: float, top: float, width: float, height: float, most: tuple[int, int] = (260, 180)) -> tuple[int, int, int, int]:
    middle = (left + width / 2, top + height / 2)
    wide, high = min(width, most[0]), min(height, most[1])
    return int(middle[0] - wide / 2), int(middle[1] - high / 2), int(middle[0] + wide / 2), int(middle[1] + high / 2)
class Session:
    def __init__(self, app: App, desk: Any, root: int, out: pathlib.Path) -> None:
        self.app, self.desk, self.root, self.out = app, desk, root, out
        self.names: dict[int, tuple[str, str]] = {}
        self.pings: list[tuple[float, float]] = []
        self.pinging = False
    def kinds(self, pids: set[int]) -> dict[int, str]:
        if pids - set(self.names):
            self.names.update(lines(pids - set(self.names)))
        found = {}
        for pid in pids:
            exe, line = self.names.get(pid, ("?", ""))
            typed = re.search(r"--type=([\w-]+)", line)
            if not typed:
                found[pid] = "browser" if exe.lower().startswith("orden") else exe
            elif typed.group(1) == "utility":
                sub = re.search(r"--utility-sub-type=([\w.]+)", line)
                found[pid] = "utility " + (sub.group(1).rsplit(".", 1)[-1] if sub else "")
            else:
                found[pid] = typed.group(1)
        return found
    def sample(self) -> tuple[float, dict[int, float]]:
        return time.perf_counter(), {pid: spent(pid) for pid in family(self.root)}
    def cpu(self, before: tuple[float, dict[int, float]], after: tuple[float, dict[int, float]]) -> dict[str, dict[str, float]]:
        took = after[0] - before[0]
        kinds = self.kinds(set(after[1]))
        found: dict[str, dict[str, float]] = {}
        for pid, now in after[1].items():
            share = (now - before[1].get(pid, 0.0)) / took * 100
            one = found.setdefault(kinds[pid], {"processes": 0, "percent": 0.0, "busiest": 0.0})
            one["processes"] += 1
            one["percent"] = round(one["percent"] + share, 1)
            one["busiest"] = round(max(one["busiest"], share), 1)
        return found
    def ping_on(self) -> threading.Thread | None:
        hwnd = handle(self.desk)
        if not hwnd:
            return None
        self.pinging = True
        def pinging() -> None:
            while self.pinging:
                at = time.time() * 1000
                took = ping(hwnd)
                if took is not None:
                    self.pings.append((at, took))
                time.sleep(0.02)
        thread = threading.Thread(target=pinging, daemon=True)
        thread.start()
        return thread
    def ratio(self) -> float:
        return float(self.app.eval("devicePixelRatio") or 1)
    def scale(self) -> float:
        return 1.0 if sys.platform == "darwin" else self.ratio()
    def on_screen(self, x: float, y: float) -> tuple[int, int]:
        box, scale = self.desk.box(), self.scale()
        return box[0] + round(x * scale), box[1] + round(y * scale)
    def band(self) -> tuple[int, int, int, int]:
        box = self.desk.box()
        pane = self.app.eval(
            "(() => { const ws = orden.workspace; const panes = ws.panes.all.map((one) => document.querySelector(`[data-pane=\"${one.id}\"]`))"
            ".filter(Boolean).map((one) => one.getBoundingClientRect()).sort((a, b) => a.x - b.x || a.y - b.y);"
            " const one = panes[0]; return one ? { x: one.x, y: one.y, w: one.width, h: one.height } : null })()"
        )
        scale = self.scale()
        if isinstance(pane, dict) and pane.get("w", 0) > 40:
            left, right = box[0] + round((pane["x"] + 12) * scale), box[0] + round((pane["x"] + pane["w"] - 12) * scale)
            y = box[1] + round((pane["y"] + pane["h"] * 0.45) * scale)
        else:
            left, right, y = box[0] + (box[2] - box[0]) // 4, box[0] + 3 * (box[2] - box[0]) // 4, (box[1] + box[3]) // 2
        return left, y, min(right, left + 640), y + 8
    def focus_note(self) -> None:
        self.desk.forward()
        spot = self.app.eval(
            "(() => { const ws = orden.workspace; const ones = ws.panes.all.map((one) => [one, document.querySelector(`[data-pane=\"${one.id}\"]`)])"
            ".filter(([, node]) => node).map(([pane, node]) => [pane, node, node.getBoundingClientRect()]).sort((a, b) => a[2].x - b[2].x || a[2].y - b[2].y);"
            " const [pane, , box] = ones[0] || []; if (!pane) return null;"
            " const note = ws.tabsIn(pane.id).find((one) => one.kind === 'note'); if (note && pane.activeTabId !== note.id) ws.activate(note.id);"
            " return { x: box.x + box.width / 2, y: box.y + box.height * 0.7 } })()"
        )
        time.sleep(0.4)
        if isinstance(spot, dict):
            x, y = self.on_screen(spot["x"], spot["y"])
            self.desk.click(x, y)
        time.sleep(0.4)
    def opened(self, pressed: list[tuple[float, str]], up: bool, band: tuple[int, int, int, int]) -> tuple[float, str, dict[str, Any]]:
        film = Band(band)
        time.sleep(0.3)
        pressed.append((self.desk.alt_alt(), "open" if up else "close"))
        how = "keys"
        time.sleep(0.7)
        if self.app.until(f"return ({drive.SHOWN}) === {json.dumps(up)} ? true : null", 2.5) is not True:
            pressed.append((time.time() * 1000, "button"))
            self.app.eval(drive.TOGGLE)
            how = "button"
        at = pressed[-1][0]
        time.sleep(max(0.0, (at + OPENS) / 1000 - time.time()))
        return at, how, filmed(film.stop(), at, at + OPENS)
    def hovered(self, card: dict[str, float], cards: list[dict[str, float]]) -> dict[str, Any]:
        scale, box = self.scale(), self.desk.box()
        rest = self.on_screen(4, 4 + float(self.app.eval("document.querySelector('header[data-chrome=\"top\"]')?.getBoundingClientRect().bottom ?? 40") or 40))
        point(*rest)
        time.sleep(0.4)
        left, top = box[0] + card["x"] * scale, box[1] + card["y"] * scale
        watched = watched_box(left, top, card["w"] * scale, card["h"] * scale)
        film = Band(watched)
        time.sleep(0.25)
        at = time.time() * 1000
        point((watched[0] + watched[2]) // 2, (watched[1] + watched[3]) // 2)
        time.sleep(0.9)
        return {"name": card["name"], "at": at, **filmed(film.stop(), at, at + 900)}
    def round_of(self, number: int, band: tuple[int, int, int, int]) -> dict[str, Any]:
        self.focus_note()
        self.app.eval("window.__perf.start()")
        time.sleep(0.4)
        thread = self.ping_on()
        before = self.sample()
        pressed: list[tuple[float, str]] = []
        open_at, open_how, open_film = self.opened(pressed, True, band)
        phases: dict[str, list[float]] = {"open": [open_at - AHEAD, open_at + OPENS]}
        cards = self.app.eval(CARDS)
        cards = cards if isinstance(cards, list) else []
        start = time.time() * 1000
        active = self.app.eval("(() => { const one = orden.workspace.tabs.find((tab) => tab.id === orden.workspace.activeTabId); return one ? one.shown : null })()")
        hovers = [self.hovered(one, cards) for one in [card for card in cards if card["name"] != active][:3]]
        phases["hover"] = [start, time.time() * 1000]
        start = time.time() * 1000
        for name in ("Right", "Left", "Tab"):
            key(name)
            time.sleep(0.45)
        phases["keys"] = [start, time.time() * 1000]
        box = self.desk.box()
        middle = ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)
        start = time.time() * 1000
        for notches in (1, 1, 1, -1, -1, -1):
            drive.Desk.wheel(*middle, notches)
            time.sleep(0.35)
        time.sleep(0.8)
        phases["zoom"] = [start, time.time() * 1000]
        scale = self.scale()
        bar = float(self.app.eval("document.querySelector('header[data-chrome=\"top\"]')?.getBoundingClientRect().bottom ?? 0") or 0)
        floor = (box[0] + round(28 * scale), round(box[1] + (bar + 160) * scale))
        start = time.time() * 1000
        drive.Desk.drag(floor, (floor[0], floor[1] - round(320 * scale)), [])
        time.sleep(0.6)
        phases["pan"] = [start, time.time() * 1000]
        close_at, close_how, close_film = self.opened(pressed, False, band)
        phases["close"] = [close_at - AHEAD, close_at + OPENS]
        after = self.sample()
        self.pinging = False
        if thread:
            thread.join()
        page = self.app.eval("window.__perf.stop()", 60)
        page = page if isinstance(page, dict) else {"error": page}
        return {
            "round": number, "how": f"{open_how} {close_how}", "phases": phases, "pressed": {"open": open_at, "close": close_at}, "cards": len(cards),
            "open_film": open_film, "close_film": close_film, "hovers": hovers, "cpu": self.cpu(before, after),
            "pings": [one for one in self.pings if phases["open"][0] <= one[0] <= phases["close"][1]], "page": page,
        }
    def clicked(self, number: int, band: tuple[int, int, int, int]) -> dict[str, Any]:
        self.focus_note()
        self.app.eval("window.__perf.start()")
        time.sleep(0.4)
        pressed: list[tuple[float, str]] = []
        open_at, how, _ = self.opened(pressed, True, band)
        chosen = self.app.eval(
            "(() => { const ws = orden.workspace; const active = ws.tabs.find((tab) => tab.id === ws.activeTabId);"
            " const one = active && ws.tabsIn(active.paneId).find((tab) => tab.id !== active.id && tab.kind === 'note'); return one ? one.shown : null })()"
        )
        cards = self.app.eval(CARDS)
        card = next((one for one in cards if one["name"] == chosen), None) if isinstance(cards, list) else None
        if not card:
            drive.toggled(self.app, self.desk, False, pressed)
            time.sleep(1.5)
            self.app.eval("window.__perf.stop()")
            return {"round": number, "error": f"no card to click for {chosen}"}
        scale, box = self.scale(), self.desk.box()
        x, y = box[0] + round((card["x"] + card["w"] / 2) * scale), box[1] + round((card["y"] + card["h"] / 2) * scale)
        point(x, y)
        time.sleep(0.5)
        film = Band(band)
        time.sleep(0.25)
        button(True)
        time.sleep(0.05)
        button(False)
        at = time.time() * 1000
        time.sleep(OPENS / 1000)
        seen = filmed(film.stop(), at, at + OPENS)
        page = self.app.eval("window.__perf.stop()", 60)
        shut = self.app.eval(drive.SHOWN)
        if shut is True:
            drive.toggled(self.app, self.desk, False, [])
            time.sleep(1.5)
        return {"round": number, "how": how, "card": chosen, "at": at, "film": seen, "closed": shut is False, "page": page if isinstance(page, dict) else {"error": page}}
    def idle(self) -> dict[str, Any]:
        box = self.desk.box()
        point(box[2] - 4, box[3] - 4)
        time.sleep(2)
        before = self.sample()
        start = time.time() * 1000
        time.sleep(IDLE)
        return {"cpu": self.cpu(before, self.sample()), "window": [start, time.time() * 1000]}
    def traced(self) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json/version", timeout=3) as said:
                browser = json.loads(said.read())["webSocketDebuggerUrl"]
        except (OSError, ValueError, KeyError) as error:
            return {"recorded": False, "why": f"no DevTools protocol on port {DEBUG_PORT} ({error}); a release build reads ORDEN_CEF_DEBUG_PORT only with debug assertions"}
        session = devtools.Session({"webSocketDebuggerUrl": browser})
        try:
            started = session.call("Tracing.start", {"traceConfig": {"includedCategories": TRACED}, "transferMode": "ReportEvents"})
            if "error" in started:
                return {"recorded": False, "why": str(started)}
            self.focus_note()
            band = self.band()
            self.opened([], True, band)
            self.opened([], False, band)
            session.call("Tracing.end")
            until = time.monotonic() + 120
            while time.monotonic() < until and not any(one.get("method") == "Tracing.tracingComplete" for one in session.events):
                session.listen(2)
            events = [event for one in session.events if one.get("method") == "Tracing.dataCollected" for event in one["params"]["value"]]
            (self.out / "trace.json").write_text(json.dumps({"traceEvents": events}), encoding="utf-8")
            return {"recorded": True, "events": len(events)}
        finally:
            session.close()
def built(app: App, url: str) -> dict[str, Any]:
    app.eval(
        "for (const one of document.querySelectorAll('button'))"
        " if (one.textContent.trim() === 'Keep running') one.click();"
        " for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false); return true"
    )
    time.sleep(1)
    for name, notes, webs, split in SPACES:
        app.eval(f"void orden.workspace.addSpace({json.dumps(name)}); return true")
        if app.until(f"return orden.workspace.activeSpace && orden.workspace.activeSpace.name === {json.dumps(name)} ? true : null", 30) is not True:
            raise SystemExit(f"the space {name} never came up")
        time.sleep(1)
        seed = len(name) * 97
        app.eval(NOTE + f"for (let i = 0; i < {notes}; i++) orden.workspace.openBlank({json.dumps(name)} + ' ' + (i + 1), note({json.dumps(name)} + ' ' + (i + 1), {seed} + i * 13)); return true")
        time.sleep(1)
        for page in range(webs):
            app.eval(f"orden.workspace.openPage({json.dumps(f'{url}page/{seed % 7 + page + 1}')}); return true")
            time.sleep(1.5)
        if split and sys.platform == "win32":
            app.eval(
                "const ws = orden.workspace; const root = ws.activeSpace ? ws.activeSpace.root : null;"
                " ws.openUnsaved('terminal', JSON.stringify({ shell: 'cmd', folder: root, key: 'perf-cmd' }), 'Terminal'); return true"
            )
            time.sleep(2)
        if split:
            said = app.eval(
                "const ws = orden.workspace; const space = ws.activeSpaceId;"
                " const mine = ws.tabs.filter((one) => ws.spaceOf(one.note) === space);"
                " const notes = mine.filter((one) => one.kind === 'note'); const webs = mine.filter((one) => one.kind === 'web');"
                " const others = mine.filter((one) => one.kind !== 'note' && one.kind !== 'web');"
                " const fresh = (before) => (ws.panes.all.find((one) => !before.has(one.id)) || {}).id;"
                " let before = new Set(ws.panes.all.map((one) => one.id)); ws.split('row', notes[0].id); const second = fresh(before);"
                " for (const one of [webs[0], webs[1], notes[1]].filter(Boolean)) ws.moveTab(one.id, second, ws.tabsIn(second).length);"
                " before = new Set(ws.panes.all.map((one) => one.id)); ws.split('column', notes[2].id); const third = fresh(before);"
                " for (const one of [webs[2], notes[3], ...others].filter(Boolean)) ws.moveTab(one.id, third, ws.tabsIn(third).length);"
                " ws.activate(webs[0].id); return ws.panes.all.length"
            )
            print(f"panes in {name}: {said}", flush=True)
        time.sleep(2)
    app.until("return orden.pages.each().some(([, page]) => page.sent && page.sent.visible && page.live) ? true : null", 60)
    time.sleep(6)
    return app.eval(
        "(() => { const ws = orden.workspace; return { spaces: ws.spaces.length, tabs: ws.tabs.length,"
        " kinds: ws.tabs.reduce((all, one) => ({ ...all, [one.kind]: (all[one.kind] || 0) + 1 }), {}),"
        " panes: ws.panes.all.length, live: orden.pages.each().filter(([, page]) => page.live).length } })()"
    )
def in_window(rows: list[Any], start: float, end: float, at: Callable[[Any], float]) -> list[Any]:
    return [one for one in rows if start <= at(one) <= end]
def phase_of(phases: dict[str, list[float]], at: float) -> str:
    for name, (start, end) in phases.items():
        if start <= at <= end:
            return name
    return "between"
def looked_at(rounds: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {"rounds": []}
    for one in rounds:
        page, phases = one["page"], one["phases"]
        frames = page.get("frames") or []
        open_at, close_at = one["pressed"]["open"], one["pressed"]["close"]
        alts = [row for row in page.get("keys") or [] if row[1] == "Alt" and row[0] == "keydown" and open_at - 1000 <= row[2] <= open_at + 50]
        down = alts[-1][2] if alts else None
        shown = first(frames, open_at - 300, lambda row: row[3] == 1)
        begun = first(frames, open_at - 300, lambda row: row[1] == 1)
        moved = first(frames, open_at - 300, lambda row: row[2] > 0)
        full = first(frames, open_at - 300, lambda row: row[2] >= 0.999)
        closing = [row for row in page.get("keys") or [] if row[1] == "Alt" and row[0] == "keydown" and open_at + 50 < row[2] <= close_at + 50]
        close_down = closing[-1][2] if closing else None
        gone = first(frames, close_at - 300, lambda row: row[1] == 0)
        calls = page.get("calls") or []
        held = [row for row in calls if row[0] == "holdStill" and open_at - 300 <= row[1] <= open_at + OPENS]
        per_phase: dict[str, dict[str, Any]] = {}
        for name, (start, end) in phases.items():
            mine = in_window(calls, start, end, lambda row: row[1])
            invokes = in_window(page.get("invokes") or [], start, end, lambda row: row[1])
            loafs = in_window(page.get("loaf") or [], start, end, lambda row: row["start"])
            per_phase[name] = {
                "frames": gaps(frames, start, end),
                "calls": {kind: stats([abs(row[2]) - row[1] for row in mine if row[0] == kind and row[2]]) for kind in sorted({row[0] for row in mine})},
                "invokes": {kind: stats([abs(row[2]) - row[1] for row in invokes if row[0] == kind and row[2]]) for kind in sorted({row[0] for row in invokes})},
                "loaf": {"count": len(loafs), "total_ms": round(sum(row["duration"] for row in loafs), 1), "blocking_ms": round(sum(row["blocking"] for row in loafs), 1)},
                "long_tasks": len(in_window(page.get("long") or [], start, end, lambda row: row[0])),
                "ping": stats([took for at, took in one["pings"] if start <= at <= end]),
            }
        inputs = [row for row in page.get("inputs") or [] if phase_of(phases, row[1]) in STEADY]
        out["rounds"].append({
            "round": one["round"], "how": one["how"], "cards": one["cards"],
            "open": {
                "first_screen_ms": one["open_film"]["first"], "settled_screen_ms": one["open_film"]["settled"], "capture_ms": one["open_film"].get("capture_ms"),
                "keydown_to_overview_frame_ms": since(begun, down), "keydown_to_open_1_ms": since(full, down),
                "keyup_to_overview_frame_ms": since(begun, open_at), "enter_to_first_move_ms": since(moved, shown),
                "enter_to_begin_ms": since(begun, shown), "hold_still_ms": since(abs(held[0][2]) if held and held[0][2] else None, held[0][1] if held else None),
                "keydown_seen": down is not None,
            },
            "close": {
                "first_screen_ms": one["close_film"]["first"], "settled_screen_ms": one["close_film"]["settled"],
                "keydown_to_gone_ms": since(gone, close_down), "keyup_to_gone_ms": since(gone, close_at),
            },
            "phases": per_phase,
            "hover_screen_ms": [row["first"] for row in one["hovers"]],
            "inputs": {kind: {"delay": stats([row[2] - row[1] for row in inputs if row[0] == kind]), "to_frame": stats([row[3] - row[1] for row in inputs if row[0] == kind and row[3]])} for kind in sorted({row[0] for row in inputs})},
            "events": [{**row, "phase": phase_of(phases, row["start"])} for row in page.get("events") or []],
            "frames": frames,
            "cpu": one["cpu"], "missing": page.get("missing"), "watched": page.get("watched"),
        })
    return out
def summary(looked: dict[str, Any], clicks: list[dict[str, Any]]) -> dict[str, Any]:
    rounds = looked["rounds"]
    warm = rounds[1:] or rounds
    def row(pick: Callable[[dict[str, Any]], Any]) -> dict[str, Any]:
        cold = pick(rounds[0]) if rounds else None
        values = [pick(one) for one in warm]
        values = [one for one in values if one is not None]
        return {"cold": cold, "median": round(statistics.median(values), 1) if values else None, "max": round(max(values), 1) if values else None}
    said: dict[str, Any] = {
        "open: second Alt keyup to first screen change": row(lambda one: one["open"]["first_screen_ms"]),
        "open: second Alt keyup to last settled frame": row(lambda one: one["open"]["settled_screen_ms"]),
        "open: Alt keydown to first frame with data-overview": row(lambda one: one["open"]["keydown_to_overview_frame_ms"]),
        "open: Alt keydown to --overview-open 1": row(lambda one: one["open"]["keydown_to_open_1_ms"]),
        "open: overview entered to first move": row(lambda one: one["open"]["enter_to_first_move_ms"]),
        "open: holdStill resolved": row(lambda one: one["open"]["hold_still_ms"]),
        "close: second Alt keyup to first screen change": row(lambda one: one["close"]["first_screen_ms"]),
        "close: second Alt keyup to last settled frame": row(lambda one: one["close"]["settled_screen_ms"]),
        "close: Alt keydown to overview gone": row(lambda one: one["close"]["keydown_to_gone_ms"]),
    }
    for phase in ("open", "hover", "keys", "zoom", "pan", "close"):
        said[f"{phase}: frame gap median"] = row(lambda one, p=phase: one["phases"][p]["frames"]["median"])
        said[f"{phase}: frame gap p95"] = row(lambda one, p=phase: one["phases"][p]["frames"]["p95"])
        said[f"{phase}: frame gap max"] = row(lambda one, p=phase: one["phases"][p]["frames"]["max"])
        said[f"{phase}: frames over 16.7 ms"] = row(lambda one, p=phase: one["phases"][p]["frames"]["over_16_7"])
        said[f"{phase}: long animation frames total ms"] = row(lambda one, p=phase: one["phases"][p]["loaf"]["total_ms"])
        said[f"{phase}: window thread ping p95"] = row(lambda one, p=phase: one["phases"][p]["ping"]["p95"])
    for phase in ("open", "zoom", "pan", "close"):
        said[f"{phase}: shoot calls"] = row(lambda one, p=phase: one["phases"][p]["calls"].get("shoot", {}).get("n", 0))
        said[f"{phase}: web_shot calls"] = row(lambda one, p=phase: one["phases"][p]["calls"].get("photograph", {}).get("n", 0))
        said[f"{phase}: web_shot median ms"] = row(lambda one, p=phase: one["phases"][p]["calls"].get("photograph", {}).get("median"))
        said[f"{phase}: page put calls"] = row(lambda one, p=phase: one["phases"][p]["calls"].get("put", {}).get("n", 0))
    said["hover: SendInput to screen change"] = row(lambda one: statistics.median([v for v in one["hover_screen_ms"] if v is not None]) if any(v is not None for v in one["hover_screen_ms"]) else None)
    for kind in ("pointerover", "keydown", "wheel", "pointerdown"):
        said[f"{kind}: event to next frame"] = row(lambda one, k=kind: one["inputs"].get(k, {}).get("to_frame", {}).get("median"))
        said[f"{kind}: input delay"] = row(lambda one, k=kind: one["inputs"].get(k, {}).get("delay", {}).get("median"))
    for kind in ("pointerover", "click", "keydown", "pointerdown"):
        said[f"{kind}: longest Event Timing duration (0 when none reached 16 ms)"] = row(lambda one, k=kind: max((e["duration"] for e in one["events"] if e["name"] == k and e["phase"] in STEADY), default=0))
    for kind in ("pointerdown", "click"):
        reached = [row[3] - row[1] for one in clicks for row in (one.get("page") or {}).get("inputs") or [] if row[0] == kind and row[3]]
        said[f"click on a card: {kind} to next frame"] = {"cold": round(reached[0], 1) if reached else None, "median": round(statistics.median(reached[1:] or reached), 1) if reached else None, "max": round(max(reached[1:] or reached), 1) if reached else None}
    seen = [one["film"]["first"] for one in clicks if one.get("film") and one["film"]["first"] is not None]
    said["click on a card: to screen change"] = {"cold": seen[0] if seen else None, "median": round(statistics.median(seen[1:] or seen), 1) if seen else None, "max": round(max(seen[1:] or seen), 1) if seen else None}
    return said
def loafs(rounds: list[dict[str, Any]], clicks: list[dict[str, Any]]) -> dict[str, Any]:
    every = []
    for one in rounds:
        for row in one["page"].get("loaf") or []:
            every.append({**row, "phase": phase_of(one["phases"], row["start"]), "round": one["round"]})
    for one in clicks:
        for row in (one.get("page") or {}).get("loaf") or []:
            every.append({**row, "phase": "click", "round": one["round"]})
    def short(script: dict[str, Any]) -> str:
        where = (script.get("url") or "").rsplit("/", 1)[-1]
        return f"{script.get('fn') or '(anonymous)'} @ {where}:{script.get('char')} [{script.get('type')} {script.get('invoker') or ''}]".strip()
    top = []
    for row in sorted(every, key=lambda one: -one["duration"])[:10]:
        scripts = sorted(row["scripts"], key=lambda one: -(one.get("duration") or 0))
        end = row["start"] + row["duration"]
        top.append({
            "phase": row["phase"], "round": row["round"], "duration": round(row["duration"], 1), "blocking": round(row["blocking"], 1),
            "style_layout_ms": round(end - row["style"], 1) if row["style"] else None,
            "render_ms": round(end - row["render"], 1) if row["render"] else None,
            "scripts_ms": round(sum(one.get("duration") or 0 for one in scripts), 1),
            "forced_ms": round(sum(one.get("forced") or 0 for one in scripts), 1),
            "top_script": short(scripts[0]) if scripts else None,
        })
    by_script: dict[str, dict[str, float]] = {}
    for row in every:
        for script in row["scripts"]:
            kept = by_script.setdefault(short(script), {"count": 0, "ms": 0.0, "forced_ms": 0.0})
            kept["count"] += 1
            kept["ms"] = round(kept["ms"] + (script.get("duration") or 0), 1)
            kept["forced_ms"] = round(kept["forced_ms"] + (script.get("forced") or 0), 1)
    style = round(sum((row["start"] + row["duration"] - row["style"]) for row in every if row["style"]), 1)
    return {"count": len(every), "style_layout_ms": style, "top": top, "scripts": sorted(([name, *kept.values()] for name, kept in by_script.items()), key=lambda one: -one[2])[:15]}
def gpu_of(rows: list[tuple[float, int, str, float]] | None, kinds: dict[int, str], windows: dict[str, list[list[float]]], exes: dict[int, str]) -> dict[str, Any]:
    if rows is None:
        return {"available": False, "why": "no GPU Engine counter samples came on this runner"}
    found: dict[str, dict[str, float]] = {}
    for name, spans in windows.items():
        inside = [row for row in rows if any(start <= row[0] <= end for start, end in spans)]
        samples = sorted({row[0] for row in inside})
        busiest: dict[tuple[float, str], float] = {}
        for at, pid, engine, value in inside:
            label = f"{kinds.get(pid) or exes.get(pid) or 'pid ' + str(pid)} {engine}"
            busiest[(at, label)] = max(busiest.get((at, label), 0.0), value)
        for (at, label), value in busiest.items():
            found.setdefault(label, {}).setdefault(name, 0.0)
            found[label][name] = round(found[label][name] + value / max(len(samples), 1), 1)
    return {"available": True, "percent": found}
def shown(value: Any) -> str:
    return "n/a" if value is None else str(value)
def table(said: dict[str, Any]) -> str:
    out = []
    for name, one in said["passes"].items():
        meta = one.get("meta", {})
        out.append(f"\n### {name}: {meta.get('window')} px window, devicePixelRatio {meta.get('ratio')}, screen {meta.get('screen')}\n")
        out.append("| measure (ms unless counted) | cold round | median of warm rounds | max of warm rounds |")
        out.append("| --- | --- | --- | --- |")
        for metric, values in one["summary"].items():
            out.append(f"| {metric} | {shown(values['cold'])} | {shown(values['median'])} | {shown(values['max'])} |")
    out.append("\n### CPU (% of one core)\n")
    out.append("| process | idle | open to close (median of warm rounds) | busiest single process |")
    out.append("| --- | --- | --- | --- |")
    for kind, row in said["cpu"].items():
        out.append(f"| {kind} | {shown(row.get('idle'))} | {shown(row.get('open_close'))} | {shown(row.get('busiest'))} |")
    gpu = said["gpu"]
    out.append("\n### GPU\n")
    if gpu.get("available"):
        out.append("| process and engine | idle % | open to close % |")
        out.append("| --- | --- | --- |")
        for label, row in gpu["percent"].items():
            out.append(f"| {label} | {row.get('idle', 0.0)} | {row.get('rounds', 0.0)} |")
    else:
        out.append(f"n/a: {gpu.get('why')}")
    out.append("\n### Longest animation frames\n")
    out.append("| phase | ms | blocking | style and layout | scripts | forced layout | top script |")
    out.append("| --- | --- | --- | --- | --- | --- | --- |")
    for row in said["loaf"]["top"]:
        out.append(f"| {row['phase']} {row['round']} | {row['duration']} | {row['blocking']} | {row['style_layout_ms']} | {row['scripts_ms']} | {row['forced_ms']} | {row['top_script']} |")
    out.append("\n| script | count | ms | forced layout ms |")
    out.append("| --- | --- | --- | --- |")
    for name, count, ms, forced in said["loaf"]["scripts"]:
        out.append(f"| {name} | {count} | {ms} | {forced} |")
    out.append("\n### Not measured\n")
    for one in said["not_measured"]:
        out.append(f"- {one}")
    return "\n".join(out)
def label() -> str:
    if sys.platform == "darwin":
        return "macos-arm64"
    import platform
    return "windows-arm64" if platform.machine().lower() in ("arm64", "aarch64") else "windows-x64"
def held(said: dict[str, Any], limits: dict[str, float]) -> list[str]:
    wrong = []
    one = said["passes"].get("window", {}).get("summary", {})
    for row, most in limits.items():
        seen = one.get(row, {}).get("median")
        if seen is None or seen > most:
            wrong.append(f"{row}: {seen} ms, over {most:.0f} ms")
    idle = round(sum(row["percent"] for row in said["rest"]["cpu"].values()), 1)
    if idle > IDLE_CPU:
        wrong.append(f"idle CPU after the rounds {idle}% of a core, over {IDLE_CPU}%")
    return wrong
def judged(said: dict[str, Any], args: argparse.Namespace) -> list[str]:
    wrong = []
    one = said["passes"].get("window", {}).get("summary", {})
    opened = one.get("open: second Alt keyup to first screen change", {}).get("median")
    if opened is None or opened > args.first_frame_ms:
        wrong.append(f"opening shows its first frame after {opened} ms, over {args.first_frame_ms} ms")
    for phase in ("open", "hover", "keys", "zoom", "pan", "close"):
        p95 = one.get(f"{phase}: frame gap p95", {}).get("median")
        if p95 is None or p95 > args.frame_ms + 1:
            wrong.append(f"{phase}: frames take {p95} ms (p95), over {args.frame_ms} ms")
    for kind in ("pointerover", "keydown"):
        reached = one.get(f"{kind}: event to next frame", {}).get("median")
        if reached is None or reached > args.input_frames * (args.frame_ms + 1):
            wrong.append(f"{kind} reaches a frame after {reached} ms, over {args.input_frames} frame")
    return wrong
def passed(session: Session, name: str, gpu_spans: dict[str, list[list[float]]]) -> dict[str, Any]:
    band = session.band()
    box = session.desk.box()
    meta = {"window": f"{box[2] - box[0]}x{box[3] - box[1]}", "ratio": session.ratio(), "screen": "x".join(map(str, screen())), "band": band}
    print(f"[{name}] {meta}", flush=True)
    rounds = []
    for number in range(1, ROUNDS + 1):
        one = session.round_of(number, band)
        gpu_spans["rounds"].append([one["phases"]["open"][0], one["phases"]["close"][1]])
        print(f"[{name}] round {number}: {one['how']}, {one['cards']} cards, open {one['open_film']}, close {one['close_film']}", flush=True)
        rounds.append(one)
    clicks = [session.clicked(number, band) for number in range(1, CLICKS + 1)]
    for one in clicks:
        print(f"[{name}] click {one['round']}: {one.get('card')} {one.get('film') or one.get('error')}", flush=True)
    looked = looked_at(rounds)
    return {"meta": meta, "summary": summary(looked, clicks), "rounds": looked["rounds"], "clicks": [{key: value for key, value in one.items() if key != "page"} for one in clicks], "raw": rounds, "raw_clicks": clicks}
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", default=pathlib.Path("out"), type=pathlib.Path)
    parser.add_argument("--first-frame-ms", default=150.0, type=float)
    parser.add_argument("--frame-ms", default=16.0, type=float)
    parser.add_argument("--input-frames", default=1.0, type=float)
    parser.add_argument("--report-only", action="store_true")
    parser.add_argument("--limits", action="store_true", help="fail past this platform's limits in LIMITS; a platform without them only reports")
    parser.add_argument("--burden", type=float, default=0.0, help="busy the page this many ms on every overview frame and key, to prove the limits fail")
    args = parser.parse_args()
    if "probe" not in args.identifier and os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    calm()
    said_screen = widened(1920, 1080)
    print(f"screen: {said_screen}", flush=True)
    time.sleep(5)
    site = site_of()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-overview-perf-"))
    drive.Desk.moving()
    log = open(args.out / "app.log", "wb")
    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces), "ORDEN_CEF_DEBUG_PORT": str(DEBUG_PORT)}
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
    desk = drive.Desk(process.pid)
    said: dict[str, Any] = {"exe": str(args.exe), "screen": said_screen, "passes": {}, "not_measured": []}
    try:
        app = endpoint(config, process.pid, secret, 30)
        desk.app = app
        if app.until("return orden.workspace ? true : null", 90) is not True:
            raise SystemExit("the app's interface never came up")
        until = time.monotonic() + 60
        while time.monotonic() < until and not desk.found():
            time.sleep(0.25)
        if not desk.found():
            raise SystemExit("the app put up no window")
        desk.placed()
        desk.forward()
        time.sleep(3)
        said["engine"] = app.eval("navigator.userAgent")
        said["content"] = built(app, url)
        print(f"content: {said['content']}", flush=True)
        if app.eval(PROBE) is not True:
            raise SystemExit("the page probe was not put in")
        if args.burden:
            app.eval(f"return ({BURDEN.strip()})({args.burden})")
        session = Session(app, desk, process.pid, args.out)
        gpu = Gpu(1800, args.out)
        time.sleep(3)
        said["idle"] = session.idle()
        spans: dict[str, list[list[float]]] = {"idle": [said["idle"]["window"]], "rounds": []}
        said["passes"]["window"] = passed(session, "window", spans)
        filled(desk)
        time.sleep(3)
        said["passes"]["full screen"] = passed(session, "full screen", spans)
        said["trace"] = session.traced()
        time.sleep(5)
        said["rest"] = session.idle()
        kinds = session.kinds(family(process.pid) | set(session.names))
        said["gpu"] = gpu_of(gpu.rows(), kinds, spans, exes())
    finally:
        ended(process)
        log.close()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    cpu: dict[str, dict[str, Any]] = {}
    for kind, row in said["idle"]["cpu"].items():
        cpu.setdefault(kind, {})["idle"] = row["percent"]
    warm = said["passes"]["window"]["rounds"][1:]
    for kind in sorted({kind for one in warm for kind in one["cpu"]}):
        values = [one["cpu"][kind]["percent"] for one in warm if kind in one["cpu"]]
        cpu.setdefault(kind, {})["open_close"] = round(statistics.median(values), 1)
        cpu[kind]["busiest"] = max(one["cpu"][kind]["busiest"] for one in warm if kind in one["cpu"])
    said["cpu"] = cpu
    rounds = said["passes"]["window"]["raw"] + said["passes"]["full screen"]["raw"]
    clicks = said["passes"]["window"]["raw_clicks"] + said["passes"]["full screen"]["raw_clicks"]
    said["loaf"] = loafs(rounds, clicks)
    missing = sorted({one for row in said["passes"]["window"]["rounds"] for one in row["missing"] or []})
    said["not_measured"] = [*missing]
    if not said["trace"].get("recorded"):
        said["not_measured"].append(f"Tracing: {said['trace'].get('why')}")
    if not said["gpu"].get("available"):
        said["not_measured"].append(f"GPU: {said['gpu'].get('why')}")
    if said["passes"]["window"]["meta"]["ratio"] == 1:
        said["not_measured"].append("high DPI: the runner's screen runs at devicePixelRatio 1")
    if said["passes"]["window"]["meta"]["window"] == said["passes"]["full screen"]["meta"]["window"]:
        said["not_measured"].append("a 1280x800 window apart from full screen: the runner's screen is no larger than that window")
    if not any(row["open"]["keydown_seen"] for row in said["passes"]["window"]["rounds"]):
        said["not_measured"].append("Alt keydown in the page: no Alt keydown reached the page, so the in-page times start at keyup")
    for one in said["passes"].values():
        one.pop("raw", None)
        one.pop("raw_clicks", None)
    (args.out / "perf.json").write_text(json.dumps(said, indent=1), encoding="utf-8")
    (args.out / "loaf.json").write_text(json.dumps([row["page"].get("loaf") for row in rounds], indent=1), encoding="utf-8")
    (args.out / "raw.json").write_text(json.dumps([row["page"] for row in rounds]), encoding="utf-8")
    written = table(said)
    (args.out / "table.md").write_text(written, encoding="utf-8")
    print(written, flush=True)
    if args.limits:
        limits = LIMITS.get(label())
        if limits is None:
            print(f"{label()}: no limits, reported only", flush=True)
            return 0
        wrong = held(said, limits)
        for one in wrong:
            print(f"::error::{label()}: {one}", flush=True)
        print(f"{label()}: {'within' if not wrong else 'past'} its limits", flush=True)
        return 1 if wrong else 0
    wrong = judged(said, args)
    for one in wrong:
        print(f"::{'warning' if args.report_only else 'error'}::{one}", flush=True)
    return 0 if args.report_only or not wrong else 1
if __name__ == "__main__":
    raise SystemExit(main())
