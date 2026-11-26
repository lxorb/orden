from __future__ import annotations
import argparse
import ctypes
import http.server
import importlib
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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
keys = importlib.import_module("parity-keys-drive")
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

PLATFORM = keys.PLATFORM
COLOURS = {"red": (220, 30, 30), "green": (30, 200, 60), "blue": (40, 60, 220)}
CLAIMS_WITHIN = 10
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        name = self.path.strip("/").split("?")[0]
        r, g, b = COLOURS.get(name, (255, 255, 255))
        body = f"<!doctype html><title>{name}</title><style>html,body{{margin:0;height:100%;background:rgb({r},{g},{b})}}</style>".encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
BUILD = """
const ws = orden.workspace
const made = (name) => { ws.openBlank(name, '# ' + name + '\\n\\nWords'); return ws.activeTabId }
const left = ws.panes.focusedId
const noteLeft = made('Left')
const red = ws.openPage(BASE + '/red')
const right = ws.panes.split('row', left)
if (!right) return null
const noteRight = made('Right')
const green = ws.openPage(BASE + '/green')
const blue = ws.openPage(BASE + '/blue')
for (const id of [noteRight, green, blue]) ws.moveTab(id, right.id)
ws.activate(blue)
ws.activate(red)
ws.activate(green)
return { left, right: right.id, noteLeft, noteRight, red, green, blue }
"""
FIND = """
const ws = orden.workspace
const note = (name) => ws.tabs.find((one) => one.shown === name)?.id ?? null
const urlOf = (one) => one.address || (orden.pages.each().find(([id]) => id === one.id) || [null, {}])[1].url || ''
const page = (colour) => ws.tabs.find((one) => urlOf(one).split('?')[0].endsWith('/' + colour))?.id ?? null
return { noteLeft: note('Left'), noteRight: note('Right'), red: page('red'), green: page('green'), blue: page('blue') }
"""
def seen(screen: Any, app: Any) -> dict[str, int]:
    left, top, scale = screen.origin()
    size = app.eval("({ w: innerWidth, h: innerHeight })")
    if not isinstance(size, dict):
        return {}
    image = screen.shot()
    counts = {name: 0 for name in COLOURS}
    step = 16
    for y in range(8, int(size["h"]) - 8, step):
        for x in range(8, int(size["w"]) - 8, step):
            colour = screen.colour(image, left + x * scale, top + y * scale)
            for name, want in COLOURS.items():
                if keys.near(colour, want, 30):
                    counts[name] += 1
    return counts
def back(app: Any, seconds: float = 90) -> bool:
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        try:
            if app.eval("!!orden.workspace && orden.workspace.tabs.length > 0", 5) is True:
                return True
        except Exception:  # noqa: BLE001 - the app is reloading and may not answer yet
            pass
        time.sleep(0.5)
    return False
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if PLATFORM == "windows":
        from probe_app import refuse_updating
        refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)
    wrote_rc = keys.prepared_linux()
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{site.server_address[1]}"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-reload-spaces-"))
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
    rows: list[dict[str, Any]] = []
    def row(check: str, said: Any, ok: bool | None) -> None:
        rows.append({"check": check, "said": said, "ok": ok})
        print(f"{check}: ok {ok}; {json.dumps(said)[:600]}", flush=True)
    try:
        app = endpoint(config, process.pid, secret, 30)
        if not back(app):
            raise SystemExit("the app never answered")
        if PLATFORM == "windows":
            from ctypes import wintypes
            from probe_app import main_window
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            hwnd = main_window(process.pid)
            desk = wintypes.RECT()
            user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
            user32.ShowWindow(hwnd, 9)
            user32.SetWindowPos(hwnd, None, desk.left, desk.top, min(1280, desk.right - desk.left), min(800, desk.bottom - desk.top), 0x0004)
        forward(app, process.pid)
        time.sleep(22)
        app.eval("document.querySelector('.orden-screen.sheet[role=\"dialog\"] button[data-lands]')?.click(); return true")
        ids = app.eval(BUILD.replace("BASE", json.dumps(base)))
        if not isinstance(ids, dict):
            raise SystemExit(f"the panes were not built: {ids}")
        if app.until("orden.pages.each().filter(([, one]) => one.live && one.sent && one.sent.visible).length >= 2 || null", 40) is None:
            raise SystemExit("the two pages were never shown")
        time.sleep(2)
        screen = keys.Screen(process.pid, app)
        before = seen(screen, app)
        screen.shot().save(args.out / "before.png")
        row("before the reload the two front pages are on the screen and the one behind is not", before, before.get("red", 0) > 0 and before.get("green", 0) > 0 and before.get("blue", 0) == 0)
        app.eval("window.__beforeReload = true; setTimeout(() => location.reload(), 50); return true")
        reloaded = False
        until = time.monotonic() + 90
        while time.monotonic() < until and not reloaded:
            time.sleep(0.5)
            try:
                reloaded = app.eval("!window.__beforeReload && !!orden.workspace && orden.workspace.tabs.length > 0", 5) is True
            except Exception:  # noqa: BLE001 - the app is reloading and may not answer yet
                pass
        if not reloaded:
            raise SystemExit("the app never came back from its reload")
        time.sleep(2)
        forward(app, process.pid)
        ids = app.eval(FIND)
        print(f"after the reload the tabs are {ids}", flush=True)
        if not isinstance(ids, dict) or not all(ids.values()):
            raise SystemExit(f"the tabs were not all found after the reload: {ids}")
        fronts = app.eval(f"const ws = orden.workspace; ws.activate({json.dumps(ids['noteLeft'])}); ws.activate({json.dumps(ids['noteRight'])}); return ws.panes.all.map((one) => one.activeTabId)")
        print(f"after the reload the panes have {fronts} in front", flush=True)
        time.sleep(1.5)
        notes = seen(screen, app)
        screen.shot().save(args.out / "notes.png")
        row("right after the reload, with a note in front of each pane, no page is drawn anywhere", notes, bool(notes) and not any(notes.values()))
        time.sleep(CLAIMS_WITHIN + 3)
        later = seen(screen, app)
        row("once the time to claim them has passed, still no page is drawn", later, bool(later) and not any(later.values()))
        app.eval(f"orden.workspace.activate({json.dumps(ids['red'])}); orden.workspace.activate({json.dumps(ids['green'])}); return true")
        app.until("orden.pages.each().filter(([, one]) => one.live && one.sent && one.sent.visible).length >= 2 || null", 40)
        time.sleep(3)
        again = seen(screen, app)
        screen.shot().save(args.out / "again.png")
        row("the two pages come back in their panes when their tabs are in front again", again, again.get("red", 0) > 0 and again.get("green", 0) > 0 and again.get("blue", 0) == 0)
    finally:
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        if wrote_rc:
            keys.openbox_rc().unlink(missing_ok=True)
            subprocess.run(["openbox", "--reconfigure"], capture_output=True, check=False)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    wrong = [one for one in rows if one["ok"] is False]
    for one in wrong:
        print(f"::error::{one['check']}: {json.dumps(one['said'])}", flush=True)
    return 1 if wrong or not rows else 0
if __name__ == "__main__":
    raise SystemExit(main())
