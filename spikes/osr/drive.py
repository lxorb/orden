from __future__ import annotations

import argparse
import ctypes
import functools
import http.server
import json
import pathlib
import random
import re
import statistics
import subprocess
import tempfile
import threading
import time
from ctypes import wintypes as W

import psutil

HERE = pathlib.Path(__file__).resolve().parent
WINDOW = 30.0
u32 = ctypes.WinDLL("user32", use_last_error=True)
g32 = ctypes.WinDLL("gdi32")
k32 = ctypes.WinDLL("kernel32")
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
u32.GetDC.restype = W.HDC
u32.GetDC.argtypes = [W.HWND]
g32.CreateCompatibleDC.restype = W.HDC
g32.CreateCompatibleDC.argtypes = [W.HDC]
g32.CreateCompatibleBitmap.restype = W.HBITMAP
g32.CreateCompatibleBitmap.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int]
g32.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
g32.SelectObject.restype = W.HGDIOBJ
g32.BitBlt.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HDC, ctypes.c_int, ctypes.c_int, W.DWORD]
g32.GetDIBits.argtypes = [W.HDC, W.HBITMAP, W.UINT, W.UINT, ctypes.c_void_p, ctypes.c_void_p, W.UINT]
u32.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
u32.GetClassNameW.argtypes = [W.HWND, W.LPWSTR, ctypes.c_int]
u32.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
u32.SetForegroundWindow.argtypes = [W.HWND]
WIDE, HIGH = u32.GetSystemMetrics(0), u32.GetSystemMetrics(1)
k32.OpenThread.restype = W.HANDLE
k32.OpenThread.argtypes = [W.DWORD, W.BOOL, W.DWORD]
k32.CloseHandle.argtypes = [W.HANDLE]
k32.GetThreadDescription.argtypes = [W.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
k32.LocalFree.argtypes = [ctypes.c_void_p]


def thread_name(tid: int) -> str:
    handle = k32.OpenThread(0x0800, False, tid)
    if not handle:
        return "?"
    said = ctypes.c_wchar_p()
    name = "?"
    if k32.GetThreadDescription(handle, ctypes.byref(said)) >= 0 and said.value is not None:
        name = said.value or "(unnamed)"
        k32.LocalFree(ctypes.cast(said, ctypes.c_void_p))
    k32.CloseHandle(handle)
    return name


def threads(pid: int) -> dict[int, tuple[str, float]]:
    try:
        return {t.id: (thread_name(t.id), t.user_time + t.system_time) for t in psutil.Process(pid).threads()}
    except psutil.Error:
        return {}


def qpc() -> int:
    v = ctypes.c_int64()
    k32.QueryPerformanceCounter(ctypes.byref(v))
    return v.value


def qpf() -> int:
    v = ctypes.c_int64()
    k32.QueryPerformanceFrequency(ctypes.byref(v))
    return v.value


FREQ = qpf()


class Mouse(ctypes.Structure):
    _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD), ("dwFlags", W.DWORD), ("time", W.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class Input(ctypes.Structure):
    class Either(ctypes.Union):
        _fields_ = [("mi", Mouse), ("pad", ctypes.c_byte * 32)]

    _anonymous_ = ("u",)
    _fields_ = [("type", W.DWORD), ("u", Either)]


POSTED = False
u32.WindowFromPoint.argtypes = [W.POINT]
u32.WindowFromPoint.restype = W.HWND
u32.ScreenToClient.argtypes = [W.HWND, ctypes.POINTER(W.POINT)]
u32.GetCursorPos.argtypes = [ctypes.POINTER(W.POINT)]
u32.GetForegroundWindow.restype = W.HWND


def send(flags: int, x: int = 0, y: int = 0, data: int = 0) -> int:
    sent = Input(type=0)
    sent.mi = Mouse(int(x * 65535 / (WIDE - 1)), int(y * 65535 / (HIGH - 1)), data & 0xFFFFFFFF, flags, 0, 0)
    return u32.SendInput(1, ctypes.byref(sent), ctypes.sizeof(Input))


def post(x: int, y: int, msg: int, wp: int, screen: bool = False) -> None:
    hwnd = u32.WindowFromPoint(W.POINT(x, y))
    pt = W.POINT(x, y)
    if not screen:
        u32.ScreenToClient(hwnd, ctypes.byref(pt))
    u32.PostMessageW(hwnd, msg, wp, ((pt.y & 0xFFFF) << 16) | (pt.x & 0xFFFF))


def input_check() -> dict:
    got = send(0x8001, 123, 77)
    err = ctypes.get_last_error()
    time.sleep(0.3)
    p = W.POINT()
    u32.GetCursorPos(ctypes.byref(p))
    return {"sendinput_returned": got, "last_error": err, "cursor": [p.x, p.y], "moved": abs(p.x - 123) <= 2 and abs(p.y - 77) <= 2}


def move(x: int, y: int) -> None:
    if POSTED:
        post(x, y, 0x0200, 0)
    else:
        send(0x8001, x, y)


def wheel(x: int, y: int, delta: int) -> None:
    if POSTED:
        post(x, y, 0x020A, (delta & 0xFFFF) << 16, screen=True)
    else:
        send(0x8800 | 0x0001, x, y, delta)


def down(x: int, y: int) -> None:
    if POSTED:
        post(x, y, 0x0201, 1)
    else:
        send(0x8002 | 0x0001, x, y)


def up(x: int, y: int) -> None:
    if POSTED:
        post(x, y, 0x0202, 0)
    else:
        send(0x8004 | 0x0001, x, y)


class Header(ctypes.Structure):
    _fields_ = [
        ("biSize", W.DWORD), ("biWidth", W.LONG), ("biHeight", W.LONG), ("biPlanes", W.WORD), ("biBitCount", W.WORD),
        ("biCompression", W.DWORD), ("biSizeImage", W.DWORD), ("biXPelsPerMeter", W.LONG), ("biYPelsPerMeter", W.LONG),
        ("biClrUsed", W.DWORD), ("biClrImportant", W.DWORD), ("pad", W.DWORD * 4),
    ]


class Grab:
    def __init__(self, x: int, y: int, wide: int = 4, high: int = 4) -> None:
        self.x, self.y, self.wide, self.high = x, y, wide, high
        self.screen = u32.GetDC(None)
        self.memory = g32.CreateCompatibleDC(self.screen)
        self.bitmap = g32.CreateCompatibleBitmap(self.screen, wide, high)
        g32.SelectObject(self.memory, self.bitmap)
        self.header = Header(biSize=40, biWidth=wide, biHeight=-high, biPlanes=1, biBitCount=32)
        self.pixels = ctypes.create_string_buffer(wide * high * 4)

    def take(self) -> bytes:
        g32.BitBlt(self.memory, 0, 0, self.wide, self.high, self.screen, self.x, self.y, 0x00CC0020)
        g32.GetDIBits(self.memory, self.bitmap, 0, self.high, self.pixels, ctypes.byref(self.header), 0)
        return self.pixels.raw


def screenshot(path: pathlib.Path) -> None:
    g = Grab(0, 0, WIDE, HIGH)
    raw = g.take()
    row = WIDE * 4
    header = b"BM" + (54 + len(raw)).to_bytes(4, "little") + b"\0\0\0\0" + (54).to_bytes(4, "little")
    info = (40).to_bytes(4, "little") + WIDE.to_bytes(4, "little") + (-HIGH & 0xFFFFFFFF).to_bytes(4, "little")
    info += (1).to_bytes(2, "little") + (32).to_bytes(2, "little") + bytes(24)
    path.write_bytes(header + info + raw[: row * HIGH])


def class_at(x: int, y: int) -> dict:
    hwnd = u32.WindowFromPoint(W.POINT(x, y))
    name = ctypes.create_unicode_buffer(128)
    u32.GetClassNameW(hwnd, name, 128)
    owner = W.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    fg = u32.GetForegroundWindow()
    fname = ctypes.create_unicode_buffer(128)
    u32.GetClassNameW(fg, fname, 128)
    try:
        exe = psutil.Process(owner.value).name()
    except psutil.Error:
        exe = "?"
    return {"at_point": name.value, "owner": exe, "foreground": fname.value}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass


def serve() -> str:
    handler = functools.partial(Quiet, directory=str(HERE / "pages"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}"


GPU_PS = r"""
param($out, $n)
try {
  $sets = Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples $n -ErrorAction Stop
  $rows = foreach ($s in $sets) { foreach ($c in $s.CounterSamples) { [pscustomobject]@{ t = $s.Timestamp.Ticks; i = $c.InstanceName; v = $c.CookedValue } } }
  ConvertTo-Json -InputObject @($rows) -Compress | Out-File -Encoding utf8 $out
} catch {
  ("ERR " + $_) | Out-File -Encoding utf8 $out
}
"""


class Spike:
    def __init__(self, exe: str, out: pathlib.Path) -> None:
        self.exe = exe
        self.out = out
        self.base = serve()
        self.w = min(960, WIDE - 80)
        self.h = min(640, HIGH - 140)
        self.hole = (160, 48, self.w - 176, self.h - 64)
        self.runs = 0
        self.gpu_script = out / "gpu.ps1"
        self.gpu_script.write_text(GPU_PS)

    def launch(self, mode: str, page: str, extra: list[str]) -> tuple[subprocess.Popen, pathlib.Path]:
        self.runs += 1
        log = self.out / f"run{self.runs:02d}-{mode}-{re.sub(r'[^a-z]', '', page.split('.')[0])}.jsonl"
        x, y, w, h = self.hole
        args = [
            self.exe,
            f"--spike-mode={mode}",
            f"--spike-url={self.base}/{page}",
            f"--spike-app={self.base}/app.html?x={x}&y={y}&w={w}&h={h}",
            f"--spike-log={log}",
            f"--spike-size={self.w}x{self.h}",
            "--spike-pos=40,40",
            f"--spike-hole={x},{y},{w},{h}",
            *extra,
        ]
        print("launch", " ".join(args[1:]), flush=True)
        return subprocess.Popen(args, cwd=str(pathlib.Path(self.exe).parent)), log

    @staticmethod
    def events(log: pathlib.Path) -> list[dict]:
        found = []
        if not log.exists():
            return found
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                found.append(json.loads(line))
            except ValueError:
                pass
        return found

    def wait_for(self, log: pathlib.Path, test, timeout: float) -> list[dict]:
        end = time.time() + timeout
        while time.time() < end:
            seen = self.events(log)
            if test(seen):
                return seen
            time.sleep(0.25)
        return self.events(log)

    @staticmethod
    def window_of(pid: int) -> int:
        found: list[int] = []

        def each(hwnd: int, _: int) -> bool:
            owner = W.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            name = ctypes.create_unicode_buffer(64)
            u32.GetClassNameW(hwnd, name, 64)
            if owner.value == pid and name.value == "OsrSpike":
                found.append(hwnd)
            return True

        u32.EnumWindows(ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)(each), 0)
        return found[0] if found else 0

    def close(self, proc: subprocess.Popen) -> None:
        hwnd = self.window_of(proc.pid)
        if hwnd:
            u32.PostMessageW(hwnd, 0x0010, 0, 0)
        try:
            proc.wait(15)
        except subprocess.TimeoutExpired:
            print("did not close; killing by pid", proc.pid, flush=True)
            try:
                for child in psutil.Process(proc.pid).children(recursive=True):
                    child.kill()
            except psutil.Error:
                pass
            proc.kill()
            proc.wait(10)
        time.sleep(1.0)

    @staticmethod
    def role(p: psutil.Process) -> str:
        try:
            line = " ".join(p.cmdline())
        except psutil.Error:
            return "gone"
        kind = re.search(r"--type=([\w-]+)", line)
        if not kind:
            return "browser"
        name = kind.group(1)
        if name == "gpu-process":
            return "gpu"
        if name == "utility":
            sub = re.search(r"--utility-sub-type=([\w.]+)", line)
            return "utility:" + (sub.group(1).split(".")[-1] if sub else "?")
        return name

    def family(self, pid: int) -> list[psutil.Process]:
        try:
            root = psutil.Process(pid)
            return [root, *root.children(recursive=True)]
        except psutil.Error:
            return []

    def cpu(self, pid: int) -> dict[int, tuple[str, float]]:
        seen = {}
        for p in self.family(pid):
            try:
                t = p.cpu_times()
                seen[p.pid] = (self.role(p), t.user + t.system)
            except psutil.Error:
                pass
        return seen

    def gpu_flags(self, pid: int) -> str:
        for p in self.family(pid):
            if self.role(p) == "gpu":
                try:
                    return " ".join(a for a in p.cmdline()[1:] if a.startswith("--") and not a.startswith("--field-trial"))[:1500]
                except psutil.Error:
                    pass
        return ""

    def gpu_start(self, tag: str) -> tuple[subprocess.Popen, pathlib.Path]:
        out = self.out / f"gpu-{tag}.json"
        proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(self.gpu_script), str(out), str(int(WINDOW))],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return proc, out

    @staticmethod
    def gpu_end(proc: subprocess.Popen, out: pathlib.Path, roles: dict[int, str]) -> dict:
        try:
            proc.wait(90)
        except subprocess.TimeoutExpired:
            proc.kill()
            return {"measured": False, "why": "Get-Counter timed out"}
        if not out.exists():
            return {"measured": False, "why": "no output"}
        text = out.read_text(encoding="utf-8-sig", errors="replace").strip()
        if text.startswith("ERR") or not text:
            return {"measured": False, "why": text[:300] or "empty"}
        try:
            rows = json.loads(text)
        except ValueError:
            return {"measured": False, "why": "bad json"}
        if isinstance(rows, dict):
            rows = [rows]
        samples: dict[int, dict[int, dict[str, float]]] = {}
        all_pids = set()
        for row in rows:
            m = re.match(r"pid_(\d+)_.*engtype_(.+)$", str(row.get("i", "")))
            if not m:
                continue
            pid, eng = int(m.group(1)), m.group(2)
            all_pids.add(pid)
            if pid not in roles:
                continue
            per = samples.setdefault(row["t"], {}).setdefault(pid, {})
            per[eng] = per.get(eng, 0.0) + float(row.get("v") or 0.0)
        ticks = sorted({row["t"] for row in rows}) or [0]
        by_role: dict[str, float] = {}
        for pid, role in roles.items():
            busy = [max(samples.get(t, {}).get(pid, {"": 0.0}).values()) for t in ticks]
            by_role[role] = by_role.get(role, 0.0) + sum(busy) / len(busy)
        return {"measured": True, "samples": len(ticks), "instances_pids": len(all_pids), "by_role": {k: round(v, 2) for k, v in by_role.items()}}

    def probe(self, flags: list[str], adapter: str, page: str = "idle.html?probe=1") -> dict:
        proc, log = self.launch("composed", page, [*flags, f"--spike-adapter={adapter}", "--spike-exit-after=12"])
        gpu = ""
        end = time.time() + 40
        while proc.poll() is None and time.time() < end:
            if not gpu:
                gpu = self.gpu_flags(proc.pid)
            time.sleep(0.5)
        if proc.poll() is None:
            self.close(proc)
        ev = self.events(log)
        if not ev:
            print("probe: no log; exit code", hex(proc.returncode & 0xFFFFFFFF) if proc.returncode is not None else None, flush=True)
        paints = [e for e in ev if e.get("ev") == "paint"]
        found = {
            "flags": flags,
            "adapter": adapter,
            "accelerated": sum(1 for e in paints if e.get("acc") == 1),
            "software": sum(1 for e in paints if e.get("acc") == 0),
            "open_fail": sum(1 for e in ev if e.get("ev") == "openfail"),
            "open_fail_hr": next((e for e in ev if e.get("ev") == "openfail"), None),
            "presents": sum(1 for e in ev if e.get("ev") == "present"),
            "device": next((e for e in ev if e.get("ev") == "device"), None),
            "adapters": [e for e in ev if e.get("ev") == "adapter"],
            "console": [e.get("msg") for e in ev if e.get("ev") == "console"],
            "strip": next((e for e in ev if e.get("ev") == "strip"), None),
            "errors": [e for e in ev if e.get("ev") == "error"],
            "gpu_process_flags": gpu,
            "how": sorted({e.get("how") for e in paints if e.get("how")}),
            "srcs": sorted({e.get("src") for e in paints if e.get("src")}),
        }
        print("probe", json.dumps({k: v for k, v in found.items() if k not in ("adapters", "gpu_process_flags")}), flush=True)
        return found

    def scenario(self, mode: str, name: str, flags: list[str]) -> dict:
        page = {"video": "video.html", "scroll": "scroll.html", "idle": "idle.html"}[name]
        proc, log = self.launch(mode, page, flags)
        want = 2 if mode == "composed" else 1
        ev = self.wait_for(log, lambda seen: sum(1 for e in seen if e.get("ev") == "created") >= want, 30)
        start = next((e for e in ev if e.get("ev") == "start"), None)
        if not start:
            self.close(proc)
            return {"error": "no start", "exit": proc.returncode}
        cx = start["client"][0] + self.hole[0] + self.hole[2] // 2
        cy = start["client"][1] + self.hole[1] + self.hole[3] // 2
        time.sleep(7.0 if name == "video" else 4.0)
        if name == "scroll":
            move(cx, cy)
        else:
            move(WIDE - 3, HIGH - 3)
        time.sleep(1.0)
        gproc, gout = self.gpu_start(f"{mode}-{name}")
        time.sleep(1.0)
        c0 = self.cpu(proc.pid)
        watched = {pid for pid, (role, _) in c0.items() if role in ("browser", "gpu", "renderer")}
        th0 = {pid: threads(pid) for pid in watched}
        q0 = qpc()
        t0 = time.perf_counter()
        notches = 0
        while time.perf_counter() - t0 < WINDOW:
            if name == "scroll":
                wheel(cx, cy, -120)
                notches += 1
                time.sleep(0.1)
            else:
                time.sleep(0.5)
        took = time.perf_counter() - t0
        c1 = self.cpu(proc.pid)
        th1 = {pid: threads(pid) for pid in watched}
        q1 = qpc()
        roles = {pid: role for pid, (role, _) in c1.items()}
        gpu = self.gpu_end(gproc, gout, roles)
        self.close(proc)
        hot = {}
        for pid in watched:
            role = c0[pid][0]
            rows = []
            for tid, (tname, spent) in th1.get(pid, {}).items():
                was = th0.get(pid, {}).get(tid, (tname, 0.0))[1]
                rows.append((round((spent - was) / WINDOW * 100.0, 2), tname))
            rows.sort(reverse=True)
            if any(v > 0.2 for v, _ in rows):
                hot[f"{role}:{pid}"] = [f"{n} {v}" for v, n in rows[:8] if v > 0.2]
        per_process = sorted(
            ((role, round((spent - c0.get(pid, (role, 0.0))[1]) / WINDOW * 100.0, 2)) for pid, (role, spent) in c1.items()),
            key=lambda x: -x[1],
        )
        cpu_role: dict[str, float] = {}
        renderers = 0
        for pid, (role, spent) in c1.items():
            before = c0.get(pid, (role, 0.0))[1]
            cpu_role[role] = cpu_role.get(role, 0.0) + (spent - before) / took * 100.0
            renderers += role == "renderer"
        ev = [e for e in self.events(log) if q0 <= e.get("t", 0) <= q1]
        paints = [e for e in ev if e.get("ev") == "paint"]
        presents = [e for e in ev if e.get("ev") == "present"]

        def stat(key: str, acc: int = 1) -> dict:
            vals = [e[key] for e in paints if e.get("acc") == acc and key in e]
            if not vals:
                return {}
            vals.sort()
            return {"mean": round(statistics.mean(vals), 1), "p95": vals[min(len(vals) - 1, int(len(vals) * 0.95))], "max": vals[-1]}

        result = {
            "mode": mode,
            "scenario": name,
            "seconds": round(took, 2),
            "cpu_pct": {k: round(v, 2) for k, v in sorted(cpu_role.items())},
            "cpu_total_pct": round(sum(cpu_role.values()), 2),
            "renderers": renderers,
            "per_process": per_process,
            "hot_threads": hot,
            "gpu": gpu,
            "wheel_notches": notches,
            "console": [e.get("msg") for e in self.events(log) if e.get("ev") == "console"],
        }
        if mode == "composed":
            per_view = {}
            for v, label in ((1, "app"), (2, "page")):
                mine = [e for e in paints if e.get("v") == v]
                per_view[label] = {
                    "paints": len(mine),
                    "accelerated": sum(1 for e in mine if e.get("acc") == 1),
                    "software": sum(1 for e in mine if e.get("acc") == 0),
                    "bytes": sum(e.get("bytes", 0) for e in mine),
                    "damage_px": sum(e.get("dmg", 0) for e in mine),
                }
            copied = sum(e.get("bytes", 0) for e in paints)
            result.update(
                {
                    "views": per_view,
                    "copied_mb_per_s": round(copied / took / 1e6, 2),
                    "copied_bytes": copied,
                    "presents": len(presents),
                    "presents_per_s": round(len(presents) / took, 1),
                    "present_area_px_per_s": round(sum(e.get("area", 0) for e in presents) / took),
                    "present_cpu_us": round(statistics.mean([e["us"] for e in presents]), 1) if presents else None,
                    "open_us": stat("open"),
                    "copy_us": stat("copy"),
                    "wait_us": stat("wait"),
                    "upload_us": stat("copy", 0),
                    "srcs": sorted({e.get("src") for e in paints}),
                    "openfail": sum(1 for e in ev if e.get("ev") == "openfail"),
                    "strip": next((e for e in self.events(log) if e.get("ev") == "strip"), None),
                }
            )
        print("scenario", json.dumps(result), flush=True)
        return result

    def latency(self, mode: str, flags: list[str], trials: int = 40) -> dict:
        proc, log = self.launch(mode, "latency.html", flags)
        want = 2 if mode == "composed" else 1
        ev = self.wait_for(log, lambda seen: sum(1 for e in seen if e.get("ev") == "created") >= want, 30)
        start = next((e for e in ev if e.get("ev") == "start"), None)
        if not start:
            self.close(proc)
            return {"error": "no start", "exit": proc.returncode}
        refresh = start.get("refresh", 60)
        cx = start["client"][0] + self.hole[0] + self.hole[2] // 2
        cy = start["client"][1] + self.hole[1] + self.hole[3] // 2
        time.sleep(4.0)
        grab = Grab(cx + 40, cy + 40)
        move(cx, cy)
        time.sleep(0.5)
        tag = mode + "".join(a.replace("--spike-", "-") for a in flags if a.startswith("--spike-sync"))
        screenshot(self.out / f"screen-{tag}.bmp")
        where = class_at(cx, cy)
        print("latency window at point", where, flush=True)
        times = []
        sent = []
        timeouts = 0
        first_pixels = grab.take()[:8].hex()
        for i in range(trials + 1):
            before = grab.take()
            t0 = qpc()
            down(cx, cy)
            up(cx, cy)
            seen = None
            while True:
                now = qpc()
                if grab.take() != before:
                    seen = (qpc() + now) // 2
                    break
                if now - t0 > FREQ:
                    break
            if i > 0:
                if seen is None:
                    timeouts += 1
                else:
                    times.append((seen - t0) * 1000.0 / FREQ)
                    sent.append(t0)
            time.sleep(0.3 + random.random() * 0.2)
        self.close(proc)
        result: dict = {"mode": tag, "window_at_point": where, "trials": trials, "timeouts": timeouts, "refresh_hz": refresh, "first_pixels": first_pixels, "injection": "PostMessage" if POSTED else "SendInput"}
        if times:
            ordered = sorted(times)
            frame = 1000.0 / refresh
            result.update(
                {
                    "ms_median": round(statistics.median(ordered), 1),
                    "ms_p90": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))], 1),
                    "frames_median": round(statistics.median(ordered) / frame, 2),
                    "ms_all": [round(t, 1) for t in times],
                }
            )
        if mode == "composed":
            ev = self.events(log)
            ins = [e for e in ev if e.get("ev") == "in" and e.get("k") == "down"]
            paints = [e for e in ev if e.get("ev") == "paint" and e.get("v") == 2]
            presents = [e for e in ev if e.get("ev") == "present"]
            split = []
            for t0 in sent:
                i = next((e["t"] for e in ins if e["t"] >= t0), None)
                if i is None:
                    continue
                p = next((e["t"] for e in paints if e["t"] >= i), None)
                if p is None:
                    continue
                s = next((e["t"] for e in presents if e["t"] >= p), None)
                if s is None:
                    continue
                split.append(((i - t0) * 1000.0 / FREQ, (p - i) * 1000.0 / FREQ, (s - p) * 1000.0 / FREQ))
            if split:
                result["in_process_ms_median"] = {
                    "sendinput_to_wndproc": round(statistics.median(a for a, _, _ in split), 2),
                    "forward_to_paint": round(statistics.median(b for _, b, _ in split), 2),
                    "paint_to_present": round(statistics.median(c for _, _, c in split), 2),
                }
        print("latency", json.dumps(result), flush=True)
        return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    out = pathlib.Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for p in psutil.process_iter(["name"]):
        if (p.info.get("name") or "").lower() in ("wwahost.exe", "useroobebroker.exe"):
            print("closing the setup screen, pid", p.pid, flush=True)
            subprocess.run(["taskkill", "/PID", str(p.pid), "/F"], capture_output=True, check=False)
            time.sleep(3)
    spike = Spike(a.exe, out)
    global POSTED
    check = input_check()
    POSTED = not check["moved"]
    check["injection"] = "PostMessage" if POSTED else "SendInput"
    print("input", json.dumps(check), flush=True)
    results: dict = {"input": check, "label": a.label, "screen": [WIDE, HIGH], "window": [spike.w, spike.h], "hole": spike.hole}
    variants = [
        [],
        ["--ignore-gpu-blocklist"],
        ["--ignore-gpu-blocklist", "--use-angle=d3d11-warp"],
        ["--ignore-gpu-blocklist", "--use-angle=d3d11-warp", "--enable-unsafe-swiftshader"],
        ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-driver-bug-workarounds", "--enable-gpu-rasterization"],
    ]
    probes = []
    chosen = None
    for flags in variants:
        hw = spike.probe(flags, "hw")
        probes.append(hw)
        if hw["accelerated"] > 0 and hw["open_fail"] == 0:
            chosen = (flags, "hw")
            break
        if hw["accelerated"] > 0 or hw["open_fail"] > 0:
            warp = spike.probe(flags, "warp")
            probes.append(warp)
            if warp["accelerated"] > 0 and warp["open_fail"] == 0:
                chosen = (flags, "warp")
                break
    results["probes"] = probes
    gpu_path = chosen is not None
    flags, adapter = chosen if chosen else ([], "hw")
    results["chosen"] = {"flags": flags, "adapter": adapter, "gpu_path": gpu_path}
    ext_flags = [f"--load-extension={HERE / 'ext'}", "--disable-features=DisableLoadExtensionCommandLineSwitch"]
    results["extension"] = {"composed_alloy_osr": spike.probe([*flags, *ext_flags], adapter)["console"]}
    nproc, nlog = spike.launch("native", "idle.html?probe=1", [*flags, *ext_flags, "--spike-exit-after=12"])
    try:
        nproc.wait(40)
    except subprocess.TimeoutExpired:
        spike.close(nproc)
    results["extension"]["native_default_style"] = [e.get("msg") for e in spike.events(nlog) if e.get("ev") == "console"]
    composed_extra = [*flags, f"--spike-adapter={adapter}"]
    results["scenarios"] = []
    for name in ("video", "scroll", "idle"):
        results["scenarios"].append(spike.scenario("native", name, flags))
        results["scenarios"].append(spike.scenario("composed", name, composed_extra))
    results["latency"] = [
        spike.latency("native", flags),
        spike.latency("composed", composed_extra),
        spike.latency("composed", [*composed_extra, "--spike-sync=0"]),
    ]
    (out / "results.json").write_text(json.dumps(results, indent=2))
    print_table(results)


def print_table(r: dict) -> None:
    print(f"\n== {r['label']} chosen={r['chosen']}")
    print(f"{'mode':9} {'scene':7} {'cpu%':>7} {'browser':>8} {'gpu':>7} {'rend':>7} {'gpu-eng%':>9} {'MB/s':>7} {'pres/s':>7}")
    for s in r["scenarios"]:
        if "error" in s:
            print(s)
            continue
        c = s["cpu_pct"]
        rend = sum(v for k, v in c.items() if k == "renderer")
        g = s["gpu"]
        gtxt = f"{sum(g['by_role'].values()):.1f}" if g.get("measured") else "n/m"
        print(
            f"{s['mode']:9} {s['scenario']:7} {s['cpu_total_pct']:7.1f} {c.get('browser', 0):8.1f} {c.get('gpu', 0):7.1f} {rend:7.1f} {gtxt:>9} "
            f"{s.get('copied_mb_per_s', 0):7.1f} {s.get('presents_per_s', 0):7.1f}"
        )
    for l in r["latency"]:
        print("latency", l.get("mode"), l.get("ms_median"), "ms", l.get("frames_median"), "frames", l.get("in_process_ms_median", ""))


if __name__ == "__main__":
    main()
