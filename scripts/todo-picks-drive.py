from __future__ import annotations
import argparse
import ctypes
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from probe_app import main_window  # noqa: E402
from fresh_app import ended, fresh  # noqa: E402
from native_app import App, config_of, endpoint  # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
LEFT_DOWN, LEFT_UP, RIGHT_DOWN, RIGHT_UP, KEY_UP = 0x2, 0x4, 0x8, 0x10, 0x2
DELETE, ESCAPE = 0x2E, 0x1B
KEYS = {"Control": 0x11, "Shift": 0x10, "Alt": 0x12}
TITLES = ["Pick one", "Pick two", "Pick three", "Pick four"]
HEARD = """
window.__heard = []
for (const kind of ['pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu']) addEventListener(kind, (e) => {
  const at = e.target instanceof Element ? e.target : null
  __heard.push([kind, at ? at.tagName + '.' + [...at.classList].join('.') : '', e.ctrlKey, e.shiftKey, e.altKey, e.defaultPrevented])
}, true)
for (const kind of ['click', 'mousedown']) addEventListener(kind, (e) => {
  __heard.push(['bubbled ' + kind, e.defaultPrevented])
})
return true
"""
def client_origin(hwnd: int) -> tuple[int, int]:
    origin = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    return origin.x, origin.y
def forward(hwnd: int) -> None:
    front = user32.GetForegroundWindow()
    theirs = user32.GetWindowThreadProcessId(front, None)
    ours = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(ours, theirs, True)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(ours, theirs, False)
def at(app: App, hwnd: int, scope: str, title: str) -> tuple[int, int] | None:
    box = app.eval(
        "const row = [...document.querySelectorAll(%s)].find((one) => one.textContent.trim() === %s);"
        "if (!row) return null; row.scrollIntoView({ block: 'nearest' }); const b = row.getBoundingClientRect();"
        "return { x: b.left + Math.min(40, b.width / 2), y: b.top + b.height / 2, ratio: devicePixelRatio }"
        % (json.dumps(f"{scope} [data-todo] .title"), json.dumps(title))
    )
    if not isinstance(box, dict) or "x" not in box:
        return None
    left, top = client_origin(hwnd)
    return int(left + box["x"] * box["ratio"]), int(top + box["y"] * box["ratio"])
def key(code: int) -> None:
    user32.keybd_event(code, 0, 0, 0)
    time.sleep(0.05)
    user32.keybd_event(code, 0, KEY_UP, 0)
    time.sleep(0.5)
def click(point: tuple[int, int], held: list[str], right: bool = False) -> None:
    for one in held:
        user32.keybd_event(KEYS[one], 0, 0, 0)
        time.sleep(0.05)
    user32.SetCursorPos(*point)
    time.sleep(0.15)
    user32.mouse_event(RIGHT_DOWN if right else LEFT_DOWN, 0, 0, 0, 0)
    time.sleep(0.06)
    user32.mouse_event(RIGHT_UP if right else LEFT_UP, 0, 0, 0, 0)
    time.sleep(0.2)
    for one in reversed(held):
        user32.keybd_event(KEYS[one], 0, KEY_UP, 0)
        time.sleep(0.05)
    time.sleep(0.5)
def picked(app: App, scope: str) -> list[str]:
    said = app.eval(
        "return [...document.querySelectorAll(%s)].map((one) => one.textContent.trim())"
        % json.dumps(f"{scope} [data-todo].is-picked .title")
    )
    return said if isinstance(said, list) else []
def titles(app: App, scope: str) -> list[str]:
    said = app.eval("return [...document.querySelectorAll(%s)].map((one) => one.textContent.trim())" % json.dumps(f"{scope} [data-todo] .title"))
    return said if isinstance(said, list) else []
