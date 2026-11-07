from __future__ import annotations

import ctypes
import http.server
import importlib.util
import json
import os
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

from harness import ROOT, Drive, Native, end, identifier_of

NEEDS = ("native",)

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong

SPACE = "Full window"
PAGE = "A page"

def borrowed(name: str, file: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Page(http.server.BaseHTTPRequestHandler):

    def do_GET(self) -> None:  # noqa: N802 - the name http.server wants
        body = b"<!doctype html><title>A page</title><body style='margin:0;height:3000px'>page"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass

def rect_of(hwnd: int, user32: Any) -> tuple[int, int, int, int]:
    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return box.left, box.top, box.right, box.bottom

def content_of(hwnd: int, user32: Any) -> tuple[int, int, int, int]:
    box = wintypes.RECT()
    user32.GetClientRect(wintypes.HWND(hwnd), ctypes.byref(box))
    corner = wintypes.POINT(0, 0)
    user32.ClientToScreen(wintypes.HWND(hwnd), ctypes.byref(corner))
    return corner.x, corner.y, corner.x + box.right, corner.y + box.bottom

HOLE = """(() => {
  const hole = document.querySelector('.hole')?.getBoundingClientRect()
  return JSON.stringify({
    hole: hole ? [hole.x, hole.y, hole.width, hole.height] : null,
    scale: devicePixelRatio,
    fills: orden.workspace.panes.fills,
  })
})()"""

def window_of(native: Native, app: Any) -> int:
    until = time.perf_counter() + 90
    while time.perf_counter() < until:
        if window := native.probe.main_window(app.pid):
            return int(window)
        time.sleep(0.2)
    raise SystemExit("the app never showed its window")

def near(one: tuple[int, ...], other: tuple[int, ...], slack: int = 2) -> bool:
    return all(abs(a - b) <= slack for a, b in zip(one, other, strict=True))

def drive(_browser: object) -> None:
    if sys.platform != "win32":
        raise SystemExit("this probe drives a Windows build")

    exe = Path(os.environ["ORDEN_PROBE_EXE"])
    identifier = identifier_of(exe)
    native = Native(DRIVE, exe)
    switch = borrowed("switch", "web-switch-probe.py")
    cursor = borrowed("cursor", "web-cursor-probe.py")
    user32 = ctypes.WinDLL("user32", use_last_error=True)

    origin = DRIVE.side(Page)
    switch.wipe(identifier)
    space = native.spaces / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / f"{PAGE}.url").write_text(switch.shortcut(f"{origin}/page", PAGE), encoding="utf-8")

    app = native.start()
    port, _ = switch.endpoint(identifier, 90)
    window_of(native, app)
    if not native.probe.close_app(app):
        end(app)
    switch.allow_eval(identifier)
    app = native.start()
    port, secret = switch.endpoint(identifier, 90, unlike=port)
    asked = switch.App(port, secret)

    window = window_of(native, app)
    native.probe.sized(window, 1280, 860)
    time.sleep(1.5)

    asked.open("Idea.md", SPACE)
    time.sleep(2)
    asked.open(f"{PAGE}.url")

    site = 0
    until = time.perf_counter() + 60
    while not site and time.perf_counter() < until:
        shown = [one for one in cursor.engines(window) if one[2]]
        if len(shown) == 2:
            site = min(shown, key=lambda one: cursor.area(one[0]))[0]
        time.sleep(0.3)
    if not site:
        raise SystemExit("the page never came up beside the app's own")
    time.sleep(1)

    content = content_of(window, user32)
    before = rect_of(site, user32)
    said = asked.ask(HOLE)
    say(f"content {content}, page {before}, {json.dumps(said)}")
    scale = float(said["scale"])
    x, y, width, height = said["hole"]
    hole = (
        content[0] + round(x * scale),
        content[1] + round(y * scale),
        content[0] + round((x + width) * scale),
        content[1] + round((y + height) * scale),
    )
    if not near(before, hole):
        wrong(f"before filling, the page {before} is not over its hole {hole}")

    seen: list[tuple[int, int, int, int]] = []
    watching = threading.Event()

    def watch() -> None:
        while not watching.is_set():
            box = rect_of(site, user32)
            if not seen or seen[-1] != box:
                seen.append(box)
            time.sleep(0.002)

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    ran = switch.act(port, secret, "commands.run", {"id": "full-window"})
    say(f"commands.run full-window: {ran}")
    time.sleep(2)
    watching.set()
    watcher.join()

    filled = rect_of(site, user32)
    said = asked.ask(HOLE)
    say(f"filled: page {filled}, {json.dumps(said)}")
    if not said.get("fills"):
        wrong("the palette's row did not fill the window")
    bar = round(said["hole"][1] * scale)
    wanted = (content[0], content[1] + bar, content[2], content[3])
    if not near(filled, wanted):
        wrong(f"filled, the page is {filled} rather than the content area under its bar {wanted}")
    say(f"the page's window on the way in: {seen}")
    if seen != [before, filled]:
        wrong(f"the page went through {len(seen) - 1} sizes on the way in, not one: {seen}")

    switch.act(port, secret, "commands.run", {"id": "full-window"})
    time.sleep(2)
    after = rect_of(site, user32)
    say(f"back: page {after}")
    if not near(after, before):
        wrong(f"back, the page is {after} rather than where it was, {before}")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the page fills the window in one step", browser=False))
