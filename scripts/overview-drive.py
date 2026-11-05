"""The tab overview opened and closed on a real engine, filmed off its screen (#1136).

Reported on 0.19.1-1087 for Windows: the overview flashed for the whole of its way in, and
a web tab's page stayed behind it. A browser shows neither of the native page's parts, so
a probe build is started on the runner's own desktop - WebView2 on Windows, CEF under an
X server on Linux - a note and then a web tab of one colour put in front, and the overview
opened and closed from its button while the window is filmed. Every frame is judged:

    a flash: a frame far from both of its neighbours while they are near each other
    the page under the overview: three of the four corners of the page's hole in its
      colour while the overview is more than a quarter out, which its window flying away
      from the pane cannot be (a notice may stand over the fourth)

What the window told the engine for the page, frame by frame, is written beside the
frames.

    python scripts/overview-drive.py --exe <probe build> --identifier <probe id> --out <folder>
"""

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

from PIL import Image, ImageChops, ImageGrab, ImageStat

COLOUR = (255, 0, 255)
PAGE = b"<!doctype html><title>one colour</title><style>html,body{margin:0;height:100%;background:#ff00ff}</style>"
WIDTH, HEIGHT = 1280, 800
Box = tuple[int, int, int, int]


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

    class Desk:
        """The app's window on Windows' desktop."""

        def __init__(self, pid: int) -> None:
            self.pid, self.hwnd = pid, 0

        @staticmethod
        def config(identifier: str) -> pathlib.Path:
            return pathlib.Path(os.environ["APPDATA"]) / identifier

        @staticmethod
        def moving() -> None:
            # Animations on, which a server's desktop has off and Chromium reads as
            # prefers-reduced-motion: the overview would arrive in one frame.
            user32.SystemParametersInfoW(0x1043, 0, ctypes.c_void_p(1), 0x3)

        def found(self) -> bool:
            self.hwnd = main_window(self.pid)
            return bool(self.hwnd)

        def placed(self) -> None:
            user32.ShowWindow(self.hwnd, 9)
            # The desk the taskbar leaves, so every corner of the page is on it.
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
        def grab(box: Box) -> Image.Image:
            return ImageGrab.grab(bbox=box, include_layered_windows=True)

else:

    def xdo(*words: str) -> str:
        return subprocess.run(["xdotool", *words], capture_output=True, text=True, check=False).stdout

    class Desk:  # type: ignore[no-redef]
        """The app's window on an X server: CEF's browsers are X windows of their own."""

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
        def grab(box: Box) -> Image.Image:
            return ImageGrab.grab(bbox=box, xdisplay=os.environ.get("DISPLAY"))


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
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")


class Film:
    """The window, grabbed as fast as the desktop gives it."""

    def __init__(self, desk: Desk, box: Box) -> None:
        self.desk, self.box, self.frames, self.going = desk, box, [], True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self) -> None:
        while self.going:
            at = time.time() * 1000
            self.frames.append((at, self.desk.grab(self.box)))

    def stop(self) -> list[tuple[float, Image.Image]]:
        self.going = False
        self.thread.join()
        return self.frames


#: How far out the overview is on each of the window's frames, and every placement the
#: window tells the engine for a page.
LOG = """
(() => {
  window.__ov = { frames: [], puts: [] }
  const look = () => {
    const open = document.documentElement.style.getPropertyValue('--overview-open')
    window.__ov?.frames.push([Date.now(), open === '' ? null : Number(open)])
    if (window.__ov) requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  const pages = nib.pages
  if (!pages.__heard) {
    const put = pages.put
    pages.put = function (id, page, one) {
      window.__ov?.puts.push([Date.now(), one.visible, one.cut, one.pane])
      return put.call(this, id, page, one)
    }
    pages.__heard = true
  }
  return true
})()
"""
TAKE = "(() => { const got = window.__ov; window.__ov = null; return got })()"
TOGGLE = "document.querySelector('button.nib-glyph.overview')?.click()"


def opened_at(log: list[list[Any]], at: float) -> float | None:
    best = None
    for when, open in log:
        if when > at:
            break
        best = open
    return best


def corners_of(hole: dict[str, float], scale: float, side: int, inset: int = 6) -> list[tuple[int, int]]:
    x0, y0 = hole["x"] * scale, hole["y"] * scale
    x1, y1 = (hole["x"] + hole["width"]) * scale, (hole["y"] + hole["height"]) * scale
    spots = [(x0 + inset, y0 + inset), (x1 - inset - side, y0 + inset), (x0 + inset, y1 - inset - side), (x1 - inset - side, y1 - inset - side)]
    return [(int(x), int(y)) for x, y in spots]


