from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import struct
import sys
import threading
import time
import zlib

from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent

MAGENTA = (255, 0, 255)

def borrowed():

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def png(size: int, rgb: tuple[int, int, int]) -> bytes:

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes(rgb) * size
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(row * size))
        + chunk(b"IEND", b"")
    )

PAGE = (
    b'<!doctype html><title>Magenta</title><link rel="icon" href="/mark.png">'
    b'<body style="font:16px system-ui;padding:2rem"><h1>Magenta</h1></body>'
)

def serve(port: int) -> http.server.ThreadingHTTPServer:
    routes = {"/page": ("text/html", PAGE), "/mark.png": ("image/png", png(32, MAGENTA))}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            kind, body = routes.get(self.path, ("text/plain", b""))
            self.send_response(200 if body else 404)
            self.send_header("content-type", kind)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    made.daemon_threads = True
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made

STRIP = """(async () => {
  const tab = nib.workspace.tabs.find((one) => one.kind === 'web' && (one.address ?? '').includes('/page'))
  if (!tab) return JSON.stringify({ tab: null })
  const img = document.querySelector(`[data-tab="${tab.id}"] .face img`)
  const src = img?.getAttribute('src') ?? ''
  const drawn = !!(img && img.complete && img.naturalWidth > 0)
  let live = false
  try {
    await window.__TAURI_INTERNALS__.invoke('web_place', {
      tab: tab.id, pane: { x: 0, y: 0, width: 10, height: 10 }, visible: false,
    })
    live = true
  } catch {}
  return JSON.stringify({
    tab: tab.id,
    path: tab.path,
    showing: tab.id === nib.workspace.activeTabId,
    mark: src.slice(0, 22) || 'globe',
    drawn,
    live,
    kept: (localStorage.getItem('orden:favicons') ?? '').includes('/page'),
  })
})()"""

def photograph(identifier: str, shot: pathlib.Path) -> str:

    from playwright.sync_api import sync_playwright

    port_file = next(borrowed().local_dir(identifier).rglob("DevToolsActivePort"), None)
    if port_file is None:
        return "no DevTools port"
    port = port_file.read_text().splitlines()[0].strip()
    with sync_playwright() as driver:
        browser = driver.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        page = next(
            (
                one
                for context in browser.contexts
                for one in context.pages
                if "tauri.localhost" in one.url or one.url.startswith("tauri:")
            ),
            None,
        )
        if page is None:
            return "no app page behind the DevTools port"
        page.screenshot(path=str(shot))
        browser.close()
    return ""

def magenta_in_strip(picture: pathlib.Path) -> int:

    from PIL import Image

    with Image.open(picture) as image:
        rgb = image.convert("RGB")
        width, height = rgb.size
        band = rgb.crop((0, 0, width, min(height, max(120, height // 8))))
        return sum(1 for r, g, b in band.get_flattened_data() if r > 200 and g < 70 and b > 200)

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="so.orden.Orden.probe")
    parsed.add_argument("--shot", type=pathlib.Path, default=pathlib.Path("favicon-cache.png"))
    args = parsed.parse_args()

    switch = borrowed()
    switch.wipe(args.identifier)
    port = switch.free_port()
    server = serve(port)
    url = f"http://127.0.0.1:{port}/page"

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")

    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=0"

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
        app.open("Idea.md", switch.SPACE)
        time.sleep(2)
        until = time.perf_counter() + 60
        opened: object = None
        while time.perf_counter() < until and opened != "opened":
            opened = app.ask(f"nib.workspace.openPage({json.dumps(url)}) && 'opened'")
            if opened != "opened":
                time.sleep(1)
        said["opened"] = opened
        until = time.perf_counter() + 30
        before: object = None
        while time.perf_counter() < until:
            before = app.ask(STRIP)
            if isinstance(before, dict) and before.get("drawn") and before.get("kept"):
                break
            time.sleep(0.5)
        said["before the restart"] = before
        app.ask(
            "nib.workspace.activate(nib.workspace.tabs.find((one) => one.kind === 'note').id)"
            " || 'note'"
        )
        time.sleep(3)
        if not close_app(running):
            raise SystemExit("the app did not close when asked")
        first_port = app.port

        running, app, hwnd = switch.launch(args.exe, args.identifier, unlike=first_port)
        after: object = None
        until = time.perf_counter() + 30
        while time.perf_counter() < until:
            after = app.ask(STRIP)
            if isinstance(after, dict) and after.get("tab") and after.get("mark") != "globe":
                break
            time.sleep(0.2)
        time.sleep(0.5)
        after = app.ask(STRIP)
        said["after the restart"] = after

        shot = args.shot.resolve()
        failed = photograph(args.identifier, shot)
        said["picture"] = failed or str(shot)
        said["magenta pixels in the strip"] = magenta_in_strip(shot) if shot.exists() else 0
        said["window"] = hex(hwnd)
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    after = said.get("after the restart")
    good = (
        isinstance(after, dict)
        and after.get("mark") == "data:image/png;base64,"
        and after.get("drawn") is True
        and after.get("live") is False
        and after.get("showing") is False
        and int(str(said.get("magenta pixels in the strip", 0))) > 50
    )
    print("PASS" if good else "FAIL")
    return 0 if good else 1

if __name__ == "__main__":
    raise SystemExit(main())
