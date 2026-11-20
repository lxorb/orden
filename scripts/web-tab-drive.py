from __future__ import annotations
import argparse
import ctypes
import http.server
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
from typing import Any
from fresh_app import ended, fresh
from native_app import INNER, App, config_of, endpoint

PAGE = b"<!doctype html><title>a page</title><p>a page"
STORM = (
    b"<!doctype html><title>a storm</title><script>let n = 0; const every = setInterval(() => {"
    b" for (let i = 0; i < 20; i++) window.open(location.origin + '/opened' + n++);"
    b" if (n >= 400) clearInterval(every) }, 1)</script><p>a storm"
)
TABS = 3
WATCHED = 10.0
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body = STORM if self.path == "/storm" else PAGE
        if self.path.startswith("/step"):
            body = f"<!doctype html><title>{self.path[1:]}</title><body style='margin:0;height:100vh'><p>{self.path[1:]}".encode()
        if self.path.startswith("/hop"):
            body = f"<!doctype html><script>location.replace('/step{self.path[4:]}b')</script>".encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
def window_answers(pid: int) -> str | None:
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from probe_app import main_window
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = main_window(pid)
    if not hwnd:
        return "the app has no window"
    result = wintypes.DWORD()
    if not user32.SendMessageTimeoutW(hwnd, 0, 0, 0, 0x0002, 3000, ctypes.byref(result)):
        return "the window does not answer Windows"
    return None
def forward(pid: int) -> None:
    if sys.platform != "win32":
        return
    import ctypes
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from probe_app import main_window
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = main_window(pid)
    theirs = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
    ours = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(ours, theirs, True)
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(ours, theirs, False)
def watched(app: App, pid: int, count: int) -> list[str]:
    opened, live = time.monotonic(), False
    while time.monotonic() - opened < WATCHED:
        asked = time.monotonic()
        said = app.answer(f"orden.pages.each().filter(([, page]) => page.live).length >= {count}")
        at = f"web tab {count}, {asked - opened:4.1f} s after it opened"
        if "error" in said:
            return [f"{at}: the endpoint did not answer: {said['error']}"]
        live = live or said.get("value") is True
        if why := window_answers(pid):
            return [f"{at}: {why}"]
        time.sleep(0.5)
    print(f"web tab {count}: answered for {WATCHED:.0f} s, its page up: {live}", flush=True)
    return [] if live else [f"web tab {count}: its page never came up in {WATCHED:.0f} s"]
WAYS = ("the bar's arrows", "Alt+Left and Alt+Right", "the mouse's back and forward buttons", "a sideways swipe")
class Hand:
    def __init__(self) -> None:
        self.u = ctypes.WinDLL("user32", use_last_error=True)
        self.u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        self.u.mouse_event.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_size_t]
    def to(self, at: tuple[float, float]) -> None:
        self.u.SetCursorPos(round(at[0]), round(at[1]))
        time.sleep(0.2)
    def click(self, at: tuple[float, float]) -> None:
        self.to(at)
        self.u.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.05)
        self.u.mouse_event(0x0004, 0, 0, 0, 0)
    def keys(self, key: int) -> None:
        self.u.keybd_event(0x12, 0x38, 0, 0)
        time.sleep(0.05)
        self.u.keybd_event(key, 0x4B if key == 0x25 else 0x4D, 0x0001, 0)
        time.sleep(0.05)
        self.u.keybd_event(key, 0x4B if key == 0x25 else 0x4D, 0x0001 | 0x0002, 0)
        time.sleep(0.05)
        self.u.keybd_event(0x12, 0x38, 0x0002, 0)
    def side(self, back: bool) -> None:
        self.u.mouse_event(0x0080, 0, 0, 1 if back else 2, 0)
        time.sleep(0.05)
        self.u.mouse_event(0x0100, 0, 0, 1 if back else 2, 0)
    def sideways(self, back: bool) -> None:
        for _ in range(30):
            self.u.mouse_event(0x01000, 0, 0, -40 if back else 40, 0)
            time.sleep(0.012)
def stepped(app: App, tab: str, want: str, arrows: tuple[bool, bool] | None = None) -> str:
    until = time.monotonic() + 8
    said: Any = None
    look: Any = None
    while time.monotonic() < until:
        said = app.eval(f"const p = orden.pages.of({json.dumps(tab)}); return {{ url: p.url, back: p.back, forward: p.forward }}")
        look = app.eval(f"return await window.__TAURI_INTERNALS__.invoke('web_look', {{ tab: {json.dumps(tab)} }}).then((l) => l.url, (e) => 'no look: ' + e)")
        if (
            isinstance(said, dict)
            and str(said.get("url", "")).endswith(want)
            and str(look).endswith(want)
            and (arrows is None or (said.get("back"), said.get("forward")) == arrows)
        ):
            return ""
        time.sleep(0.25)
    lit = "" if arrows is None else f", its arrows should be lit {arrows}"
    return f"the tab shows {said}, the page itself is at {look}{lit}"
