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
import mss
import psutil
from PIL import Image
from fresh_app import ended, fresh
from native_app import INNER, App, config_of, endpoint, forward

COLOUR = (200, 30, 30)
PICTURE = (255, 0, 255)
STILL = (
    "orden.pages.each().forEach(([, one]) => { one.shot = \"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'"
    " width='8' height='8'><rect width='8' height='8' fill='%23ff00ff'/></svg>\"; one.shotAt = Date.now() + 3600000 }); return true"
)
PAGE = b"""<!doctype html><title>film</title>
<body style="margin:0;height:100vh;background:rgb(200,30,30)">
<div id="beat" style="position:fixed;left:0;top:0;width:40px;height:40px;background:#000"></div>
<script>let n = 0; (function beat() { document.getElementById('beat').style.opacity = ++n % 2 ? '1' : '0.5'; requestAnimationFrame(beat) })()</script>
</body>"""
STILL_PAGE = b"""<!doctype html><title>still</title>
<body style="margin:0;height:100vh;background:rgb(200,30,30)"></body>"""
PALETTE = (
    "(() => { const mac = navigator.platform.startsWith('Mac');"
    " window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));"
    " return true })()"
)
ESCAPE = (
    "(() => { const at = document.activeElement || document;"
    " at.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true })()"
)
LAG = 17
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body = STILL_PAGE if "still" in self.path else PAGE
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
PANE = (
    "(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible && !one.sent.away);"
    " return all[0] ? all[0][1].sent.pane : null })()"
)
LIVE = "orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible && !one.sent.away)"
SIDE = "document.querySelector('.column:not(.right) > aside[data-sidebar]')"
def logging(selector: str) -> str:
    return (
        "window.__film = []; const started = Date.now();"
        "const go = () => {"
        f" const one = {selector};"
        " const drawn = one && one.checkVisibility({ visibilityProperty: true }) && !one.hasAttribute('data-covers-held');"
        " const box = drawn ? one.getBoundingClientRect() : null;"
        " const sent = (orden.pages.each().find(([, page]) => page.sent && page.sent.visible) || [])[1];"
        " const cut = sent && sent.sent.cut ? (sent.sent.cut.all ? 'all' : sent.sent.cut.hollows.map((h) => `${Math.round(h.x)}+${Math.round(h.width)}`).join(' ')) : '-';"
        " const held = !!one && one.hasAttribute('data-covers-held');"
        " const still = !!document.querySelector('.hole.still');"
        " window.__film.push([Date.now(), box && [box.x, box.y, box.width, box.height], cut, held, still, sent ? sent.sent.away === true : null]);"
        " if (Date.now() - started < 6000) requestAnimationFrame(go) };"
        "requestAnimationFrame(go); return true"
    )
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
class Film(threading.Thread):
    def __init__(self, box: dict[str, int]) -> None:
        super().__init__(daemon=True)
        self.box, self.frames, self.going = box, [], True
    def run(self) -> None:
        with mss.mss() as grabber:
            while self.going:
                one = grabber.grab(self.box)
                self.frames.append((time.time() * 1000, Image.frombytes("RGB", one.size, one.rgb)))
    def stop(self) -> list[tuple[float, Image.Image]]:
        self.going = False
        self.join(5)
        return self.frames
def near(one: tuple[int, ...], other: tuple[int, ...], by: int = 40) -> bool:
    return all(abs(a - b) <= by for a, b in zip(one, other))