def judged(name: str, frames: list[tuple[float, Image.Image]], log: dict[str, Any], hole: dict[str, float] | None, out: pathlib.Path, scale: float) -> list[str]:
    wrong: list[str] = []
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    smalls = [one.convert("L").resize((160, 100)) for _, one in frames]
    for index, (_, one) in enumerate(frames):
        one.convert("RGB").resize((one.width // 2, one.height // 2)).save(folder / f"{index:03d}.jpg", quality=80)

    def apart(a: Image.Image, b: Image.Image) -> float:
        return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]

    steps = [round(apart(smalls[i - 1], smalls[i]), 1) for i in range(1, len(smalls))]
    opens = [opened_at(log["frames"], at) for at, _ in frames]
    print(f"[{name}] {len(frames)} frames over {(frames[-1][0] - frames[0][0]) / 1000:.2f} s, the overview out on {sum(o is not None for o in opens)}", flush=True)
    for i in range(1, len(smalls) - 1):
        before, after, across = steps[i - 1], steps[i], apart(smalls[i - 1], smalls[i + 1])
        if min(before, after) > 10 and across < min(before, after) / 2:
            wrong.append(f"[{name}] frame {i} flashes: {before:.1f} and {after:.1f} from its neighbours, {across:.1f} between them")
    if hole:
        side = 20
        spots = corners_of(hole, scale, side)
        for index, ((_, one), open) in enumerate(zip(frames, opens)):
            if open is None or open < 0.25:
                continue
            rgb = one.convert("RGB")
            painted = sum(
                all(abs(channel - COLOUR[k]) < 40 for k, channel in enumerate(ImageStat.Stat(rgb.crop((x, y, x + side, y + side))).mean))
                for x, y in spots
            )
            if painted >= 3:
                wrong.append(f"[{name}] frame {index}: the page is drawn under the overview, {open:.2f} out")
                break
    (folder / "log.json").write_text(json.dumps({"steps": steps, "opens": opens, **log}, indent=1), encoding="utf-8")
    return wrong


def round_trip(app: App, desk: Desk, name: str, hole: dict[str, float] | None, out: pathlib.Path, scale: float) -> list[str]:
    desk.forward()
    time.sleep(0.5)
    app.eval(LOG)
    film = Film(desk, desk.box())
    time.sleep(0.4)
    app.eval(TOGGLE)
    time.sleep(1.8)
    app.eval(TOGGLE)
    time.sleep(1.8)
    frames = film.stop()
    log = app.eval(TAKE)
    if not isinstance(log, dict) or "frames" not in log:
        log = {"frames": [], "puts": [], "said": log}
    return judged(name, frames, log, hole, out, scale)


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
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-overview-spaces-"))
    Desk.moving()
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "NIB_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    desk = Desk(process.pid)
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace") is not True:
            time.sleep(1)
        while time.monotonic() < until and not desk.found():
            time.sleep(0.25)
        if not desk.found():
            raise SystemExit("the app put up no window")
        desk.placed()
        desk.forward()
        time.sleep(3)
        app.eval(
            "for (const name of ['One', 'Two', 'Three'])"
            " nib.workspace.openBlank(name, `# ${name}\\n\\nSome words of ${name}.`); return true"
        )
        time.sleep(2)
        scale = float(app.eval("devicePixelRatio") or 1)
        still = app.eval("matchMedia('(prefers-reduced-motion: reduce)').matches")
        if still is not False:
            wrong.append(f"the window asks for no movement ({still}), so nothing would be filmed moving")
        desk.grab(desk.box()).save(args.out / "start.png")
        wrong += round_trip(app, desk, "notes", None, args.out, scale)

        app.eval(f"nib.workspace.openPage({json.dumps(url)}); return true")
        until = time.monotonic() + 40
        while time.monotonic() < until:
            if app.eval("nib.pages.each().some(([, page]) => page.sent && page.sent.visible && page.live)") is True:
                break
            time.sleep(0.5)
        time.sleep(3)
        hole = app.eval(
            "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        desk.grab(desk.box()).save(args.out / "web.png")
        if not isinstance(hole, dict):
            wrong.append(f"the web tab's page was never shown: {hole}")
        else:
            print(f"the page's hole: {hole}", flush=True)
            wrong += round_trip(app, desk, "web", hole, args.out, scale)
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
