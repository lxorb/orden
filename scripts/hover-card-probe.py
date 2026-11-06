from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
import json
import pathlib
import shutil
import sys
import threading
import time
from ctypes import wintypes
from typing import Any

from probe_app import close_app, main_window, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Hover card probe"

ENOUGH = 0.15

GREEN_ENOUGH = 0.8

NEAR = 24

def page(colour: str, title: str) -> bytes:
    return (
        f"<!doctype html><title>{title}</title>"
        f'<body style="margin:0;background:{colour};height:100vh"></body>'
    ).encode()

def pdf() -> bytes:

    stream = b"1 0 0.5 rg 0 0 612 792 re f"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for one in offsets:
        out += b"%010d 00000 n \n" % one
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)

PAGES: dict[str, tuple[str, bytes]] = {
    "/green": ("text/html; charset=utf-8", page("#00c040", "Green")),
    "/flat": ("text/html; charset=utf-8", page("#ff0080", "Flat")),
    "/doc.pdf": ("application/pdf", pdf()),
}

def borrowed(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

POINT = """(() => {
  const tab = [...document.querySelectorAll('[data-strip] .tab')]
    .find((one) => (one.textContent ?? '').trim().startsWith('%s'))
  if (!tab) return JSON.stringify(false)
  tab.dispatchEvent(new PointerEvent('%s', { pointerType: 'mouse' }))
  return JSON.stringify(true)
})()"""

ACROSS = """(() => {
  const tabs = [...document.querySelectorAll('[data-strip] .tab')]
  const named = (words) => tabs.find((one) => (one.textContent ?? '').trim().startsWith(words))
  const from = named('%s'), to = named('%s')
  if (!from || !to) return JSON.stringify(false)
  from.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
  to.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
  return JSON.stringify(true)
})()"""

SLIDING = "JSON.stringify(document.querySelector('.card')?.classList.contains('sliding') ?? null)"

WHERE = """(() => {
  const scale = window.devicePixelRatio || 1
  const box = (one) => {
    if (!one) return null
    const at = one.getBoundingClientRect()
    return [at.left, at.top, at.right, at.bottom].map((side) => Math.round(side * scale))
  }
  return JSON.stringify({ card: box(document.querySelector('.card')), still: box(document.querySelector('.card .still')) })
})()"""

NAMES = "JSON.stringify([...document.querySelectorAll('[data-strip] .tab')].map((one) => one.textContent.trim()))"

PRESS = "window.dispatchEvent(new PointerEvent('pointerdown')), 'ok'"

def client_origin(hwnd: int) -> tuple[int, int]:

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    whole = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(whole))
    corner = wintypes.POINT(0, 0)
    user32.ClientToScreen(wintypes.HWND(hwnd), ctypes.byref(corner))
    return corner.x - whole.left, corner.y - whole.top

def same(one: tuple[int, ...], other: tuple[int, ...]) -> bool:
    return all(abs(a - b) <= NEAR for a, b in zip(one, other))

def matching(base: pathlib.Path, shot: pathlib.Path, box: list[int], origin: tuple[int, int], inset: int = 8) -> float:

    from PIL import Image

    left, top, right, bottom = box
    crop = (left + origin[0] + inset, top + origin[1] + inset, right + origin[0] - inset, bottom + origin[1] - inset)
    with Image.open(base) as before, Image.open(shot) as after:
        a = list(before.convert("RGB").crop(crop).get_flattened_data())
        b = list(after.convert("RGB").crop(crop).get_flattened_data())
    return sum(1 for x, y in zip(a, b) if same(x, y)) / max(1, len(a))

def green(shot: pathlib.Path, box: list[int], origin: tuple[int, int], inset: int = 4) -> float:
    from PIL import Image

    left, top, right, bottom = box
    crop = (left + origin[0] + inset, top + origin[1] + inset, right + origin[0] - inset, bottom + origin[1] - inset)
    with Image.open(shot) as picture:
        seen = list(picture.convert("RGB").crop(crop).get_flattened_data())
    return sum(1 for one in seen if same(one, (0x00, 0xC0, 0x40))) / max(1, len(seen))

