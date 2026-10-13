"""Does the window hand its own page the keyboard as it comes back, once a web tab has
closed in it? Windows only, `WebView2`.

Emil, 2026-10-13: *"when I alt tab out of nib and then alt tab onto it again ... when I
then want to do ctrl tab nothing happens. i have to click into nib first."* wry gives the
window's keyboard to its own page from a subclass of the window, and drops that subclass
as soon as any webview in the window goes; see the top of src-tauri/src/keyboard.rs. So
after one web tab had closed, coming back left the keyboard on the bare window.

A probe is never handed the keyboard and never activated (src-tauri/src/foreground.rs),
so no real Alt+Tab is played and nothing here takes the foreground. Instead the drive
sends the probe's window the two messages Alt+Tab sends it, `WM_ACTIVATE` and
`WM_SETFOCUS`, after a web tab has opened and closed, and reads:

* **the rule** - what the crate says on stderr where it would have handed the keyboard:
  the window's own page, and that it kept that page to hand it to. Before the fix there
  was no own page to hand it to; wry was trusted, and wry had let go.
* **held** - the probe never the window in front, and the window its own thread would
  hand a key to the same before and after: the probe-quiet rule holding.
* **Ctrl+Tab** - a Ctrl+Tab keydown played on the app's window afterwards, the way
  scripts/web-bar-probe.py plays keys, moves from one note to the next.

    python scripts/refocus-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
import json
import pathlib
import shutil
import sys
import tempfile
import threading
import time
from ctypes import wintypes

from probe_app import close_app, keyboard, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

WM_ACTIVATE = 0x0006
WM_SETFOCUS = 0x0007
WA_ACTIVE = 1

FIRST = "First"
SECOND = "Second"
WEB = "A page"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


def borrowed():
    """The switch probe's own helpers: the space, the endpoint, `eval`."""

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def launch(switch, exe: pathlib.Path, identifier: str, errors, unlike: int = 0):
    """The probe, with what it says on stderr kept in `errors`."""

    running = run_probe(exe, errors=errors)
    port, secret = switch.endpoint(identifier, 90, unlike)
    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = switch.windows_of(running.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")
    sized(hwnd, 1280, 860)
    time.sleep(1.5)
    return running, switch.App(port, secret), hwnd


def front_tab(app) -> object:
    return app.ask(
        "JSON.stringify(nib.workspace.tabs.find((one) => one.id === nib.workspace.activeTabId)?.name ?? null)"
    )


def ctrl_tab(app) -> object:
    """Ctrl+Tab, played on the app's window, which is where the app reads its chords."""

    init = {"key": "Tab", "code": "Tab", "ctrlKey": True, "bubbles": True, "cancelable": True}
    return app.ask(
        f"(window.dispatchEvent(new KeyboardEvent('keydown', {json.dumps(init)})),"
        f" window.dispatchEvent(new KeyboardEvent('keyup', {json.dumps({**init, 'key': 'Control', 'code': 'ControlLeft', 'ctrlKey': False})})),"
        " JSON.stringify(true))"
    )


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch = borrowed()
    switch.wipe(args.identifier)
    port = switch.free_port()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<!doctype html><title>A page</title><input autofocus>")

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    for name in (FIRST, SECOND):
        (space / f"{name}.md").write_text(f"# {name}\n\nA note.\n", encoding="utf-8")
    (space / f"{WEB}.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/page", WEB), encoding="utf-8"
    )

    said: dict[str, object] = {}
    logged = pathlib.Path(tempfile.mkdtemp(prefix="nib-refocus-probe-")) / "stderr.txt"
    running = None
    try:
        with logged.open("wb") as errors:
            running, app, _ = launch(switch, args.exe, args.identifier, errors)
            if not close_app(running):
                running.terminate()
                running.wait(timeout=30)
            switch.allow_eval(args.identifier)
            time.sleep(2)
            running, app, hwnd = launch(switch, args.exe, args.identifier, errors, app.port)

            app.open(f"{FIRST}.md", switch.SPACE)
            time.sleep(2)
            app.open(f"{SECOND}.md")
            time.sleep(1)
            app.open(f"{WEB}.url")
            time.sleep(6)
            web = switch.tab_of(app, WEB)
            if web is None:
                raise SystemExit("the app never opened the web tab")
            app.ask(f"(nib.workspace.close('{web}'), JSON.stringify(true))")
            time.sleep(2)
            app.open(f"{FIRST}.md")
            time.sleep(1.5)

            said["before"] = keyboard(running.pid)
            said["front tab before"] = front_tab(app)
            assert user32 is not None
            mark = logged.stat().st_size
            user32.SendMessageW(wintypes.HWND(hwnd), WM_ACTIVATE, WA_ACTIVE, 0)
            user32.SendMessageW(wintypes.HWND(hwnd), WM_SETFOCUS, 0, 0)
            time.sleep(1)
            said["after"] = keyboard(running.pid)
            errors.flush()
            with logged.open("rb") as reading:
                reading.seek(mark)
                said["the rule"] = [
                    line
                    for line in reading.read().decode("utf-8", "replace").splitlines()
                    if line.startswith("nib: keyboard:")
                ]

            ctrl_tab(app)
            time.sleep(1)
            said["front tab after Ctrl+Tab"] = front_tab(app)
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()
        shutil.rmtree(logged.parent, ignore_errors=True)

    print(json.dumps(said, indent=2))
    failed = []
    rule = said["the rule"]
    if rule != ["nib: keyboard: main back to its own page, its own page kept; held"]:
        failed.append(f"the window's own page was not the keyboard's way back: {rule}")
    before, after = said["before"], said["after"]
    if not isinstance(before, dict) or not isinstance(after, dict):
        failed.append("the keyboard could not be read")
    else:
        if after.get("front is ours"):
            failed.append("the probe took the foreground")
        # The window in front is the reader's to change meanwhile; the probe's thread's
        # keyboard is not.
        if before.get("app thread focus") != after.get("app thread focus"):
            failed.append("the probe thread's keyboard moved")
    if not str(said["front tab before"]).startswith(FIRST) or not str(
        said["front tab after Ctrl+Tab"]
    ).startswith(SECOND):
        failed.append("Ctrl+Tab did not reach the app")
    for one in failed:
        print(f"FAIL: {one}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
