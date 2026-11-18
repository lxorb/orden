from __future__ import annotations

import argparse
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
from native_app import INNER, App, config_of, endpoint, forward

PAGE = b"""<!doctype html><title>edges</title>
<body style="margin:0;height:100vh;font:24px sans-serif">a page from edge to edge</body>"""

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

PANE = (
    "(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible);"
    " return all[0] ? all[0][1].sent.pane : null })()"
)

PEEKS = "!!document.querySelector('.column.peek')"
BAR = "!!document.querySelector('.bar.shown[data-covers]')"

def moved_to(x: float, y: float) -> None:
    x, y = round(x), round(y)
    if sys.platform == "win32":
        import ctypes

        ctypes.WinDLL("user32", use_last_error=True).SetCursorPos(x, y)
    else:
        import Quartz

        made = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (x, y), Quartz.kCGMouseButtonLeft)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, made)

def screen(inner: dict[str, float], x: float, y: float) -> tuple[float, float]:
    if sys.platform == "darwin":
        return inner["x"] / inner["scale"] + x, inner["y"] / inner["scale"] + y
    return inner["x"] + x * inner["ratio"], inner["y"] + y * inner["ratio"]

def glided(app: App, pid: int, path: list[tuple[float, float]]) -> None:
    forward(app, pid)
    time.sleep(0.5)
    inner = app.eval(INNER)
    for x, y in path:
        moved_to(*screen(inner, x, y))
        time.sleep(0.12)

def toward(start: tuple[float, float], end: tuple[float, float], steps: int = 8) -> list[tuple[float, float]]:
    return [(start[0] + (end[0] - start[0]) * one / steps, start[1] + (end[1] - start[1]) * one / steps) for one in range(steps + 1)]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/edges"

    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-edge-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        forward(app, process.pid)
        time.sleep(2)
        app.eval(f"orden.workspace.openPage({json.dumps(url)}); return true")
        if app.until(PANE, 40) is None:
            raise SystemExit("the page was never shown")

        app.eval("if (orden.workspace.panel) orden.workspace.toggleSidebar('left'); return true")
        pane = app.until(f"(() => {{ const pane = {PANE}; return pane && pane.x < 1 ? pane : null }})()")
        if pane is None:
            raise SystemExit(f"the page never reached the window's left edge: {app.eval(PANE)}")
        middle = (pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2)
        glided(app, process.pid, [middle])
        time.sleep(1)
        if app.eval(PEEKS) is True:
            wrong.append("the sidebar came out with the pointer in the middle of the page")
        glided(app, process.pid, toward(middle, (1, middle[1])))
        peeked = app.until(PEEKS, 4) is True
        print(f"left edge over the page {pane}: the sidebar came out: {peeked}", flush=True)
        if not peeked:
            wrong.append("the pointer at the left edge over a web page did not bring the shut sidebar out")
        glided(app, process.pid, toward((1, middle[1]), middle))
        time.sleep(1)

        app.eval("orden.workspace.panes.fills = orden.workspace.panes.focusedId; return true")
        if app.until("!!document.querySelector('.bar[data-covers]')") is not True:
            raise SystemExit("the page never filled the window")
        time.sleep(1.5)
        pane = app.eval(PANE)
        middle = (pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2)
        glided(app, process.pid, [middle])
        time.sleep(1)
        if app.eval(BAR) is True:
            wrong.append("the full window's bar came out with the pointer in the middle of the page")
        glided(app, process.pid, toward(middle, (middle[0], 1)))
        shown = app.until(BAR, 4) is True
        print(f"top edge of the window, above the filled page {pane}: the bar came out: {shown}", flush=True)
        if not shown:
            wrong.append("the pointer at the top edge of a filled window did not bring the bar out")
    finally:
        ended(process)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
