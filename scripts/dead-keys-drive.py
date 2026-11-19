"""Does the first dead key after a layout switch compose on Windows?

On a US-International or German keyboard a dead key waits for the next letter:
acute, then e, types é. Chromium rebuilds its key map on the first key after
the thread's layout changes, and that rebuild cleared the pending dead key, so
the first acute after a switch was lost wherever the keyboard was. The drive
switches the app's thread to US-International, then clicks into a plain field
of the app and into a note in turn and presses acute, e, acute, e as a
keyboard does. Every try must type éé. It prints the keys and inputs the page
heard on the way.

    python scripts/dead-keys-drive.py --exe <probe orden.exe> --identifier <probe id>
"""
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
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh
from native_app import INNER, App, config_of, endpoint, forward
from probe_app import main_window, refuse_updating

QUOTE = 0xDE
LETTER_E = 0x45
LETTER_X = 0x58
SPACE = 0x20
INTERNATIONAL = "00020409"
HEARD = """
if (!window.__heard) {
  window.__heard = []
  const told = (e) => ({ type: e.type, key: e.key, code: e.code, keyCode: e.keyCode, data: e.data, inputType: e.inputType, composing: e.isComposing })
  for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
    window.addEventListener(type, (e) => window.__heard.push({ ...told(e), at: 'first' }), true)
    window.addEventListener(type, (e) => { if (e.defaultPrevented) window.__heard.push({ ...told(e), at: 'prevented' }) }, false)
  }
}
window.__heard.length = 0
return true
"""
FIELD = """
let field = document.getElementById('dead-keys-field')
if (!field) {
  field = document.createElement('input')
  field.id = 'dead-keys-field'
  field.style.cssText = 'position:fixed;left:40%;top:40%;width:240px;height:40px;z-index:2147483647;font-size:20px'
  document.body.append(field)
}
field.value = ''
const r = field.getBoundingClientRect()
return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
"""
LINE = """
const line = [...document.querySelectorAll('.cm-content .cm-line')].find((one) => one.textContent.includes('Keyline'))
if (!line) return null
const r = line.getBoundingClientRect()
return { x: r.x + r.width + 4, y: r.y + r.height / 2 }
"""
class Keys:
    def __init__(self) -> None:
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]
        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]
        class EITHER(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]
        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("u", EITHER)]
        self.KEYBDINPUT, self.MOUSEINPUT, self.INPUT = KEYBDINPUT, MOUSEINPUT, INPUT
    def send(self, one: Any) -> None:
        self.user32.SendInput(1, ctypes.byref(one), ctypes.sizeof(self.INPUT))
    def tap(self, vk: int) -> None:
        for up in (False, True):
            one = self.INPUT(type=1)
            one.u.ki = self.KEYBDINPUT(wVk=vk, wScan=self.user32.MapVirtualKeyW(vk, 0), dwFlags=0x2 if up else 0, time=0, dwExtraInfo=0)
            self.send(one)
            time.sleep(0.05)
        time.sleep(0.3)
    def click(self, x: int, y: int) -> None:
        self.user32.SetCursorPos(x, y)
        time.sleep(0.15)
        for flag in (0x2, 0x4):
            one = self.INPUT(type=0)
            one.u.mi = self.MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=flag, time=0, dwExtraInfo=0)
            self.send(one)
            time.sleep(0.05)
        time.sleep(0.4)
def on_screen(app: App, at: Any) -> tuple[int, int]:
    inner = app.eval(INNER)
    scale = inner["scale"]
    return round(inner["x"] + at["x"] * scale), round(inner["y"] + at["y"] * scale)
def layout(user32: ctypes.WinDLL, hwnd: int, name: str) -> int:
    user32.LoadKeyboardLayoutW.restype = ctypes.c_void_p
    user32.GetKeyboardLayout.restype = ctypes.c_void_p
    wanted = user32.LoadKeyboardLayoutW(name, 1)
    user32.PostMessageW(hwnd, 0x0050, 0, ctypes.c_void_p(wanted))
    time.sleep(1)
    now = user32.GetKeyboardLayout(user32.GetWindowThreadProcessId(hwnd, None))
    print(f"the app's keyboard layout {now or 0:#x}, asked {wanted or 0:#x}", flush=True)
    return now == wanted
def typed(app: App, keys: Keys, where: str, spot: str, text: str, presses: list[int]) -> tuple[str, list[Any]]:
    at = app.eval(spot)
    if not isinstance(at, dict):
        return f"no {where} to click: {at}", []
    keys.click(*on_screen(app, at))
    app.eval(HEARD)
    for vk in presses:
        keys.tap(vk)
    time.sleep(0.6)
    return str(app.eval(text)), app.eval("return window.__heard") or []
def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows only")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    refuse_updating(args.exe)
    keys = Keys()
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-dead-keys-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret, 20)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        forward(app, process.pid)
        time.sleep(15)
        app.eval("document.querySelector('.orden-screen.sheet[role=\"dialog\"] button[data-lands]')?.click(); return true")
        note = app.eval("const ws = orden.workspace; ws.openBlank('Dead', '# Dead\\n\\nKeyline'); return ws.activeTabId")
        if not isinstance(note, str):
            raise SystemExit(f"no note was opened: {note}")
        time.sleep(2)
        hwnd = main_window(process.pid)
        doc = f"return orden.workspace.tabs.find((one) => one.id === {json.dumps(note)})?.doc ?? ''"
        value = "return document.getElementById('dead-keys-field')?.value ?? ''"
        forward(app, process.pid)
        time.sleep(0.5)
        said, heard = typed(app, keys, "note", LINE, doc, [LETTER_X])
        print(f"US layout, x in the note: {said!r}; heard {json.dumps(heard)}", flush=True)
        if not said.endswith("Keylinex"):
            wrong.append(f"a plain x did not land in the note: {said!r}")
        if not layout(keys.user32, hwnd, INTERNATIONAL):
            raise SystemExit("the app's thread did not take the US-International layout")
        steps = [("field", FIELD, value), ("note", LINE, doc), ("note", LINE, doc), ("field", FIELD, value), ("note", LINE, doc)]
        for where, spot, text in steps:
            forward(app, process.pid)
            time.sleep(0.5)
            said, heard = typed(app, keys, where, spot, text, [QUOTE, LETTER_E, QUOTE, LETTER_E])
            short = [f"{one['type']}:{one.get('key') or one.get('data')}" for one in heard if one["type"] in ("keydown", "beforeinput")]
            print(f"twice acute then e, in the {where}: {said!r}; heard {short}", flush=True)
            if not said.endswith("\u00e9\u00e9"):
                wrong.append(f"the dead key did not compose in the {where}: {said!r}")
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
