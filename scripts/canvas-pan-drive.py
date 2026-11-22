from __future__ import annotations
import argparse
import json
import os
import pathlib
import random
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import traceback

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

MOST_GAP = 80
MOST_CHANGES = 16
SIDES = ["top", "right", "bottom", "left"]
WATCH = (
    "(() => { const host = [...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length);"
    " const probe = { frames: [], changed: 0 }; window.__pan = probe;"
    " new MutationObserver((list) => { probe.changed += list.length }).observe(host, { subtree: true, childList: true, attributes: true, characterData: true });"
    " const tick = (at) => { probe.frames.push([at, probe.changed]); probe.changed = 0; requestAnimationFrame(tick) };"
    " requestAnimationFrame(tick); return true })()"
)
SINCE = (
    "((from) => { const frames = window.__pan.frames.filter(([at]) => at >= from); let gap = 0;"
    " for (let i = 1; i < frames.length; i++) gap = Math.max(gap, frames[i][0] - frames[i - 1][0]);"
    " return { frames: frames.length, gap: Math.round(gap), most: Math.max(0, ...frames.map(([, c]) => c)) } })(%s)"
)
def board() -> str:
    pick = random.Random(7)
    nodes, cards = [], []
    for group in range(3):
        gx, gy = group * 900 - 1100, (group % 2) * 200 - 400
        nodes.append({"id": f"g{group}", "type": "group", "label": f"Group {group}", "x": gx - 40, "y": gy - 60, "width": 760, "height": 860})
        for at in range(7 if group < 2 else 6):
            one = f"c{group}-{at}"
            cards.append(one)
            nodes.append({"id": one, "type": "text", "text": f"Card {group}.{at}", "x": gx + (at % 2) * 360, "y": gy + (at // 2) * 200, "width": 300, "height": 90})
    edges = []
    for at in range(40):
        a, b = pick.sample(cards, 2)
        edges.append({"id": f"e{at}", "fromNode": a, "toNode": b, "fromSide": pick.choice(SIDES), "toSide": pick.choice(SIDES), "toEnd": "arrow"})
    return json.dumps({"nodes": nodes, "edges": edges})
def borrowed(name: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    ink = borrowed("ink-black-drive")
    pointer = ink.borrowed("parity-pointer-drive")
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-canvas-pan-spaces-"))
    hand = pointer.Windows() if sys.platform == "win32" else pointer.Mac() if sys.platform == "darwin" else pointer.Linux()
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        stop = time.monotonic() + 90
        while time.monotonic() < stop and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        opened = None
        for _try in range(5):
            opened = app.eval(
                "(async () => { if (!orden.workspace.spaces.length) await orden.workspace.addSpace('Pan');"
                " const path = `${orden.workspace.activeSpace.root}/Pan board.canvas`;"
                f" await orden.invoke('write_note', {{ path, content: {json.dumps(board())} }});"
                " await orden.workspace.loadTree(); await orden.workspace.openEntry(path, { activate: true }); return path })()",
                60,
            )
            if isinstance(opened, str):
                break
            time.sleep(2)
        print(f"the board: {opened}", flush=True)
        forward(app, process.pid)
        if sys.platform == "darwin":
            from AppKit import NSApplicationActivateIgnoringOtherApps, NSRunningApplication
            NSRunningApplication.runningApplicationWithProcessIdentifier_(process.pid).activateWithOptions_(NSApplicationActivateIgnoringOtherApps)
        time.sleep(3)
        drive = ink.Drive(app, process.pid, hand, pointer, args.out)
        box = app.eval(
            "(() => { const r = [...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length)?.getBoundingClientRect();"
            " return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()"
        )
        if not isinstance(box, dict):
            raise SystemExit(f"the canvas never showed: {box}")
        cards = app.eval("document.querySelectorAll('.canvas .node').length")
        app.eval("[...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length).dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }))")
        time.sleep(0.3)
        drive.where = drive.inner()
        app.eval(WATCH)
        app.eval("(() => { window.__moves = 0; addEventListener('pointermove', () => { window.__moves += 1 }, { capture: true, passive: true }); return true })()")
        start = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        hand.move(*drive.screen(*start))
        time.sleep(0.2)
        hand.down()
        time.sleep(0.1)
        began = app.eval("performance.now()")
        for step in range(1, 61):
            hand.move(*drive.screen(start[0] - step * 10, start[1] - step * 3))
            time.sleep(0.016)
        seen = app.eval(SINCE % began)
        hand.up()
        print(f"panning {cards} nodes and 40 arrows: {seen}", flush=True)
        if app.eval("window.__moves") == 0:
            print("::notice::no pointer move reached the app on this machine, so the pan was not measured", flush=True)
        elif not isinstance(seen, dict) or seen.get("frames", 0) < 20:
            wrong.append(f"the pan was not measured: {seen}")
        else:
            if seen["gap"] > MOST_GAP:
                wrong.append(f"panning left a {seen['gap']} ms gap between frames")
            if seen["most"] > MOST_CHANGES:
                wrong.append(f"panning changed {seen['most']} things in one frame")
    except (SystemExit, Exception) as error:
        traceback.print_exc()
        wrong.append(str(error))
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
