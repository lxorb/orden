from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
import json
import math
import pathlib
import sys
import threading
import time
from ctypes import wintypes
from typing import Any

from probe_app import close_app, main_window, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Web bounds probe"

NEAR = 1

WAITS = 8.0

FLAT = b"""<!doctype html><title>Flat</title>
<body style="margin:0;background:#ff0080;height:100vh"></body>"""
OTHER = b"""<!doctype html><title>Other</title>
<body style="margin:0;background:#00a0ff;height:100vh"></body>"""

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True) if sys.platform == "win32" else None

def borrowed(name: str) -> Any:

    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def origin(hwnd: int) -> tuple[int, int]:

    assert user32 is not None
    point = wintypes.POINT(0, 0)
    user32.ClientToScreen(wintypes.HWND(hwnd), ctypes.byref(point))
    return (point.x, point.y)

def drawn_at(hwnd: int, x: int, y: int) -> bool:

    assert user32 is not None and gdi32 is not None
    region = gdi32.CreateRectRgn(0, 0, 0, 0)
    try:
        if user32.GetWindowRgn(wintypes.HWND(hwnd), region) == 0:
            return True
        return bool(gdi32.PtInRegion(region, x, y))
    finally:
        gdi32.DeleteObject(region)

HOLES = """(() => {
  const holes = [...document.querySelectorAll('.hole')].map((one) => one.getBoundingClientRect())
    .filter((box) => box.width >= 1 && box.height >= 1)
  const over = (box) => holes.some((hole) => box.left < hole.right && hole.left < box.right
    && box.top < hole.bottom && hole.top < box.bottom)
  const layers = [...document.querySelectorAll(
    '.nib-layer, .nib-bubble, .nib-screen, .nib-swipe, [data-notices] > *, .nib-scrim')]
    .filter((one) => { const box = one.getBoundingClientRect(); return box.width > 0 && box.height > 0 && over(box) })
    .map((one) => one.className.toString().slice(0, 60))
  return JSON.stringify({
    scale: devicePixelRatio,
    holes: holes.map((box) => [box.left, box.top, box.right, box.bottom]),
    layers,
  })
})()"""

def client_size(hwnd: int) -> tuple[int, int]:
    assert user32 is not None
    box = wintypes.RECT()
    user32.GetClientRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return (box.right - box.left, box.bottom - box.top)