def main() -> int:
    if sys.platform != "win32":
        print("this drive photographs a Windows window")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--out", type=pathlib.Path, default=HERE.parent / "target" / "hover-card")
    args = parsed.parse_args()

    switch = borrowed("web-switch-probe")
    overlays = borrowed("web-overlays-probe")
    smooth = borrowed("web-smooth-probe")
    shutil.rmtree(args.out, ignore_errors=True)
    args.out.mkdir(parents=True, exist_ok=True)
    overlays.OUT = args.out
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))

    switch.wipe(args.identifier)
    port = switch.free_port()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            kind, body = PAGES.get(self.path, ("text/plain", b"no"))
            self.send_response(200 if self.path in PAGES else 404)
            self.send_header("content-type", kind)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    for name, path in (("Green", "/green"), ("Flat", "/flat"), ("Doc", "/doc.pdf")):
        (space / f"{name}.url").write_text(switch.shortcut(f"http://127.0.0.1:{port}{path}", name), encoding="utf-8")

    said: dict[str, object] = {}
    failed: list[str] = []
    running = None

    def hover(name: str, shot: str, base: pathlib.Path, origin: tuple[int, int], slide_from: str | None) -> None:

        if slide_from:
            app.ask(POINT % (slide_from, "pointerenter"))
            time.sleep(2.0)
            app.ask(smooth.COUNT)
            app.ask(ACROSS % (slide_from, name))
            time.sleep(1.0)
            placed = app.ask(smooth.TAKE)
            if isinstance(placed, list):
                places = [one for one in placed if one[1] == "web_place"]
                said[f"{shot}: placements while it slid"] = len(places)
                if any(one[2] is False for one in places):
                    failed.append(f"{shot}: the page was hidden while the card slid")
        else:
            app.ask(POINT % (name, "pointerenter"))
            time.sleep(2.0)
        where = app.ask(WHERE)
        picture = overlays.shoot(hwnd, shot)
        row: dict[str, object] = {"where": where, "slid": app.ask(SLIDING)}
        if slide_from and row["slid"] is not True:
            failed.append(f"{shot}: the card arrived rather than slid")
        card = where.get("card") if isinstance(where, dict) else None
        if not card:
            failed.append(f"{shot}: no card came up")
        else:
            behind = round(matching(base, picture, card, origin), 3)
            row["card that is still the window without it"] = behind
            if behind > ENOUGH:
                failed.append(f"{shot}: the card is behind the page, {behind} of it")
            still = where.get("still")
            if not still:
                failed.append(f"{shot}: the card has no still")
            else:
                share = round(green(picture, still, origin), 3)
                row["still that is the green page"] = share
                width, height = still[2] - still[0], still[3] - still[1]
                row["still width:height"] = round(width / max(1, height), 3)
                if share < GREEN_ENOUGH:
                    failed.append(f"{shot}: the still is not the page, {share} of it green")
                if abs(width / max(1, height) - 16 / 9) > 0.05:
                    failed.append(f"{shot}: the still is not sixteen by nine")
                if not (card[0] <= still[0] and still[2] <= card[2] and card[1] <= still[1] and still[3] <= card[3]):
                    failed.append(f"{shot}: the still reaches outside the card")
        said[shot] = row
        app.ask(POINT % (name, "pointerleave"))
        time.sleep(1.2)
        gone = app.ask(WHERE)
        after = overlays.shoot(hwnd, f"{shot}-gone")
        back = round(matching(base, after, card, origin), 3) if card else None
        said[f"{shot}, after"] = {"card": gone.get("card") if isinstance(gone, dict) else gone, "window as before": back}
        if isinstance(gone, dict) and gone.get("card"):
            failed.append(f"{shot}: the card stayed after the pointer left")
        if back is not None and back < 0.9:
            failed.append(f"{shot}: the page did not come back whole, {back} of it")

    try:
        running, app, hwnd = switch.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        hwnd = 0
        until = time.perf_counter() + 30
        while not hwnd and time.perf_counter() < until:
            hwnd = main_window(running.pid)
            time.sleep(0.1)
        sized(hwnd, 1600, 1000)
        time.sleep(1)
        origin = client_origin(hwnd)
        said["build"] = app.ask("JSON.stringify(window.nibBuild)")

        app.open("Idea.md", SPACE)
        time.sleep(2)
        app.open("Green.url")
        time.sleep(4)
        app.ask(PRESS)
        time.sleep(1)
        app.open("Flat.url")
        time.sleep(4)
        said["the strip"] = app.ask(NAMES)

        base = overlays.shoot(hwnd, "web-alone")
        hover("Green", "web-card", base, origin, None)
        hover("Green", "web-slid", base, origin, "Flat")

        app.ask(PRESS)
        app.open("Doc.url")
        time.sleep(5)
        said["the strip, with the PDF"] = app.ask(NAMES)
        base = overlays.shoot(hwnd, "pdf-alone")
        hover("Green", "pdf-card", base, origin, None)
        hover("Green", "pdf-slid", base, origin, "Doc")
    finally:
        if running is not None and not close_app(running):
            running.kill()
        server.shutdown()

    print(json.dumps(said, indent=1))
    print(f"\nthe photographs are in {args.out}")
    for one in failed:
        print(f"FAIL: {one}")
    return 1 if failed else 0

if __name__ == "__main__":
    raise SystemExit(main())
