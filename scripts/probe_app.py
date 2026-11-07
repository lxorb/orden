from __future__ import annotations

import ctypes
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from ctypes import wintypes
from dataclasses import dataclass
from typing import Any

PROBE_VERSION = "99.0.0"

WM_CLOSE = 0x0010

APP_CLASS = "Tauri Window"

OFF_SCREEN = "NIB_OFF_SCREEN"

LOOK_EVERY = 0.004

FAMILY_EVERY = 0.25

AFTERLIFE = 2.0

IN_VIEW_EXIT = 3

STARTF_USESHOWWINDOW = 0x0001
SW_SHOWNOACTIVATE = 4

SEM_FAILCRITICALERRORS = 0x0001
SEM_NOGPFAULTERRORBOX = 0x0002
SEM_NOOPENFILEERRORBOX = 0x8000
NO_ERROR_BOXES = SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX

SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010

GW_OWNER = 4

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x0008_0000
LWA_ALPHA = 0x0000_0002

UNDRAWN = frozenset({"Tao Thread Event Target", "Winit Thread Event Target"})
UNDRAWN_SUFFIX = "-sic"

DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4

TH32CS_SNAPPROCESS = 0x00000002
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_TERMINATE = 0x0001
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if sys.platform == "win32" else None
if user32 is not None and kernel32 is not None:
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindow.restype = wintypes.HWND
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongW.restype = ctypes.c_long
    user32.GetLayeredWindowAttributes.argtypes = [
        wintypes.HWND,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.POINTER(wintypes.DWORD),
    ]
    user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.SetErrorMode.argtypes = [wintypes.UINT]
    kernel32.SetErrorMode.restype = wintypes.UINT
    kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE, *[ctypes.POINTER(wintypes.FILETIME)] * 4]

def version_of(exe: pathlib.Path) -> str:

    library = ctypes.WinDLL("version")
    library.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, wintypes.LPDWORD]
    library.GetFileVersionInfoW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
    ]
    library.VerQueryValueW.argtypes = [
        ctypes.c_void_p,
        wintypes.LPCWSTR,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.UINT),
    ]

    size = library.GetFileVersionInfoSizeW(str(exe), None)
    if not size:
        return ""
    data = ctypes.create_string_buffer(size)
    if not library.GetFileVersionInfoW(str(exe), 0, size, data):
        return ""
    fixed = ctypes.c_void_p()
    length = wintypes.UINT()
    if not library.VerQueryValueW(data, "\\", ctypes.byref(fixed), ctypes.byref(length)):
        return ""
    info = ctypes.cast(fixed, ctypes.POINTER(wintypes.DWORD * 4)).contents
    return f"{info[2] >> 16}.{info[2] & 0xFFFF}.{info[3] >> 16}"

def refuse_updating(exe: pathlib.Path) -> None:

    found = version_of(exe)
    if found != PROBE_VERSION:
        raise SystemExit(
            f"{exe} is version {found or 'unknown'}, not {PROBE_VERSION}: it would fetch the "
            "real update and install it on close. Build it as scripts/probe_app.py says."
        )

def identifier_of(exe: pathlib.Path, given: str | None = None) -> str:

    if given:
        return given
    beside = exe.parent / "nib-probe-identifier.json"
    if not beside.exists():
        raise SystemExit(f"which identifier was {exe} built under? pass --identifier")
    return str(json.loads(beside.read_text(encoding="utf-8"))["identifier"])

def main_window(pid: int) -> int:

    assert user32 is not None
    found: list[int] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        if name.value == APP_CLASS:
            found.append(hwnd)
            return False
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found[0] if found else 0

def close_app(app: subprocess.Popen[bytes], seconds: float = 30) -> bool:

    assert user32 is not None
    hwnd = main_window(app.pid)
    if not hwnd:
        return False
    user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    try:
        app.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        return False
    return True

def run_probe(
    exe: pathlib.Path,
    env: dict[str, str] | None = None,
    quiet: bool = False,
    args: Sequence[str] = (),
    piped: bool = False,
    errors: Any = None,
) -> subprocess.Popen[bytes]:

    refuse_updating(exe)
    environment = {**(os.environ if env is None else env), OFF_SCREEN: "1"}
    if not environment.get("NIB_SPACES_DIR"):
        raise SystemExit("a probe is launched with NIB_SPACES_DIR in a temp folder, never without")

    without_error_boxes()
    shown = subprocess.STARTUPINFO()
    shown.dwFlags |= STARTF_USESHOWWINDOW
    shown.wShowWindow = SW_SHOWNOACTIVATE
    output = subprocess.DEVNULL if quiet else None
    app = _started_bare(
        [str(exe), *args],
        env=environment,
        cwd=str(exe.parent),
        startupinfo=shown,
        stdin=subprocess.PIPE if piped else None,
        stdout=subprocess.PIPE if piped else output,
        stderr=output if errors is None else errors,
    )
    threading.Thread(target=_watch, args=(app,), name="off-screen watch", daemon=True).start()
    return app

