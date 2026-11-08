
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
import urllib.error
import urllib.request
from typing import Any

import mss
import numpy
from PIL import Image, ImageStat
import crash_told
from fresh_app import fresh

COLOUR = (255, 0, 255)
PAGE = b"<!doctype html><title>one colour</title><style>html,body{margin:0;height:100%;background:#ff00ff}</style>"
WIDTH, HEIGHT = 1280, 800
Box = tuple[int, int, int, int]
CELLS = (16, 10)
FAR, STILL = 24.0, 1.5
WIDE = 10
MOST = 0.6

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from probe_app import main_window  # noqa: E402

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    VK_MENU, KEYUP, WHEEL = 0x12, 0x2, 0x800
    LEFTDOWN, LEFTUP = 0x2, 0x4

    class Desk:

        def __init__(self, pid: int) -> None:
            self.pid, self.hwnd = pid, 0

        @staticmethod
        def config(identifier: str) -> pathlib.Path:
            return pathlib.Path(os.environ["APPDATA"]) / identifier

        @staticmethod
        def moving() -> None:
            user32.SystemParametersInfoW(0x1043, 0, ctypes.c_void_p(1), 0x3)

        def found(self) -> bool:
            self.hwnd = main_window(self.pid)
            return bool(self.hwnd)

        def placed(self) -> None:
            user32.ShowWindow(self.hwnd, 9)
            desk = wintypes.RECT()
            user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
            width = min(WIDTH, desk.right - desk.left)
            height = min(HEIGHT, desk.bottom - desk.top)
            user32.SetWindowPos(self.hwnd, None, desk.left, desk.top, width, height, 0x0004)

        def box(self) -> Box:
            rect = wintypes.RECT()
            user32.GetClientRect(self.hwnd, ctypes.byref(rect))
            origin = wintypes.POINT(0, 0)
            user32.ClientToScreen(self.hwnd, ctypes.byref(origin))
            return origin.x, origin.y, origin.x + rect.right, origin.y + rect.bottom

        def forward(self) -> None:
            front = user32.GetForegroundWindow()
            theirs = user32.GetWindowThreadProcessId(front, None)
            ours = ctypes.windll.kernel32.GetCurrentThreadId()
            user32.AttachThreadInput(ours, theirs, True)
            user32.SetForegroundWindow(self.hwnd)
            user32.BringWindowToTop(self.hwnd)
            user32.AttachThreadInput(ours, theirs, False)

        @staticmethod
        def click(x: int, y: int) -> None:
            user32.SetCursorPos(x, y)
            time.sleep(0.1)
            user32.mouse_event(LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.05)
            user32.mouse_event(LEFTUP, 0, 0, 0, 0)
            time.sleep(0.3)

        @staticmethod
        def alt_alt() -> None:
            scan = user32.MapVirtualKeyW(VK_MENU, 0)
            for _ in range(2):
                user32.keybd_event(VK_MENU, scan, 0, 0)
                time.sleep(0.03)
                user32.keybd_event(VK_MENU, scan, KEYUP, 0)
                time.sleep(0.06)

        @staticmethod
        def wheel(x: int, y: int, notches: int) -> None:
            user32.SetCursorPos(x, y)
            user32.mouse_event(WHEEL, 0, 0, ctypes.c_uint32((120 * notches) & 0xFFFFFFFF).value, 0)

        @staticmethod
        def drag(start: tuple[int, int], end: tuple[int, int], pressed: list[tuple[float, str]]) -> None:
            user32.SetCursorPos(*start)
            time.sleep(0.1)
            pressed.append((time.time() * 1000, "pan"))
            user32.mouse_event(LEFTDOWN, 0, 0, 0, 0)
            for step in range(1, 21):
                user32.SetCursorPos(start[0] + (end[0] - start[0]) * step // 20, start[1] + (end[1] - start[1]) * step // 20)
                time.sleep(0.03)
            user32.mouse_event(LEFTUP, 0, 0, 0, 0)

else:

    def xdo(*words: str) -> str:
        return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout

    class Desk:  # type: ignore[no-redef]

        def __init__(self, pid: int) -> None:
            self.pid, self.window = pid, ""

        @staticmethod
        def config(identifier: str) -> pathlib.Path:
            return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier

        @staticmethod
        def moving() -> None:
            pass

        @staticmethod
        def geometry(window: str) -> dict[str, int]:
            said = dict(line.split("=", 1) for line in xdo("getwindowgeometry", "--shell", window).split() if "=" in line)
            return {key: int(value) for key, value in said.items() if value.lstrip("-").isdigit()}

        def found(self) -> bool:
            best, area = "", 0
            for one in xdo("search", "--onlyvisible", "--pid", str(self.pid), "").split():
                got = self.geometry(one)
                if got.get("WIDTH", 0) * got.get("HEIGHT", 0) > area:
                    best, area = one, got["WIDTH"] * got["HEIGHT"]
            self.window = best
            return bool(best)

        def placed(self) -> None:
            xdo("windowmove", self.window, "0", "0")
            xdo("windowsize", self.window, str(WIDTH), str(HEIGHT))

        def box(self) -> Box:
            got = self.geometry(self.window)
            return got["X"], got["Y"], got["X"] + got["WIDTH"], got["Y"] + got["HEIGHT"]

        def forward(self) -> None:
            xdo("windowactivate", self.window)

        @staticmethod
        def click(x: int, y: int) -> None:
            xdo("mousemove", str(x), str(y))
            xdo("click", "1")
            time.sleep(0.3)

        @staticmethod
        def alt_alt() -> None:
            xdo("key", "--delay", "60", "Alt_L", "Alt_L")

        @staticmethod
        def wheel(x: int, y: int, notches: int) -> None:
            xdo("mousemove", str(x), str(y))
            xdo("click", "4" if notches > 0 else "5")

        @staticmethod
        def drag(start: tuple[int, int], end: tuple[int, int], pressed: list[tuple[float, str]]) -> None:
            xdo("mousemove", str(start[0]), str(start[1]))
            time.sleep(0.1)
            pressed.append((time.time() * 1000, "pan"))
            xdo("mousedown", "1")
            for step in range(1, 21):
                xdo("mousemove", str(start[0] + (end[0] - start[0]) * step // 20), str(start[1] + (end[1] - start[1]) * step // 20))
                time.sleep(0.03)
            xdo("mouseup", "1")

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 30) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                answer = json.loads(said.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}
        return answer.get("value") if answer.get("ok", answer.get("status") == "ok") else answer

def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                crash_told.told(int(said["port"]), secret)
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

class Film:

    def __init__(self, box: Box) -> None:
        self.box, self.frames, self.going = box, [], True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self) -> None:
        left, top, right, bottom = self.box
        with mss.mss() as screen:
            while self.going:
                at = time.time() * 1000
                shot = screen.grab({"left": left, "top": top, "width": right - left, "height": bottom - top})
                self.frames.append((at, Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")))

    def stop(self) -> list[tuple[float, Image.Image]]:
        self.going = False
        self.thread.join()
        return self.frames

LOG = """
(() => {
  window.__ov = { frames: [], puts: [] }
  let last = 0
  const look = (now) => {
    const html = document.documentElement
    const layered = document.querySelectorAll('.is-moving, [style*="will-change: transform"]').length
    const cut = document.querySelectorAll('[data-underlay]').length
    const holder = document.querySelector('.canvas [style*="--overview-open"]')
    const open = holder ? Number(holder.style.getPropertyValue('--overview-open')) : 0
    window.__ov?.frames.push([Date.now(), html.hasAttribute('data-overview'), layered, cut, Math.round(now - last), open])
    last = now
    if (window.__ov) requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  const pages = orden.pages
  if (!pages.__heard) {
    const put = pages.put
    pages.put = function (id, page, one) {
      window.__ov?.puts.push([Date.now(), one.visible, one.cut && one.cut.all, one.pane, one.opacity])
      return put.call(this, id, page, one)
    }
    pages.__heard = true
  }
  return true
})()
"""
TAKE = "(() => { const got = window.__ov; window.__ov = null; return got })()"
TOGGLE = "document.querySelector('button.orden-glyph.overview')?.click(); return true"
SHOWN = "document.querySelector('button.orden-glyph.overview')?.getAttribute('aria-pressed') === 'true'"

def toggled(app: App, desk: Desk, up: bool, pressed: list[tuple[float, str]]) -> str:

    what = "open" if up else "close"
    pressed.append((time.time() * 1000, what))
    desk.alt_alt()
    time.sleep(0.6)
    if app.eval(SHOWN) is up:
        return "keys"
    pressed.append((time.time() * 1000, what))
    app.eval(TOGGLE)
    return "button"

def small(image: Image.Image) -> numpy.ndarray:
    return numpy.asarray(image.convert("L").resize((CELLS[0] * 20, CELLS[1] * 20)), dtype=numpy.float32)

def cells(a: numpy.ndarray, b: numpy.ndarray) -> list[float]:
    diff = numpy.abs(a - b).reshape(CELLS[1], 20, CELLS[0], 20).mean(axis=(1, 3))
    return [float(one) for one in diff.ravel()]

def distinct(smalls: list[numpy.ndarray]) -> list[int]:

    kept = [0]
    for i in range(1, len(smalls)):
        if max(cells(smalls[kept[-1]], smalls[i])) >= 0.5:
            kept.append(i)
    return kept

def flashes(smalls: list[numpy.ndarray], kept: list[int]) -> list[tuple[int, int, int, float]]:

    found = []
    for length in (1, 2, 3):
        for k in range(1, len(kept) - length):
            before, after = smalls[kept[k - 1]], smalls[kept[k + length]]
            across = cells(before, after)
            inside = [cells(before, smalls[kept[k + n]]) for n in range(length)]
            back = [cells(smalls[kept[k + n]], after) for n in range(length)]
            far = []
            for cell in range(len(across)):
                left = min(one[cell] for one in inside)
                right = min(one[cell] for one in back)
                if min(left, right) > FAR and across[cell] < min(left, right) / 3:
                    far.append(min(left, right))
            if len(far) >= WIDE:
                found.append((kept[k], length, len(far), round(max(far), 1)))
    return found

def pops(smalls: list[numpy.ndarray], kept: list[int], times: list[float], pressed: list[float]) -> list[tuple[int, float, float]]:

    found = []
    for k in range(1, len(kept)):
        i, was = kept[k], kept[k - 1]
        moved = max(cells(smalls[was], smalls[i]))
        stood_from = times[was] if k == 1 else times[kept[k - 1]]
        since = max((one for one in pressed if one <= times[i]), default=None)
        if since is None or moved <= FAR / 2:
            continue
        if times[i] - stood_from >= 200 and stood_from > since:
            found.append((i, round(moved, 1), round(times[i] - since)))
    return found

def sheet(frames: list[tuple[float, Image.Image]], path: pathlib.Path) -> None:
    across = 10
    w, h = 256, 160
    rows = (len(frames) + across - 1) // across
    out = Image.new("RGB", (across * w, max(rows, 1) * h), (0, 0, 0))
    for index, (_, one) in enumerate(frames):
        out.paste(one.resize((w, h)), ((index % across) * w, (index // across) * h))
    out.save(path, quality=80)

def judged(name: str, frames: list[tuple[float, Image.Image]], log: dict[str, Any], pressed: list[tuple[float, str]], hole: dict[str, float] | None, out: pathlib.Path, scale: float) -> list[str]:
    wrong: list[str] = []
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    for index, (_, one) in enumerate(frames):
        one.resize((one.width // 2, one.height // 2)).save(folder / f"{index:03d}.jpg", quality=85)
    sheet(frames, folder / "sheet.jpg")
    smalls = [small(one) for _, one in frames]
    times = [at for at, _ in frames]
    steps = [round(max(cells(smalls[i - 1], smalls[i])), 1) for i in range(1, len(smalls))]
    print(f"[{name}] {len(frames)} frames over {(times[-1] - times[0]) / 1000:.2f} s", flush=True)
    kept = distinct(smalls)
    print(f"[{name}] {len(kept)} of them drawn anew", flush=True)
    for i, length, many, far in flashes(smalls, kept):
        wrong.append(f"[{name}] frames {i}-{i + length - 1} flash in {many} cells, up to {far} from both sides")
    for k in range(1, len(kept)):
        share = sum(one > FAR for one in cells(smalls[kept[k - 1]], smalls[kept[k]])) / (CELLS[0] * CELLS[1])
        if share > MOST:
            wrong.append(f"[{name}] frame {kept[k]} jumps: {share:.0%} of the window changed at once")
    for i, moved, since in pops(smalls, kept, times, [at for at, _ in pressed]):
        wrong.append(f"[{name}] frame {i} pops {moved} after the screen stood still, {since} ms after the last press")
    up = [(at, on) for at, on, *_ in log.get("frames", [])]
    outs = [(one[0], one[5] if len(one) > 5 else 0) for one in log.get("frames", [])]

    def up_at(at: float) -> bool:
        best = False
        for when, on in up:
            if when > at:
                break
            best = bool(on)
        return best

    def out_at(at: float) -> float:
        best = 0.0
        for when, open in outs:
            if when > at:
                break
            best = float(open or 0)
        return best

    if not any(on for _, on in up):
        wrong.append(f"[{name}] the overview never came up")
    elif up and up[-1][1]:
        wrong.append(f"[{name}] the overview never went away")
    if hole:
        told = [one for one in log.get("puts", []) if up_at(one[0])]
        if len(told) > 2:
            wrong.append(f"[{name}] the page was told where it is {len(told)} times while the overview was up")
        side = 20
        x0, y0 = hole["x"] * scale, hole["y"] * scale
        x1, y1 = (hole["x"] + hole["width"]) * scale, (hole["y"] + hole["height"]) * scale
        spots = [(x0 + 6, y0 + 6), (x1 - 26, y0 + 6), (x0 + 6, y1 - 26), (x1 - 26, y1 - 26)]
        for index, (at, one) in enumerate(frames):
            if out_at(at) < 0.6:
                continue
            painted = sum(
                all(abs(channel - COLOUR[k]) < 40 for k, channel in enumerate(ImageStat.Stat(one.crop((int(x), int(y), int(x) + side, int(y) + side))).mean))
                for x, y in spots
            )
            if painted >= 3:
                wrong.append(f"[{name}] frame {index}: the page is drawn over the overview")
                break
    (folder / "log.json").write_text(json.dumps({"times": times, "steps": steps, "pressed": pressed, **log}, indent=1), encoding="utf-8")
    return wrong

def round_trip(app: App, desk: Desk, name: str, hole: dict[str, float] | None, out: pathlib.Path, scale: float) -> list[str]:
    desk.forward()
    box = desk.box()
    middle = ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)
    desk.click(box[0] + round(60 * scale), box[3] - round(90 * scale))
    time.sleep(0.5)
    app.eval(LOG)
    pressed: list[tuple[float, str]] = []
    film = Film(box)
    time.sleep(0.4)
    how = toggled(app, desk, True, pressed)
    time.sleep(1.6)
    bar = float(app.eval("document.querySelector('header[data-chrome=\"top\"]')?.getBoundingClientRect().bottom ?? 0") or 0)
    ground = str(app.eval(SEE_THROUGH))
    floor = (box[0] + round(28 * scale), round(box[1] + (bar + 160) * scale))
    desk.drag(floor, (floor[0], floor[1] - round(320 * scale)), pressed)
    time.sleep(0.5)
    for notches in (1, 1, 1, -1, -1, -1):
        pressed.append((time.time() * 1000, "wheel"))
        desk.wheel(*middle, notches)
        time.sleep(0.35)
    time.sleep(1.2)
    how += " " + toggled(app, desk, False, pressed)
    time.sleep(1.8)
    frames = film.stop()
    log = app.eval(TAKE)
    if not isinstance(log, dict) or "frames" not in log:
        log = {"frames": [], "puts": [], "said": log}
    print(f"[{name}] opened and closed by {how}", flush=True)
    return judged(name, frames, log, pressed, hole, out, scale) + barred(name, ground)


SEE_THROUGH = """(() => {
  const bar = document.querySelector('header[data-chrome="top"]')
  if (!bar) return 'no bar'
  const ground = getComputedStyle(bar).backgroundColor
  const parts = (/\\(([^)]*)\\)/.exec(ground)?.[1] ?? '').split(/[ ,\\/]+/).filter(Boolean)
  const alpha = ground === 'transparent' ? 0 : ground.includes('/') || ground.startsWith('rgba') ? Number(parts[parts.length - 1]) : 1
  const blurred = [...document.querySelectorAll('.canvas *')].some((one) => (getComputedStyle(one).backdropFilter || 'none') !== 'none')
  return alpha <= 0.01 && !blurred ? 'clear' : ground + (blurred ? ' blurred' : '')
})()"""


def barred(name: str, ground: str) -> list[str]:
    print(f"[{name}] the bar over the overview: {ground}", flush=True)
    return [] if ground == "clear" else [f"[{name}] the bar over the overview is not see-through: {ground}"]

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
    url = f"http://127.0.0.1:{site.server_address[1]}/"

    config = Desk.config(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-overview-spaces-"))
    Desk.moving()
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    desk = Desk(process.pid)
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        while time.monotonic() < until and not desk.found():
            time.sleep(0.25)
        if not desk.found():
            raise SystemExit("the app put up no window")
        desk.placed()
        desk.forward()
        time.sleep(3)
        app.eval(
            "for (const one of document.querySelectorAll('button'))"
            " if (one.textContent.trim() === 'Keep running') one.click();"
            " for (const tab of [...nib.workspace.tabs]) orden.workspace.close(tab.id, false); return true"
        )
        time.sleep(1)
        app.eval(
            "for (const name of ['One', 'Two', 'Three'])"
            " orden.workspace.openBlank(name, `# ${name}\\n\\n` + `Some words of ${name}. `.repeat(40));"
            " orden.workspace.split('row'); return true"
        )
        time.sleep(2)
        scale = float(app.eval("devicePixelRatio") or 1)
        still = app.eval("matchMedia('(prefers-reduced-motion: reduce)').matches")
        if still is not False:
            wrong.append(f"the window asks for no movement ({still}), so nothing would be filmed moving")
        print(f"the engine: {app.eval('navigator.userAgent')}; pages under the app: {app.eval('nib.pages.under')}", flush=True)
        wrong += round_trip(app, desk, "notes", None, args.out, scale)
        wrong += round_trip(app, desk, "notes-again", None, args.out, scale)

        app.eval(f"nib.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until:
            if app.eval("nib.pages.each().some(([, page]) => page.sent && page.sent.visible && page.live)") is True:
                break
            time.sleep(0.5)
        time.sleep(3)
        hole = app.eval(
            "(() => { const all = orden.pages.each().map(([, page]) => page.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        print(f"pages under the app: {app.eval('nib.pages.under')}", flush=True)
        if not isinstance(hole, dict):
            wrong.append(f"the web tab's page was never shown: {hole}")
        else:
            print(f"the page's hole: {hole}", flush=True)
            wrong += round_trip(app, desk, "web", hole, args.out, scale)
            wrong += round_trip(app, desk, "web-again", hole, args.out, scale)
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
