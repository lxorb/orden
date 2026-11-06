from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import time

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location("browser_probe", HERE / "default-browser-probe.py")
assert _spec and _spec.loader
browser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(browser)

SPACE = "Full screen probe"

STATE = r"""
(async () => {
  const ws = nib.workspace
  const call = window.__TAURI_INTERNALS__.invoke
  const shown = (selector) => [...document.querySelectorAll(selector)]
    .filter((one) => one.getClientRects().length > 0).length
  return JSON.stringify({
    full: document.querySelector('main')?.classList.contains('full') ?? null,
    asked: await call('window_is_fullscreen').catch((error) => `failed: ${error}`),
    fills: ws.panes.fills,
    focused: ws.panes.focusedId,
    panes: ws.panes.count,
    panesDrawn: shown('[data-pane]'),
    strips: shown('[data-chrome]'),
    webBars: shown('.web .head'),
    wayOut: shown('.leave'),
    front: ws.active ? ws.active.kind : null,
  })
})()
"""

def key(name: str) -> str:
    return (
        "window.dispatchEvent(new KeyboardEvent('keydown', "
        f"{{ key: '{name}', code: '{name}', bubbles: true, cancelable: true }}))"
    )

def state(port: int, secret: str) -> dict[str, object]:
    said = browser.ask(port, secret, STATE)
    return said if isinstance(said, dict) else {"error": said}

def settled(port: int, secret: str, full: bool) -> dict[str, object]:
    until = time.perf_counter() + 20
    said: dict[str, object] = {}
    while time.perf_counter() < until:
        said = state(port, secret)
        if said.get("full") is full:
            return said
        time.sleep(0.3)
    return said

def window_rect(hwnd: int) -> tuple[int, int, int, int]:
    import ctypes
    from ctypes import wintypes

    rect = wintypes.RECT()
    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return rect.left, rect.top, rect.right, rect.bottom

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    options = parsed.parse_args()

    browser.wipe(options.identifier)
    port_ = browser.free_port()
    browser.serve(port_)
    site = f"http://127.0.0.1:{port_}"
    space = browser.spaces_root() / SPACE
    space.mkdir(parents=True)
    for name in ("One", "Two"):
        (space / f"{name}.md").write_text(f"# {name}\n\nWords.\n", encoding="utf-8")

    wrong: list[str] = []
    said: dict[str, object] = {}
    running: subprocess.Popen[bytes] | None = None
    try:
        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        browser.act(port, secret, "open", {"path": "One.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        browser.allow_eval(options.identifier)

        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        hwnd = main_window(running.pid)
        if hwnd:
            sized(hwnd, 1180, 760)
        time.sleep(3)
        before_rect = window_rect(hwnd) if hwnd else None

        browser.act(port, secret, "open", {"path": "One.md", "space": SPACE})
        time.sleep(1)
        browser.ask(port, secret, "nib.workspace.split('row')")
        time.sleep(1)
        browser.act(port, secret, "open", {"path": "Two.md", "space": SPACE})
        time.sleep(1.5)
        split = state(port, secret)
        said["split"] = split

        browser.ask(port, secret, key("F11"))
        inside = settled(port, secret, True)
        said["in"] = inside
        if inside.get("full") is not True or inside.get("asked") is not True:
            wrong.append(f"F11 did not put the window full screen: {inside}")
        if inside.get("panesDrawn") != 1 or inside.get("fills") != split.get("focused"):
            wrong.append(f"F11 did not leave the pane worked in alone: {inside}")
        if inside.get("strips"):
            wrong.append(f"the strips or the sides stayed in full screen: {inside}")
        if hwnd and window_rect(hwnd) != before_rect:
            wrong.append(f"the probe window moved: {before_rect} to {window_rect(hwnd)}")

        browser.ask(port, secret, key("F11"))
        out = settled(port, secret, False)
        said["out"] = out
        if out.get("asked") is not False or out.get("fills") is not None:
            wrong.append(f"F11 again did not give the window back: {out}")
        if out.get("panesDrawn") != split.get("panesDrawn"):
            wrong.append(f"the split did not come back: {out} after {split}")

        browser.ask(port, secret, key("F11"))
        settled(port, secret, True)
        browser.ask(port, secret, "document.activeElement?.blur()")
        browser.ask(port, secret, key("Escape"))
        escaped = settled(port, secret, False)
        said["escape"] = escaped
        if escaped.get("full") is not False:
            wrong.append(f"Escape did not leave full screen: {escaped}")

        browser.ask(port, secret, f"nib.workspace.openPage('{site}/page', 'front')")
        time.sleep(3)
        browser.ask(port, secret, key("F11"))
        web = settled(port, secret, True)
        said["web"] = web
        if web.get("front") != "web" or web.get("webBars") or web.get("wayOut"):
            wrong.append(f"a web tab in full screen kept its bar or a button: {web}")
        time.sleep(1)
        out_path = options.shots / "fullscreen-web.png"
        browser.photograph(running.pid, out_path)
        said["shot"] = str(out_path)
        browser.ask(port, secret, key("F11"))
        said["web out"] = settled(port, secret, False)
    finally:
        if running and running.poll() is None:
            if not close_app(running):
                running.terminate()

    for name, value in said.items():
        print(f"{name:8} {json.dumps(value) if isinstance(value, dict) else value}")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    sys.exit(main())
