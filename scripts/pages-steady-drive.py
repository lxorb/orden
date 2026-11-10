from __future__ import annotations

import argparse
import base64
import io
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any

import crash_told
from fresh_app import ended, fresh
from heavy_paper import BENCH_BODY, REFERENCE, heavy_paper

OPEN_LIMIT = 8000
BLOCK_LIMIT = 500

WATCH = """
const probe = { beats: [], frames: [] }
window.__steady = probe
let last = performance.now()
setInterval(() => {
  const now = performance.now()
  probe.beats.push([now, now - last])
  last = now
}, 16)
const look = (at) => {
  const sheets = [...document.querySelectorAll('.pages .sheet')].filter((one) => {
    const box = one.getBoundingClientRect()
    return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth
  })
  const bare = sheets.filter((one) => {
    const canvas = one.querySelector('canvas:not(.close)')
    return canvas && (!canvas.classList.contains('there') || canvas.width <= 1)
  }).length
  probe.frames.push([at, sheets.length, bare])
  requestAnimationFrame(look)
}
requestAnimationFrame(look)
return true
"""

SINCE = """
const from = %s
const probe = window.__steady
const beats = probe.beats.filter(([at]) => at >= from)
const frames = probe.frames.filter(([at]) => at >= from)
let gap = 0
for (let i = 1; i < frames.length; i++) gap = Math.max(gap, frames[i][0] - frames[i - 1][0])
let blocked = 0
for (const [, between] of beats) blocked = Math.max(blocked, between)
return { blocked, gap, frames: frames.length, bare: frames.filter(([, , bare]) => bare > 0).length }
"""

DRAWN = """
const sheets = [...document.querySelectorAll('.pages .sheet')]
return sheets.length === 2 && sheets.every((one) => one.querySelector('canvas.there')?.width > 1)
"""

DARK = """
const out = []
for (const sheet of document.querySelectorAll('.pages .sheet')) {
  for (const canvas of sheet.querySelectorAll('canvas.there')) {
    const pen = canvas.getContext('2d')
    if (!pen || canvas.width < 4 || canvas.height < 4) continue
    const data = pen.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: 'srgb' }).data
    let dark = 0, seen = 0
    for (let at = 0; at < data.length; at += 4 * 97) {
      seen++
      if (data[at] < 24 && data[at + 1] < 24 && data[at + 2] < 24) dark++
    }
    out.push(Math.round((dark / Math.max(1, seen)) * 100))
  }
}
return out
"""

INKED = """
await new Promise((go) => setTimeout(go, 1500))
const path = orden.workspace.active?.note?.path ?? orden.workspace.active?.path
if (!path) return -1
try { return JSON.parse(await orden.invoke('read_note', { path })).orden?.ink?.length ?? 0 } catch { return -2 }
"""

EDITS = """
const path = orden.workspace.active?.note?.path ?? orden.workspace.active?.path
if (!path) return false
for (let n = 0; n < 12; n++) {
  const doc = JSON.parse(await orden.invoke('read_note', { path }))
  doc.orden ??= { version: 1 }
  doc.orden.ink ??= []
  const x = 60 + (n % 4) * 60, y = 80 + Math.floor(n / 4) * 50
  const points = []
  for (let at = 0; at < 16; at++) points.push(x + at * 8, y + (at % 5) * 4, 0.6, 0, 0, at * 8)
  doc.orden.ink.push({ id: 'steady-' + n, tool: 'pen', color: 'ink', size: 3, points })
  await orden.invoke('write_note', { path, content: JSON.stringify(doc, null, '\\t') })
  await new Promise((go) => setTimeout(go, 350))
}
return true
"""

MARKS = """
const from = %s
const marks = performance.getEntriesByType('mark').filter((one) => one.name.startsWith('orden: paper')).map((one) => [one.name, Math.round(one.startTime - from)])
const held = window.__steady.beats.filter(([at]) => at >= from).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([at, between]) => [Math.round(at - between - from), Math.round(between)])
return { marks, held }
"""

SHEET = """
const box = document.querySelector('.pages .sheet').getBoundingClientRect()
const host = document.querySelector('.pages').getBoundingClientRect()
return { x: box.x, y: box.y, width: box.width, height: box.height, hx: host.x, hy: host.y, hw: host.width, hh: host.height }
"""


