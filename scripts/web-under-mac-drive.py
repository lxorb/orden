from __future__ import annotations
import argparse
import http.server
import json
import os
import pathlib
import plistlib
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any
import Quartz
from AppKit import NSApplication, NSCursor, NSScreen
from ApplicationServices import (
    AXUIElementCopyAttributeValue,
    AXUIElementCopyElementAtPosition,
    AXUIElementCreateApplication,
    AXUIElementCreateSystemWide,
    AXUIElementPerformAction,
    AXUIElementSetAttributeValue,
)
from PIL import Image, ImageChops, ImageGrab, ImageStat
from carry_page import PAGE as CARRY_PAGE, carried
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint, known

COLOUR = (255, 0, 255)
LAYER = (0, 160, 0)
PAGE = b"""<!doctype html><title>under</title>
<style>
html,body{margin:0;background:#ff00ff;height:400vh;font:20px sans-serif}
#field{position:fixed;left:40px;top:40px;width:320px;height:40px;font-size:20px}
#press{position:fixed;left:40px;top:120px;width:220px;height:60px}
#drag{position:fixed;left:40px;top:220px;width:80px;height:80px;background:#0000ff}
#drop{position:fixed;left:320px;top:220px;width:160px;height:160px;background:#00ffff}
</style>
<input id=field aria-label="the field"><button id=press>Pressable</button>
<div id=drag draggable=true></div><div id=drop></div>
<script>
window.__log = []
let moves = 0
addEventListener('pointermove', () => moves++, true)
const field = document.getElementById('field')
const say = () => fetch('/heard', { method: 'POST', body: JSON.stringify({ log: __log, value: field.value, scrolled: scrollY, moves }) }).catch(() => {})
const log = (e) => { __log.push([e.type, (e.target && e.target.id) || '']); say() }
for (const kind of ['pointerdown', 'pointerup', 'click', 'contextmenu', 'keydown', 'wheel', 'dragstart', 'drop']) addEventListener(kind, log, true)
addEventListener('contextmenu', (e) => e.preventDefault())
addEventListener('scroll', say)
field.addEventListener('input', say)
document.getElementById('drop').addEventListener('dragover', (e) => e.preventDefault())
document.getElementById('drop').addEventListener('drop', (e) => e.preventDefault())
setInterval(say, 400)
</script>"""
HEARD: dict[str, Any] = {}
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        page = CARRY_PAGE if self.path.startswith("/carry") else PAGE
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)
    def do_POST(self) -> None:  # noqa: N802 - the standard library's name
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        try:
            HEARD.update(json.loads(body))
        except ValueError:
            pass
        self.send_response(204)
        self.end_headers()
def heard(seconds: float = 1.2) -> dict[str, Any]:
    time.sleep(seconds)
    return dict(HEARD)
def post(kind: int, at: tuple[float, float], button: int = Quartz.kCGMouseButtonLeft) -> None:
    event = Quartz.CGEventCreateMouseEvent(None, kind, at, button)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
def point(at: tuple[float, float]) -> None:
    post(Quartz.kCGEventMouseMoved, at)
    time.sleep(0.15)
def press(at: tuple[float, float], right: bool = False) -> None:
    point(at)
    down, up = (
        (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp)
        if right
        else (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp)
    )
    button = Quartz.kCGMouseButtonRight if right else Quartz.kCGMouseButtonLeft
    post(down, at, button)
    time.sleep(0.06)
    post(up, at, button)
    time.sleep(0.4)
def typed(text: str) -> None:
    for letter in text:
        for down in (True, False):
            event = Quartz.CGEventCreateKeyboardEvent(None, 0, down)
            Quartz.CGEventKeyboardSetUnicodeString(event, 1, letter)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
            time.sleep(0.03)
        time.sleep(0.05)
    time.sleep(0.4)
def scrolled_down(at: tuple[float, float]) -> None:
    point(at)
    for _ in range(4):
        event = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, -5)
        Quartz.CGEventSetLocation(event, at)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
        time.sleep(0.05)
