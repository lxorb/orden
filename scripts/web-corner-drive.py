from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
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
from ctypes import wintypes
from typing import Any

from PIL import Image, ImageChops, ImageGrab, ImageStat

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("web_under_drive", HERE / "web-under-drive.py")
under = importlib.util.module_from_spec(spec)
spec.loader.exec_module(under)
from probe_app import main_window, refuse_updating  # noqa: E402
from fresh_app import ended, fresh  # noqa: E402
import crash_told  # noqa: E402

user32 = under.user32
WIDTH, HEIGHT = 1280, 800
CORNER = 14

def page(wide: bool) -> bytes:
    size = "width:300vw;height:300vh" if wide else "width:10px;height:10px"
    return (
        "<!doctype html><title>corner</title><style>html,body{margin:0;background:#ff00ff}"
        f"#far{{{size}}}</style><div id=far></div><script>"
        "const said = () => { const root = document.documentElement;"
        " document.title = 'corner ' + JSON.stringify({ wide: " + ("true" if wide else "false") + ","
        " across: innerWidth - root.clientWidth, down: innerHeight - root.clientHeight,"
        " runs: root.scrollWidth > innerWidth }) };"
        " addEventListener('load', said); addEventListener('resize', said); said()</script>"
    ).encode()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body = page(self.path.startswith("/wide"))
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def corners(shot: Image.Image, hole: tuple[int, int, int, int]) -> list[Image.Image]:
    left, top, right, bottom = hole
    return [
        shot.convert("RGB").crop((left, bottom - CORNER, left + CORNER, bottom)),
        shot.convert("RGB").crop((right - CORNER, bottom - CORNER, right, bottom)),
    ]

def apart(one: Image.Image, other: Image.Image) -> float:
    return max(ImageStat.Stat(ImageChops.difference(one, other)).mean)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{site.server_address[1]}"

    config = under.config_dir(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-corner-spaces-"))
    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces)}
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    wrong: list[str] = []
    try:
        app = under.endpoint(args.identifier, process.pid, secret)
        crash_told.told(app.at, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        hwnd = 0
        while time.monotonic() < until and not hwnd:
            hwnd = main_window(process.pid)
            time.sleep(0.25)
        if not hwnd:
            raise SystemExit("no window")
        user32.ShowWindow(hwnd, 9)
        desk = wintypes.RECT()
        user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
        user32.SetWindowPos(hwnd, None, desk.left, desk.top, min(WIDTH, desk.right - desk.left), min(HEIGHT, desk.bottom - desk.top), 0x0004)
        app.eval("orden.setup.finish(); return true")
        under.forward(hwnd)
        time.sleep(3)
        user32.SetCursorPos(desk.right - 2, desk.bottom - 2)

        shots: dict[bool, tuple[Image.Image, tuple[int, int, int, int], dict]] = {}
        for wide in (False, True):
            if wide:
                app.eval(
                    "const [id] = orden.pages.each().find(([, one]) => one.live && one.sent && one.sent.visible) || [];"
                    f" if (id) orden.pages.go(id, {json.dumps(base + '/wide')}); return !!id"
                )
            else:
                app.eval(f"orden.workspace.openPage({json.dumps(base + '/narrow')}); return true")
            until = time.monotonic() + 40
            metrics: Any = None
            while time.monotonic() < until:
                title = app.eval(
                    "orden.pages.each().filter(([, one]) => one.live && one.sent && one.sent.visible)"
                    ".map(([, one]) => one.title).find((one) => (one || '').startsWith('corner ')) || ''"
                )
                if isinstance(title, str) and title.startswith("corner "):
                    metrics = json.loads(title[len("corner "):])
                    if metrics.get("wide") is wide:
                        break
                time.sleep(0.5)
            pane = app.eval(
                "(() => { const all = orden.pages.each().map(([, one]) => one.sent)"
                ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
            )
            if not isinstance(pane, dict) or not isinstance(metrics, dict):
                raise SystemExit(f"the {'wide' if wide else 'narrow'} page was never shown: {pane} {metrics}")
            time.sleep(4)
            scale = float(app.eval("devicePixelRatio") or 1)
            left, top, _, _ = under.client_box(hwnd)
            hole = (
                left + round(pane["x"] * scale),
                top + round(pane["y"] * scale),
                left + round((pane["x"] + pane["width"]) * scale),
                top + round((pane["y"] + pane["height"]) * scale),
            )
            shot = ImageGrab.grab()
            shot.save(args.out / f"{'wide' if wide else 'narrow'}.png")
            print(f"{'wide' if wide else 'narrow'}: hole {hole}, page says {metrics}", flush=True)
            shots[wide] = (shot, hole, metrics)

        narrow, wide = shots[False], shots[True]
        if not wide[2].get("runs"):
            wrong.append(f"the wide page does not run wider than the pane: {wide[2]}")
        if narrow[1] != wide[1]:
            wrong.append(f"the two pages sit in different holes: {narrow[1]} {wide[1]}")
        for name, one, other in zip(("bottom left", "bottom right"), corners(narrow[0], narrow[1]), corners(wide[0], wide[1])):
            one.resize((CORNER * 8, CORNER * 8), Image.NEAREST).save(args.out / f"{name.replace(' ', '-')}-narrow.png")
            other.resize((CORNER * 8, CORNER * 8), Image.NEAREST).save(args.out / f"{name.replace(' ', '-')}-wide.png")
            by = apart(one, other)
            print(f"{name}: the corners differ by {by:.1f} on average", flush=True)
            if by > 6:
                wrong.append(f"the {name} corner of a page that runs wide is not drawn like a page that does not: {by:.1f}")
    finally:
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    (args.out / "wrong.json").write_text(json.dumps(wrong, indent=1), encoding="utf-8")
    print(f"{len(wrong)} wrong", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
