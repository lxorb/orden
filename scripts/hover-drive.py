from __future__ import annotations
import argparse
import ctypes
import json
import os
import pathlib
import secrets
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import wintypes as W
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint
IDLE_CPU = 8.0
HOVER_FRAMES = 8.0
EVENT_FRAMES = 2.0
PING_FRAMES = 1.0
SETTLE = 20.0
IDLE = 20.0
WIGGLE = 10.0
COLS, ROWS = 9, 7
OOBE = {"wwahost.exe", "useroobebroker.exe"}
u32 = ctypes.WinDLL("user32", use_last_error=True)
g32 = ctypes.WinDLL("gdi32")
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
class Entry(ctypes.Structure):
    _fields_ = [
        ("dwSize", W.DWORD), ("cntUsage", W.DWORD), ("th32ProcessID", W.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", W.DWORD), ("cntThreads", W.DWORD),
        ("th32ParentProcessID", W.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", W.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]
class Header(ctypes.Structure):
    _fields_ = [
        ("biSize", W.DWORD), ("biWidth", W.LONG), ("biHeight", W.LONG), ("biPlanes", W.WORD),
        ("biBitCount", W.WORD), ("biCompression", W.DWORD), ("biSizeImage", W.DWORD),
        ("biXPelsPerMeter", W.LONG), ("biYPelsPerMeter", W.LONG), ("biClrUsed", W.DWORD),
        ("biClrImportant", W.DWORD), ("pad", W.DWORD * 4),
    ]
class Mouse(ctypes.Structure):
    _fields_ = [
        ("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD), ("dwFlags", W.DWORD),
        ("time", W.DWORD), ("dwExtraInfo", ctypes.c_size_t),
    ]
class Input(ctypes.Structure):
    class Either(ctypes.Union):
        _fields_ = [("mi", Mouse), ("pad", ctypes.c_byte * 32)]
    _anonymous_ = ("u",)
    _fields_ = [("type", W.DWORD), ("u", Either)]
k32.CreateToolhelp32Snapshot.restype = W.HANDLE
k32.Process32FirstW.argtypes = [W.HANDLE, ctypes.c_void_p]
k32.Process32NextW.argtypes = [W.HANDLE, ctypes.c_void_p]
k32.OpenProcess.restype = W.HANDLE
k32.CloseHandle.argtypes = [W.HANDLE]
k32.GetProcessTimes.argtypes = [W.HANDLE] + [ctypes.c_void_p] * 4
u32.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
u32.IsWindowVisible.argtypes = [W.HWND]
u32.GetWindowRect.argtypes = [W.HWND, ctypes.POINTER(W.RECT)]
u32.SetWindowPos.argtypes = [W.HWND, W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.UINT]
u32.SetForegroundWindow.argtypes = [W.HWND]
u32.SendMessageTimeoutW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM, W.UINT, W.UINT, ctypes.POINTER(ctypes.c_size_t)]
u32.SendMessageTimeoutW.restype = W.LPARAM
u32.GetForegroundWindow.restype = W.HWND
u32.GetClassNameW.argtypes = [W.HWND, W.LPWSTR, ctypes.c_int]
u32.WindowFromPoint.argtypes = [W.POINT]
u32.WindowFromPoint.restype = W.HWND
u32.GetAncestor.argtypes = [W.HWND, W.UINT]
u32.GetAncestor.restype = W.HWND
u32.GetDC.argtypes = [W.HWND]
u32.GetDC.restype = W.HDC
g32.CreateCompatibleDC.argtypes = [W.HDC]
g32.CreateCompatibleDC.restype = W.HDC
g32.CreateCompatibleBitmap.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int]
g32.CreateCompatibleBitmap.restype = W.HBITMAP
g32.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
g32.SelectObject.restype = W.HGDIOBJ
g32.BitBlt.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HDC, ctypes.c_int, ctypes.c_int, W.DWORD]
g32.GetDIBits.argtypes = [W.HDC, W.HBITMAP, W.UINT, W.UINT, ctypes.c_void_p, ctypes.c_void_p, W.UINT]
WIDE, HIGH = u32.GetSystemMetrics(0), u32.GetSystemMetrics(1)
PAGE = """
if (document.getElementById('hover-grid')) return true;
const m = (window.__hover = { on: false, r: [], f: [], last: 0 });
addEventListener('pointermove', (e) => {
  if (!m.on) return;
  const t = e.timeStamp;
  requestAnimationFrame(() => m.r.push(performance.now() - t));
}, { capture: true, passive: true });
m.loop = (t) => { if (!m.on) { m.last = 0; return } if (m.last) m.f.push(t - m.last); m.last = t; requestAnimationFrame(m.loop) };
const style = document.createElement('style');
style.textContent = '#hover-grid{position:fixed;inset:0;z-index:2147483647;display:grid;grid-template-columns:repeat(%d,1fr);grid-template-rows:repeat(%d,1fr);background:#fff}#hover-grid>div{border:1px solid #ccc}#hover-grid>div:hover{background:#000}';
document.head.appendChild(style);
const grid = document.createElement('div');
grid.id = 'hover-grid';
for (let i = 0; i < %d; i++) grid.appendChild(document.createElement('div'));
document.body.appendChild(grid);
return true
""" % (COLS, ROWS, COLS * ROWS)
START = "const m = window.__hover; m.r = []; m.f = []; m.on = true; requestAnimationFrame(m.loop); return true"
SOFTWARE = ("--disable-gpu", "--use-angle=swiftshader", "--use-angle=d3d11-warp", "--use-gl=swiftshader")
GPU_LINES = (
    "$all = Get-CimInstance Win32_Process; $mine = @(%d);"
    " do { $n = $mine.Count; $mine = @($mine + ($all | ? { $mine -contains $_.ParentProcessId } | %% ProcessId) | Sort-Object -Unique) }"
    " while ($mine.Count -ne $n);"
    " $all | ? { $mine -contains $_.ProcessId -and $_.CommandLine -match 'type=gpu-process' } | %% CommandLine"
)
RENDERER = (
    "const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no WebGL';"
    "const i = g.getExtension('WEBGL_debug_renderer_info');"
    "return String(g.getParameter(i ? i.UNMASKED_RENDERER_WEBGL : g.RENDERER))"
)
STOP = "const m = window.__hover; m.on = false; return { r: m.r, f: m.f }"
def processes() -> dict[int, tuple[int, str]]:
    snap = k32.CreateToolhelp32Snapshot(2, 0)
    entry = Entry()
    entry.dwSize = ctypes.sizeof(Entry)
    found: dict[int, tuple[int, str]] = {}
    ok = k32.Process32FirstW(snap, ctypes.byref(entry))
    while ok:
        found[entry.th32ProcessID] = (entry.th32ParentProcessID, entry.szExeFile.lower())
        ok = k32.Process32NextW(snap, ctypes.byref(entry))
    k32.CloseHandle(snap)
    return found
def family(root: int) -> set[int]:
    every = processes()
    kept = {root} & set(every)
    grew = True
    while grew:
        grew = False
        for pid, (parent, _) in every.items():
            if pid not in kept and parent in kept:
                kept.add(pid)
                grew = True
    return kept
def spent(pid: int) -> float:
    handle = k32.OpenProcess(0x1000, False, pid)
    if not handle:
        return 0.0
    times = [W.FILETIME() for _ in range(4)]
    ok = k32.GetProcessTimes(handle, *[ctypes.byref(t) for t in times])
    k32.CloseHandle(handle)
    if not ok:
        return 0.0
    return sum((t.dwHighDateTime << 32 | t.dwLowDateTime) / 1e7 for t in times[2:])
def cpu_over(root: int, seconds: float) -> float:
    before = {pid: spent(pid) for pid in family(root)}
    start = time.perf_counter()
    time.sleep(seconds)
    took = time.perf_counter() - start
    after = {pid: spent(pid) for pid in family(root)}
    return sum(after[pid] - before.get(pid, 0.0) for pid in after) / took * 100
def window_of(root: int) -> int:
    mine = family(root)
    found: list[tuple[int, int]] = []
    def each(hwnd: int, _: int) -> bool:
        owner = W.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value in mine and u32.IsWindowVisible(hwnd):
            rect = W.RECT()
            u32.GetWindowRect(hwnd, ctypes.byref(rect))
            found.append(((rect.right - rect.left) * (rect.bottom - rect.top), hwnd))
        return True
    u32.EnumWindows(ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)(each), 0)
    found.sort(reverse=True)
    return found[0][1] if found and found[0][0] > 300 * 300 else 0