def screen(app: App, x: float, y: float) -> tuple[float, float]:
    inner = app.eval(INNER)
    return inner["x"] + x * inner["ratio"], inner["y"] + y * inner["ratio"]
def steps(app: App, pid: int, url: str) -> list[str]:
    wrong: list[str] = []
    hand = Hand() if sys.platform == "win32" else None
    tab = app.eval(f"orden.workspace.openPage({json.dumps(url + 'step')}); return orden.workspace.activeTabId")
    if why := stepped(app, tab, "step", (False, False)):
        return [f"the page to step along did not load: {why}"]
    time.sleep(2)
    app.eval(f"orden.workspace.goBack({json.dumps(tab)}); return true")
    time.sleep(2)
    if why := stepped(app, tab, "step", (False, False)):
        wrong.append(f"back on a tab's first page leaves it: {why}")
    for number, way in enumerate(WAYS):
        if hand is None and number:
            continue
        here, there = f"step{number}a", f"step{number}b"
        app.eval(f"orden.pages.go({json.dumps(tab)}, {json.dumps(url + here)}); return true")
        if why := stepped(app, tab, here):
            wrong.append(f"{way}: the first page did not load: {why}")
            continue
        app.eval(f"orden.pages.go({json.dumps(tab)}, {json.dumps(url + f'hop{number}')}); return true")
        if why := stepped(app, tab, there, (True, False)):
            wrong.append(f"{way}: the second page did not load: {why}")
            continue
        time.sleep(1)
        box = app.eval(f"const p = orden.pages.of({json.dumps(tab)}); return p.sent && p.sent.pane")
        if not isinstance(box, dict):
            wrong.append(f"{way}: the page has no box: {box}")
            continue
        middle = screen(app, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        for back, want, arrows in ((True, here, (True, True)), (False, there, (True, False))):
            if way == WAYS[0]:
                arrow = app.eval(
                    f"const b = [...document.querySelectorAll('.webbar button[aria-label={'Back' if back else 'Forward'}]')].find((one) => one.checkVisibility()).getBoundingClientRect();"
                    " return { x: b.x + b.width / 2, y: b.y + b.height / 2 }"
                )
                if hand:
                    hand.click(screen(app, arrow["x"], arrow["y"]))
                else:
                    app.eval(f"[...document.querySelectorAll('.webbar button[aria-label={'Back' if back else 'Forward'}]')].find((one) => one.checkVisibility()).click(); return true")
            elif way == WAYS[1]:
                hand.click(middle)
                time.sleep(0.5)
                hand.keys(0x25 if back else 0x27)
            elif way == WAYS[2]:
                hand.to(middle)
                hand.side(back)
            else:
                hand.to(middle)
                hand.sideways(back)
            if why := stepped(app, tab, want, arrows):
                wrong.append(f"{way}, {'back' if back else 'forward'}: {why}")
                break
            print(f"{way}: {'back' if back else 'forward'} went to {want}", flush=True)
            time.sleep(1)
    return wrong
def stalls(identifier: str) -> list[str]:
    home = pathlib.Path.home()
    folders = [
        pathlib.Path(os.environ.get("LOCALAPPDATA") or home) / identifier,
        home / "Library" / "Logs" / identifier,
        pathlib.Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share") / identifier,
    ]
    lines: list[str] = []
    for log in (one for folder in folders for one in folder.glob("**/orden.log")):
        lines += [line for line in log.read_text(encoding="utf-8", errors="replace").splitlines() if "stall" in line]
    return lines[-20:]
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-web-tab-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret, 8)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.answer("!!orden.workspace").get("value") is not True:
            time.sleep(1)
        time.sleep(2)
        said = app.answer("orden.workspace.openBlank('One', '# One\\n\\nSome words.'); return true", 20)
        if said.get("value") is not True:
            raise SystemExit(f"no note was opened: {said}")
        time.sleep(2)
        if why := window_answers(process.pid):
            raise SystemExit(f"before any web tab: {why}")
        for count in range(1, TABS + 1):
            forward(process.pid)
            time.sleep(1)
            said = app.answer(f"orden.workspace.openPage({json.dumps(f'{url}{count}')}); return true", 20)
            if said.get("value") is not True:
                raise SystemExit(f"web tab {count} was not opened: {said}")
            wrong += watched(app, process.pid, count)
            if wrong:
                break
        if not wrong:
            wrong += steps(app, process.pid, url)
        if not wrong:
            before = app.answer("return orden.workspace.tabs.length", 20).get("value")
            app.answer(f"orden.workspace.openPage({json.dumps(f'{url}storm')}); return true", 20)
            time.sleep(8)
            after = app.answer("return orden.workspace.tabs.length", 20).get("value")
            if not isinstance(before, int) or after != before + 1:
                wrong.append(f"400 window.open calls without a gesture: {before} tabs became {after}, not {before} + the storm's own")
            if why := window_answers(process.pid):
                wrong.append(f"after the window.open storm: {why}")
    finally:
        ended(process)
        site.shutdown()
        if wrong:
            for line in stalls(args.identifier):
                print(line, flush=True)
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
