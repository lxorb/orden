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

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

Y = "[...document.querySelectorAll('.pages')].find((one) => one.getClientRects().length)?.querySelector('.sheet')?.getBoundingClientRect().top ?? null"
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
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-pages-scroll-spaces-"))
    hand = pointer.Windows() if sys.platform == "win32" else pointer.Mac() if sys.platform == "darwin" else pointer.Linux()
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        stop = time.monotonic() + 90
        while time.monotonic() < stop and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        app.eval("(async () => { if (!orden.workspace.spaces.length) await orden.workspace.addSpace('Scroll'); return true })()")
        forward(app, process.pid)
        if sys.platform == "darwin":
            from AppKit import NSApplicationActivateIgnoringOtherApps, NSRunningApplication
            NSRunningApplication.runningApplicationWithProcessIdentifier_(process.pid).activateWithOptions_(NSApplicationActivateIgnoringOtherApps)
        time.sleep(2)
        drive = ink.Drive(app, process.pid, hand, pointer, args.out)
        box = drive.opened("pages", "Scroll")
        if not box:
            raise SystemExit("the page note never opened")
        time.sleep(0.8)
        drive.where = drive.inner()
        hand.move(*drive.screen(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2))
        time.sleep(0.3)
        hand.click(1)
        time.sleep(0.5)
        app.eval("(() => { window.__wheels = 0; addEventListener('wheel', () => { window.__wheels += 1 }, { capture: true, passive: true }); return true })()")
        for label, notches in (("a wheel", 4), ("a wheel again", 4)):
            before = app.eval(Y)
            hand.wheel(notches)
            time.sleep(1)
            after = app.eval(Y)
            print(f"{label}: the view went {before} -> {after}", flush=True)
            if app.eval("window.__wheels") == 0:
                print(f"::notice::{label}: no wheel event reached the app on this machine, so the scroll was not measured", flush=True)
                continue
            if not isinstance(before, (int, float)) or not isinstance(after, (int, float)) or after >= before - 100:
                wrong.append(f"{label} did not scroll a page note down ({before} -> {after})")
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