class Grab:
    def __init__(self, wide: int, high: int) -> None:
        self.wide, self.high = wide, high
        self.screen = u32.GetDC(None)
        self.memory = g32.CreateCompatibleDC(self.screen)
        self.bitmap = g32.CreateCompatibleBitmap(self.screen, wide, high)
        g32.SelectObject(self.memory, self.bitmap)
        self.header = Header(biSize=40, biWidth=wide, biHeight=-high, biPlanes=1, biBitCount=32)
        self.pixels = ctypes.create_string_buffer(wide * high * 4)
    def at(self, x: int, y: int) -> bytes:
        g32.BitBlt(self.memory, 0, 0, self.wide, self.high, self.screen, x, y, 0x00CC0020)
        g32.GetDIBits(self.memory, self.bitmap, 0, self.high, self.pixels, ctypes.byref(self.header), 0)
        return self.pixels.raw
def move(x: int, y: int) -> None:
    sent = Input(type=0)
    sent.mi = Mouse(int(x * 65535 / (WIDE - 1)), int(y * 65535 / (HIGH - 1)), 0, 0x8001, 0, 0)
    u32.SendInput(1, ctypes.byref(sent), ctypes.sizeof(Input))
def ping(hwnd: int) -> float:
    result = ctypes.c_size_t()
    start = time.perf_counter()
    ok = u32.SendMessageTimeoutW(hwnd, 0, 0, 0, 0x0002, 2000, ctypes.byref(result))
    return (time.perf_counter() - start) * 1000 if ok else 2000.0