def dragged(start: tuple[float, float], end: tuple[float, float], midway: Any = None) -> None:
    point(start)
    post(Quartz.kCGEventLeftMouseDown, start)
    time.sleep(0.2)
    steps = 20
    for step in range(1, steps + 1):
        at = (start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps)
        post(Quartz.kCGEventLeftMouseDragged, at)
        time.sleep(0.03)
    time.sleep(0.3)
    if midway:
        midway()
    post(Quartz.kCGEventLeftMouseUp, end)
    time.sleep(0.6)
def beam_now() -> bool | None:
    NSApplication.sharedApplication()
    now, beam = NSCursor.currentSystemCursor(), NSCursor.IBeamCursor()
    if now is None or beam is None or now.image() is None or beam.image() is None:
        return None
    return bytes(now.image().TIFFRepresentation()) == bytes(beam.image().TIFFRepresentation()) or (
        now.hotSpot() == beam.hotSpot() and now.image().size() == beam.image().size()
    )
def named_at(at: tuple[float, float]) -> str | None:
    error, element = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), at[0], at[1], None)
    if error != 0 or element is None:
        print(f"accessibility at {at}: error {error}", flush=True)
        return None
    said = []
    for name in ("AXRole", "AXTitle", "AXDescription", "AXValue"):
        error, value = AXUIElementCopyAttributeValue(element, name, None)
        if error == 0 and value is not None:
            said.append(str(value))
    return "|".join(said)
def shot() -> Image.Image:
    return ImageGrab.grab().convert("RGB")
def colour_at(image: Image.Image, at: tuple[float, float], ratio: float) -> tuple[int, int, int]:
    x, y = round(at[0] * ratio), round(at[1] * ratio)
    patch = ImageStat.Stat(image.crop((x - 3, y - 3, x + 3, y + 3))).mean
    return (round(patch[0]), round(patch[1]), round(patch[2]))
def near(one: tuple[int, int, int], other: tuple[int, int, int], by: int = 40) -> bool:
    return all(abs(one[k] - other[k]) < by for k in range(3))
LOCAL_NETWORK = "find devices on local networks"
def ax(element: Any, name: str) -> Any:
    error, value = AXUIElementCopyAttributeValue(element, name, None)
    return value if error == 0 else None
def within(element: Any, depth: int = 0) -> list[Any]:
    found = [element]
    if depth < 6:
        for child in ax(element, "AXChildren") or []:
            found += within(child, depth + 1)
    return found
def refused_local_network() -> list[str]:
    owners = {
        int(one["kCGWindowOwnerPID"])
        for one in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) or []
        if one.get("kCGWindowOwnerName") == "UserNotificationCenter"
    }
    refused = []
    for pid in owners:
        for window in ax(AXUIElementCreateApplication(pid), "AXWindows") or []:
            parts = within(window)
            text = " ".join(str(ax(one, "AXValue") or "") for one in parts if ax(one, "AXRole") == "AXStaticText")
            if LOCAL_NETWORK not in text:
                continue
            refuse = next((one for one in parts if ax(one, "AXRole") == "AXButton" and str(ax(one, "AXTitle") or "").startswith("Don")), None)
            if refuse is not None and AXUIElementPerformAction(refuse, "AXPress") == 0:
                refused.append(text.strip())
    return refused
class Refuser:
    def __init__(self) -> None:
        self.going = True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
    def run(self) -> None:
        while self.going:
            for one in refused_local_network():
                print(f"the runner's local network prompt, not the app's, answered Don't Allow: {one}", flush=True)
            time.sleep(0.5)
    def stop(self) -> None:
        self.going = False
        self.thread.join()
def page_edge(image: Image.Image, start: tuple[float, float], step: tuple[int, int], ratio: float) -> tuple[float, float]:
    x, y = start
    while x > 0 and y > 0:
        pixel = image.getpixel((round((x + step[0]) * ratio), round((y + step[1]) * ratio)))
        if not near(pixel[:3], COLOUR):
            break
        x, y = x + step[0], y + step[1]
    return x, y
