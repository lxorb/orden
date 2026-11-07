"""A folder of camera photos in the file explorer's grid, in the packaged Windows app.

Scrolls a grid of a few hundred 12-megapixel photos from top to bottom and back while
the window is asked a WM_NULL every quarter second and the page watches its long tasks.
Fails when the window hung, a task held the page too long, the webview's memory climbed
by more than --most-mb, or no tile ever showed its picture.

    python scripts/explorer-photos-probe.py --exe <the probe's exe> --identifier <probe id>
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import threading
import time
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
SPACE = "Photos probe"
NOTE = "Idea"
LONGEST_MS = 400


def borrowed(name: str, file: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def photos(folder: pathlib.Path, count: int) -> int:
    from PIL import Image

    folder.mkdir(parents=True)
    made: list[bytes] = []
    for seed in range(4):
        small = Image.frombytes("RGB", (400, 300), os.urandom(400 * 300 * 3))
        big = small.resize((4000, 3000), Image.Resampling.BICUBIC)
        out = io.BytesIO()
        big.save(out, "JPEG", quality=92)
        made.append(out.getvalue())
    for at in range(count):
        (folder / f"IMG_{at:04}.jpg").write_bytes(made[at % len(made)])
    return sum(len(one) for one in made) // len(made)


def webview_mb(pid: int, family: Any) -> float:
    import psutil

    total = 0
    for one in family(pid):
        try:
            process = psutil.Process(one)
            if "webview" in process.name().lower() or one == pid:
                total += process.memory_info().private
        except psutil.Error:
            continue
    return total / (1024 * 1024)


WATCH = """(() => {
  const said = { long: [] }
  window.__photos = said
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) said.long.push(Math.round(one.duration))
  }).observe({ type: 'longtask' })
  return true
})()"""

GRID = """(() => {
  const button = document.querySelector('button[aria-label="Grid"]')
  if (!button) return 'no grid button'
  if (button.getAttribute('aria-pressed') !== 'true') button.click()
  return 'grid'
})()"""

SCROLL = """(async () => {
  const rows = document.querySelector('.rows')
  if (!rows) return { error: 'no rows' }
  const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))
  const steps = %d
  const shownAt = []
  for (let at = 0; at <= steps; at += 1) {
    rows.scrollTop = ((rows.scrollHeight - rows.clientHeight) * at) / steps
    await frame()
    await wait(%d)
    shownAt.push(rows.querySelectorAll('.face img').length)
  }
  return { height: rows.scrollHeight, tiles: rows.querySelectorAll('.tile').length, shownAt }
})()"""

SHOWN = """(() => ({
  shown: document.querySelectorAll('.rows .face img').length,
  tiles: document.querySelectorAll('.rows .tile').length,
  long: window.__photos ? window.__photos.long : null,
}))()"""


def main() -> int:
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", type=pathlib.Path, required=True)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--count", type=int, default=300)
    parsed.add_argument("--most-mb", type=float, default=1500)
    parsed.add_argument("--most-hang", type=float, default=2.0)
    options = parsed.parse_args()
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    sys.path.insert(0, str(HERE))
    from probe_app import close_app, family, main_window, run_probe

    browser = borrowed("browser_probe", "default-browser-probe.py")
    freeze = borrowed("freeze", "web-freeze-probe.py")
    freeze.bind_names()

    browser.wipe(options.identifier)
    spaces = browser.spaces_root()
    (spaces / SPACE).mkdir(parents=True)
    (spaces / SPACE / f"{NOTE}.md").write_text(f"# {NOTE}\n", encoding="utf-8")
    folder = pathlib.Path(tempfile.mkdtemp(prefix="orden-photos-")).resolve() / "Camera"
    each = photos(folder, options.count)
    print(f"{options.count} photos of 4000x3000, {each // 1024} KB each, in {folder}", flush=True)

    wrong: list[str] = []
    hangs: list[float] = []
    going = True
    running = None
    try:
        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        browser.act(port, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        browser.allow_eval(options.identifier)

        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        until = time.perf_counter() + 60
        while browser.ask(port, secret, "1 + 1") != 2 and time.perf_counter() < until:
            time.sleep(1)
        hwnd = main_window(running.pid)

        def pump() -> None:
            run = 0.0
            while going:
                answered, cost = freeze.ask(hwnd)
                if not answered or freeze.user32.IsHungAppWindow(hwnd):
                    run += 0.25 + cost / 1000
                    hangs.append(run)
                else:
                    run = 0.0
                time.sleep(0.25)

        threading.Thread(target=pump, daemon=True).start()
        time.sleep(5)
        before = webview_mb(running.pid, family)
        print(f"webview before: {before:.0f} MB", flush=True)

        browser.ask(port, secret, WATCH)
        opened = (
            "(() => { const ws = arguments[0].workspace; ws.openUnsaved('explorer', "
            + json.dumps(json.dumps({"folder": str(folder), "back": [], "ahead": []}))
            + ", 'Camera'); return ws.activeTabId })()"
        )
        print("explorer", browser.ask(port, secret, opened), flush=True)
        time.sleep(4)
        print("view", browser.ask(port, secret, GRID), flush=True)
        time.sleep(6)
        print("first look", browser.ask(port, secret, SHOWN), flush=True)

        slow = browser.ask(port, secret, SCROLL % (40, 400))
        print("slow scroll", json.dumps(slow), flush=True)
        peak = webview_mb(running.pid, family)
        fast = browser.ask(port, secret, SCROLL % (40, 0))
        print("fast scroll", json.dumps(fast), flush=True)
        for _ in range(3):
            browser.ask(port, secret, SCROLL % (20, 16))
            peak = max(peak, webview_mb(running.pid, family))
        time.sleep(8)
        after = webview_mb(running.pid, family)
        last = browser.ask(port, secret, SHOWN)
        print(f"webview peak {peak:.0f} MB, after {after:.0f} MB", flush=True)
        print("last look", json.dumps(last), flush=True)

        longest_hang = max(hangs, default=0.0)
        long = (last or {}).get("long") if isinstance(last, dict) else None
        longest = max(long or [0])
        print(f"longest hang {longest_hang:.2f} s, longest task {longest} ms, {len(long or [])} long tasks", flush=True)
        if longest_hang > options.most_hang:
            wrong.append(f"the window hung for {longest_hang:.2f} s")
        if longest > LONGEST_MS:
            wrong.append(f"a task held the page for {longest} ms")
        if peak - before > options.most_mb:
            wrong.append(f"the webview grew by {peak - before:.0f} MB")
        shown = max((slow or {}).get("shownAt") or [0]) if isinstance(slow, dict) else 0
        if not shown:
            wrong.append(f"no tile showed its picture: {slow}")
        if browser.ask(port, secret, "1 + 1") != 2:
            wrong.append("the page stopped answering")
    finally:
        going = False
        if running and running.poll() is None:
            if not close_app(running):
                running.terminate()
        shutil.rmtree(folder.parent, ignore_errors=True)
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    sys.exit(main())
