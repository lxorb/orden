"""Does a tap of Alt or F10 leave the window answering? Windows only.

Released alone, Alt and F10 ask the window for its menu: Windows sends
`WM_SYSCOMMAND` with `SC_KEYMENU`, and the default answer to that is a modal
menu loop on the window's thread. The window has no menu bar, so nothing shows,
but while that loop runs the app's own work waits on the thread: the page stops
being answered until a key or a click ends it. Orden opens its overview on two
taps of Alt, so this is a press people make all the time. Alt+Space still opens
the window's own menu, and one Escape must end it: the menu Windows opens for it
falls back to a menu bar the window does not have, the same hidden loop.

The drive taps each key with `keybd_event`, the way a keyboard does, then asks
Windows whether the window's thread is in menu mode and asks the app a question
over its automation endpoint. Both must come back clean. Every window of the app
shares that thread, so the same taps are made in a second window of its own, the
presenter's, which runs none of the main window's page.

    python scripts/alt-alone-drive.py --exe <probe nib.exe> --identifier <probe id>
"""

from __future__ import annotations

import argparse
import ctypes
import importlib
import json
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

drive = importlib.import_module("web-tab-drive")
from probe_app import main_window

ALT = 0x12
F10 = 0x79
ESCAPE = 0x1B
SPACE = 0x20
KEY_UP = 0x0002
IN_MENU = 0x00000004


class GuiThreadInfo(ctypes.Structure):
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


def in_menu(user32: ctypes.WinDLL, hwnd: int) -> bool:
    thread = user32.GetWindowThreadProcessId(hwnd, None)
    info = GuiThreadInfo()
    info.cbSize = ctypes.sizeof(GuiThreadInfo)
    if not user32.GetGUIThreadInfo(thread, ctypes.byref(info)):
        return False
    return bool(info.flags & IN_MENU)


def windows_of(user32: ctypes.WinDLL, pid: int) -> list[int]:
    found: list[int] = []

    def each(hwnd: int, _: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            name = ctypes.create_unicode_buffer(64)
            user32.GetClassNameW(hwnd, name, 64)
            if name.value == "Tauri Window":
                found.append(hwnd)
        return True

    user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(each), 0)
    return found


def front(user32: ctypes.WinDLL, hwnd: int) -> bool:
    theirs = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
    ours = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(ours, theirs, True)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(ours, theirs, False)
    time.sleep(0.8)
    return user32.GetForegroundWindow() == hwnd


def tap(user32: ctypes.WinDLL, app, hwnd: int, name: str, key: int, where: str, wrong: list[str]) -> None:
    user32.keybd_event(key, 0, 0, 0)
    user32.keybd_event(key, 0, KEY_UP, 0)
    time.sleep(1.0)
    menu = in_menu(user32, hwnd)
    asked = time.monotonic()
    said = app.eval("return 1 + 1", 8)
    took = time.monotonic() - asked
    print(f"{name} alone in {where}: menu mode {menu}, the page answered {said} in {took:.1f} s", flush=True)
    if menu:
        wrong.append(f"{name} alone in {where} put the window's thread in menu mode")
    if said.get("value") != 2:
        wrong.append(f"after {name} alone in {where} the page did not answer: {said}")
    user32.keybd_event(ESCAPE, 0, 0, 0)
    user32.keybd_event(ESCAPE, 0, KEY_UP, 0)
    time.sleep(1.0)


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows only")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    config = drive.config_of(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-alt-"))
    (spaces / "Alt").mkdir()
    (spaces / "Alt" / "A note.md").write_text("# A note\n\nWords.\n", encoding="utf-8")
    process = subprocess.Popen([str(args.exe)], env={**drive.os.environ, "NIB_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = drive.endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace").get("value") is not True:
            time.sleep(1)
        time.sleep(3)
        hwnd = main_window(process.pid)
        for name, key in (("Alt", ALT), ("F10", F10), ("Alt", ALT)):
            drive.forward(process.pid)
            time.sleep(0.5)
            tap(user32, app, hwnd, name, key, "the main window", wrong)
        drive.forward(process.pid)
        time.sleep(0.5)
        user32.keybd_event(ALT, 0, 0, 0)
        user32.keybd_event(SPACE, 0, 0, 0)
        user32.keybd_event(SPACE, 0, KEY_UP, 0)
        user32.keybd_event(ALT, 0, KEY_UP, 0)
        time.sleep(1.0)
        shown = in_menu(user32, hwnd)
        user32.keybd_event(ESCAPE, 0, 0, 0)
        user32.keybd_event(ESCAPE, 0, KEY_UP, 0)
        time.sleep(1.0)
        menu = in_menu(user32, hwnd)
        said = app.eval("return 1 + 1", 8)
        print(f"Alt+Space, then Escape: the window's menu came up {shown}, menu mode after {menu}, the page answered {said}", flush=True)
        if not shown:
            wrong.append("Alt+Space showed no window menu")
        if menu or said.get("value") != 2:
            wrong.append(f"Alt+Space and one Escape left the window's thread in menu mode {menu}, the page answering {said}")
            user32.keybd_event(ESCAPE, 0, 0, 0)
            user32.keybd_event(ESCAPE, 0, KEY_UP, 0)
            time.sleep(1.0)
        before = set(windows_of(user32, process.pid))
        said = app.eval("await window.__TAURI_INTERNALS__.invoke('presenter_open', {}); return true", 20)
        until = time.monotonic() + 20
        other = 0
        while not other and time.monotonic() < until:
            other = next(iter(set(windows_of(user32, process.pid)) - before), 0)
            time.sleep(0.5)
        if not other:
            wrong.append(f"the presenter's window never opened: {said}")
        else:
            time.sleep(3)
            for name, key in (("Alt", ALT), ("F10", F10)):
                if not front(user32, other):
                    wrong.append("the presenter's window could not be brought to the front")
                    break
                tap(user32, app, other, name, key, "the presenter's window", wrong)
    finally:
        process.kill()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            pass
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
