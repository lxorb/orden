from __future__ import annotations
import argparse
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
import http.server
from typing import Any
from fresh_app import ended, fresh
from native_app import config_of, endpoint

GEOMETRY = """(async () => {
  const i = window.__TAURI_INTERNALS__
  const ask = (verb) => i.invoke('plugin:window|' + verb, { label: 'main' }).catch((error) => String(error))
  const top = document.querySelector("header[data-chrome='top']")
  const box = top ? top.getBoundingClientRect() : null
  return {
    inner: await ask('inner_size'),
    outer: await ask('outer_size'),
    at: await ask('inner_position'),
    outerAt: await ask('outer_position'),
    scale: await ask('scale_factor'),
    page: [innerWidth, innerHeight, devicePixelRatio],
    bar: box ? [box.left, box.top, box.width, box.height] : null,
    frame: document.documentElement.dataset.frame ?? null,
  }
})()"""
PAGE = b"<!doctype html><title>magenta</title><style>html,body{margin:0;height:100%;background:#ff00ff}</style>"
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)
PANE = """(() => { const all = orden.pages.each().map(([, one]) => one.sent).filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"""
def page_spot(app: Any, out: pathlib.Path, name: str) -> dict[str, Any]:
    try:
        from PIL import ImageGrab
    except Exception as error:  # noqa: BLE001
        return {"error": str(error)}
    seen = app.eval(GEOMETRY)
    pane = app.eval(PANE)
    if not isinstance(seen, dict) or not isinstance(pane, dict) or not isinstance(seen.get("at"), dict):
        return {"error": f"no pane: {pane}"}
    picture = ImageGrab.grab()
    picture.save(out / f"{name}.png")
    scale = float(seen.get("scale") or 1)
    left = seen["at"]["x"]
    top = seen["at"]["y"]
    def pixel(x: float, y: float) -> list[int]:
        return list(picture.getpixel((int(left + x * scale), int(top + y * scale)))[:3])
    bar = seen.get("bar") or [0, 0, 0, 38]
    return {
        "pane": pane,
        "page middle": pixel(pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2),
        "page top": pixel(pane["x"] + pane["width"] / 2, pane["y"] + 4),
        "top bar": pixel(bar[0] + bar[2] - 60, bar[1] + bar[3] / 2),
        "above page": pixel(pane["x"] + pane["width"] / 2, pane["y"] - 6),
    }
def shot(out: pathlib.Path, name: str) -> None:
    try:
        from PIL import ImageGrab
        ImageGrab.grab().save(out / f"{name}.png")
    except Exception as error:  # noqa: BLE001 - a picture is a help, never a failure
        print(f"no picture of {name}: {error}", flush=True)
def overlapped(seen: dict[str, Any]) -> str | None:
    inner, outer, page = seen.get("inner"), seen.get("outer"), seen.get("page")
    if not isinstance(inner, dict) or not isinstance(outer, dict) or not isinstance(page, list):
        return f"the window did not say its size: {seen}"
    scale = float(seen.get("scale") or page[2] or 1)
    drawn = page[1] * scale
    if abs(drawn - inner["height"]) > 2 * scale:
        return f"the page is {drawn:.0f}px tall in a window whose content is {inner['height']}px"
    return None
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("system-frame"))
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-frame-spaces-"))
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen(
        [str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT
    )
    wrong: list[str] = []
    seen: dict[str, Any] = {}
    try:
        app = endpoint(config, process.pid, secret, 20)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(2)
        site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=site.serve_forever, daemon=True).start()
        app.eval(f"orden.workspace.openPage('http://127.0.0.1:{site.server_address[1]}/'); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until and not isinstance(app.eval(PANE), dict):
            time.sleep(0.5)
        time.sleep(3)
        seen["orden"] = app.eval(GEOMETRY)
        seen["orden page"] = page_spot(app, args.out, "orden-page")
        app.eval("await window.__TAURI_INTERNALS__.invoke('set_frame', { system: true }); document.documentElement.dataset.frame = 'system'; return true")
        time.sleep(2)
        seen["system"] = app.eval(GEOMETRY)
        seen["system page"] = page_spot(app, args.out, "system-page")
        size = seen["system"].get("outer") if isinstance(seen["system"], dict) else None
        if isinstance(size, dict):
            app.eval(
                "await window.__TAURI_INTERNALS__.invoke('plugin:window|set_size', { label: 'main', value: { Physical: { width: %d, height: %d } } }); return true"
                % (size["width"] - 40, size["height"] - 40)
            )
            time.sleep(2)
            seen["resized"] = app.eval(GEOMETRY)
            shot(args.out, "resized")
        app.eval("await window.__TAURI_INTERNALS__.invoke('set_frame', { system: false }); document.documentElement.dataset.frame = 'orden'; return true")
        time.sleep(2)
        seen["back"] = app.eval(GEOMETRY)
        shot(args.out, "back")
        app.eval(
            "const kept = JSON.parse(localStorage.getItem('orden:modes') || '{}'); kept.frame = 'system';"
            " localStorage.setItem('orden:modes', JSON.stringify(kept)); return true"
        )
        time.sleep(3)
        app.eval("window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }); return true", 5)
        try:
            process.wait(30)
        except subprocess.TimeoutExpired:
            ended(process)
        process = subprocess.Popen(
            [str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT
        )
        app = endpoint(config, process.pid, secret, 20)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(3)
        seen["relaunched"] = app.eval(GEOMETRY)
        shot(args.out, "relaunched")
        for stage, one in seen.items():
            print(f"{stage}: {json.dumps(one)}", flush=True)
        for stage in ("orden", "system", "back", "relaunched"):
            one = seen.get(stage)
            said = overlapped(one) if isinstance(one, dict) else f"no answer: {one}"
            if said:
                wrong.append(f"with {stage}: {said}")
        system, orden = seen.get("system"), seen.get("orden")
        if isinstance(system, dict) and isinstance(orden, dict) and isinstance(system.get("inner"), dict) and isinstance(orden.get("inner"), dict):
            if sys.platform != "linux" and system["inner"]["height"] >= system["outer"]["height"]:
                wrong.append(f"the system's frame took no room above the page: inner {system['inner']}, outer {system['outer']}")
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "seen.json").write_text(json.dumps({"seen": seen, "wrong": wrong}, indent=1), encoding="utf-8")
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
