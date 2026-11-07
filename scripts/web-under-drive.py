from __future__ import annotations

import argparse
import ctypes
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
import urllib.error
import urllib.request
from ctypes import wintypes
from typing import Any

from PIL import Image, ImageChops, ImageGrab, ImageStat

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from carry_page import PAGE as CARRY_PAGE, carried  # noqa: E402
from probe_app import main_window, refuse_updating  # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

COLOUR = (255, 0, 255)
LAYER = (0, 160, 0)
WIDTH, HEIGHT = 1280, 800
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
const said = () => { document.title = 'under ' + JSON.stringify({ v: document.getElementById('field').value, y: Math.round(scrollY), log: __log.slice(-24) }) }
const log = (e) => { __log.push([e.type, (e.target && e.target.id) || '', e.pointerType || '']); said() }
addEventListener('scroll', said)
addEventListener('input', said, true)
for (const kind of ['pointerdown', 'pointerup', 'click', 'contextmenu', 'keydown', 'wheel',
  'compositionstart', 'compositionend', 'dragstart', 'drop']) addEventListener(kind, log, true)
addEventListener('contextmenu', (e) => e.preventDefault())
document.getElementById('drop').addEventListener('dragover', (e) => e.preventDefault())
document.getElementById('drop').addEventListener('drop', (e) => e.preventDefault())
</script>"""

MOUSEEVENTF_MOVE = 0x1
MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x2, 0x4
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x8, 0x10
MOUSEEVENTF_WHEEL = 0x800
KEYEVENTF_KEYUP = 0x2
VK_MENU = 0x12
IDC_IBEAM = 32513

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

def config_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier

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

def client_box(hwnd: int) -> tuple[int, int, int, int]:
    rect = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    origin = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    return origin.x, origin.y, origin.x + rect.right, origin.y + rect.bottom

def forward(hwnd: int) -> None:
    front = user32.GetForegroundWindow()
    theirs = user32.GetWindowThreadProcessId(front, None)
    ours = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(ours, theirs, True)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(ours, theirs, False)

def press(x: int, y: int, down: int = MOUSEEVENTF_LEFTDOWN, up: int = MOUSEEVENTF_LEFTUP) -> None:
    user32.SetCursorPos(x, y)
    time.sleep(0.15)
    user32.mouse_event(down, 0, 0, 0, 0)
    time.sleep(0.06)
    user32.mouse_event(up, 0, 0, 0, 0)
    time.sleep(0.4)

def typed(text: str) -> None:
    for letter in text:
        key = user32.VkKeyScanW(ord(letter)) & 0xFF
        user32.keybd_event(key, 0, 0, 0)
        time.sleep(0.03)
        user32.keybd_event(key, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.05)
    time.sleep(0.4)

def dragged(start: tuple[int, int], end: tuple[int, int], midway: Any = None) -> None:
    user32.SetCursorPos(*start)
    time.sleep(0.2)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.2)
    steps = 20
    for step in range(1, steps + 1):
        x = start[0] + (end[0] - start[0]) * step // steps
        y = start[1] + (end[1] - start[1]) * step // steps
        user32.SetCursorPos(x, y)
        time.sleep(0.03)
    time.sleep(0.3)
    if midway:
        midway()
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.6)

def alt_twice() -> None:
    for _ in range(2):
        user32.keybd_event(VK_MENU, 0, 0, 0)
        time.sleep(0.03)
        user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.06)

class POINTER_INFO(ctypes.Structure):  # noqa: N801 - the system's name
    _fields_ = [
        ("pointerType", wintypes.DWORD), ("pointerId", wintypes.UINT), ("frameId", wintypes.UINT),
        ("pointerFlags", wintypes.DWORD), ("sourceDevice", wintypes.HANDLE), ("hwndTarget", wintypes.HWND),
        ("ptPixelLocation", wintypes.POINT), ("ptHimetricLocation", wintypes.POINT),
        ("ptPixelLocationRaw", wintypes.POINT), ("ptHimetricLocationRaw", wintypes.POINT),
        ("dwTime", wintypes.DWORD), ("historyCount", wintypes.UINT), ("InputData", ctypes.c_int32),
        ("dwKeyStates", wintypes.DWORD), ("PerformanceCount", ctypes.c_uint64), ("ButtonChangeType", ctypes.c_int),
    ]

class POINTER_TOUCH_INFO(ctypes.Structure):  # noqa: N801 - the system's name
    _fields_ = [
        ("pointerInfo", POINTER_INFO), ("touchFlags", wintypes.DWORD), ("touchMask", wintypes.DWORD),
        ("rcContact", wintypes.RECT), ("rcContactRaw", wintypes.RECT), ("orientation", wintypes.UINT), ("pressure", wintypes.UINT),
    ]

def tapped(x: int, y: int) -> bool:

    if not user32.InitializeTouchInjection(1, 3):
        print(f"no touch to inject here: {ctypes.get_last_error()}", flush=True)
        return False
    touch = POINTER_TOUCH_INFO()
    touch.pointerInfo.pointerType = 2
    touch.pointerInfo.pointerId = 0
    touch.pointerInfo.ptPixelLocation = wintypes.POINT(x, y)
    touch.touchFlags = 0
    touch.touchMask = 1 | 2 | 4
    touch.rcContact = wintypes.RECT(x - 2, y - 2, x + 2, y + 2)
    touch.orientation = 90
    touch.pressure = 32000
    for flags in (0x10000 | 0x2 | 0x4, 0x20000 | 0x2 | 0x4, 0x40000):
        touch.pointerInfo.pointerFlags = flags
        if not user32.InjectTouchInput(1, ctypes.byref(touch)):
            print(f"a touch was not injected: {ctypes.get_last_error()}", flush=True)
            return False
        time.sleep(0.05)
    time.sleep(0.6)
    return True

class CURSORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD), ("hCursor", wintypes.HANDLE), ("ptScreenPos", wintypes.POINT)]

def cursor_now() -> int:
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    user32.GetCursorInfo(ctypes.byref(info))
    return int(info.hCursor or 0)

def window_at(x: int, y: int) -> str:

    hwnd = user32.WindowFromPoint(wintypes.POINT(x, y))
    name = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, name, 256)
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    parent = user32.GetParent(hwnd)
    above = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(parent, above, 256)
    return f"{name.value} of {owner.value} in {above.value}"

def cursor_shown() -> bool:
    info = CURSORINFO()
    info.cbSize = ctypes.sizeof(CURSORINFO)
    user32.GetCursorInfo(ctypes.byref(info))
    return bool(info.flags & 1)

def colour_at(image: Image.Image, x: int, y: int) -> tuple[int, int, int]:
    patch = ImageStat.Stat(image.convert("RGB").crop((x - 3, y - 3, x + 3, y + 3))).mean
    return (round(patch[0]), round(patch[1]), round(patch[2]))

def near(one: tuple[int, int, int], other: tuple[int, int, int], by: int = 40) -> bool:
    return all(abs(one[k] - other[k]) < by for k in range(3))

def named_at(x: int, y: int) -> str:

    import comtypes.client  # noqa: PLC0415 - the drive's own, on Windows

    comtypes.client.GetModule("UIAutomationCore.dll")
    from comtypes.gen import UIAutomationClient as uia  # noqa: PLC0415

    client = comtypes.client.CreateObject(uia.CUIAutomation, interface=uia.IUIAutomation)
    found = "nothing"
    for _ in range(8):
        at = client.ElementFromPoint(wintypes.POINT(x, y))
        if at and at.CurrentName == "Pressable":
            return f"at the point: {at.CurrentControlType}:{at.CurrentName}"
        top = client.ElementFromHandle(user32.GetAncestor(user32.WindowFromPoint(wintypes.POINT(x, y)), 2))
        named = client.CreatePropertyCondition(uia.UIA_NamePropertyId, "Pressable")
        button = top.FindFirst(uia.TreeScope_Descendants, named) if top else None
        if button:
            return f"under the window: {button.CurrentControlType}:{button.CurrentName}"
        found = f"only {at.CurrentControlType}:{at.CurrentClassName}" if at else "nothing"
        time.sleep(2)
    return found

class Film:
    def __init__(self, box: tuple[int, int, int, int]) -> None:
        self.box, self.frames, self.going = box, [], True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self) -> None:
        while self.going:
            self.frames.append((time.time() * 1000, ImageGrab.grab(bbox=self.box, include_layered_windows=True)))

    def stop(self) -> list[tuple[float, Image.Image]]:
        self.going = False
        self.thread.join()
        return self.frames

OPENING = """
(() => {
  window.__ov = []
  const look = () => {
    if (!window.__ov) return
    const holder = document.querySelector('[style*="--overview-open"]')
    const open = holder ? holder.style.getPropertyValue('--overview-open') : ''
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

def overview(app: App, hwnd: int, hole: tuple[int, int, int, int], out: pathlib.Path, by_keys: bool) -> list[str]:
    name = "keys" if by_keys else "button"
    wrong: list[str] = []
    forward(hwnd)
    app.eval(OPENING)
    film = Film(client_box(hwnd))
    time.sleep(0.4)
    toggle = "document.querySelector('button.nib-glyph.overview')?.click()"
    for _ in range(2):
        if by_keys:
            alt_twice()
        else:
            app.eval(toggle)
        time.sleep(1.8)
    frames = film.stop()
    log = app.eval(OPENED) or []
    folder = out / f"overview-{name}"
    folder.mkdir(parents=True, exist_ok=True)
    smalls = [one.convert("L").resize((160, 100)) for _, one in frames]
    for index, (_, one) in enumerate(frames):
        one.convert("RGB").resize((one.width // 2, one.height // 2)).save(folder / f"{index:03d}.jpg", quality=80)
    d = lambda a, b: ImageStat.Stat(ImageChops.difference(a, b)).mean[0]  # noqa: E731
    for i in range(1, len(smalls) - 1):
        a, b, across = d(smalls[i - 1], smalls[i]), d(smalls[i], smalls[i + 1]), d(smalls[i - 1], smalls[i + 1])
        if min(a, b) > 10 and across < min(a, b) / 2:
            wrong.append(f"[overview {name}] frame {i} flashes: {a:.1f}, {b:.1f}, {across:.1f} across")
    opens = [opened_at(log if isinstance(log, list) else [], at) for at, _ in frames]
    if not any(open is not None and open > 0.9 for open in opens):
        wrong.append(f"[overview {name}] never opened: {opens}")
    left, top, right, bottom = hole
    inset, side = 6, 20
    corners = [(left + inset, top + inset), (right - inset - side, top + inset), (left + inset, bottom - inset - side), (right - inset - side, bottom - inset - side)]
    for index, ((_, one), open) in enumerate(zip(frames, opens)):
        if open is None or open < 0.25:
            continue
        if all(near(colour_at(one, x + side // 2, y + side // 2), COLOUR) for x, y in corners):
            wrong.append(f"[overview {name}] frame {index}: the page is drawn over the overview, {open:.2f} out")
    print(f"[overview {name}] {len(frames)} frames, open {[None if o is None else round(o, 2) for o in opens]}", flush=True)
    return wrong

def stacks(pid: int, out: pathlib.Path) -> None:

    for root in (r"C:\Program Files (x86)\Windows Kits\10\Debuggers\x64", r"C:\Program Files\Windows Kits\10\Debuggers\x64"):
        cdb = pathlib.Path(root) / "cdb.exe"
        if cdb.exists():
            said = subprocess.run([str(cdb), "-p", str(pid), "-pv", "-c", "~*kn 40; q"], capture_output=True, text=True, timeout=300)
            (out / "stacks.txt").write_text(said.stdout + said.stderr, encoding="utf-8")
            print(said.stdout[-20000:], flush=True)
            return
    print("no debugger on this machine", flush=True)

def carried_alone(exe: pathlib.Path, identifier: str, secret: str, env: dict[str, str], url: str, out: pathlib.Path) -> list[str]:

    said = open(out / "carry-app.log", "wb")
    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent), stdout=said, stderr=subprocess.STDOUT)
    try:
        app = endpoint(identifier, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace") is not True:
            time.sleep(1)
        hwnd = 0
        while time.monotonic() < until and not hwnd:
            hwnd = main_window(process.pid)
            time.sleep(0.25)
        if not hwnd:
            return ["[carry under] no window"]
        user32.ShowWindow(hwnd, 9)
        desk = wintypes.RECT()
        user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
        user32.SetWindowPos(hwnd, None, desk.left, desk.top, min(WIDTH, desk.right - desk.left), min(HEIGHT, desk.bottom - desk.top), 0x0004)
        forward(hwnd)
        time.sleep(3)
        scale = float(app.eval("devicePixelRatio") or 1)
        left, top, _, _ = client_box(hwnd)

        def screen(x: float, y: float) -> tuple[int, int]:
            return left + round(x * scale), top + round(y * scale)

        def dragged_to(start: tuple[float, float], end: tuple[float, float], midway: Any = None) -> None:
            dragged((round(start[0]), round(start[1])), (round(end[0]), round(end[1])), midway)
            if midway:
                print(f"carry: under the pointer as it was let go: {window_at(round(end[0]), round(end[1]))}", flush=True)

        missed, unsure = carried(app.eval, screen, dragged_to, url, "under")
        ImageGrab.grab().save(out / "carried.png")
        for one in unsure:
            print(f"::warning::{one}", flush=True)
        return missed
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
    parser.add_argument("--windowed", action="store_true")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/under"

    config = config_dir(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-under-spaces-"))
    user32.SystemParametersInfoW(0x1043, 0, ctypes.c_void_p(1), 0x3)

    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces), **({"ORDEN_PAGES_WINDOWED": "1"} if args.windowed else {})}
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    wrong: list[str] = []
    try:
        app = endpoint(args.identifier, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace") is not True:
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
        forward(hwnd)
        time.sleep(3)

        ImageGrab.grab().save(args.out / "start.png")
        app.eval(f"nib.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until:
            if app.eval("nib.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible)") is True:
                break
            time.sleep(0.5)
        time.sleep(3)
        ImageGrab.grab().save(args.out / "built.png")
        under = app.eval("nib.pages.under")
        print(f"under: {under}", flush=True)
        if isinstance(under, dict):
            hung = user32.IsHungAppWindow(hwnd)
            stacks(process.pid, args.out)
            raise SystemExit(f"the window stopped answering once the page was built (hung: {hung}, alive: {process.poll() is None})")
        if under is not True and not args.windowed:
            wrong.append(f"the crate did not say the page is drawn under the app: {under}")
        pane = app.eval(
            "(() => { const all = nib.pages.each().map(([, one]) => one.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        if not isinstance(pane, dict):
            raise SystemExit(f"the page was never shown: {pane}")
        scale = float(app.eval("devicePixelRatio") or 1)
        left, top, _, _ = client_box(hwnd)
        hole = (
            left + round(pane["x"] * scale),
            top + round(pane["y"] * scale),
            left + round((pane["x"] + pane["width"]) * scale),
            top + round((pane["y"] + pane["height"]) * scale),
        )
        print(f"hole on the screen: {hole}", flush=True)
        at = lambda x, y: (hole[0] + round(x * scale), hole[1] + round(y * scale))  # noqa: E731
        if args.windowed:
            time.sleep(3)
            print(f"windowed, UI Automation at the button: {named_at(*at(150, 150))!r}", flush=True)
            return 0

        print("grounds:", app.eval(
            "({ html: document.documentElement.hasAttribute('data-underlay'),"
            " painters: [...document.querySelectorAll('[data-underlay]')].map((one) => one.tagName + '.' + one.className.split(' ')[0]),"
            " hole: (() => { const one = document.querySelector('.hole'); return one && { under: one.classList.contains('under'),"
            " ground: getComputedStyle(one).backgroundColor } })() })"
        ), flush=True)
        app.eval("document.documentElement.style.opacity = '0'; return true")
        time.sleep(1)
        bare = ImageGrab.grab()
        bare.save(args.out / "bare.png")
        print(f"the page with the window's HTML at no opacity: {colour_at(bare, (hole[0] + hole[2]) // 2, (hole[1] + hole[3]) // 2)}", flush=True)
        app.eval("document.documentElement.style.opacity = ''; return true")
        time.sleep(1)

        def told() -> dict:
            title = app.eval("nib.pages.each().map(([, one]) => one.title).find((one) => (one || '').startsWith('under ')) || ''")
            try:
                return json.loads(str(title)[len("under "):])
            except ValueError:
                return {"v": None, "y": None, "log": []}

        heard = lambda: told()["log"]  # noqa: E731

        shot = ImageGrab.grab()
        shot.save(args.out / "page.png")
        middle = at(600, 470)
        if not near(colour_at(shot, *middle), COLOUR):
            wrong.append(f"the page is not drawn in its hole: {colour_at(shot, *middle)} at {middle}")
        app.eval(
            "const one = document.createElement('div'); one.className = 'nib-layer'; one.id = 'drive-layer';"
            f"Object.assign(one.style, {{ position: 'fixed', left: '{pane['x'] + 600 - 60}px',"
            f" top: '{pane['y'] + 470 - 60}px', width: '120px', height: '120px',"
            " background: 'rgb(0,160,0)', zIndex: 9999 }); document.body.append(one); return true"
        )
        time.sleep(1)
        shot = ImageGrab.grab()
        shot.save(args.out / "layer.png")
        beside = at(500, 470)
        if not near(colour_at(shot, *middle), LAYER):
            wrong.append(f"the app's layer is not drawn over the page: {colour_at(shot, *middle)}")
        if not near(colour_at(shot, *beside), COLOUR):
            wrong.append(f"the page is not drawn beside the app's layer: {colour_at(shot, *beside)}")
        app.eval("document.getElementById('drive-layer')?.remove(); return true")
        time.sleep(1)

        user32.SetCursorPos(*at(200, 60))
        time.sleep(0.5)
        user32.SetCursorPos(*at(210, 62))
        time.sleep(0.5)
        beam = user32.LoadCursorW(None, IDC_IBEAM)
        print(f"under the pointer: {window_at(*at(210, 62))}", flush=True)
        if not cursor_shown():
            print("no cursor is shown on this machine, so which one the page asked for is not seen", flush=True)
        elif cursor_now() != beam:
            wrong.append(f"the cursor over the page's field is not the I-beam: {cursor_now():#x}, {beam:#x}")

        press(*at(120, 60))
        typed("under")
        value = told()["v"]
        print(f"typed: {value!r}; heard {heard()}", flush=True)
        if value != "under":
            wrong.append(f"what was typed did not arrive in the page's field: {value!r}")
        log = heard()
        if not any(one[0] == "click" and one[1] == "field" for one in log):
            wrong.append("a click on the page's field was not heard")

        press(*at(150, 150), MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
        if not any(one[0] == "contextmenu" for one in heard()):
            wrong.append("a right click on the page was not heard")

        user32.SetCursorPos(*at(600, 500))
        time.sleep(0.3)
        user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, ctypes.c_uint32(-360 & 0xFFFFFFFF).value, 0)
        time.sleep(1.2)
        scrolled = told()["y"]
        print(f"scrolled: {scrolled}", flush=True)
        if not isinstance(scrolled, (int, float)) or scrolled <= 0:
            wrong.append(f"the wheel over the page did not scroll it: {scrolled}")

        dragged(at(80, 260), at(400, 300))
        log = heard()
        if not any(one[0] == "drop" and one[1] == "drop" for one in log):
            wrong.append(f"a drag inside the page was not dropped: {log[-8:]}")

        named = named_at(*at(150, 150))
        print(f"UI Automation at the button: {named!r}", flush=True)
        if "Pressable" not in named:
            wrong.append(f"UI Automation does not find the page's button: {named!r}")

        if tapped(*at(150, 150)):
            log = heard()
            print(f"after a tap: {log[-4:]}", flush=True)
            if not any(one[0] == "pointerdown" and one[2] == "touch" for one in log):
                wrong.append(f"a touch on the page was not heard as one: {log[-6:]}")

        user32.SetCursorPos(*at(600, 500))
        user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, 2000, 0)
        time.sleep(1)
        for by_keys in (False, True):
            wrong += overview(app, hwnd, hole, args.out, by_keys)

        if not args.windowed:
            process.terminate()
            try:
                process.wait(20)
            except subprocess.TimeoutExpired:
                process.kill()
            wrong += carried_alone(args.exe, args.identifier, secret, env, url.replace("/under", "/carry"), args.out)
    finally:
        process.terminate()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            process.kill()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    (args.out / "wrong.json").write_text(json.dumps(wrong, indent=1), encoding="utf-8")
    print(f"{len(wrong)} wrong", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
