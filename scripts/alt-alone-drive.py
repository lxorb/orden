"""Does a tap of Alt or F10 leave the window answering? Windows only.

Released alone, Alt and F10 ask the window for its menu: Windows sends
`WM_SYSCOMMAND` with `SC_KEYMENU`, and the default answer to that is a modal
menu loop on the window's thread. The window has no menu bar, so nothing shows,
but while that loop runs the app's own work waits on the thread: the page stops
being answered until a key or a click ends it. Orden opens its overview on two
taps of Alt, so this is a press people make all the time.

The drive taps each key with `keybd_event`, the way a keyboard does, then asks
Windows whether the window's thread is in menu mode and asks the app a question
over its automation endpoint. Both must come back clean.

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
            user32.keybd_event(key, 0, 0, 0)
            user32.keybd_event(key, 0, KEY_UP, 0)
            time.sleep(1.0)
            menu = in_menu(user32, hwnd)
            asked = time.monotonic()
            said = app.eval("return 1 + 1", 8)
            took = time.monotonic() - asked
            print(f"{name} alone: menu mode {menu}, the page answered {said} in {took:.1f} s", flush=True)
            if menu:
                wrong.append(f"{name} alone put the window's thread in menu mode")
            if said.get("value") != 2:
                wrong.append(f"after {name} alone the page did not answer: {said}")
            user32.keybd_event(ESCAPE, 0, 0, 0)
            user32.keybd_event(ESCAPE, 0, KEY_UP, 0)
            time.sleep(1.0)
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