def without_error_boxes() -> None:

    assert kernel32 is not None
    kernel32.SetErrorMode(kernel32.SetErrorMode(NO_ERROR_BOXES) | NO_ERROR_BOXES)

def _started_bare(argv: list[str], **how: Any) -> subprocess.Popen[bytes]:

    made: list[subprocess.Popen[bytes] | BaseException] = []

    def start() -> None:
        try:
            made.append(subprocess.Popen(argv, **how))
        except BaseException as error:  # noqa: BLE001 - handed back to the caller's thread
            made.append(error)

    starter = threading.Thread(target=start, name="probe start")
    starter.start()
    starter.join()
    if isinstance(made[0], BaseException):
        raise made[0]
    return made[0]

@dataclass(frozen=True)
class Seen:

    hwnd: int
    pid: int
    kind: str
    visible: bool
    box: tuple[int, int, int, int]

@dataclass(frozen=True)
class Look:

    windows: tuple[Seen, ...]
    front: int
    screens: tuple[tuple[int, int, int, int], ...]

def on_a_screen(box: tuple[int, int, int, int], screens: Iterable[tuple[int, int, int, int]]) -> bool:

    left, top, right, bottom = box
    if right <= left or bottom <= top:
        return False
    return any(
        left < s_right and s_left < right and top < s_bottom and s_top < bottom
        for s_left, s_top, s_right, s_bottom in screens
    )

def draws_nothing(ex_style: int, flags: int, alpha: int) -> bool:
    return bool(ex_style & WS_EX_LAYERED) and bool(flags & LWA_ALPHA) and alpha == 0

def see_through(hwnd: int) -> bool:

    if user32 is None:
        return False
    ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & 0xFFFF_FFFF
    if not ex_style & WS_EX_LAYERED:
        return False
    alpha = ctypes.c_ubyte()
    flags = wintypes.DWORD()
    if not user32.GetLayeredWindowAttributes(hwnd, None, ctypes.byref(alpha), ctypes.byref(flags)):
        return False
    return draws_nothing(ex_style, flags.value, alpha.value)

def in_view(look: Look, pids: Collection[int]) -> list[str]:

    found: list[str] = []
    for one in look.windows:
        if one.pid not in pids:
            continue
        left, top, right, bottom = one.box
        where = f"{left},{top} {right - left}x{bottom - top}"
        if one.hwnd == look.front:
            found.append(f"{one.kind} 0x{one.hwnd:X} of pid {one.pid} is the window in front, at {where}")
        elif one.kind in UNDRAWN or one.kind.endswith(UNDRAWN_SUFFIX):
            continue
        elif one.visible and on_a_screen(one.box, look.screens) and not see_through(one.hwnd):
            found.append(f"{one.kind} 0x{one.hwnd:X} of pid {one.pid} is on a screen at {where}")
    return found

def descendants(root: int, parents: Mapping[int, int], born: Callable[[int], int | None]) -> set[int]:

    found = {root}
    waiting = [root]
    while waiting:
        parent = waiting.pop()
        started = born(parent)
        for child, its in parents.items():
            if its != parent or child in found or child == parent:
                continue
            when = born(child)
            if started is not None and when is not None and when >= started:
                found.add(child)
                waiting.append(child)
    return found

class _Entry(ctypes.Structure):

    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]

def parents() -> dict[int, int]:

    assert kernel32 is not None
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == INVALID_HANDLE_VALUE:
        return {}
    found: dict[int, int] = {}
    try:
        entry = _Entry()
        entry.dwSize = ctypes.sizeof(_Entry)
        more = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while more:
            found[entry.th32ProcessID] = entry.th32ParentProcessID
            more = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return found

def born(pid: int) -> int | None:

    assert kernel32 is not None
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        created, ended, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel32.GetProcessTimes(
            handle, ctypes.byref(created), ctypes.byref(ended), ctypes.byref(kernel), ctypes.byref(user)
        ):
            return None
        return (created.dwHighDateTime << 32) | created.dwLowDateTime
    finally:
        kernel32.CloseHandle(handle)

def family(pid: int) -> set[int]:

    return descendants(pid, parents(), born)