class Film:
    def __init__(self) -> None:
        self.frames: list[tuple[float, Image.Image]] = []
        self.going = True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
    def run(self) -> None:
        while self.going:
            self.frames.append((time.time() * 1000, shot()))
    def stop(self) -> list[tuple[float, Image.Image]]:
        self.going = False
        self.thread.join()
        return self.frames
OPENING = """
(() => {
  window.__ov = []
  const look = () => {
    if (!window.__ov) return
    // Said on what the overview moves: the bar's buttons among them.
    const one = document.querySelector("header[data-chrome='top'] :is(button, [role='button'])")
    const open = one ? one.style.getPropertyValue('--overview-open') : ''
    window.__ov.push([Date.now(), open === '' ? null : Number(open)])
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  return true
})()
"""
OPENED = "(() => { const got = window.__ov; window.__ov = null; return got })()"
def opened_at(log: list[list[Any]], at: float) -> float | None:
    best = None
    for when, open in log:
        if when <= at:
            best = open
        else:
            break
    return best
def overview(app: App, hole: tuple[float, float, float, float], ratio: float, out: pathlib.Path) -> list[str]:
    wrong: list[str] = []
    app.eval(OPENING)
    film = Film()
    time.sleep(0.4)
    for _ in range(2):
        app.eval("document.querySelector('button.orden-glyph.overview')?.click(); return true")
        time.sleep(1.8)
    frames = film.stop()
    log = app.eval(OPENED) or []
    folder = out / "overview"
    folder.mkdir(parents=True, exist_ok=True)
    smalls = [one.convert("L").resize((160, 100)) for _, one in frames]
    for index, (_, one) in enumerate(frames):
        one.resize((one.width // 2, one.height // 2)).save(folder / f"{index:03d}.jpg", quality=80)
    d = lambda a, b: ImageStat.Stat(ImageChops.difference(a, b)).mean[0]  # noqa: E731
    for i in range(1, len(smalls) - 1):
        a, b, across = d(smalls[i - 1], smalls[i]), d(smalls[i], smalls[i + 1]), d(smalls[i - 1], smalls[i + 1])
        if min(a, b) > 10 and across < min(a, b) / 2:
            wrong.append(f"[overview] frame {i} flashes: {a:.1f}, {b:.1f}, {across:.1f} across")
    opens = [opened_at(log if isinstance(log, list) else [], at) for at, _ in frames]
    if not any(open is not None and open > 0.9 for open in opens):
        wrong.append(f"[overview] never opened: {opens}")
    left, top, right, bottom = hole
    inset = 16
    corners = [(left + inset, top + inset), (right - inset, top + inset), (left + inset, bottom - inset), (right - inset, bottom - inset)]
    for index, ((_, one), open) in enumerate(zip(frames, opens)):
        if open is None or open < 0.25:
            continue
        if sum(near(colour_at(one, at, ratio), COLOUR) for at in corners) >= 3:
            wrong.append(f"[overview] frame {index}: the page is drawn over the overview, {open:.2f} out")
    print(f"[overview] {len(frames)} frames, open {[None if o is None else round(o, 2) for o in opens]}", flush=True)
    return wrong
INNER = (
    "const i = window.__TAURI_INTERNALS__;"
    "const at = await i.invoke('plugin:window|inner_position', { label: 'main' });"
    "const scale = await i.invoke('plugin:window|scale_factor', { label: 'main' });"
    "return { x: at.x / scale, y: at.y / scale }"
)
def window_of(pid: int) -> dict[str, float] | None:
    found = [
        dict(one["kCGWindowBounds"])
        for one in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) or []
        if int(one.get("kCGWindowOwnerPID", 0)) == pid and int(one.get("kCGWindowLayer", 0)) == 0
    ]
    if not found:
        return None
    bounds = max(found, key=lambda one: one["Width"] * one["Height"])
    return {"x": bounds["X"], "y": bounds["Y"]}
def inner_of(app: App, pid: int) -> Any:
    said = app.eval(INNER)
    seen = window_of(pid)
    if seen is not None and isinstance(said, dict) and (said["x"], said["y"]) != (seen["x"], seen["y"]):
        print(f"::warning::the app says its window is at {said}, the screen shows it at {seen}", flush=True)
    return seen or said
def moves_as_before(exe: pathlib.Path, identifier: str, secret: str, env: dict[str, str]) -> Any:
    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        app = endpoint(config_of(identifier), process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(2)
        app.eval("window.__moves = 0; addEventListener('pointermove', () => window.__moves++, true); return true")
        inner = inner_of(app, process.pid)
        if not isinstance(inner, dict):
            return inner
        for step in range(8):
            point((inner["x"] + 400 + step * 20, inner["y"] + 300 + step * 5))
        time.sleep(0.5)
        return app.eval("window.__moves")
    finally:
        ended(process, gentle=True)
def carried_in(app: App, pid: int, url: str, name: str) -> tuple[list[str], list[str]]:
    inner = inner_of(app, pid)
    if not isinstance(inner, dict):
        return [f"[carry {name}] where the window is was not said: {inner}"], []
    screen = lambda x, y: (inner["x"] + x, inner["y"] + y)  # noqa: E731
    return carried(app.eval, screen, dragged, url, name)
def carried_alone(exe: pathlib.Path, identifier: str, secret: str, env: dict[str, str], url: str, out: pathlib.Path, name: str) -> tuple[list[str], list[str]]:
    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        app = endpoint(config_of(identifier), process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(3)
        said = carried_in(app, process.pid, url, name)
        shot().save(out / f"carried-{name}.png")
        return said
    finally:
        ended(process, gentle=True)
MEASURED: list[str] = []
def measure(name: str, value: Any) -> None:
    MEASURED.append(f"{name}: {value}")
    print(f"[measure] {name}: {value}", flush=True)
LAYER_AT = (
    "(({x, y, size, colour, id}) => { const one = document.createElement('div'); one.className = 'orden-layer'; one.id = id;"
    " Object.assign(one.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px',"
    " background: colour, zIndex: 9999 }); document.body.append(one); window.__drawnAt = null;"
    " requestAnimationFrame(() => requestAnimationFrame(() => { window.__drawnAt = Date.now() })); return Date.now() })(ARGS)"
)
def layer_at(app: App, x: float, y: float, size: float, colour: str, name: str) -> Any:
    args = json.dumps({"x": x, "y": y, "size": size, "colour": colour, "id": name})
    return app.eval(LAYER_AT.replace("ARGS", args))
def gone(app: App, name: str) -> None:
    app.eval(f"document.getElementById({json.dumps(name)})?.remove(); return true")
    time.sleep(0.8)
def see_through(app: App, pane: dict[str, float], hole: tuple[float, float, float, float], ratio: float, out: pathlib.Path, under: bool) -> list[str]:
    wrong: list[str] = []
    x, y = pane["x"] + pane["width"] * 0.25, pane["y"] + pane["height"] * 0.55
    layer_at(app, x, y, 120, "rgba(0,160,0,0.5)", "drive-glass")
    time.sleep(1.2)
    image = shot()
    image.save(out / "glass.png")
    spot = (hole[0] + pane["width"] * 0.25 + 60, hole[1] + pane["height"] * 0.55 + 60)
    seen = colour_at(image, spot, ratio)
    wanted = (128, 80, 128)
    measure("half clear layer over the page (page magenta, layer green at 0.5; blended is (128, 80, 128))", seen)
    if under and not near(seen, wanted, 30):
        wrong.append(f"a half clear layer over the page is not blended with the live page under it: {seen}, not {wanted}")
    gone(app, "drive-glass")
    return wrong
def first_frame(app: App, pane: dict[str, float], hole: tuple[float, float, float, float], ratio: float, out: pathlib.Path, under: bool) -> list[str]:
    wrong: list[str] = []
    film = Film()
    time.sleep(0.6)
    x, y = pane["x"] + pane["width"] * 0.25, pane["y"] + pane["height"] * 0.3
    added = layer_at(app, x, y, 120, "rgb(0,160,0)", "drive-first")
    time.sleep(1.5)
    frames = film.stop()
    drawn = app.eval("window.__drawnAt")
    spot = (hole[0] + pane["width"] * 0.25 + 60, hole[1] + pane["height"] * 0.3 + 60)
    if not isinstance(drawn, (int, float)) or not isinstance(added, (int, float)):
        gone(app, "drive-first")
        return [f"[first frame] the app did not say when it drew its layer: {added}, {drawn}"]
    after = [(at, one) for at, one in frames if at >= drawn + 34]
    late = [at for at, one in after if not near(colour_at(one, spot, ratio), LAYER)]
    shown = next((at for at, one in frames if at >= added and near(colour_at(one, spot, ratio), LAYER)), None)
    folder = out / "first-frame"
    folder.mkdir(parents=True, exist_ok=True)
    for index, (at, one) in enumerate(frames):
        if at >= added - 200:
            one.resize((one.width // 2, one.height // 2)).save(folder / f"{index:03d}-{int(at - added)}.jpg", quality=70)
    measure("frames grabbed after the app drew a layer over the page in which the page still shows there", f"{len(late)} of {len(after)}")
    measure("ms from the app's draw to the first grab with the layer over the page", None if shown is None else round(shown - drawn))
    if under and late:
        wrong.append(f"[first frame] the page shows through a layer the app has drawn, in {len(late)} of {len(after)} grabs")
    gone(app, "drive-first")
    return wrong
PANE = "(() => { const all = orden.pages.each().map(([, one]) => one.sent).filter((one) => one && one.visible && !one.away); return all[0] ? all[0].pane : null })()"
def peek(app: App, pid: int, ratio: float, out: pathlib.Path, as_before: Any, under: bool) -> tuple[list[str], list[str]]:
    if not as_before:
        return [], ["this machine hands the app no pointer moves: the left peek over a page is not driven"]
    app.eval("if (orden.workspace.panel) orden.workspace.toggleSidebar('left'); return true")
    pane = app.until(f"(() => {{ const pane = {PANE}; return pane && pane.x < 1 ? pane : null }})()", 10)
    inner = inner_of(app, pid)
    if not isinstance(pane, dict) or not isinstance(inner, dict):
        return [f"[peek] the page never reached the window's left edge: {app.eval(PANE)}"], []
    middle = (inner["x"] + pane["x"] + pane["width"] / 2, inner["y"] + pane["y"] + pane["height"] / 2)
    point(middle)
    time.sleep(0.6)
    for step in range(12):
        point((middle[0] - (middle[0] - inner["x"] - 1) * (step + 1) / 12, middle[1]))
    box = app.until("(() => { const one = document.querySelector('.column.peek'); if (!one) return null; const r = one.getBoundingClientRect(); return r.width > 40 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()", 4)
    if not isinstance(box, dict):
        return [], ["the left peek did not come out over the page with posted pointer moves"]
    time.sleep(0.8)
    image = shot()
    image.save(out / "peek.png")
    inside = (inner["x"] + box["x"] + box["width"] / 2, inner["y"] + box["y"] + box["height"] / 2)
    beside = (inner["x"] + box["x"] + box["width"] + 120, inside[1])
    wrong: list[str] = []
    measure("colour inside the left peek over the page", colour_at(image, inside, ratio))
    measure("colour of the page beside the left peek", colour_at(image, beside, ratio))
    if near(colour_at(image, inside, ratio), COLOUR):
        wrong.append("[peek] the page is drawn over the left peek")
    if not near(colour_at(image, beside, ratio), COLOUR):
        wrong.append("[peek] the page is not drawn beside the left peek")
    if app.eval("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible && !one.sent.away)") is not True:
        wrong.append("[peek] the page steps away for the left peek")
    return wrong, []
def cleared_after_reload(app: App, hole: tuple[float, float, float, float], ratio: float, out: pathlib.Path) -> list[str]:
    middle = ((hole[0] + hole[2]) / 2, (hole[1] + hole[3]) / 2)
    app.eval("setTimeout(() => location.reload(), 50); return true")
    time.sleep(3)
    until = time.monotonic() + 60
    while time.monotonic() < until and app.eval("!!(window.orden && orden.workspace)") is not True:
        time.sleep(1)
    until = time.monotonic() + 40
    while time.monotonic() < until and app.eval("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is not True:
        time.sleep(0.5)
    time.sleep(2)
    app.eval("document.documentElement.style.opacity = '0'; return true")
    time.sleep(1)
    image = shot()
    image.save(out / "reloaded-bare.png")
    app.eval("document.documentElement.style.opacity = ''; return true")
    seen = colour_at(image, middle, ratio)
    measure("the hole after the app reloaded, its HTML at no opacity", seen)
    measure("the engine lays the page under the app after the reload", app.eval("orden.pages.under"))
    return [] if near(seen, COLOUR) else [f"[reload] the app's ground is not clear after it reloaded: {seen}"]
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--under", action="store_true")
    parser.add_argument("--fail", action="store_true")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    info = plistlib.loads((args.exe.parent.parent / "Info.plist").read_bytes())
    if info.get("CFBundleShortVersionString") != "99.0.0":
        raise SystemExit(f"{args.exe} is not a probe build: it would fetch the real update")
    args.out.mkdir(parents=True, exist_ok=True)
    refuser = Refuser()
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/under"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-under-spaces-"))
    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces), "ORDEN_PAGES_UNDER": "1" if args.under or args.fail else "0", "ORDEN_PAGES_UNDER_FAIL": "1" if args.fail else "0"}
    as_before = moves_as_before(args.exe, args.identifier, secret, env)
    print(f"moves the app's page heard with no page under it: {as_before}", flush=True)
    carry_url = url.replace("/under", "/carry")
    beside_wrong, beside_unverified = carried_alone(args.exe, args.identifier, secret, env, carry_url, args.out, "beside")
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    wrong: list[str] = []
    unverified: list[str] = []
    try:
        app = endpoint(config_of(args.identifier), process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(3)
        screen = NSScreen.mainScreen().frame()
        ratio = shot().width / screen.size.width
        shot().save(args.out / "start.png")
        app.eval(f"orden.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until:
            if app.eval("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is True:
                break
            time.sleep(0.5)
        time.sleep(3)
        shot().save(args.out / "built.png")
        pane = app.eval(
            "(() => { const all = orden.pages.each().map(([, one]) => one.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        if not isinstance(pane, dict):
            raise SystemExit(f"the page was never shown: {pane}")
        inner = inner_of(app, process.pid)
        if not isinstance(inner, dict):
            raise SystemExit(f"where the window is was not said: {inner}")
        hole = (
            inner["x"] + pane["x"],
            inner["y"] + pane["y"],
            inner["x"] + pane["x"] + pane["width"],
            inner["y"] + pane["y"] + pane["height"],
        )
        print(f"hole on the screen, in points: {hole}; {ratio} pixels a point", flush=True)
        at = lambda x, y: (hole[0] + x, hole[1] + y)  # noqa: E731
        middle = (hole[0] + pane["width"] * 0.75, hole[1] + pane["height"] * 0.45)
        app.eval("document.documentElement.style.opacity = '0'; return true")
        time.sleep(1)
        bare = shot()
        bare.save(args.out / "bare.png")
        print(f"the page with the window's HTML at no opacity: {colour_at(bare, middle, ratio)}", flush=True)
        top = page_edge(bare, middle, (0, -1), ratio)[1]
        left = page_edge(bare, (middle[0], hole[3] - 40), (-1, 0), ratio)[0]
        if (left, top) != hole[:2] and abs(left - hole[0]) < 40 and abs(top - hole[1]) < 40:
            print(f"the page itself begins at {(left, top)}, not at the pane's corner {hole[:2]}", flush=True)
            hole = (left, top, hole[2], hole[3])
        app.eval("document.documentElement.style.opacity = ''; return true")
        time.sleep(1)
        image = shot()
        image.save(args.out / "page.png")
        if not near(colour_at(image, middle, ratio), COLOUR):
            wrong.append(f"the page is not drawn in its hole: {colour_at(image, middle, ratio)} at {middle}")
        app.eval(
            "window.__layerHit = 0; const one = document.createElement('div'); one.className = 'orden-layer'; one.id = 'drive-layer';"
            f"Object.assign(one.style, {{ position: 'fixed', left: '{pane['x'] + pane['width'] * 0.75 - 60}px',"
            f" top: '{pane['y'] + pane['height'] * 0.45 - 60}px', width: '120px', height: '120px',"
            " background: 'rgb(0,160,0)', zIndex: 9999 }); one.addEventListener('click', () => window.__layerHit++);"
            " document.body.append(one); return true"
        )
        time.sleep(1)
        image = shot()
        image.save(args.out / "layer.png")
        beside = (middle[0] + 100, middle[1])
        if not near(colour_at(image, middle, ratio), LAYER):
            wrong.append(f"the app's layer is not drawn over the page: {colour_at(image, middle, ratio)}")
        if not near(colour_at(image, beside, ratio), COLOUR):
            wrong.append(f"the page is not drawn beside the app's layer: {colour_at(image, beside, ratio)}")
        laid = app.eval("orden.pages.under") is True
        measure("the engine lays the page under the app", laid)
        if args.under and not laid:
            wrong.append("the engine did not lay the page under the app")
        if args.fail and laid:
            wrong.append("the engine laid the page under the app though its ground was said not to clear")
        cuts = app.eval("orden.pages.cuts") is True
        still = app.eval("!!document.querySelector('.hole.still')") is True
        print(f"the engine cuts layers out of pages: {cuts}; the page is held as a still under the layer: {still}", flush=True)
        if cuts and app.eval("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is not True:
            wrong.append("the page steps behind its picture for a layer over part of it, though the engine cuts the layer out of the page")
        if not cuts and not still:
            wrong.append("the page is hidden under the app's layer with no still of it in its place")
        press(at(500, 120))
        before = len(heard(0.6).get("log", []))
        press(middle)
        hits = app.eval("window.__layerHit")
        log = heard().get("log", [])
        if hits != 1:
            wrong.append(f"a click on the app's layer over the page was not the app's: {hits}")
        if any(one[0] == "click" for one in log[before:]):
            wrong.append("a click on the app's layer reached the page under it")
        press(beside)
        reached = any(one[0] == "click" for one in heard().get("log", [])[before:])
        if cuts and not reached:
            wrong.append("a click on the page beside the app's layer was not heard by the page")
        if not cuts and reached:
            wrong.append("a click beside the app's layer reached the page held still under it")
        app.eval("document.getElementById('drive-layer')?.remove(); return true")
        time.sleep(1)
        low = pane["height"] - 90
        app.eval(
            "window.__noticeHit = 0; const row = document.createElement('div'); row.dataset.notices = ''; row.id = 'drive-notices';"
            f"Object.assign(row.style, {{ position: 'fixed', left: '{pane['x'] + pane['width'] - 420}px',"
            f" top: '{pane['y'] + low}px', width: '400px', height: '70px', zIndex: 9999 }});"
            "const card = document.createElement('div');"
            "Object.assign(card.style, { width: '400px', height: '70px', background: 'rgb(0,160,0)', borderRadius: '8px' });"
            "card.addEventListener('click', () => window.__noticeHit++); row.append(card); document.body.append(row); return true"
        )
        time.sleep(1.5)
        image = shot()
        image.save(args.out / "notice.png")
        card = (hole[0] + pane["width"] - 220, hole[1] + low + 35)
        for name, there in (("beside", at(200, low + 35)), ("below", at(200, pane["height"] - 10))):
            if not near(colour_at(image, there, ratio), COLOUR):
                wrong.append(f"the page is not drawn {name} the notice: {colour_at(image, there, ratio)}")
        if not near(colour_at(image, card, ratio), LAYER):
            wrong.append(f"the notice is not drawn over the page: {colour_at(image, card, ratio)}")
        if app.eval("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is not True:
            wrong.append("the page steps behind its picture for a notice over part of it")
        before = len(heard(0.6).get("log", []))
        press(card)
        if app.eval("window.__noticeHit") != 1:
            wrong.append("a click on the notice over the page was not the app's")
        if any(one[0] == "click" for one in heard().get("log", [])[before:]):
            wrong.append("a click on the notice reached the page under it")
        press(at(200, low + 35))
        if not any(one[0] == "click" for one in heard().get("log", [])[before:]):
            wrong.append("a click on the page beside the notice was not heard by the page")
        app.eval("document.getElementById('drive-notices')?.remove(); return true")
        time.sleep(1)
        wrong += see_through(app, pane, hole, ratio, args.out, args.under)
        wrong += first_frame(app, pane, hole, ratio, args.out, args.under)
        press(at(120, 60))
        typed("under")
        now = heard()
        print(f"typed: {now.get('value')!r}; heard {now.get('log', [])[-12:]}", flush=True)
        if now.get("value") != "under":
            wrong.append(f"what was typed did not arrive in the page's field: {now.get('value')!r}")
        if not any(one[0] == "click" and one[1] == "field" for one in now.get("log", [])):
            wrong.append("a click on the page's field was not heard")
        moves = heard(0.5).get("moves") or 0
        for step in range(6):
            point(at(200 + step * 4, 60))
        time.sleep(0.5)
        beam = beam_now()
        moved = (heard(0.5).get("moves") or 0) - moves
        print(f"moves the page heard over its field: {moved}; the I-beam: {beam}", flush=True)
        if not as_before:
            unverified.append("this machine hands no page the moves it posts, with no page under the app too: hover and the cursor are not read")
        elif not moved:
            wrong.append("the page under the app heard no pointer moves over it")
        elif beam is None:
            unverified.append("the system's cursor could not be read")
        elif not beam:
            wrong.append("the cursor over the page's field is not the I-beam")
        press(at(150, 150), right=True)
        if not any(one[0] == "contextmenu" for one in heard().get("log", [])):
            wrong.append("a right click on the page was not heard")
        post(Quartz.kCGEventLeftMouseDown, at(600, 500))
        post(Quartz.kCGEventLeftMouseUp, at(600, 500))
        time.sleep(0.4)
        scrolled_down(at(600, 500))
        scrolled = heard(1.5).get("scrolled")
        print(f"scrolled: {scrolled}", flush=True)
        if not isinstance(scrolled, (int, float)) or scrolled <= 0:
            wrong.append(f"the wheel over the page did not scroll it: {scrolled}")
        dragged(at(80, 260), at(400, 300))
        log = heard().get("log", [])
        if not any(one[0] == "drop" and one[1] == "drop" for one in log):
            wrong.append(f"a drag inside the page was not dropped: {log[-8:]}")
        asked = AXUIElementSetAttributeValue(AXUIElementCreateApplication(process.pid), "AXManualAccessibility", True)
        print(f"accessibility asked for as an assistive app asks: {asked}", flush=True)
        named = named_at(at(150, 150))
        until = time.monotonic() + 8
        while time.monotonic() < until and "Pressable" not in (named or ""):
            time.sleep(0.5)
            named = named_at(at(150, 150))
        print(f"accessibility at the button: {named!r}; at the app's own sidebar: {named_at((inner['x'] + 60, inner['y'] + 150))!r}", flush=True)
        if named is None:
            unverified.append("this process may not ask the accessibility hit test")
        elif "Pressable" not in named:
            wrong.append(f"the accessibility hit test does not find the page's button: {named!r}")
        wrong += beside_wrong
        unverified += beside_unverified
        wrong += overview(app, hole, ratio, args.out)
        if args.under:
            wrong += cleared_after_reload(app, hole, ratio, args.out)
        peeked, unseen = peek(app, process.pid, ratio, args.out, as_before, args.under)
        wrong += peeked
        unverified += unseen
    finally:
        refuser.stop()
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    hiding = [one for one in wrong if one.startswith("[overview] frame ")]
    for one in hiding:
        known(2214, one)
    wrong = [one for one in wrong if one not in hiding]
    for one in unverified:
        print(f"::warning::{one}", flush=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    (args.out / "wrong.json").write_text(json.dumps({"wrong": wrong, "unverified": unverified, "measured": MEASURED}, indent=1), encoding="utf-8")
    print(f"{len(wrong)} wrong", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
