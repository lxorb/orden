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
import urllib.error
import urllib.request
from typing import Any

import Quartz
from AppKit import NSApplication, NSCursor, NSScreen
from ApplicationServices import (
    AXUIElementCopyAttributeValue,
    AXUIElementCopyElementAtPosition,
    AXUIElementCreateSystemWide,
)
from PIL import Image, ImageChops, ImageGrab, ImageStat

from carry_page import PAGE as CARRY_PAGE, carried

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

def config_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path.home() / "Library" / "Application Support" / identifier

class App:
    def __init__(self, at: int, secret: str) -> None:
        self.at, self.secret = at, secret

    def eval(self, code: str, seconds: float = 30) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.at}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                answer = json.loads(said.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}
        return answer.get("value") if answer.get("ok", answer.get("status") == "ok") else answer

def endpoint(identifier: str, pid: int, secret: str) -> App:
    path = config_dir(identifier) / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

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

def moves_as_before(exe: pathlib.Path, identifier: str, secret: str, env: dict[str, str]) -> Any:

    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        app = endpoint(identifier, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(2)
        app.eval("window.__moves = 0; addEventListener('pointermove', () => window.__moves++, true); return true")
        inner = app.eval(INNER)
        if not isinstance(inner, dict):
            return inner
        for step in range(8):
            point((inner["x"] + 400 + step * 20, inner["y"] + 300 + step * 5))
        time.sleep(0.5)
        return app.eval("window.__moves")
    finally:
        process.terminate()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            process.kill()

def carried_in(app: App, url: str, name: str) -> tuple[list[str], list[str]]:
    inner = app.eval(INNER)
    if not isinstance(inner, dict):
        return [f"[carry {name}] where the window is was not said: {inner}"], []
    screen = lambda x, y: (inner["x"] + x, inner["y"] + y)  # noqa: E731
    return carried(app.eval, screen, dragged, url, name)

def carried_alone(exe: pathlib.Path, identifier: str, secret: str, env: dict[str, str], url: str, out: pathlib.Path, name: str) -> tuple[list[str], list[str]]:

    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        app = endpoint(identifier, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(3)
        said = carried_in(app, url, name)
        shot().save(out / f"carried-{name}.png")
        return said
    finally:
        process.terminate()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            process.kill()

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    info = plistlib.loads((args.exe.parent.parent / "Info.plist").read_bytes())
    if info.get("CFBundleShortVersionString") != "99.0.0":
        raise SystemExit(f"{args.exe} is not a probe build: it would fetch the real update")
    args.out.mkdir(parents=True, exist_ok=True)

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/under"

    config = config_dir(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-under-spaces-"))

    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces)}
    as_before = moves_as_before(args.exe, args.identifier, secret, env)
    print(f"moves the app's page heard with no page under it: {as_before}", flush=True)
    carry_url = url.replace("/under", "/carry")
    beside_wrong, beside_unverified = carried_alone(args.exe, args.identifier, secret, env, carry_url, args.out, "beside")
    under_wrong, under_unverified = carried_alone(
        args.exe, args.identifier, secret, {**env, "ORDEN_PAGES_UNDER": "1"}, carry_url, args.out, "under"
    )
    env["ORDEN_PAGES_UNDER"] = "1"
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    wrong: list[str] = []
    unverified: list[str] = []
    try:
        app = endpoint(args.identifier, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
        time.sleep(3)
        screen = NSScreen.mainScreen().frame()
        ratio = shot().width / screen.size.width
        shot().save(args.out / "start.png")

        app.eval(f"nib.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until:
            if app.eval("nib.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is True:
                break
            time.sleep(0.5)
        time.sleep(3)
        shot().save(args.out / "built.png")
        under = app.eval("nib.pages.under")
        print(f"under: {under}", flush=True)
        if under is not True:
            wrong.append(f"the crate did not say the page is drawn under the app: {under}")
        pane = app.eval(
            "(() => { const all = orden.pages.each().map(([, one]) => one.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        if not isinstance(pane, dict):
            raise SystemExit(f"the page was never shown: {pane}")
        inner = app.eval(INNER)
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
        if app.eval("!!document.querySelector('.hole.still')") is True:
            wrong.append("the page's hole shows a still under the app's layer")

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
        if not any(one[0] == "click" for one in heard().get("log", [])[before:]):
            wrong.append("a click on the page beside the app's layer was not heard by the page")
        app.eval("document.getElementById('drive-layer')?.remove(); return true")
        time.sleep(1)

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

        named = named_at(at(150, 150))
        print(f"accessibility at the button: {named!r}; at the app's own sidebar: {named_at((inner['x'] + 60, inner['y'] + 150))!r}", flush=True)
        if named is None:
            unverified.append("this process may not ask the accessibility hit test")
        elif "Pressable" not in named:
            wrong.append(f"the accessibility hit test does not find the page's button: {named!r}")

        wrong += beside_wrong + under_wrong
        unverified += beside_unverified + under_unverified

        wrong += overview(app, hole, ratio, args.out)
    finally:
        process.terminate()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            process.kill()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in unverified:
        print(f"::warning::{one}", flush=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    (args.out / "wrong.json").write_text(json.dumps({"wrong": wrong, "unverified": unverified}, indent=1), encoding="utf-8")
    print(f"{len(wrong)} wrong", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