def look(of: Collection[int] | None = None) -> Look:

    assert user32 is not None
    windows: list[Seen] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if of is not None and owner.value not in of:
            return True
        box = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        windows.append(
            Seen(
                hwnd=hwnd,
                pid=owner.value,
                kind=name.value,
                visible=bool(user32.IsWindowVisible(hwnd)),
                box=(box.left, box.top, box.right, box.bottom),
            )
        )
        return True

    screens: list[tuple[int, int, int, int]] = []

    def screen(_monitor: int, _dc: int, box: Any, _lparam: int) -> bool:
        at = box.contents
        screens.append((at.left, at.top, at.right, at.bottom))
        return True

    front = user32.GetForegroundWindow() or 0
    window_kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(window_kind(each), 0)
    screen_kind = ctypes.WINFUNCTYPE(
        wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM
    )
    user32.EnumDisplayMonitors(None, None, screen_kind(screen), 0)
    return Look(windows=tuple(windows), front=front, screens=tuple(screens))

def in_physical_pixels() -> None:

    if user32 is not None:
        user32.SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)

def image_of(pid: int) -> str:

    assert kernel32 is not None
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return "?"
    try:
        size = wintypes.DWORD(1024)
        name = ctypes.create_unicode_buffer(1024)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
            return "?"
        return pathlib.PureWindowsPath(name.value).name
    finally:
        kernel32.CloseHandle(handle)

def whose(look: Look, pids: Collection[int]) -> list[str]:

    if user32 is None:
        return []
    living = parents()
    found: list[str] = []
    for one in look.windows:
        if one.pid not in pids or not one.visible or not on_a_screen(one.box, look.screens):
            continue
        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(one.hwnd, title, 256)
        owner = user32.GetWindow(one.hwnd, GW_OWNER) or 0
        parent = living.get(one.pid, 0)
        found.append(
            f"0x{one.hwnd:X} {title.value!r} owned by 0x{owner:X}, {image_of(one.pid)} "
            f"started by pid {parent} ({image_of(parent)})"
        )
    return found

def end_all(pids: Iterable[int]) -> None:

    assert kernel32 is not None
    for pid in pids:
        handle = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
        if handle:
            kernel32.TerminateProcess(handle, IN_VIEW_EXIT)
            kernel32.CloseHandle(handle)

def _watch(app: subprocess.Popen[bytes]) -> None:

    in_physical_pixels()
    started = time.perf_counter()
    pids = {app.pid}
    asked = 0.0
    gone_at: float | None = None
    while True:
        now = time.perf_counter()
        if app.poll() is None:
            if now - asked > FAMILY_EVERY:
                living = parents()
                pids = descendants(app.pid, living, born) | (pids & living.keys())
                asked = now
        else:
            gone_at = gone_at or now
            pids &= parents().keys()
            if not pids or now - gone_at > AFTERLIFE:
                return
        looked = look(pids)
        seen = in_view(looked, pids)
        if seen:
            told = whose(looked, pids)
            end_all([app.pid, *(pids - {app.pid})])
            after = (now - started) * 1000
            print(
                f"PROBE IN VIEW after {after:.0f} ms: {'; '.join(seen)} ({'; '.join(told)}). "
                f"Ended pid {app.pid} and {len(pids) - 1} under it; this build or drive puts a "
                "window in front of somebody. See scripts/probe_app.py.",
                file=sys.stderr,
            )
            sys.stderr.flush()
            os._exit(IN_VIEW_EXIT)
        time.sleep(LOOK_EVERY)

class _GuiThread(ctypes.Structure):

    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND),
        ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND),
        ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND),
        ("hwndCaret", wintypes.HWND),
        ("rcCaret", wintypes.RECT),
    ]

def described(hwnd: int | None) -> str:

    assert user32 is not None
    if not hwnd:
        return "none"
    name = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, name, 256)
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    return f"{name.value}@{owner.value} 0x{hwnd:X}"

def keyboard(pid: int) -> dict[str, object]:

    assert user32 is not None
    front = user32.GetForegroundWindow()
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(front, ctypes.byref(owner))
    hwnd = main_window(pid)
    thread = user32.GetWindowThreadProcessId(hwnd, None) if hwnd else 0
    info = _GuiThread()
    info.cbSize = ctypes.sizeof(_GuiThread)
    focus = "?"
    if thread and user32.GetGUIThreadInfo(thread, ctypes.byref(info)):
        focus = described(info.hwndFocus)
    return {
        "front": described(front),
        "front is ours": owner.value in family(pid),
        "app thread focus": focus,
    }

class _LastInput(ctypes.Structure):

    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

def idle_seconds() -> float:

    assert user32 is not None and kernel32 is not None
    last = _LastInput()
    last.cbSize = ctypes.sizeof(_LastInput)
    if not user32.GetLastInputInfo(ctypes.byref(last)):
        return 0.0
    return ((kernel32.GetTickCount() - last.dwTime) & 0xFFFFFFFF) / 1000

def sized(hwnd: int, width: int, height: int) -> None:

    assert user32 is not None
    user32.SetWindowPos(
        hwnd, None, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
    )

def spaces_folder(name: str) -> pathlib.Path:

    import tempfile

    return pathlib.Path(tempfile.mkdtemp(prefix=f"nib-{name}-spaces-"))