def config_of(identifier: str) -> pathlib.Path:
    if sys.platform == "win32":
        return pathlib.Path(os.environ["APPDATA"]) / identifier
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 60) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                return json.loads(said.read().decode("utf-8", "replace")).get("value")
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            return {"error": str(error)}

    def until(self, code: str, seconds: float = 30) -> bool:
        ends = time.monotonic() + seconds
        while time.monotonic() < ends:
            if self.eval(code) is True:
                return True
            time.sleep(0.1)
        return False


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


def page_session(identifier: str) -> Any:
    from devtools import Session, port, targets

    web = pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier / "EBWebView"
    until = time.monotonic() + 90
    while time.monotonic() < until:
        found = port(web) if web.exists() else 0
        if found:
            pages = [one for one in targets(found) if one.get("type") == "page"]
            pages = [one for one in pages if "quick-add" not in one.get("url", "")] or pages
            if pages:
                return Session(pages[0])
        time.sleep(0.5)
    there = sorted(str(one.relative_to(web.parent)) for one in web.parent.glob("*")) if web.parent.exists() else []
    print(f"no devtools port under {web}; beside it: {there[:20]}", flush=True)
    return None


class Recording:
    def __init__(self, tools: Any) -> None:
        self.tools = tools

    def start(self) -> None:
        self.tools.events.clear()
        self.tools.call("Page.startScreencast", {"format": "png", "everyNthFrame": 1})

    def stop(self) -> list[bytes]:
        frames: list[bytes] = []
        self.tools.listen(0.3)
        self.tools.call("Page.stopScreencast")
        for one in self.tools.events:
            if one.get("method") != "Page.screencastFrame":
                continue
            params = one["params"]
            frames.append(base64.b64decode(params["data"]))
            self.tools.call("Page.screencastFrameAck", {"sessionId": params["sessionId"]}, seconds=5)
        self.tools.events.clear()
        return frames

    def pump(self, seconds: float) -> None:
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            self.tools.listen(0.05)
            for one in self.tools.events:
                if one.get("method") == "Page.screencastFrame" and not one.get("acked"):
                    one["acked"] = True
                    self.tools.call("Page.screencastFrameAck", {"sessionId": one["params"]["sessionId"]}, seconds=5)