def clipped(box: tuple[int, ...], width: int, height: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    return (max(left, 0), max(top, 0), min(right, width), min(bottom, height))

def snapped(length: float) -> int:

    return math.floor(length + 0.5)

def asked(app: Any) -> dict[str, Any]:
    said = app.ask(HOLES)
    if not isinstance(said, dict):
        raise SystemExit(f"the window did not say where its holes are: {said}")
    return said

def expected(app: Any) -> tuple[float, list[tuple[int, int, int, int]]]:
    said = asked(app)
    scale = float(said["scale"])
    return scale, [
        tuple(snapped(edge * scale) for edge in hole)  # type: ignore[misc]
        for hole in said["holes"]
    ]

def region_box(hwnd: int) -> tuple[int, tuple[int, int, int, int]]:

    assert user32 is not None
    box = wintypes.RECT()
    kind = int(user32.GetWindowRgnBox(wintypes.HWND(hwnd), ctypes.byref(box)))
    return kind, (box.left, box.top, box.right, box.bottom)

class Probe:
    def __init__(self, app: Any, hwnd: int, smooth: Any) -> None:
        self.app, self.hwnd, self.smooth = app, hwnd, smooth
        self.rows: list[dict[str, object]] = []
        self.app_view = 0

    def own(self) -> int:

        if not self.app_view:
            self.app_view = int(self.smooth.app_view(self.hwnd))
        return self.app_view

    def pages(self) -> list[int]:
        own = self.own()
        return [one for one in self.smooth.views(self.hwnd) if one != own]

    def shown_pages(self) -> list[tuple[int, tuple[int, int, int, int]]]:

        ox, oy = origin(self.own())
        found = []
        for one in self.pages():
            if not self.smooth.shown(one):
                continue
            left, top, right, bottom = self.smooth.rect(one)
            found.append((one, (left - ox, top - oy, right - ox, bottom - oy)))
        return found

    def settled(self, seconds: float = 6.0) -> None:

        last: object = None
        still = time.perf_counter()
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            now = [(box, self.smooth.region(one)) for one, box in self.shown_pages()]
            if now != last:
                last, still = now, time.perf_counter()
            elif time.perf_counter() - still > 0.5:
                return
            time.sleep(0.03)

    def check(self, step: str, extra: dict[str, object] | None = None) -> dict[str, object]:

        began = time.perf_counter()
        while True:
            self.settled()
            row = self.measured(step, extra)
            if row["ok"] or time.perf_counter() - began > WAITS:
                break
            time.sleep(0.3)
        row["ms"] = round((time.perf_counter() - began) * 1000)
        self.rows.append(row)
        print(json.dumps(row), flush=True)
        return row

    def measured(self, step: str, extra: dict[str, object] | None) -> dict[str, object]:
        said = asked(self.app)
        scale = float(said["scale"])
        width, height = client_size(self.own())
        holes = [
            clipped(tuple(snapped(edge * scale) for edge in hole), width, height)
            for hole in said["holes"]
        ]
        layers = list(said.get("layers") or [])
        shown = self.shown_pages()
        worst = 0
        unmatched = 0
        cut = 0
        regions: list[dict[str, object]] = []
        apart: dict[str, object] = {}
        free = list(shown)
        for hole in holes:
            best = min(free, key=lambda one: max(abs(a - b) for a, b in zip(one[1], hole)), default=None)
            if best is None:
                unmatched += 1
                continue
            seen = clipped(best[1], width, height)
            off = max(abs(a - b) for a, b in zip(seen, hole))
            if off > worst:
                apart = {"hole": hole, "page": best[1]}
            worst = max(worst, off)
            free.remove(best)
            kind, box = region_box(best[0])
            whole = (0, 0, best[1][2] - best[1][0], best[1][3] - best[1][1])
            if kind != 0 and not (kind == 2 and box == whole) and not layers:
                cut += 1
                regions.append({"kind": kind, "box": box, "page": whole})
        row: dict[str, object] = {
            "step": step,
            "holes": len(holes),
            "pages on screen": len(shown),
            "worst edge off px": worst,
            "page without a hole": len(free),
            "hole without a page": unmatched,
            "pages cut": cut,
            "scale": scale,
            **({"regions": regions} if regions else {}),
            **apart,
            **({"pages without a hole": [box for _, box in free]} if free else {}),
            **({"layers over": layers} if layers else {}),
            **(extra or {}),
        }
        row["ok"] = bool(worst <= NEAR and not free and not unmatched and not cut and row.get("ok", True))
        return row

def tabs(app: Any) -> list[list[Any]]:
    said = app.ask(
        "JSON.stringify(nibApp.workspace.tabs.map((one) => [one.id, one.name, one.paneId]))"
    )
    return said if isinstance(said, list) else []

def tab_id(app: Any, name: str) -> str:
    said = tabs(app)
    for tab, named, _pane in said:
        if str(named).startswith(name):
            return str(tab)
    raise SystemExit(f"no tab called {name}: {said}")

def menu_over_the_edge(probe: Probe) -> dict[str, object]:

    shown = probe.shown_pages()
    if not shown:
        return {"step": "menu over the edge", "ok": False, "error": "no page on screen"}
    page, (left, top, right, bottom) = shown[0]
    scale, _ = expected(probe.app)
    width, height, radius = 240, 200, 12
    x = left / scale - width * 2 / 3
    y = top / scale + 60
    probe.app.ask(
        f"""(() => {{
  const one = document.createElement('div')
  one.className = 'nib-layer probe-layer'
  one.style.cssText = 'position:fixed;left:{x}px;top:{y}px;width:{width}px;height:{height}px;border-radius:{radius}px;background:#888;z-index:99999'
  document.body.append(one)
  window.dispatchEvent(new PointerEvent('pointerdown'))
  return 'ok'
}})()"""
    )
    time.sleep(1.0)
    probe.settled()
    inside = round(2 * scale)
    corner = (inside, round((y - top / scale) * scale) + inside)
    middle = (round((x + width - left / scale) * scale / 2), round((y + height / 2 - top / scale) * scale))
    beyond = (round((x + width - left / scale) * scale) + round(20 * scale), corner[1])
    said = {
        "step": "menu over the edge",
        "page drawn in the layer's corner": drawn_at(page, *corner),
        "page drawn in the layer": drawn_at(page, *middle),
        "page drawn beside the layer": drawn_at(page, *beyond),
    }
    said["ok"] = (
        not said["page drawn in the layer's corner"]
        and not said["page drawn in the layer"]
        and said["page drawn beside the layer"]
    )
    probe.app.ask(
        "document.querySelector('.probe-layer')?.remove(), window.dispatchEvent(new PointerEvent('pointerdown')), 'ok'"
    )
    probe.rows.append(said)
    print(json.dumps(said), flush=True)
    return said

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    switch = borrowed("web-switch-probe")
    smooth = borrowed("web-smooth-probe")
    assert user32 is not None
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))

    switch.wipe(args.identifier)
    port = switch.free_port()
    served = {"/flat": FLAT, "/other": OTHER}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = served.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    for name, path in (("Flat", "/flat"), ("Other", "/other")):
        (space / f"{name}.url").write_text(
            switch.shortcut(f"http://127.0.0.1:{port}{path}", name), encoding="utf-8"
        )

    running = None
    probe: Probe | None = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
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
        probe = Probe(app, hwnd, smooth)
        probe.own()

        app.open("Idea.md", SPACE)
        time.sleep(1.5)
        app.ask("nibApp.workspace.keep(nibApp.workspace.activeTabId), 'ok'")
        app.ask("nibApp.workspace.closePanel(), 'ok'")
        app.open("Flat.url")
        smooth.page_view(hwnd)
        time.sleep(1.5)
        probe.check("open")

        sized(hwnd, 1900, 1150)
        probe.check("wider")
        sized(hwnd, 1300, 860)
        probe.check("narrower")

        app.ask("nibApp.workspace.showPanel('tree'), 'ok'")
        probe.check("sidebar open")
        app.ask("nibApp.workspace.movePanel('tree', 'right'), 'ok'")
        probe.check("sidebar to the other side")
        app.ask("nibApp.workspace.movePanel('tree', 'left'), 'ok'")
        probe.check("sidebar back")
        app.ask("nibApp.workspace.closePanel(), 'ok'")
        probe.check("sidebar shut")

        for step in range(1, 31):
            sized(hwnd, 1300 + step * 17, 860 + step * 9)
            time.sleep(0.016)
        probe.check("resized a frame at a time")
        for _ in range(3):
            app.ask("nibApp.workspace.showPanel('tree'), 'ok'")
            time.sleep(0.05)
            app.ask("nibApp.workspace.closePanel(), 'ok'")
            time.sleep(0.05)
        app.ask("nibApp.workspace.showPanel('tree'), 'ok'")
        probe.check("sidebar pressed over and over")
        for step in range(1, 21):
            sized(hwnd, 1810 - step * 20, 1130 - step * 10)
            if step == 8:
                app.ask("nibApp.workspace.closePanel(), 'ok'")
            time.sleep(0.016)
        probe.check("resized while the sidebar shut")

        flat = tab_id(app, "Flat")
        app.ask(f"nibApp.workspace.keep('{flat}'), 'ok'")
        if not any(str(one[1]).startswith("Idea") for one in tabs(app)):
            app.open("Idea.md")
            time.sleep(0.8)
            app.ask(f"nibApp.workspace.activate('{flat}'), 'ok'")
        idea = tab_id(app, "Idea")
        app.ask(f"nibApp.workspace.split('row', '{idea}'), 'ok'")
        time.sleep(0.5)
        pane = app.ask(
            "JSON.stringify([...document.querySelectorAll('[data-pane]')].map((one) => one.dataset.pane))"
        )
        panes = pane if isinstance(pane, list) else []
        if len(panes) >= 2:
            app.ask(f"nibApp.workspace.moveTab('{flat}', '{panes[-1]}'), nibApp.workspace.activate('{flat}'), 'ok'")
        probe.check("split", {"panes": len(panes)})

        split = app.ask(
            "JSON.stringify(nibApp.workspace.panes.frame.kind === 'split' ? nibApp.workspace.panes.frame.id : null)"
        )
        if isinstance(split, str):
            room = app.ask("JSON.stringify(document.querySelector('[data-panes]').getBoundingClientRect().width)")
            app.ask(f"nibApp.workspace.panes.resize('{split}', 0.3, {room}), nibApp.workspace.panes.settle(), 'ok'")
        probe.check("divider")

        if len(panes) >= 2:
            app.ask(f"nibApp.workspace.panes.fills = '{panes[-1]}', 'ok'")
            probe.check("pane fills the window")
            app.ask("nibApp.workspace.panes.fills = null, 'ok'")
            probe.check("and gives it back")
            app.ask(f"nibApp.workspace.deselect('{panes[-1]}'), 'ok'")
            probe.check("pane shows nothing")
            app.ask(f"nibApp.workspace.activate('{flat}'), 'ok'")
            probe.check("and the page again")

        if len(panes) >= 2:
            app.ask(f"nibApp.workspace.panes.close('{panes[0]}'), 'ok'")
        probe.check("unsplit")

        app.open("Idea.md")
        time.sleep(0.6)
        probe.check("to a note")
        app.open("Flat.url")
        probe.check("and back")

        app.open("Other.url")
        smooth.page_view(hwnd)
        probe.check("to another page")
        app.open("Flat.url")
        probe.check("and back again")

        sized(hwnd, 1410, 120)
        probe.check("too short for the page", {"room": asked(app)["holes"]})
        sized(hwnd, 1410, 910)
        probe.check("room again")

        menu_over_the_edge(probe)
        probe.check("menu gone")

        app.ask(
            "(() => { const one = document.createElement('div'); one.className = 'nib-layer probe-layer';"
            " one.style.cssText = 'position:fixed;right:40px;top:120px;width:220px;height:160px;border-radius:12px;background:#888';"
            " document.body.append(one); window.dispatchEvent(new PointerEvent('pointerdown')); return 'ok' })()"
        )
        time.sleep(0.6)
        for step in range(1, 16):
            sized(hwnd, 1410 + step * 20, 910 + step * 10)
            time.sleep(0.016)
        app.ask("document.querySelector('.probe-layer')?.remove(), window.dispatchEvent(new PointerEvent('pointerdown')), 'ok'")
        probe.check("layer up through a resize, then gone")
    finally:
        if running is not None and not close_app(running):
            running.kill()
        server.shutdown()

    failed = [row for row in (probe.rows if probe else []) if not row.get("ok")]
    print(json.dumps({"steps": len(probe.rows) if probe else 0, "failed": [row["step"] for row in failed]}))
    return 1 if failed or probe is None else 0

if __name__ == "__main__":
    raise SystemExit(main())
