from __future__ import annotations
import argparse
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from typing import Any
import mss
import numpy
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from drive_scheme import clicked  # noqa: E402
from fresh_app import ended, fresh  # noqa: E402
from native_app import INNER, App, config_of, endpoint, forward  # noqa: E402

MOST_BLACK = 0.1
KINDS = {"pages": (".pages", "createPages"), "canvas": (".canvas", "createCanvas")}
INK = (
    "(() => { try { const d = JSON.parse(orden.workspace.active?.doc ?? '{}');"
    " return (d.ink ?? d.orden?.ink ?? []).length } catch { return -1 } })()"
)
def borrowed(name: str) -> Any:
    import importlib.util
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
class Drive:
    def __init__(self, app: App, pid: int, hand: Any, pointer: Any, out: pathlib.Path) -> None:
        self.app, self.pid, self.hand, self.pointer, self.out = app, pid, hand, pointer, out
        self.where: dict[str, float] = {}
        self.wrong: list[str] = []
    def run(self, code: str) -> Any:
        return self.app.eval(code)
    def until(self, code: str, seconds: float) -> Any:
        stop = time.monotonic() + seconds
        while time.monotonic() < stop:
            said = self.run(code)
            if said and not (isinstance(said, dict) and "error" in said):
                return said
            time.sleep(0.25)
        return None
    def inner(self) -> dict[str, float]:
        said = self.run(INNER)
        if not isinstance(said, dict) or "x" not in said:
            raise SystemExit(f"where the window is was not said: {said}")
        if sys.platform == "darwin":
            import Quartz
            seen = [
                dict(one["kCGWindowBounds"])
                for one in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) or []
                if int(one.get("kCGWindowOwnerPID", 0)) == self.pid and int(one.get("kCGWindowLayer", 0)) == 0
            ]
            if seen:
                bounds = max(seen, key=lambda one: one["Width"] * one["Height"])
                said = {**said, "x": bounds["X"] * said["scale"], "y": bounds["Y"] * said["scale"]}
        elif sys.platform.startswith("linux"):
            size = self.run("[innerWidth, innerHeight]")
            client = self.pointer.x_client(self.pid, size if isinstance(size, list) else None)
            if client:
                said = {**said, "x": client[0], "y": client[1]}
        return said
    def screen(self, x: float, y: float) -> tuple[float, float]:
        at = self.where
        if sys.platform == "darwin":
            return at["x"] / at["scale"] + x, at["y"] / at["scale"] + y
        return at["x"] + x * at["ratio"], at["y"] + y * at["ratio"]
    def region(self, box: dict[str, float]) -> dict[str, int]:
        left, top = self.screen(box["x"], box["y"])
        right, bottom = self.screen(box["x"] + box["width"], box["y"] + box["height"])
        return {"left": int(left), "top": int(top), "width": int(right - left), "height": int(bottom - top)}
    def grab(self, region: dict[str, int]) -> numpy.ndarray:
        with mss.mss() as grab:
            return numpy.asarray(grab.grab(region))[:, :, :3]
    def opened(self, kind: str, named: str) -> dict[str, float] | None:
        selector, make = KINDS[kind]
        for _try in range(4):
            made = self.run(f"(async () => {{ try {{ await orden.workspace.{make}(undefined, {json.dumps(named)}); return 'made' }} catch (error) {{ return String(error) }} }})()")
            if self.until(f"orden.workspace.active?.kind === '{kind}' && !!document.querySelector('{selector}')", 6):
                break
            print(
                f"{kind}: {made}; "
                + json.dumps(self.run(f"({{ active: orden.workspace.active?.path ?? null, kind: orden.workspace.active?.kind ?? null, spaces: orden.workspace.spaces.length, found: !!document.querySelector('{selector}') }})")),
                flush=True,
            )
        time.sleep(1)
        box = self.run(
            f"(() => {{ const r = [...document.querySelectorAll('{selector}')].find((one) => one.getClientRects().length)?.getBoundingClientRect();"
            " return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()"
        )
        return box if isinstance(box, dict) else None
    def drawn(self, scheme: str, kind: str) -> None:
        label = f"{kind} {scheme}"
        box = self.opened(kind, f"Ink {scheme}")
        if not box:
            self.wrong.append(f"{label}: the surface never opened")
            return
        clip = {"x": box["x"] + 8, "y": box["y"] + 60, "width": min(700, box["width"] - 16), "height": min(480, box["height"] - 80)}
        self.run(
            f"[...document.querySelectorAll('{KINDS[kind][0]}')].find((one) => one.getClientRects().length).dispatchEvent(new KeyboardEvent('keydown', {{ key: 'd', code: 'KeyD', bubbles: true }}))"
        )
        time.sleep(0.4)
        region = self.region(clip)
        before = self.grab(region)
        ink = self.run(INK)
        start = (clip["x"] + 120, clip["y"] + 120)
        self.hand.move(*self.screen(*start))
        time.sleep(0.1)
        self.hand.down()
        for step in range(1, 30):
            self.hand.move(*self.screen(start[0] + step * 8, start[1] + (step % 6) * 5))
            time.sleep(0.02)
        time.sleep(0.2)
        during = self.grab(region)
        self.hand.up()
        time.sleep(1.2)
        after = self.grab(region)
        self.latency(label, clip)
        more = self.until(f"({INK}) > {ink}", 4)
        held, left = turned(before, during), turned(before, after)
        print(
            f"{label}: backing "
            + json.dumps(self.run(
                "(() => { const live = [...document.querySelectorAll('canvas.ink.live')].find((one) => one.getClientRects().length)?.getContext('2d')?.getContextAttributes?.() ?? null;"
                " const gl = document.createElement('canvas').getContext('webgl');"
                " const info = gl?.getExtension('WEBGL_debug_renderer_info');"
                " return { live, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null } })()"
            )),
            flush=True,
        )
        print(f"{label}: ink {ink} -> {self.run(INK)}; black while drawing {held:.1%}, after {left:.1%}", flush=True)
        if not more:
            self.wrong.append(f"{label}: the stroke left no ink")
        if held > MOST_BLACK or left > MOST_BLACK:
            for name, shot in (("before", before), ("during", during), ("after", after)):
                Image.fromarray(shot[:, :, ::-1]).save(self.out / f"black-{kind}-{scheme}-{name}.png")
            self.wrong.append(f"{label}: one stroke turned {max(held, left):.0%} of the surface black")
    def latency(self, label: str, clip: dict[str, float]) -> None:
        start = (clip["x"] + 60, clip["y"] + clip["height"] - 100)
        self.hand.move(*self.screen(*start))
        time.sleep(0.1)
        self.hand.down()
        took: list[float] = []
        with mss.mss() as grab:
            for one in range(1, 13):
                at = (start[0] + one * 30, start[1])
                spot = self.region({"x": at[0] - 6, "y": at[1] - 6, "width": 12, "height": 12})
                was = numpy.asarray(grab.grab(spot))[:, :, :3].astype(numpy.float32)
                began = time.perf_counter()
                self.hand.move(*self.screen(*at))
                while time.perf_counter() - began < 0.5:
                    now = numpy.asarray(grab.grab(spot))[:, :, :3].astype(numpy.float32)
                    if abs(now - was).mean() > 6:
                        took.append((time.perf_counter() - began) * 1000)
                        break
                time.sleep(0.12)
        self.hand.up()
        took.sort()
        middle = took[len(took) // 2] if took else None
        print(f"latency {label}: median {middle if middle is None else round(middle, 1)} ms over {len(took)} of 12 moves; {[round(one) for one in took]}", flush=True)
    def all(self) -> None:
        for scheme in ("light", "dark"):
            said = clicked(self.run, scheme)
            for _again in range(2):
                if said in ("switched", "kept"):
                    break
                time.sleep(1)
                said = clicked(self.run, scheme)
            print(f"{scheme}: {said}", flush=True)
            if said not in ("switched", "kept") and self.run("document.documentElement.dataset.theme") != scheme:
                self.wrong.append(f"{scheme}: the theme could not be chosen ({said})")
                continue
            for kind in KINDS:
                forward(self.app, self.pid)
                time.sleep(0.5)
                self.where = self.inner()
                try:
                    self.drawn(scheme, kind)
                except (SystemExit, Exception) as error:
                    traceback.print_exc()
                    self.wrong.append(f"{kind} {scheme}: stopped: {error}")
def turned(before: numpy.ndarray, after: numpy.ndarray) -> float:
    if before.shape != after.shape:
        return 0.0
    was = (before < 20).all(axis=2)
    now = (after < 20).all(axis=2)
    return float((now & ~was).sum()) / max(1, now.size)
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    pointer = borrowed("parity-pointer-drive")
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-ink-black-spaces-"))
    hand = pointer.Windows() if sys.platform == "win32" else pointer.Mac() if sys.platform == "darwin" else pointer.Linux()
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    drive: Drive | None = None
    failed: str | None = None
    try:
        app = endpoint(config, process.pid, secret)
        stop = time.monotonic() + 90
        while time.monotonic() < stop and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("(async () => { if (!orden.workspace.spaces.length) await orden.workspace.addSpace('Ink'); return true })()")
        stop = time.monotonic() + 30
        while time.monotonic() < stop and not app.eval("orden.workspace.spaces.length > 0"):
            time.sleep(0.5)
        forward(app, process.pid)
        time.sleep(2)
        drive = Drive(app, process.pid, hand, pointer, args.out)
        drive.all()
    except (SystemExit, Exception) as error:
        traceback.print_exc()
        failed = str(error)
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)
    wrong = (drive.wrong if drive else []) + ([failed] if failed else [])
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