def median(values: list[float]) -> float:
    return statistics.median(values) if values else float("inf")
def high(values: list[float], share: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * share))] if ordered else float("inf")
def front(hwnd: int) -> None:
    for _ in range(3):
        shown = u32.GetForegroundWindow()
        if shown == hwnd:
            break
        name = ctypes.create_unicode_buffer(256)
        u32.GetClassNameW(shown, name, 256)
        if name.value == "Windows.UI.Core.CoreWindow":
            u32.keybd_event(0x1B, 0, 0, 0)
            u32.keybd_event(0x1B, 0, 2, 0)
            time.sleep(1)
        u32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0003 | 0x0040)
        u32.SetForegroundWindow(hwnd)
        time.sleep(1)
def ours(hwnd: int, x: int, y: int) -> bool:
    return u32.GetAncestor(u32.WindowFromPoint(W.POINT(x, y)), 2) == hwnd
def hovers(hwnd: int, rect: tuple[int, int, int, int]) -> list[float]:
    left, top, right, bottom = rect
    grab = Grab(60, 30)
    took: list[float] = []
    for row in range(ROWS):
        columns = range(COLS) if row % 2 == 0 else reversed(range(COLS))
        for column in columns:
            x = int(left + (column + 0.5) * (right - left) / COLS)
            y = int(top + (row + 0.5) * (bottom - top) / ROWS)
            if not ours(hwnd, x, y):
                continue
            before = grab.at(x - 30, y - 15)
            start = time.perf_counter()
            move(x, y)
            while time.perf_counter() - start < 1.0:
                if grab.at(x - 30, y - 15) != before:
                    took.append((time.perf_counter() - start) * 1000)
                    break
            time.sleep(0.2)
    return took
