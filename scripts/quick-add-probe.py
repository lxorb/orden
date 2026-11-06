from __future__ import annotations

import argparse
import ctypes
import os
import pathlib
import shutil
import sys
import time

from devtools import SWITCHES, Session, port, targets
from probe_app import APP_CLASS, close_app, look, main_window, run_probe, spaces_folder

user32 = ctypes.WinDLL("user32", use_last_error=True)

PROBE_KEY = "Control+Alt+Shift+F24"
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x1, 0x2, 0x4, 0x4000
VK_F24 = 0x87
ERROR_HOTKEY_ALREADY_REGISTERED = 1409
WM_HOTKEY = 0x0312

KEY_ID = 0x020900B7

IDENTIFIER = "ch.emilvinu.nib.probe.quickadd"

HOTKEY_CLASS = "global_hotkey_app"

failures: list[str] = []

def wrong(what: str) -> None:
    print(f"  WRONG: {what}")
    failures.append(what)

def held_elsewhere() -> bool:

    if user32.RegisterHotKey(None, 0x5A5A, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, VK_F24):
        user32.UnregisterHotKey(None, 0x5A5A)
        return False
    return ctypes.get_last_error() == ERROR_HOTKEY_ALREADY_REGISTERED

def app_windows(pid: int) -> list[int]:
    return [one.hwnd for one in look({pid}).windows if one.kind == APP_CLASS and one.visible]

def until(test, what: str, seconds: float = 60.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        found = test()
        if found:
            return found
        time.sleep(0.2)
    wrong(f"gave up waiting for {what}")
    return None

def press(pid: int) -> None:

    keeper = next((one.hwnd for one in look({pid}).windows if one.kind == HOTKEY_CLASS), 0)
    if not keeper:
        wrong("the global shortcut plugin keeps no window: nothing registered a key")
        return
    flags = MOD_CONTROL | MOD_ALT | MOD_SHIFT
    user32.PostMessageW(keeper, WM_HOTKEY, KEY_ID, (VK_F24 << 16) | flags)

def height(hwnd: int) -> int:
    box = next((one.box for one in look().windows if one.hwnd == hwnd), (0, 0, 0, 0))
    return box[3] - box[1]

def page_of_window() -> Session | None:
    web = pathlib.Path(os.environ["LOCALAPPDATA"]) / IDENTIFIER / "EBWebView"
    page = until(
        lambda: next(
            (one for one in targets(port(web)) if str(one.get("url", "")).endswith("/quick-add.html")),
            None,
        )
        if port(web)
        else None,
        "the quick add window's page",
    )
    return Session(page) if page else None

def grows(pid: int, hwnd: int) -> None:

    session = page_of_window()
    if not session or not hwnd:
        return
    short = height(hwnd)
    session.value("document.querySelectorAll('.controls .control')[1].click()")
    tall = until(lambda: height(hwnd) > short and height(hwnd), "the window grown for the picker", 10)
    print(f"  the window grew from {short} to {tall} for the picker")
    session.value("document.querySelector('.picker').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    back = until(lambda: height(hwnd) == short, "the window back to its field's height", 10)
    if back:
        print("  and back to its field's height")
    session.close()

def typed_in(spaces: pathlib.Path) -> None:

    session = page_of_window()
    if not session:
        return
    said = session.call(
        "Runtime.evaluate",
        {
            "expression": """
              new Promise((done) => {
                const field = document.querySelector('input.field')
                if (!field) return done('no field')
                field.value = 'Call mum tomorrow p1'
                field.dispatchEvent(new Event('input', { bubbles: true }))
                setTimeout(() => {
                  const chips = [...document.querySelectorAll('[data-chip]')].map((one) => one.textContent)
                  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
                  done(chips.join(','))
                }, 300)
              })
            """,
            "awaitPromise": True,
            "returnByValue": True,
        },
    )
    session.close()
    chips = said.get("result", {}).get("value")
    print(f"  the window read {chips!r} as chips")
    if chips != "tomorrow,p1":
        wrong(f"the window's chips were {chips!r}, not tomorrow and p1")
    inbox = spaces / "Probe" / "Inbox.md"
    written = until(lambda: inbox.exists() and inbox.read_text(encoding="utf-8"), "the task in Inbox.md", 20)
    print(f"  Inbox.md: {written!a}")
    if not written or not written.startswith("- [ ] Call mum 🔺 📅 "):
        wrong(f"Inbox.md holds {written!a}, not the task")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    exe = parser.parse_args().exe

    spaces = spaces_folder("quick-add")
    (spaces / "Probe").mkdir()
    (spaces / "Probe" / "Plan.md").write_text("# Plan", encoding="utf-8")
    env = {
        **os.environ,
        "NIB_SPACES_DIR": str(spaces),
        "NIB_QUICK_ADD_KEY": PROBE_KEY,
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": SWITCHES,
    }
    if held_elsewhere():
        print(f"  {PROBE_KEY} is already held by something else on this machine; not starting")
        return 1

    app = run_probe(exe, env=env, quiet=True)
    try:
        until(lambda: main_window(app.pid), "the app's window")
        print("  the app is up")
        if until(held_elsewhere, f"{PROBE_KEY} held by the probe"):
            print(f"  {PROBE_KEY} is held by the probe")

        before = app_windows(app.pid)
        press(app.pid)
        opened = until(lambda: [one for one in app_windows(app.pid) if one not in before], "the quick add window")
        if opened:
            print(f"  the key opened a window of its own: {opened}")

        time.sleep(1.0)
        press(app.pid)
        time.sleep(1.5)
        again = [one for one in app_windows(app.pid) if one not in before]
        print(f"  pressed again: {len(again)} quick add window(s)")
        if len(again) != 1:
            wrong(f"the key made {len(again)} quick add windows, not one window shown again")

        grows(app.pid, opened[0] if opened else 0)
        typed_in(spaces)
    finally:
        if not close_app(app):
            app.kill()
        shutil.rmtree(spaces, ignore_errors=True)

    if held_elsewhere():
        wrong(f"{PROBE_KEY} is still held after the probe closed")
    print("FAILED" if failures else "quick add's key opened its window, on a probe")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main())
