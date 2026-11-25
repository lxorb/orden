from __future__ import annotations
import argparse
import ctypes
import http.server
import importlib
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
import mss
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
keys = importlib.import_module("parity-keys-drive")
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

PLATFORM = keys.PLATFORM
WATCH = """
window.__flights = 0
window.__flightWatch?.disconnect()
window.__flightWatch = new MutationObserver((records) => {
  for (const one of records) for (const node of one.addedNodes) if (node.dataset && 'flight' in node.dataset) window.__flights += 1
})
window.__flightWatch.observe(document.body, { childList: true })
window.__cutMost = 0
const until = performance.now() + 2000
const look = () => {
  for (const [, page] of orden.pages.each()) {
    const cut = page.sent && page.sent.cut
    for (const one of (cut && cut.hollows) || []) window.__cutMost = Math.max(window.__cutMost, Math.round(one.width * one.height))
  }
  if (performance.now() < until) requestAnimationFrame(look)
}
requestAnimationFrame(look)
return true
"""
LOOKS = 1.6
STEP = 12
CONTROLS = (12, 12, 352, 416)
ICON_AREA = 4 * 28 * 28
def region(drive: keys.Drive) -> dict[str, int] | None:
    pane = drive.js("(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible); return all[0] ? all[0][1].sent.pane : null })()")
    if not isinstance(pane, dict):
        return None
    left, top = drive.screen.at(drive.page_left + 4, drive.page_top + 4)
    right, bottom = drive.screen.at(pane["x"] + pane["width"] - 4, pane["y"] + pane["height"] - 4)
    if right - left < STEP or bottom - top < STEP:
        return None
    controls = [*drive.screen.at(drive.page_left + CONTROLS[0], drive.page_top + CONTROLS[1]), *drive.screen.at(drive.page_left + CONTROLS[2], drive.page_top + CONTROLS[3])]
    return {"left": round(left), "top": round(top), "width": round(right - left), "height": round(bottom - top), "controls": [round(one) for one in controls]}
def holes(grab, area: dict[str, object]) -> list[list[int]]:
    box = {key: area[key] for key in ("left", "top", "width", "height")}
    shot = grab.grab(box)
    image = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    x0, y0, x1, y1 = area["controls"]
    found = []
    for y in range(0, image.height, STEP):
        for x in range(0, image.width, STEP):
            at = [box["left"] + x, box["top"] + y]
            if x0 <= at[0] <= x1 and y0 <= at[1] <= y1:
                continue
            if not keys.near(image.getpixel((x, y)), keys.MAGENTA, 60):
                found.append(at)
    return found
def animations(on: bool) -> bool:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    was = ctypes.c_int(0)
    user32.SystemParametersInfoW(0x1042, 0, ctypes.byref(was), 0)
    user32.SystemParametersInfoW(0x1043, 0, ctypes.c_void_p(1 if on else 0), 0x2)
    print(f"the system's animations were {'on' if was.value else 'off'}, now {'on' if on else 'off'}", flush=True)
    return bool(was.value)
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--times", type=int, default=5)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if PLATFORM == "windows":
        from probe_app import refuse_updating
        refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)
    animated = animations(True) if PLATFORM == "windows" else None
    wrote_rc = keys.prepared_linux()
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), keys.Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/keys"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-flight-spaces-"))
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
    rows: list[dict[str, object]] = []
    try:
        app = endpoint(config, process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        if PLATFORM == "windows":
            from ctypes import wintypes
            from probe_app import main_window
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            hwnd = main_window(process.pid)
            desk = wintypes.RECT()
            user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
            user32.ShowWindow(hwnd, 9)
            user32.SetWindowPos(hwnd, None, desk.left, desk.top, min(1280, desk.right - desk.left), min(800, desk.bottom - desk.top), 0x0004)
        forward(app, process.pid)
        time.sleep(22)
        app.eval("document.querySelector('.orden-screen.sheet[role=\"dialog\"] button[data-lands]')?.click(); return true")
        grab = mss.mss()
        drive = keys.Drive(app, process.pid, url, args.out)
        tab = drive.js(f"return orden.workspace.openPage({json.dumps(url + '?main')})")
        if not isinstance(tab, str):
            raise SystemExit(f"no web tab was opened: {tab}")
        drive.ids = {"web": tab}
        drive.js(f"orden.workspace.activate({json.dumps(tab)}); return true")
        if app.until("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible) || null", 40) is None:
            raise SystemExit("the page was never shown")
        time.sleep(2)
        forward(app, process.pid)
        for time_ in range(args.times):
            drive.js(f"orden.workspace.activate({json.dumps(tab)}); return true")
            time.sleep(0.8)
            drive.page_box()
            if not drive.focus_page():
                rows.append({"time": time_, "ok": None, "why": "the page could not be given the keyboard by a click"})
                continue
            area = region(drive)
            if area is None:
                rows.append({"time": time_, "ok": None, "why": "the page has no place"})
                continue
            before = holes(grab, area)
            drive.js(WATCH)
            drive.keys.click(*drive.in_page(99, 384))
            frames, worst = 0, []
            stop = time.monotonic() + LOOKS
            while time.monotonic() < stop:
                found = holes(grab, area)
                frames += 1
                if len(found) > len(worst):
                    worst = found
                    drive.screen.shot().save(args.out / f"worst-{time_}.png")
            flights = drive.js("return window.__flights")
            cut_most = drive.js("return window.__cutMost")
            one = {"time": time_, "flights": flights, "largest hollow cut for it": cut_most, "frames": frames, "page off before": len(before), "page off at worst": len(worst), "first off": worst[:6]}
            small = isinstance(cut_most, (int, float)) and cut_most <= ICON_AREA
            ok = None if not flights else (len(worst) == 0 and len(before) == 0 and small)
            why = "" if flights else "no flight was seen, so nothing was measured"
            rows.append({**one, "ok": ok, "why": why})
            print(f"a download's flight over a live page leaves the page whole: {json.dumps(rows[-1])}", flush=True)
            time.sleep(1.0)
    finally:
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        if animated is False:
            animations(False)
        if wrote_rc:
            keys.openbox_rc().unlink(missing_ok=True)
            subprocess.run(["openbox", "--reconfigure"], capture_output=True, check=False)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    wrong = [one for one in rows if one["ok"] is False]
    measured = [one for one in rows if one["ok"] is not None]
    for one in wrong:
        print(f"::error::a download's flight cut the page: {json.dumps(one)}", flush=True)
    if not measured:
        print("::error::no flight was ever seen over the page", flush=True)
    return 1 if wrong or not measured else 0
if __name__ == "__main__":
    raise SystemExit(main())