def wiggle(rect: tuple[int, int, int, int], seconds: float) -> None:
    left, top, right, bottom = rect
    end = time.perf_counter() + seconds
    step = 0
    while time.perf_counter() < end:
        across = (step % 200) / 100
        across = across if across < 1 else 2 - across
        down = ((step // 7) % 60) / 60
        move(int(left + 20 + across * (right - left - 40)), int(top + 20 + down * (bottom - top - 40)))
        step += 1
        time.sleep(0.008)
def clear_screen() -> None:
    for pid, (_, name) in processes().items():
        if name in OOBE:
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, check=False)
            time.sleep(3)
def grid(app: App) -> None:
    if app.eval(PAGE) is not True:
        raise SystemExit("the hover grid was not put up")
def measure(app: App, root: int) -> dict[str, Any]:
    hwnd = 0
    until = time.monotonic() + 90
    while not hwnd and time.monotonic() < until:
        hwnd = window_of(root)
        time.sleep(0.5)
    if not hwnd:
        raise SystemExit("the app showed no window")
    u32.SetWindowPos(hwnd, -1, 0, 0, min(WIDE, 1280), min(HIGH - 40, 800), 0x0040)
    front(hwnd)
    if app.until("return !!orden.workspace", 90) is not True:
        raise SystemExit("the app's interface never came up")
    time.sleep(SETTLE)
    grid(app)
    rect = W.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(rect))
    area = (rect.left + 8, rect.top + 8, rect.right - 8, rect.bottom - 8)
    move(area[2] - 3, area[3] - 3)
    time.sleep(2)
    said: dict[str, Any] = {"idle_cpu": cpu_over(root, IDLE), "renderer": str(app.eval(RENDERER))}
    asked = subprocess.run(["powershell", "-NoProfile", "-Command", GPU_LINES % root], capture_output=True, text=True, timeout=120, check=False)
    said["gpu"] = [line for line in asked.stdout.splitlines() if line.strip()]
    grid(app)
    front(hwnd)
    took = hovers(hwnd, area)
    said["hover_ms"] = median(took)
    said["hovered"] = len(took)
    pings: list[float] = []
    def pinging() -> None:
        end = time.perf_counter() + WIGGLE
        while time.perf_counter() < end:
            pings.append(ping(hwnd))
            time.sleep(0.005)
    grid(app)
    app.eval(START)
    watcher = threading.Thread(target=pinging)
    watcher.start()
    wiggle(area, WIGGLE)
    watcher.join()
    page = app.eval(STOP, 30)
    page = page if isinstance(page, dict) else {}
    said["frame_ms"] = median(page.get("f") or [])
    said["event_to_frame_p90_ms"] = high(page.get("r") or [], 0.9)
    said["main_thread_p99_ms"] = high(pings, 0.99)
    return said
def judged(said: dict[str, Any]) -> list[str]:
    frame = said["frame_ms"]
    wrong = []
    if not said["gpu"]:
        wrong.append("no GPU process runs")
    for flag in SOFTWARE:
        if any(flag in line for line in said["gpu"]):
            wrong.append(f"the GPU process draws in software ({flag})")
    if said["idle_cpu"] > IDLE_CPU:
        wrong.append(f"idle CPU {said['idle_cpu']:.1f}% of a core, over {IDLE_CPU}%")
    if said["hovered"] < COLS * ROWS // 2:
        wrong.append(f"only {said['hovered']} of {COLS * ROWS} cells showed their hover")
    if said["hover_ms"] > HOVER_FRAMES * frame:
        wrong.append(f"a hover shows after {said['hover_ms']:.0f} ms, over {HOVER_FRAMES:.0f} frames of {frame:.1f} ms")
    if said["event_to_frame_p90_ms"] > EVENT_FRAMES * frame:
        wrong.append(f"a pointer move reaches a frame after {said['event_to_frame_p90_ms']:.0f} ms (p90), over {EVENT_FRAMES:.0f} frames")
    if said["main_thread_p99_ms"] > PING_FRAMES * frame:
        wrong.append(f"the window's thread answers after {said['main_thread_p99_ms']:.1f} ms (p99) while the pointer moves, over a frame")
    return wrong
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier and os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    clear_screen()
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-hover-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    try:
        said = measure(endpoint(config, process.pid, secret, 20), process.pid)
    finally:
        ended(process)
    print(json.dumps({key: round(value, 2) if isinstance(value, float) else value for key, value in said.items() if key != "gpu"}))
    wrong = judged(said)
    for one in wrong:
        print(f"::error::{one}")
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
