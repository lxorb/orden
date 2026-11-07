from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import pathlib
import shutil
import sys
import time
from ctypes import wintypes

from probe_app import close_app, main_window

HERE = pathlib.Path(__file__).resolve().parent

WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202

PAGE = b"""<!doctype html>
<title>A form</title>
<body style="margin:0;font:16px system-ui;background:#eef">
<input id="field" autofocus style="margin:2rem;font-size:20px"
  onfocus="document.title = 'focused'" oninput="document.title = this.value">
<div style="height:2000px"></div>
</body>
"""

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
kernel32 = ctypes.WinDLL("kernel32") if sys.platform == "win32" else None

def borrowed():

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def class_of(hwnd: int) -> str:
    assert user32 is not None
    name = ctypes.create_unicode_buffer(128)
    user32.GetClassNameW(wintypes.HWND(hwnd), name, 128)
    return name.value

def children(hwnd: int) -> list[int]:

    assert user32 is not None
    found: list[int] = []

    def each(child: int, _lparam: int) -> bool:
        found.append(child)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumChildWindows(wintypes.HWND(hwnd), kind(each), 0)
    return found

def engines(window: int) -> list[tuple[int, int, bool]]:

    assert user32 is not None
    made = []
    for one in children(window):
        if class_of(one) != "WRY_WEBVIEW":
            continue
        inside = [child for child in children(one) if class_of(child) == "Chrome_WidgetWin_1"]
        if inside:
            made.append((one, inside[0], bool(user32.IsWindowVisible(wintypes.HWND(one)))))
    return made

def area(hwnd: int) -> int:
    assert user32 is not None
    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return (box.right - box.left) * (box.bottom - box.top)

def thread_of(hwnd: int) -> int:
    assert user32 is not None
    return int(user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), None))

def level(window: int) -> int:

    assert user32 is not None and kernel32 is not None
    mine = kernel32.GetCurrentThreadId()
    theirs = thread_of(window)
    if not user32.AttachThreadInput(mine, theirs, True):
        raise SystemExit("could not attach to the window's input queue")
    try:
        user32.ShowCursor(True)
        return int(user32.ShowCursor(False))
    finally:
        user32.AttachThreadInput(mine, theirs, False)

def hidden_elsewhere(window: int) -> int:

    import threading

    assert user32 is not None and kernel32 is not None
    theirs = thread_of(window)
    hid = threading.Event()
    done = threading.Event()

    def hide() -> None:
        mine = kernel32.GetCurrentThreadId()
        user32.AttachThreadInput(mine, theirs, True)
        user32.ShowCursor(False)
        hid.set()
        done.wait(10)
        user32.ShowCursor(True)
        user32.AttachThreadInput(mine, theirs, False)

    other = threading.Thread(target=hide)
    other.start()
    hid.wait(10)
    try:
        return level(window)
    finally:
        done.set()
        other.join()

def focus(engine: int) -> None:

    assert user32 is not None and kernel32 is not None
    mine = kernel32.GetCurrentThreadId()
    theirs = thread_of(engine)
    user32.AttachThreadInput(mine, theirs, True)
    try:
        user32.SetFocus(wintypes.HWND(engine))
    finally:
        user32.AttachThreadInput(mine, theirs, False)
    time.sleep(0.3)

def type_into(engine: int, letters: str) -> None:

    assert user32 is not None
    focus(engine)
    for letter in letters:
        vk = ord(letter.upper())
        user32.PostMessageW(wintypes.HWND(engine), WM_KEYDOWN, vk, 0x0000_0001)
        user32.PostMessageW(wintypes.HWND(engine), WM_KEYUP, vk, 0xC000_0001)
        time.sleep(0.05)
    time.sleep(0.4)

def press(engine: int, x: int, y: int) -> None:

    assert user32 is not None
    at = (y << 16) | x
    user32.PostMessageW(wintypes.HWND(engine), WM_MOUSEMOVE, 0, at)
    user32.PostMessageW(wintypes.HWND(engine), WM_LBUTTONDOWN, 0x0001, at)
    user32.PostMessageW(wintypes.HWND(engine), WM_LBUTTONUP, 0, at)
    time.sleep(0.4)

def move_over(engine: int, steps: int = 6) -> None:

    assert user32 is not None
    for step in range(steps):
        x, y = 120 + step * 17, 140 + step * 11
        user32.PostMessageW(wintypes.HWND(engine), WM_MOUSEMOVE, 0, (y << 16) | x)
        time.sleep(0.05)
    time.sleep(0.4)

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="so.orden.Orden.probe")
    args = parsed.parse_args()

    switch = borrowed()
    switch.wipe(args.identifier)
    port = switch.free_port()

    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "A form.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/form", "A form"), encoding="utf-8"
    )

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        window = 0
        until = time.perf_counter() + 90
        while not window and time.perf_counter() < until:
            window = main_window(running.pid)
            time.sleep(0.2)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A form.url")
        time.sleep(6)

        if not window:
            raise SystemExit("the app never showed its window")
        found = engines(window)
        shown = [one for one in found if one[2]]
        if len(shown) != 2:
            raise SystemExit(f"expected the app's page and the site's on screen, found {found}")
        shown.sort(key=lambda one: -area(one[0]))
        ours, page = shown[0][1], shown[1][1]
        said["threads share one queue"] = {
            "window": thread_of(window),
            "app page": thread_of(ours),
            "site": thread_of(page),
        }
        said["level at rest"] = level(window)
        said["level while another thread hides it"] = hidden_elsewhere(window)
        said["level once it shows it again"] = level(window)

        app.ask("document.querySelector('.webbar input.orden-field')?.focus()")
        time.sleep(0.3)
        type_into(ours, "moodle")
        said["level after typing in the address field"] = level(window)
        said["what the field holds"] = app.ask(
            "JSON.stringify(document.querySelector('.webbar input.orden-field')?.value ?? null)"
        )
        move_over(page)
        said["level after moving over the page"] = level(window)
        move_over(ours)
        said["level after moving over the app"] = level(window)

        app.ask("document.querySelector('.webbar input.orden-field')?.blur()")
        focus(page)
        press(page, 60, 45)
        type_into(page, "hello")
        said["level after typing in the page"] = level(window)
        said["what the page heard"] = app.ask(
            "JSON.stringify(document.querySelector('.webbar input.orden-field')?.value ?? null)"
        )
        app.open("Idea.md")
        time.sleep(1.5)
        move_over(ours)
        said["level after moving over a note the page gave way to"] = level(window)
        app.open("A form.url")
        time.sleep(1.5)
        move_over(page)
        said["level after moving over the page again"] = level(window)
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    stuck = [
        name
        for name, value in said.items()
        if isinstance(value, int) and value < 0 and name != "level while another thread hides it"
    ]
    if stuck:
        print(f"FAIL: the pointer is hidden at {stuck}")
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