def acts(app: App, hwnd: int, scope: str, wrong: list[str]) -> None:
    point = at(app, hwnd, scope, "Pick four")
    if not point:
        wrong.append(f"no row Pick four in {scope}")
        return
    key(ESCAPE)
    app.eval("window.__heard = []; return true")
    click(point, [], right=True)
    menu = app.eval("return [...document.querySelectorAll('.menu [role=menuitem]')].map((one) => one.textContent.trim())")
    print(f"{scope}: a right click shows the menu {menu}; heard {json.dumps(app.eval('return window.__heard'))}", flush=True)
    if not isinstance(menu, list) or "Open" not in menu or not any(one.startswith("Delete") for one in menu):
        wrong.append(f"a right click on a todo in {scope} showed {menu}")
    key(ESCAPE)
    point = at(app, hwnd, scope, "Pick three")
    if point:
        click(point, [])
        click(point, [])
        focused = app.eval("return document.activeElement?.closest('[data-todo]')?.textContent.trim() ?? document.activeElement?.tagName")
        key(DELETE)
        time.sleep(1)
        left = titles(app, scope)
        print(f"{scope}: Delete with {focused} focused leaves {left}", flush=True)
        if "Pick three" in left:
            wrong.append(f"the Delete key on a focused todo in {scope} kept it: {left}")
def tried(app: App, hwnd: int, scope: str, wrong: list[str]) -> None:
    for mod in ["Control", "Shift"]:
        app.eval("document.activeElement?.blur(); window.__heard = []; return true")
        for title in ["Pick one", "Pick one"]:
            point = at(app, hwnd, scope, title)
            if point:
                click(point, [])
        first, last = ("Pick one", "Pick three") if mod == "Control" else ("Pick two", "Pick four")
        app.eval("window.__heard = []; return true")
        for title in [first, last]:
            point = at(app, hwnd, scope, title)
            if not point:
                wrong.append(f"no row {title} in {scope}")
                return
            click(point, [mod])
        now = picked(app, scope)
        heard = app.eval("return window.__heard")
        print(f"{scope}: {mod} clicks on {first} and {last} pick {now}; heard {json.dumps(heard)}", flush=True)
        order = titles(app, scope)
        ends = sorted([order.index(first), order.index(last)]) if first in order and last in order else [0, -1]
        wanted = [first, last] if mod == "Control" else order[ends[0] : ends[1] + 1]
        if sorted(now) != sorted(wanted):
            wrong.append(f"{mod} clicks in {scope} picked {now}, not {wanted}")
def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows only")
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-picks-"))
    (spaces / "Picks").mkdir()
    (spaces / "Picks" / "A note.md").write_text("# A note\n\nWords.\n", encoding="utf-8")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        if app.until("return !!orden.workspace.activeSpace", 120) is not True:
            raise SystemExit("::error::the app never opened a space")
        hwnd = main_window(process.pid)
        user32.SetWindowPos(hwnd, None, 0, 0, 1280, 800, 0x0004)
        time.sleep(2)
        forward(hwnd)
        app.eval(HEARD)
        app.eval("orden.workspace.showPanel('tasks'); return true")
        if app.until("return !!document.querySelector('[data-todos-panel] [data-todos-add]') || null", 60) is not True:
            raise SystemExit("::error::the todos panel never came up")
        made = app.eval(
            "const field = document.querySelector('[data-todos-panel] [data-todos-add]');"
            "for (const title of %s) { field.value = title; field.dispatchEvent(new Event('input', { bubbles: true }));"
            "field.form.requestSubmit(); await new Promise((done) => setTimeout(done, 300)) } return true"
            % json.dumps(TITLES)
        )
        print(f"made the todos: {made}", flush=True)
        app.until("return document.querySelectorAll('[data-todos-panel] [data-todo]').length >= 4 || null", 30)
        tried(app, hwnd, "[data-todos-panel]", wrong)
        acts(app, hwnd, "[data-todos-panel]", wrong)
        made = app.eval(
            "const field = document.querySelector('[data-todos-panel] [data-todos-add]');"
            "field.value = 'Pick three'; field.dispatchEvent(new Event('input', { bubbles: true }));"
            "field.form.requestSubmit(); await new Promise((done) => setTimeout(done, 300)); return true"
        )
        forward(hwnd)
        app.eval("document.activeElement?.blur(); return true")
        for key in [0x11, 0x10, 0x59]:
            user32.keybd_event(key, 0, 0, 0)
            time.sleep(0.05)
        for key in [0x59, 0x10, 0x11]:
            user32.keybd_event(key, 0, KEY_UP, 0)
            time.sleep(0.05)
        app.until("return !!document.querySelector('[data-todos-board] [data-todo]') || null", 30)
        time.sleep(1)
        tried(app, hwnd, "[data-todos-board]", wrong)
        acts(app, hwnd, "[data-todos-board]", wrong)
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