def black_frames(frames: list[bytes], sheet: dict, css_width: float) -> tuple[int, float, list[bytes]]:
    from PIL import Image

    black, worst, kept = 0, 0.0, []
    for png in frames:
        picture = Image.open(io.BytesIO(png)).convert("RGB")
        scale = picture.width / css_width
        left = max(0, int(max(sheet["x"], sheet["hx"]) * scale) + 4)
        top = max(0, int(max(sheet["y"], sheet["hy"]) * scale) + 4)
        right = min(picture.width, int(min(sheet["x"] + sheet["width"], sheet["hx"] + sheet["hw"]) * scale) - 4)
        bottom = min(picture.height, int(min(sheet["y"] + sheet["height"], sheet["hy"] + sheet["hh"]) * scale) - 4)
        if right - left < 8 or bottom - top < 8:
            continue
        part = picture.crop((left, top, right, bottom)).resize((max(1, (right - left) // 4), max(1, (bottom - top) // 4)))
        pixels = part.tobytes()
        count = len(pixels) // 3
        dark = sum(1 for at in range(0, len(pixels), 3) if pixels[at] < 24 and pixels[at + 1] < 24 and pixels[at + 2] < 24)
        share = dark / max(1, count)
        worst = max(worst, share)
        if share > 0.25:
            black += 1
            if len(kept) < 3:
                kept.append(png)
    return black, worst, kept


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--shots", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()) / "pages-steady")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if sys.platform not in ("win32", "darwin"):
        print("this drive is for WebView2 and WKWebView; the Linux engines are driven by test/e2e/pages-pdf-steady.py")
        return 0
    windows = sys.platform == "win32"
    args.shots.mkdir(parents=True, exist_ok=True)

    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-steady-spaces-"))
    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces)}
    if windows:
        from devtools import debugged

        env = debugged(env)
    process = subprocess.Popen([str(args.exe)], env=env, cwd=str(args.exe.parent))
    wrong: list[str] = []
    unverified: list[str] = []
    tools = None
    try:
        app = endpoint(config, process.pid, secret)
        if not app.until("return !!orden.workspace && !!orden.workspace.activeSpace", 90):
            raise SystemExit("the app never had a space")
        time.sleep(2)
        print(f"engine: {app.eval('return navigator.userAgent')}", flush=True)
        print(f"graphics: {app.eval('const gl = document.createElement(\"canvas\").getContext(\"webgl\"); const info = gl && gl.getExtension(\"WEBGL_debug_renderer_info\"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : String(!!gl)')}", flush=True)
        root = app.eval("return orden.workspace.activeSpace.root.replace(/[\\\\/]+$/, '')")
        if not isinstance(root, str):
            raise SystemExit(f"no space root: {root}")
        pdf = f"{root}/Heavy.pdf"
        made = heavy_paper()
        put = app.eval(
            f"return orden.invoke('write_bytes', {{ path: {json.dumps(pdf)}, base64: {json.dumps(base64.b64encode(made).decode())} }})"
            ".then(() => 'done', (error) => 'refused: ' + error)"
        )
        if put != "done":
            raise SystemExit(f"the app put no PDF in the space: {put}")
        app.eval("await orden.workspace.loadTree(); return true")
        benches = [app.eval(BENCH_BODY) for _ in range(5)]
        bench = min(one for one in benches if isinstance(one, (int, float))) if any(isinstance(one, (int, float)) for one in benches) else REFERENCE
        slower = max(1, bench / REFERENCE)
        open_limit, block_limit = OPEN_LIMIT * slower, BLOCK_LIMIT * slower
        print(f"the fixed work took {bench:.1f} ms against {REFERENCE:.1f}: opening may take {open_limit:.0f} ms, the window may be held {block_limit:.0f} ms", flush=True)
        app.eval(WATCH)
        if windows:
            tools = page_session(args.identifier)
            if tools is None:
                unverified.append("the engine's devtools never answered; no frames or profile were recorded")
        recording = Recording(tools) if tools else None
        if tools:
            tools.call("Profiler.enable")
            tools.call("Profiler.setSamplingInterval", {"interval": 500})
            tools.call("Profiler.start")

        started = app.eval("return performance.now()")
        app.eval(f"void orden.workspace.openPdf({json.dumps(pdf)}, 1); return true")
        opened = app.until("return document.querySelectorAll('.pages .sheet').length === 2", 120)
        drawn_ok = opened and app.until(DRAWN, 180)
        drawn = app.eval("return performance.now()")
        time.sleep(1.5)
        opening = app.eval(SINCE % started)
        if tools:
            profile = tools.call("Profiler.stop", seconds=60).get("profile")
            if profile:
                (args.shots / "open.cpuprofile").write_text(json.dumps(profile), encoding="utf-8")
                print(f"open profile: {heaviest(profile)}", flush=True)
        print(f"paper marks: {app.eval(MARKS % started)}", flush=True)
        print(f"open: both pages drawn {drawn_ok} after {drawn - started:.0f} ms; {opening}", flush=True)
        if not drawn_ok:
            wrong.append("the page note never drew both pages")
        elif drawn - started > open_limit:
            wrong.append(f"opening the page note took {drawn - started:.0f} ms to draw its pages")
        if isinstance(opening, dict) and opening["blocked"] > block_limit:
            wrong.append(f"opening the page note held the window {opening['blocked']:.0f} ms")

        app.eval("document.querySelector('.pages').focus(); return true")
        sheet = app.eval(SHEET)
        css = app.eval("return innerWidth")
        before = app.eval(INKED)
        from_edit = app.eval("return performance.now()")
        if recording:
            recording.start()
        if tools:
            tools.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "d", "text": "d", "code": "KeyD", "windowsVirtualKeyCode": 68})
            tools.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "d", "code": "KeyD", "windowsVirtualKeyCode": 68})
            for n in range(12):
                x0 = sheet["x"] + 60 + (n % 4) * 60
                y0 = max(sheet["hy"] + 80, sheet["y"] + 80) + (n // 4) * 50
                tools.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x0, "y": y0, "button": "left", "buttons": 1, "clickCount": 1, "pointerType": "pen", "force": 0.6})
                for step in range(1, 16):
                    tools.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x0 + step * 8, "y": y0 + (step % 5) * 4, "button": "left", "buttons": 1, "pointerType": "pen", "force": 0.6})
                    recording.pump(0.008) if recording else time.sleep(0.008)
                tools.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x0 + 120, "y": y0 + 8, "button": "left", "buttons": 0, "clickCount": 1, "pointerType": "pen"})
                recording.pump(0.35) if recording else time.sleep(0.35)
        else:
            app.eval(EDITS)
        if recording:
            recording.pump(1.2)
        else:
            time.sleep(1.2)
        after = app.eval(INKED)
        editing = app.eval(SINCE % from_edit)
        if not (isinstance(after, int) and isinstance(before, int) and after - before == 12):
            unverified.append(f"the twelve strokes written to the page note were not all read back: {before} -> {after}")
        dark = app.eval(DARK)
        print(f"edit: {after - before if isinstance(after, int) and isinstance(before, int) else after} strokes; {editing}; dark share of drawn canvases {dark}", flush=True)
        if isinstance(editing, dict):
            if editing["bare"]:
                wrong.append(f"while editing, {editing['bare']} frames showed a page without its paper")
            if editing["blocked"] > block_limit:
                wrong.append(f"editing held the window {editing['blocked']:.0f} ms")
        if isinstance(dark, list) and any(one > 25 for one in dark):
            wrong.append(f"a page's paper canvas is mostly black after edits: {dark}")
        if recording:
            frames = recording.stop()
            black, worst, kept = black_frames(frames, sheet, css)
            for at, png in enumerate(kept):
                (args.shots / f"black-edit-{at}.png").write_bytes(png)
            print(f"edit frames: {len(frames)}, {black} mostly black (worst {worst:.0%})", flush=True)
            if black:
                wrong.append(f"while editing, {black} of {len(frames)} frames showed the page note black")

        from_zoom = app.eval("return performance.now()")
        if recording:
            recording.start()
        if tools:
            tools.call("Profiler.start")
            middle = (sheet["hx"] + sheet["hw"] / 2, sheet["hy"] + sheet["hh"] / 2)
            for step in range(24):
                tools.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": middle[0], "y": middle[1], "deltaX": 0, "deltaY": -120 if step < 16 else 120, "modifiers": 2})
                recording.pump(0.06) if recording else time.sleep(0.06)
        else:
            app.eval(
                "const host = document.querySelector('.pages'); const box = host.getBoundingClientRect();"
                "for (let step = 0; step < 24; step++) { host.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: step < 16 ? -120 : 120, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }));"
                " await new Promise((go) => setTimeout(go, 60)) } return true"
            )
        if recording:
            recording.pump(1.5)
        else:
            time.sleep(1.5)
        zooming = app.eval(SINCE % from_zoom)
        scale = app.eval("return document.querySelector('.pages .sheet').getBoundingClientRect().width")
        print(f"zoom: the first page is {scale} wide; {zooming}", flush=True)
        if tools:
            profile = tools.call("Profiler.stop", seconds=60).get("profile")
            if profile:
                (args.shots / "zoom.cpuprofile").write_text(json.dumps(profile), encoding="utf-8")
                print(f"zoom profile: {heaviest(profile)}", flush=True)
        if isinstance(zooming, dict):
            if zooming["bare"]:
                wrong.append(f"while zooming, {zooming['bare']} frames showed a page without its paper")
            if zooming["blocked"] > block_limit:
                wrong.append(f"zooming held the window {zooming['blocked']:.0f} ms")
        if recording:
            frames = recording.stop()
            black, worst, kept = black_frames(frames, sheet, css)
            for at, png in enumerate(kept):
                (args.shots / f"black-zoom-{at}.png").write_bytes(png)
            print(f"zoom frames: {len(frames)}, {black} mostly black (worst {worst:.0%})", flush=True)
            if black:
                wrong.append(f"while zooming, {black} of {len(frames)} frames showed the page note black")
    finally:
        if tools:
            tools.close()
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)

    for one in unverified:
        print(f"::warning::{one}", flush=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0


def heaviest(profile: dict, count: int = 12) -> list[str]:
    nodes = {node["id"]: node for node in profile.get("nodes", [])}
    self_time: dict[int, int] = {}
    for sample in profile.get("samples", []):
        self_time[sample] = self_time.get(sample, 0) + 1
    deltas = profile.get("timeDeltas", [])
    every = (sum(deltas) / max(1, len(deltas))) / 1000 if deltas else 0.5
    named: dict[str, float] = {}
    for node_id, hits in self_time.items():
        frame = nodes.get(node_id, {}).get("callFrame", {})
        name = f"{frame.get('functionName') or '(anonymous)'} {pathlib.PurePosixPath(frame.get('url', '')).name}:{frame.get('lineNumber', 0)}"
        named[name] = named.get(name, 0) + hits * every
    return [f"{ms:.0f} ms {name}" for name, ms in sorted(named.items(), key=lambda one: -one[1])[:count]]


if __name__ == "__main__":
    raise SystemExit(main())