def judged(
    name: str,
    frames: list[tuple[float, Image.Image]],
    log: list[list[Any]],
    pane: dict[str, float],
    strip: dict[str, float],
    out: pathlib.Path,
) -> list[str]:
    drawn = [(one[0], one[1]) for one in log if one[1]]
    first = drawn[0][0] if drawn else None
    if first is not None:
        near_first = [one for one in log if first - 200 <= one[0] <= first + 400]
        print(f"[{name}] app frames around the first draw (t, box, cut, held, still, away):", flush=True)
        for one in near_first[:40]:
            box = one[1]
            print(f"  {round(one[0] - first)} {box and [round(v) for v in box]} {one[2:]}", flush=True)
    bad: list[float] = []
    ahead: list[float] = []
    for index, (at, image) in enumerate(frames):
        seen = [one[1] for one in log if one[0] <= at - LAG]
        box = seen[-1] if seen else None
        if not box:
            continue
        left = max(box[0], pane["x"]) + 6
        right = min(box[0] + box[2], pane["x"] + pane["width"]) - 6
        if right <= left:
            continue
        scale = image.width / strip["width"]
        xs = [left + (right - left) * step / 8 for step in range(9)]
        seen_at = [image.getpixel((min(image.width - 1, round((x - strip["x"]) * scale)), image.height // 2)) for x in xs]
        if any(near(one, PICTURE) for one in seen_at):
            ahead.append(at)
        if any(near(one, COLOUR) for one in seen_at):
            bad.append(at)
            image.save(out / f"{name}-{index:03d}.png")
    span = round(bad[-1] - bad[0]) if bad else 0
    rate = round(len(frames) / max(0.001, (frames[-1][0] - frames[0][0]) / 1000)) if len(frames) > 1 else 0
    print(
        f"[{name}] {len(frames)} screen frames at {rate}/s, layer first drawn at {first and round(first - frames[0][0])} ms,"
        f" page over the layer in {len(bad)} frames over {span} ms,"
        f" the hollow drawn before the layer in {len(ahead)} frames",
        flush=True,
    )
    if bad:
        return [f"{name}: the page is drawn over the layer in {len(bad)} screen frames ({span} ms)"]
    return []
def filmed(app: App, inner: dict[str, float], selector: str, strip: dict[str, float], start: Any) -> tuple[list[tuple[float, Image.Image]], list[list[Any]]]:
    x, y = screen(inner, strip["x"], strip["y"])
    far_x, far_y = screen(inner, strip["x"] + strip["width"], strip["y"] + strip["height"])
    film = Film({"left": round(x), "top": round(y), "width": max(1, round(far_x - x)), "height": max(1, round(far_y - y))})
    app.eval(STILL)
    app.eval(logging(selector))
    film.start()
    time.sleep(0.3)
    start()
    time.sleep(3)
    frames = film.stop()
    log = app.eval("return window.__film") or []
    return frames, log if isinstance(log, list) else []
def delays(frames: list[tuple[float, Image.Image]], log: list[list[Any]], strip: dict[str, float], asked: float | None) -> str:
    drawn = [(one[0], one[1]) for one in log if one[1]]
    if not drawn or asked is None or not frames:
        return "never drawn"
    box = drawn[-1][1]
    scale = frames[0][1].width / strip["width"]
    left, right = max(box[0], strip["x"]) + 6, min(box[0] + box[2], strip["x"] + strip["width"]) - 6
    xs = [min(frames[0][1].width - 1, max(0, round((left + (right - left) * step / 8 - strip["x"]) * scale))) for step in range(9)]
    row = frames[0][1].height // 2
    base = [frames[0][1].getpixel((x, row)) for x in xs]
    shown = next((at for at, image in frames if any(not near(image.getpixel((x, row)), one) and not near(image.getpixel((x, row)), PICTURE) for x, one in zip(xs, base))), None)
    on_screen = "never" if shown is None else f"{round(shown - asked)} ms"
    return f"app {round(drawn[0][0] - asked)} ms, screen {on_screen}"
def rounds(
    app: App, pid: int, inner: dict[str, float], pane: dict[str, float], middle: tuple[float, float], over: str, out: pathlib.Path, took: dict[str, list[str]]
) -> list[str]:
    wrong: list[str] = []
    strip = {"x": 0, "y": middle[1], "width": pane["x"] + min(pane["width"], 520), "height": 3}
    forward(app, pid)
    moved_to(*screen(inner, *middle))
    time.sleep(1)
    def to_the_edge() -> None:
        app.eval(
            "window.__asked = Date.now(); window.dispatchEvent(new PointerEvent('pointermove',"
            f" {{ clientX: 1, clientY: {middle[1]}, pointerType: 'mouse', bubbles: true }})); return true"
        )
    frames, log = filmed(app, inner, SIDE, strip, to_the_edge)
    came = app.eval("!!document.querySelector('.column.peek')") is True
    print(f"[peek over {over}] the sidebar came out: {came}, the page live beside it: {app.eval(LIVE)}", flush=True)
    asked = app.eval("return window.__asked")
    took.setdefault(f"peek over {over}", []).append(delays(frames, log, strip, asked if isinstance(asked, (int, float)) else None))
    if not came:
        wrong.append(f"peek over {over}: a move to the left edge did not bring the sidebar out")
    elif over == "web":
        wrong += judged("peek", frames, log, pane, strip, out)
        if app.eval(LIVE) is not True:
            wrong.append("peek: the page steps behind its picture while the sidebar peeks over part of it")
        side = app.eval(f"(() => {{ const box = {SIDE}.getBoundingClientRect(); return [box.x, box.width] }})()")
        if isinstance(side, list) and side[0] + side[1] + 80 < pane["x"] + pane["width"]:
            with mss.mss() as grabber:
                at = screen(inner, side[0] + side[1] + 80, middle[1])
                one = grabber.grab({"left": round(at[0]), "top": round(at[1]), "width": 1, "height": 1})
                if not near(one.pixel(0, 0), COLOUR):
                    wrong.append(f"peek: the page is not drawn beside the sidebar: {one.pixel(0, 0)}")
    moved_to(*screen(inner, *middle))
    app.eval(
        "window.dispatchEvent(new PointerEvent('pointermove',"
        f" {{ clientX: {middle[0]}, clientY: {middle[1]}, pointerType: 'mouse', bubbles: true }})); return true"
    )
    time.sleep(1.5)
    if app.eval("!!document.querySelector('.column.peek')") is True:
        wrong.append(f"peek over {over}: the sidebar stayed out after the pointer went back")
    if over == "web" and app.until(LIVE, 4) is not True:
        wrong.append("peek: the page is not live again once the sidebar went")
    card = {"x": middle[0] - 80, "y": middle[1] - 80}
    strip = {"x": pane["x"], "y": middle[1], "width": min(pane["width"], 520 + middle[0] - pane["x"]), "height": 3}
    for name, motion in (
        ("pop", ""),
        ("slide", "one.animate([{ transform: 'translateX(-260px)' }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });"),
    ):
        def put() -> None:
            app.eval(
                "const one = document.createElement('div'); one.className = 'orden-layer'; one.id = 'film-layer';"
                f"Object.assign(one.style, {{ position: 'fixed', left: '{card['x']}px', top: '{card['y']}px',"
                " width: '160px', height: '160px', background: 'rgb(0,160,0)', borderRadius: '10px', zIndex: 9999 });"
                f"window.__asked = Date.now(); document.body.append(one); {motion} return true"
            )
        frames, log = filmed(app, inner, "document.getElementById('film-layer')", strip, put)
        asked = app.eval("return window.__asked")
        took.setdefault(f"{name} over {over}", []).append(delays(frames, log, strip, asked if isinstance(asked, (int, float)) else None))
        if over == "web":
            wrong += judged(name, frames, log, pane, strip, out)
        app.eval("document.getElementById('film-layer')?.remove(); return true")
        time.sleep(1)
    return wrong
def cpu(pid: int, seconds: float) -> int:
    root = psutil.Process(pid)
    every = [root, *root.children(recursive=True)]
    for one in every:
        try:
            one.cpu_percent(None)
        except psutil.Error:
            pass
    time.sleep(seconds)
    total = 0.0
    for one in every:
        try:
            total += one.cpu_percent(None)
        except psutil.Error:
            pass
    return round(total)
def longest_still(frames: list[tuple[float, Image.Image]]) -> int:
    worst, since, last = 0.0, None, None
    for at, image in frames:
        seen = image.getpixel((image.width // 2, image.height // 2))
        if last is None or any(abs(a - b) > 6 for a, b in zip(seen, last)):
            if since is not None:
                worst = max(worst, at - since)
            since = at
        last = seen
    if since is not None and frames:
        worst = max(worst, frames[-1][0] - since)
    return round(worst)
def palette_cost(app: App, pid: int, over: str, beat: tuple[float, float] | None = None) -> str:
    idle = cpu(pid, 3)
    app.eval(PALETTE)
    if app.until("!!document.querySelector('.orden-screen.palette')", 5) is not True:
        return f"{over}: the palette never came up"
    time.sleep(0.5)
    film = Film({"left": round(beat[0]) - 2, "top": round(beat[1]) - 2, "width": 4, "height": 4}) if beat else None
    if film:
        film.start()
    busy = cpu(pid, 4)
    stale = longest_still(film.stop()) if film else None
    app.eval(ESCAPE)
    app.until("!document.querySelector('.orden-screen.palette')", 3)
    time.sleep(1)
    return f"{over}: idle {idle}% of a core, palette up {busy}%" + ("" if stale is None else f", the page under it still for {stale} ms at most")
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/film"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-film-spaces-"))
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
        pane = app.until(f"(() => {{ const pane = {PANE}; return pane && pane.x < 20 ? pane : null }})()")
        if pane is None:
            raise SystemExit(f"the sidebar never shut: {app.eval(PANE)}")
        time.sleep(2)
        forward(app, process.pid)
        time.sleep(0.5)
        inner = app.eval(INNER)
        middle = (pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2)
        took: dict[str, list[str]] = {}
        for over in ("web", "note"):
            if over == "note":
                app.eval("orden.workspace.openBlank('Film', 'words'); return true")
                time.sleep(2)
            wrong += rounds(app, process.pid, inner, pane, middle, over, args.out, took)
        for name, said in took.items():
            print(f"[input to first drawn] {name}: {', '.join(said)}", flush=True)
        costs = [palette_cost(app, process.pid, "note")]
        app.eval(f"orden.workspace.openPage({json.dumps(url)}); return true")
        app.until(LIVE, 40)
        time.sleep(3)
        shown = app.eval(PANE)
        beat = screen(inner, shown["x"] + 20, shown["y"] + 20) if isinstance(shown, dict) else None
        for mode in ("signal", "picture"):
            app.eval(f"globalThis.ordenDrewPicture = {'true' if mode == 'picture' else 'false'}; return true")
            costs.append(palette_cost(app, process.pid, f"web, busy page, {mode}", beat))
        app.eval(f"orden.workspace.openPage({json.dumps(url.replace('/film', '/still'))}); return true")
        time.sleep(4)
        for mode in ("signal", "picture"):
            app.eval(f"globalThis.ordenDrewPicture = {'true' if mode == 'picture' else 'false'}; return true")
            costs.append(palette_cost(app, process.pid, f"web, still page, {mode}"))
        for one in costs:
            print(f"[cpu, a page under the palette for 4 s] {one}", flush=True)
    finally:
        ended(process)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
