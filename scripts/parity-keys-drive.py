from __future__ import annotations
import argparse
import ctypes
import http.server
import importlib
import json
import os
import pathlib
import plistlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable
from PIL import Image, ImageChops, ImageGrab, ImageStat

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh  # noqa: E402
from native_app import App, config_of, endpoint, forward  # noqa: E402

PLATFORM = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
MAC = PLATFORM == "macos"
MOD = "Meta" if MAC else "Ctrl"
MAGENTA = (255, 0, 255)
PAGE = b"""<!doctype html><title>keys</title>
<style>
html,body{margin:0;background:#ff00ff;height:100%;overflow:hidden;font:14px sans-serif}
#field{position:fixed;left:24px;top:24px;width:260px;height:44px;font-size:18px}
.go{position:fixed;width:150px;height:40px;font-size:14px;box-sizing:border-box}
#save{background:#fff;color:#000;text-align:center;line-height:40px}
</style>
<input id=field aria-label="the field">
<button id=press class=go style="left:24px;top:84px">Pressable</button>
<button id=alert class=go style="left:24px;top:140px">alert</button>
<button id=confirm class=go style="left:190px;top:140px">confirm</button>
<button id=prompt class=go style="left:24px;top:196px">prompt</button>
<input id=file type=file class=go style="left:190px;top:196px">
<select id=pick class=go style="left:24px;top:252px"><option>one<option>two<option>three</select>
<button id=camera class=go style="left:190px;top:252px">camera</button>
<button id=where class=go style="left:24px;top:308px">where</button>
<button id=notify class=go style="left:190px;top:308px">notify</button>
<a id=save class=go href="/saved.txt" download style="left:24px;top:364px">save</a>
<a id=away class=go href="/elsewhere" style="left:190px;top:364px">away</a>
<script>
const field = document.getElementById('field')
const said = { who: location.search.slice(1) || 'main', log: [], answers: {}, asked: {} }
if (said.who !== 'main') document.title = 'keys ' + said.who
let sent = 0
const tell = () => {
  said.focus = document.hasFocus()
  said.active = document.activeElement ? document.activeElement.id : ''
  said.value = field.value
  said.n = ++sent
  fetch('/heard', { method: 'POST', body: JSON.stringify(said) }).catch(() => {})
}
const log = (e) => {
  said.log.push([e.type, e.key || '', (e.target && e.target.id) || ''])
  if (said.log.length > 60) said.log.shift()
  tell()
}
for (const kind of ['keydown', 'focus', 'blur', 'compositionstart', 'compositionend', 'contextmenu']) addEventListener(kind, log, true)
field.addEventListener('input', tell)
setInterval(tell, 300)
const answer = (name, value) => { said.answers[name] = [value, Math.round(performance.now() - (said.asked[name] || 0))]; tell() }
const ask = (name, run) => document.getElementById(name).addEventListener('click', () => {
  said.asked[name] = performance.now()
  Promise.resolve().then(run).then((v) => answer(name, String(v)), (e) => answer(name, 'error ' + ((e && e.name) || e)))
})
ask('alert', () => { alert('a page alert'); return 'closed' })
ask('confirm', () => confirm('a page confirm'))
ask('prompt', () => prompt('a page prompt', 'words'))
ask('camera', () => navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'granted' }))
ask('where', () => new Promise((ok) => navigator.geolocation.getCurrentPosition(() => ok('granted'), (e) => ok('error ' + e.code), { timeout: 10000 })))
ask('notify', () => Notification.requestPermission())
const file = document.getElementById('file')
file.addEventListener('click', () => { said.asked.file = performance.now() })
file.addEventListener('change', () => answer('file', 'chose'))
file.addEventListener('cancel', () => answer('file', 'cancelled'))
document.getElementById('pick').addEventListener('change', (e) => answer('pick', e.target.value))
</script>"""
HEARD: dict[str, tuple[float, dict[str, Any]]] = {}
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body, kind = (b"saved words\n", "text/plain") if self.path.startswith("/saved") else (PAGE, "text/html; charset=utf-8")
        self.send_response(200)
        self.send_header("content-type", kind)
        if self.path.startswith("/saved"):
            self.send_header("content-disposition", 'attachment; filename="saved.txt"')
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self) -> None:  # noqa: N802 - the standard library's name
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        try:
            said = json.loads(body)
            HEARD[str(said.get("who"))] = (time.monotonic(), said)
        except ValueError:
            pass
        self.send_response(204)
        self.end_headers()
def page_said(who: str = "main", after: float | None = None, seconds: float = 2.5) -> dict[str, Any]:
    after = time.monotonic() if after is None else after
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        at, said = HEARD.get(who, (0.0, {}))
        if at > after:
            return said
        time.sleep(0.05)
    return HEARD.get(who, (0.0, {}))[1]
SPECIAL_WIN = {"Tab": 0x09, "ArrowRight": 0x27, "ArrowDown": 0x28, "ArrowLeft": 0x25, "F11": 0x7A, "Escape": 0x1B, "Quote": 0xDE, "Space": 0x20, "Return": 0x0D}
EXTENDED_WIN = {0x25, 0x26, 0x27, 0x28, 0x21, 0x22, 0x2D, 0x2E, 0x24, 0x23}
MODS_WIN = {"Ctrl": 0x11, "Shift": 0x10, "Alt": 0x12, "Meta": 0x5B}
LETTERS_MAC = "asdfhgzxcv bqweryt123465=97-80]ou[ip lj'k;\\,/nm."
SPECIAL_MAC = {"Tab": 48, "Space": 49, "Escape": 53, "Return": 36, "F11": 103, "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125}
MODS_MAC = {"Meta": 55, "Shift": 56, "Alt": 58, "Ctrl": 59}
SPECIAL_X = {"Tab": "Tab", "ArrowRight": "Right", "ArrowDown": "Down", "ArrowLeft": "Left", "F11": "F11", "Escape": "Escape", "Space": "space", "Quote": "dead_acute", "Return": "Return"}
MODS_X = {"Ctrl": "Control_L", "Shift": "Shift_L", "Alt": "Alt_L", "Meta": "Super_L"}
class Input:
    def __init__(self) -> None:
        if PLATFORM == "windows":
            from ctypes import wintypes
            self.wintypes = wintypes
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
        elif MAC:
            import Quartz
            self.Q = Quartz
            self.flags = {"Meta": Quartz.kCGEventFlagMaskCommand, "Shift": Quartz.kCGEventFlagMaskShift, "Alt": Quartz.kCGEventFlagMaskAlternate, "Ctrl": Quartz.kCGEventFlagMaskControl}
        else:
            from Xlib import X, XK, display
            from Xlib.ext import xtest
            XK.load_keysym_group("xkb")
            self.X, self.XK, self.xtest = X, XK, xtest
            self.display = display.Display()
    def send(self, *inputs: Any) -> None:
        array = (self.INPUT * len(inputs))(*inputs)
        self.user32.SendInput(len(inputs), array, ctypes.sizeof(self.INPUT))
    def key_win(self, vk: int, down: bool) -> None:
        one = self.INPUT(type=1)
        one.u.ki = self.KEYBDINPUT(wVk=vk, wScan=self.user32.MapVirtualKeyW(vk, 0), dwFlags=(0 if down else 0x2) | (0x1 if vk in EXTENDED_WIN else 0), time=0, dwExtraInfo=0)
        self.send(one)
    def code_of(self, name: str) -> Any:
        if PLATFORM == "windows":
            if name in MODS_WIN:
                return MODS_WIN[name]
            if name in SPECIAL_WIN:
                return SPECIAL_WIN[name]
            return ord(name.upper())
        if MAC:
            if name in MODS_MAC:
                return MODS_MAC[name]
            if name in SPECIAL_MAC:
                return SPECIAL_MAC[name]
            return LETTERS_MAC.index(name.lower())
        sym = self.XK.string_to_keysym(MODS_X.get(name) or SPECIAL_X.get(name) or name.lower())
        return self.display.keysym_to_keycode(sym)
    def key(self, name: str, down: bool, held: list[str]) -> None:
        code = self.code_of(name)
        if PLATFORM == "windows":
            self.key_win(code, down)
        elif MAC:
            Q = self.Q
            flags = 0
            for one in held:
                flags |= self.flags[one]
            if name in MODS_MAC and down:
                flags |= self.flags[name]
            event = Q.CGEventCreateKeyboardEvent(None, code, down)
            if name in MODS_MAC:
                Q.CGEventSetType(event, Q.kCGEventFlagsChanged)
            Q.CGEventSetFlags(event, flags)
            Q.CGEventPost(Q.kCGHIDEventTap, event)
        else:
            self.xtest.fake_input(self.display, self.X.KeyPress if down else self.X.KeyRelease, code)
            self.display.sync()
        time.sleep(0.03)
    def chord(self, combo: str) -> None:
        if " " in combo:
            one = combo.split(" ")[0]
            for _ in range(2):
                self.key(one, True, [one])
                self.key(one, False, [])
                time.sleep(0.08)
            time.sleep(0.5)
            return
        parts = combo.split("-")
        mods = [MOD if one == "Mod" else one for one in parts[:-1]]
        main = parts[-1]
        held: list[str] = []
        for one in mods:
            held.append(one)
            self.key(one, True, held)
        self.key(main, True, held)
        self.key(main, False, held)
        for one in reversed(mods):
            held.remove(one)
            self.key(one, False, held)
        time.sleep(0.4)
    def typed(self, text: str) -> None:
        for letter in text:
            self.key(letter, True, [])
            self.key(letter, False, [])
            time.sleep(0.03)
        time.sleep(0.4)
    def move(self, x: float, y: float) -> None:
        if PLATFORM == "windows":
            self.user32.SetCursorPos(round(x), round(y))
        elif MAC:
            Q = self.Q
            Q.CGEventPost(Q.kCGHIDEventTap, Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, (x, y), Q.kCGMouseButtonLeft))
        else:
            self.xtest.fake_input(self.display, self.X.MotionNotify, x=round(x), y=round(y))
            self.display.sync()
        time.sleep(0.12)
    def click(self, x: float, y: float, right: bool = False) -> None:
        self.move(x, y)
        if PLATFORM == "windows":
            down, up = (0x8, 0x10) if right else (0x2, 0x4)
            for flag in (down, up):
                one = self.INPUT(type=0)
                one.u.mi = self.MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=flag, time=0, dwExtraInfo=0)
                self.send(one)
                time.sleep(0.05)
        elif MAC:
            Q = self.Q
            kinds = (Q.kCGEventRightMouseDown, Q.kCGEventRightMouseUp) if right else (Q.kCGEventLeftMouseDown, Q.kCGEventLeftMouseUp)
            button = Q.kCGMouseButtonRight if right else Q.kCGMouseButtonLeft
            for kind in kinds:
                Q.CGEventPost(Q.kCGHIDEventTap, Q.CGEventCreateMouseEvent(None, kind, (x, y), button))
                time.sleep(0.05)
        else:
            for kind in (self.X.ButtonPress, self.X.ButtonRelease):
                self.xtest.fake_input(self.display, kind, 3 if right else 1)
                self.display.sync()
                time.sleep(0.05)
        time.sleep(0.5)
class Screen:
    def __init__(self, pid: int, app: App) -> None:
        self.pid, self.app = pid, app
        self.ratio = 1.0
        if MAC:
            import Quartz
            self.Q = Quartz
            shot = ImageGrab.grab()
            self.ratio = shot.width / Quartz.CGDisplayBounds(Quartz.CGMainDisplayID()).size.width
        elif PLATFORM == "linux":
            from Xlib import X, display
            self.X, self.display = X, display.Display()
    def origin(self) -> tuple[float, float, float]:
        if PLATFORM == "windows":
            from probe_app import main_window
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            from ctypes import wintypes
            point = wintypes.POINT(0, 0)
            user32.ClientToScreen(main_window(self.pid), ctypes.byref(point))
            return point.x, point.y, float(self.app.eval("devicePixelRatio") or 1)
        if MAC:
            Q = self.Q
            found = [
                dict(one["kCGWindowBounds"])
                for one in Q.CGWindowListCopyWindowInfo(Q.kCGWindowListOptionOnScreenOnly, Q.kCGNullWindowID) or []
                if int(one.get("kCGWindowOwnerPID", 0)) == self.pid and int(one.get("kCGWindowLayer", 0)) == 0
            ]
            bounds = max(found, key=lambda one: one["Width"] * one["Height"])
            return bounds["X"], bounds["Y"], 1.0
        root = self.display.screen().root
        pid_atom = self.display.intern_atom("_NET_WM_PID")
        best, area = None, 0
        for frame in root.query_tree().children:
            for one in [frame, *frame.query_tree().children]:
                said = one.get_full_property(pid_atom, 0)
                if said and said.value and int(said.value[0]) == self.pid:
                    shape = one.get_geometry()
                    if shape.width * shape.height > area:
                        best, area = one, shape.width * shape.height
        if best is None:
            raise SystemExit("the app showed no X window")
        at = best.translate_coords(root, 0, 0)
        return -at.x, -at.y, float(self.app.eval("devicePixelRatio") or 1)
    def at(self, x: float, y: float) -> tuple[float, float]:
        left, top, scale = self.origin()
        return left + x * scale, top + y * scale
    def css(self, x: float, y: float) -> tuple[float, float]:
        left, top, scale = self.origin()
        return (x - left) / scale, (y - top) / scale
    def shot(self) -> Image.Image:
        return ImageGrab.grab().convert("RGB")
    def colour(self, image: Image.Image, x: float, y: float) -> tuple[int, int, int]:
        px, py = round(x * self.ratio), round(y * self.ratio)
        patch = ImageStat.Stat(image.crop((px - 2, py - 2, px + 3, py + 3))).mean
        return round(patch[0]), round(patch[1]), round(patch[2])
def near(one: tuple[int, int, int], other: tuple[int, int, int], by: int = 40) -> bool:
    return all(abs(one[k] - other[k]) < by for k in range(3))
class Windows:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        if MAC:
            import Quartz
            self.Q = Quartz
        elif PLATFORM == "linux":
            from Xlib import X, display
            self.X, self.display = X, display.Display()
    def now(self) -> dict[Any, dict[str, Any]]:
        if PLATFORM == "windows":
            from probe_app import family, look
            return {
                one.hwnd: {"kind": one.kind, "box": list(one.box), "owner": one.pid}
                for one in look(family(self.pid)).windows
                if one.visible and one.box[2] - one.box[0] > 1 and one.box[3] - one.box[1] > 1
            }
        if MAC:
            Q = self.Q
            found = {}
            for one in Q.CGWindowListCopyWindowInfo(Q.kCGWindowListOptionOnScreenOnly, Q.kCGNullWindowID) or []:
                bounds = dict(one["kCGWindowBounds"])
                if bounds["Width"] < 2 or bounds["Height"] < 2 or one.get("kCGWindowOwnerName") == "Window Server" or int(one.get("kCGWindowLayer", 0)) > 1000:
                    continue
                found[int(one["kCGWindowNumber"])] = {
                    "kind": f"{one.get('kCGWindowOwnerName', '')} layer {int(one.get('kCGWindowLayer', 0))}",
                    "box": [bounds["X"], bounds["Y"], bounds["X"] + bounds["Width"], bounds["Y"] + bounds["Height"]],
                    "owner": int(one.get("kCGWindowOwnerPID", 0)),
                }
            return found
        found = {}
        for one in self.display.screen().root.query_tree().children:
            try:
                if one.get_attributes().map_state != self.X.IsViewable:
                    continue
                shape = one.get_geometry()
                names = [one.get_wm_class()] + [kid.get_wm_class() for kid in one.query_tree().children[:3]]
            except Exception:  # noqa: BLE001 - a window may go while it is read
                continue
            named = next((pair for pair in names if pair), None)
            found[one.id] = {"kind": "/".join(named) if named else "unnamed", "box": [shape.x, shape.y, shape.x + shape.width, shape.y + shape.height], "owner": 0}
        return found
    def close(self, ids: list[Any]) -> None:
        if PLATFORM == "windows":
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            for hwnd in ids:
                user32.PostMessageW(hwnd, 0x0010, 0, 0)
        elif MAC:
            import ApplicationServices as AS
            def ax(one: Any, name: str) -> Any:
                error, value = AS.AXUIElementCopyAttributeValue(one, name, None)
                return value if error == 0 else None
            for window in ax(AS.AXUIElementCreateApplication(self.pid), "AXWindows") or []:
                if ax(window, "AXMain") is True:
                    continue
                stack, buttons = [(window, 0)], []
                while stack:
                    one, depth = stack.pop()
                    if ax(one, "AXRole") == "AXButton":
                        buttons.append(one)
                    if depth < 6:
                        stack.extend((kid, depth + 1) for kid in ax(one, "AXChildren") or [])
                titles = [str(ax(one, "AXTitle") or "") for one in buttons]
                pick = next((one for one, title in zip(buttons, titles) if title in ("Cancel", "OK", "Block", "Don’t Allow", "Not Now")), buttons[0] if buttons else None)
                if pick is not None:
                    print(f"pressed {titles[buttons.index(pick)]!r} on a window the keys did not close", flush=True)
                    AS.AXUIElementPerformAction(pick, "AXPress")
MENU_NOW = """(() => {
  const menu = [...document.querySelectorAll('[role=menu]')].find((one) => one.offsetParent !== null || one.getClientRects().length)
  if (!menu) return { items: [], active: null }
  const items = [...menu.querySelectorAll('[role=menuitem]')]
  const focused = document.activeElement && menu.contains(document.activeElement) ? document.activeElement.closest('[role=menuitem]') : null
  const marked = items.find((one) => one.matches('[aria-selected=true], [data-active], [data-highlighted], .active, .is-active, :focus-visible'))
  const held = menu.getAttribute('aria-activedescendant')
  const active = focused || marked || (held ? document.getElementById(held) : null)
  return { items: items.map((one) => one.textContent.trim()), active: active ? active.textContent.trim() : null }
})()"""
LAYERS = """(() => [...document.querySelectorAll('.orden-layer, .orden-screen, [role=dialog], [role=menu], [role=alertdialog], [role=listbox]')]
  .map((e) => [e, e.getBoundingClientRect()])
  .filter(([e, r]) => r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
  .map(([e, r]) => {
    let ground = ''
    const queue = [e]
    while (queue.length && !ground) {
      const one = queue.shift()
      const bg = getComputedStyle(one).backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ground = bg
      else queue.push(...[...one.children].slice(0, 8))
    }
    const name = e.tagName.toLowerCase() + String(e.className || '').split(' ').filter(Boolean).map((one) => '.' + one).join('') + (e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : '')
    return { name: name.slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), ground }
  }))()"""
OVERVIEW = "(() => { const one = document.querySelector('[style*=\"--overview-open\"]'); const open = one ? Number(one.style.getPropertyValue('--overview-open')) : 0; return open > 0.5 })()"
TEXT_AT = """((word) => {
  for (const content of document.querySelectorAll('.cm-content')) {
    const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walk.nextNode())) {
      const at = node.data.indexOf(word)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + word.length)
      const r = range.getBoundingClientRect()
      if (r.width > 0) return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
  }
  return null
})"""
IN_NOTE = """((word) => {
  const active = document.activeElement
  const content = active && active.closest && active.closest('.cm-content')
  return !!content && content.textContent.includes(word) && document.hasFocus()
})"""
TABBABLE = "a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex=\"-1\"]), [contenteditable=\"true\"]"
DESCRIBE = "((e) => e ? (e.tagName.toLowerCase() + String(e.className || '').split(' ').filter(Boolean).map((one) => '.' + one).join('') + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : '')).slice(0, 80) : 'none')"
def anchored(box: dict[str, Any], click: tuple[float, float], room: tuple[float, float], reference: list[int]) -> bool:
    for start, size, at, wide, near in ((box["x"], box["w"], click[0], room[0], reference[0]), (box["y"], box["h"], click[1], room[1], reference[1])):
        opened = abs((start - at) - near) <= 40
        flipped = abs((start + size) - at) <= 40
        held = start <= 8 or start + size >= wide - 8
        covers = start - 8 <= at <= start + size + 8
        if not (opened or flipped or held or covers):
            return False
    return True
class Drive:
    def __init__(self, app: App, pid: int, url: str, out: pathlib.Path) -> None:
        self.app, self.pid, self.url, self.out = app, pid, url, out
        self.keys = Input()
        self.screen = Screen(pid, app)
        self.windows = Windows(pid)
        self.rows: list[dict[str, Any]] = []
        self.count = 0
        self.ids: dict[str, Any] = {}
    def js(self, code: str, seconds: float = 20) -> Any:
        return self.app.eval(code, seconds)
    def token(self) -> str:
        self.count += 1
        letters = "abcdfghjkmnrsuvxyz"
        return "q" + letters[self.count // len(letters) % len(letters)] + letters[self.count % len(letters)]
    def row(self, item: int, check: str, web: Any, note: Any, ok: bool | None, why: str = "") -> None:
        one: dict[str, Any] = {"item": item, "check": check, "platform": PLATFORM, "web": web, "note": note, "ok": ok}
        if why:
            one["why"] = why
        self.rows.append(one)
        print(f"[{item}] {check}: ok {ok}; web {json.dumps(web)[:300]}; note {json.dumps(note)[:300]}{'; ' + why if why else ''}", flush=True)
    def judged(self, item: int, check: str, web: tuple[Any, bool], note: tuple[Any, bool], unsure: str = "") -> None:
        if unsure:
            self.row(item, check, web[0], note[0], None, unsure)
        elif not note[1]:
            self.row(item, check, web[0], note[0], None, "the note pane itself did not pass, so the web tab is not judged against it")
        else:
            self.row(item, check, web[0], note[0], web[1])
    def build(self) -> None:
        code = f"""
const ws = orden.workspace
const made = (name, doc) => {{ ws.openBlank(name, doc); return ws.activeTabId }}
const before = ws.tabs.map((one) => one.id)
const one = made('One', {json.dumps('# One' + chr(10) + chr(10) + 'Firstline')})
const left = ws.panes.focusedId
const two = made('Two', {json.dumps('# Two' + chr(10) + chr(10) + 'Lodestar words' + chr(10) + chr(10) + 'Keyline')})
const three = made('Three', {json.dumps('# Three' + chr(10) + chr(10) + 'Filler')})
const web = ws.openPage({json.dumps(self.url + '?main')})
const right = ws.panes.split('row', left)
if (!right) return null
for (const id of [three, two, web]) ws.moveTab(id, right.id)
return {{ one, two, three, web, left, right: right.id, keep: [...before, one, two, three, web], panel: !!ws.panel }}
"""
        said = self.js(code)
        if not isinstance(said, dict) or not said.get("web"):
            raise SystemExit(f"the stage was not built: {said}")
        self.ids = said
        self.js(f"orden.workspace.activate({json.dumps(said['web'])}); return true")
        if self.app.until("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible) || null", 40) is None:
            raise SystemExit("the page was never shown")
        time.sleep(2)
        self.screen.shot().save(self.out / "stage.png")
        self.page_box()
    def fresh_page(self) -> None:
        ids = self.ids
        made = self.js(
            f"const ws = orden.workspace; ws.focusPane({json.dumps(ids['right'])}); const id = ws.openPage({json.dumps(self.url + '?main')});"
            f" ws.moveTab(id, {json.dumps(ids['right'])}); ws.closeEach([{json.dumps(ids['web'])}], false); return id"
        )
        if not isinstance(made, str):
            print(f"::warning::a page left with a dialog open could not be replaced: {made}", flush=True)
            return
        ids["keep"] = [made if one == ids["web"] else one for one in ids["keep"]]
        ids["web"] = made
        self.js(f"orden.workspace.activate({json.dumps(made)}); return true")
        if self.app.until("orden.pages.each().some(([, one]) => one.live && one.sent && one.sent.visible) || null", 40) is None:
            print("::warning::the fresh page was never shown", flush=True)
        time.sleep(1.5)
        self.page_box()
        print("a page left with a dialog open was replaced by a fresh one", flush=True)
    def page_box(self) -> None:
        pane = self.js("(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible); return all[0] ? all[0][1].sent.pane : null })()")
        if not isinstance(pane, dict):
            raise SystemExit(f"the page has no place: {pane}")
        image = self.screen.shot()
        image.save(self.out / "page.png")
        right = self.screen.at(pane["x"] + pane["width"] - 14, pane["y"] + pane["height"] * 0.6)
        low = self.screen.at(pane["x"] + pane["width"] * 0.6, pane["y"] + pane["height"] - 24)
        for start in (right, low):
            if not near(self.screen.colour(image, *start), MAGENTA):
                raise SystemExit(f"the page is not drawn where it was placed: {self.screen.colour(image, *start)} at {start}")
        x, y = right
        while near(self.screen.colour(image, x, y - 1), MAGENTA) and y > 0:
            y -= 1
        top = y
        x, y = low
        while near(self.screen.colour(image, x - 1, y), MAGENTA) and x > 0:
            x -= 1
        left = x
        self.page_left, self.page_top = self.screen.css(left, top)
        self.zoom = 1.0
        field = self.screen.colour(image, *self.in_page(150, 46))
        print(f"the page's place {pane}; drawn from {(round(self.page_left), round(self.page_top))} in the window; its field {field}", flush=True)
        if near(field, MAGENTA):
            raise SystemExit("the page's field is not where the drive looks for it")
    def in_page(self, x: float, y: float) -> tuple[float, float]:
        return self.screen.at(self.page_left + x * self.zoom, self.page_top + y * self.zoom)
    def word_at(self, word: str) -> tuple[float, float] | None:
        box = self.js(f"{TEXT_AT}({json.dumps(word)})")
        if not isinstance(box, dict):
            return None
        return self.screen.at(box["x"] + box["width"] + 2, box["y"] + box["height"] / 2)
    def reset(self) -> None:
        ids = self.ids
        self.js(
            f"""
const ws = orden.workspace
const keep = new Set({json.dumps(ids['keep'])})
const panes = {json.dumps([ids['left'], ids['right']])}
ws.panes.fills = null
document.querySelector('.orden-screen.palette .give')?.click()
const extra = ws.tabs.filter((one) => !keep.has(one.id)).map((one) => one.id)
if (extra.length) ws.closeEach(extra, false)
for (const one of ws.panes.all) if (!panes.includes(one.id)) ws.panes.close(one.id)
if (!!ws.panel !== {json.dumps(ids['panel'])}) ws.toggleSidebar('left')
if ({OVERVIEW}) document.querySelector('button.orden-glyph.overview')?.click()
return true
"""
        )
        time.sleep(0.6)
        for _ in range(3):
            if self.js("!!document.querySelector('.orden-screen.palette, .orden-screen.sheet')") is not True:
                break
            self.keys.chord("Escape")
            time.sleep(0.5)
    def show(self, tab: str) -> None:
        self.js(f"orden.workspace.activate({json.dumps(self.ids['one'])}); orden.workspace.activate({json.dumps(tab)}); return true")
        if tab == self.ids["web"]:
            self.app.until(f"orden.pages.each().some(([id, one]) => id === {json.dumps(tab)} && one.live && one.sent && one.sent.visible && !one.sent.away) || null", 20)
        time.sleep(0.8)
    def focus_note(self, word: str) -> bool:
        for _ in range(3):
            at = self.word_at(word)
            if at is None:
                time.sleep(0.5)
                continue
            self.keys.click(*at)
            if self.js(f"{IN_NOTE}({json.dumps(word)})") is True:
                return True
        return False
    def focus_page(self, who: str = "main") -> bool:
        said: dict[str, Any] = {}
        for _ in range(4):
            asked = time.monotonic()
            self.keys.click(*self.in_page(150, 46))
            said = page_said(who, asked + 0.3)
            if said.get("focus") is True and said.get("active") == "field":
                return True
            time.sleep(0.6)
        app = self.js(f"({{ app: document.hasFocus(), active: {DESCRIBE}(document.activeElement), pages: orden.pages.each().map(([id, one]) => [id, one.live, one.sent && one.sent.visible, one.sent && one.sent.away, one.keyboard]) }})")
        print(f"::warning::the page did not take the keyboard from a click: the page said {json.dumps({k: said.get(k) for k in ('focus', 'active', 'log')})[:400]}, the app {json.dumps(app)[:400]}", flush=True)
        return False
    def staged(self, side: str) -> bool:
        self.reset()
        if side == "web":
            self.show(self.ids["web"])
            return self.focus_page()
        self.show(self.ids["two"])
        return self.focus_note("Keyline")
    def landed(self, side: str, token: str) -> bool:
        if side == "web":
            return token in str(page_said("main", time.monotonic() + 0.3).get("value", ""))
        return self.js(f"orden.workspace.tabs.find((one) => one.id === {json.dumps(self.ids['two'])})?.doc.includes({json.dumps(token)})") is True
    def shortcuts(self) -> None:
        slot = json.dumps(self.ids["right"])
        cases: list[tuple[str, str, str, Callable[[Any, Any], bool]]] = [
            ("the palette (Mod-o)", "Mod-o", "!!document.querySelector('.orden-screen.palette')", lambda a, b: b is True and a is not True),
            ("the palette (Shift twice)", "Shift Shift", "!!document.querySelector('.orden-screen.palette')", lambda a, b: b is True and a is not True),
            ("commands (Mod-Shift-p)", "Mod-Shift-p", "!!document.querySelector('.orden-screen.palette')", lambda a, b: b is True and a is not True),
            ("a new tab (Mod-t)", "Mod-t", "orden.workspace.tabs.length", lambda a, b: isinstance(a, int) and isinstance(b, int) and b > a),
            ("close the tab (Mod-w)", "Mod-w", "", lambda a, b: a is True and b is False),
            ("the next tab", "Ctrl-Tab" if MAC else "Mod-Tab", f"orden.workspace.panes.at({slot})?.activeTabId", lambda a, b: a != b and b is not None),
            ("a tab by its number", "Mod-1" if MAC else "Mod-Alt-1", f"orden.workspace.panes.at({slot})?.activeTabId", lambda a, b: a != b and b is not None),
            ("split down (Mod-Alt-ArrowDown)", "Mod-Alt-ArrowDown", "orden.workspace.panes.all.length", lambda a, b: isinstance(a, int) and isinstance(b, int) and b > a),
            ("the full window", "Mod-Ctrl-Shift-f" if MAC else "Shift-F11", "orden.workspace.panes.fills !== null", lambda a, b: b is True and a is False),
            ("the left sidebar (Mod-Shift-l)", "Mod-Shift-l", "!!orden.workspace.panel", lambda a, b: a != b and isinstance(b, bool)),
            ("the overview (Alt twice)", "Alt Alt", OVERVIEW, lambda a, b: b is True and a is not True),
        ]
        for name, combo, probe, changed in cases:
            said: dict[str, tuple[Any, bool]] = {}
            unsure = ""
            for side in ("note", "web"):
                if probe == "":
                    ready, probe_now = self.spare(side), "orden.workspace.tabs.some((one) => one.id === window.__spare)"
                else:
                    ready, probe_now = self.staged(side), probe
                if not ready:
                    unsure = f"the {side} side could not be given the keyboard by a click"
                    said[side] = ("no keyboard", False)
                    continue
                before = self.js(probe_now)
                self.keys.chord(combo)
                after = before
                until = time.monotonic() + 2.5
                while time.monotonic() < until:
                    after = self.js(probe_now)
                    if changed(before, after):
                        break
                    time.sleep(0.15)
                worked = changed(before, after)
                said[side] = ({"keys": combo, "worked": worked, "before": before, "after": after}, worked)
            self.judged(4, f"app shortcut while focused: {name}", said["web"], said["note"], unsure)
        self.reset()
    def spare(self, side: str) -> bool:
        self.reset()
        right = json.dumps(self.ids["right"])
        if side == "web":
            tab = self.js(f"const id = orden.workspace.openPage({json.dumps(self.url + '?spare')}); orden.workspace.moveTab(id, {right}); window.__spare = id; return id")
            self.app.until(f"orden.pages.each().some(([id, one]) => id === {json.dumps(tab)} && one.live && one.sent && one.sent.visible) || null", 20)
            time.sleep(1.2)
            for _ in range(3):
                asked = time.monotonic()
                self.keys.click(*self.in_page(150, 46))
                said = page_said("spare", asked + 0.2)
                if said.get("focus") is True and said.get("active") == "field":
                    return True
            return False
        self.js(f"orden.workspace.openBlank('Spare', ''); const id = orden.workspace.activeTabId; orden.workspace.moveTab(id, {right}); window.__spare = id; return id")
        time.sleep(1)
        for _ in range(3):
            box = self.js(
                f"(() => {{ const shown = [...document.querySelectorAll('.pane[data-pane={json.dumps(self.ids['right'])}] .cm-content')]"
                ".map((one) => one.getBoundingClientRect()).find((r) => r.width > 0 && r.height > 0);"
                " return shown ? { x: shown.x, y: shown.y, width: shown.width, height: shown.height } : null })()"
            )
            if isinstance(box, dict):
                self.keys.click(*self.screen.at(box["x"] + 40, box["y"] + 12))
                if self.js("(() => { const a = document.activeElement; return !!(a && a.closest && a.closest('.cm-content')) && document.hasFocus() && orden.workspace.activeTabId === window.__spare })()") is True:
                    return True
            time.sleep(0.5)
        return False
    def control_before(self, side: str) -> str:
        pane = f".pane[data-pane={json.dumps(self.ids['right'])}]"
        if side == "web":
            slot = f"document.querySelector('{pane} .hole')"
        else:
            slot = f"[...document.querySelectorAll('{pane} .cm-content')].find((one) => one.textContent.includes('Lodestar'))"
        return f"""(() => {{
  const slot = {slot}
  if (!slot) return null
  let last = null
  for (const one of document.querySelectorAll({json.dumps(TABBABLE)})) {{
    const r = one.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || one.tabIndex < 0 || one.closest('[inert]')) continue
    if (one === slot || slot.contains(one) || slot.compareDocumentPosition(one) & Node.DOCUMENT_POSITION_FOLLOWING) break
    last = one
  }}
  return last
}})()"""

    def keeps_keyboard(self) -> None:
        said: dict[str, Any] = {}
        for side in ("note", "web"):
            self.reset()
            self.show(self.ids["web"] if side == "web" else self.ids["two"])
            kept = 0
            for _ in range(5):
                self.focus_note("Firstline")
                if side == "web":
                    self.keys.click(*self.in_page(150, 46))
                    time.sleep(1.0)
                    now = page_said("main", time.monotonic())
                    kept += now.get("focus") is True and now.get("active") == "field"
                else:
                    at = self.word_at("Keyline")
                    if at:
                        self.keys.click(*at)
                    time.sleep(1.0)
                    kept += self.js(f"{IN_NOTE}('Keyline')") is True
            said[side] = ({"kept the keyboard a second after the click": f"{kept} of 5"}, kept == 5)
        self.judged(4, "a click on the slot gives it the keyboard and it keeps it", said["web"], said["note"])
    def palette_and_back(self) -> None:
        said: dict[str, Any] = {}
        for side in ("note", "web"):
            if not self.staged(side):
                self.row(4, "after the command palette is put away with Escape, typing goes back where it was", None, None, None, f"the {side} side could not be given the keyboard by a click")
                return
            first, second = self.token(), self.token()
            self.keys.typed(first)
            time.sleep(0.4)
            self.keys.chord("Mod-Shift-p")
            time.sleep(1.0)
            opened = self.js("!!document.querySelector('.orden-screen.palette')") is True
            self.keys.chord("Escape")
            time.sleep(0.8)
            closed = self.js("!document.querySelector('.orden-screen.palette')") is True
            focus = self.js(f"({{ focus: document.hasFocus(), active: {DESCRIBE}(document.activeElement) }})")
            self.keys.typed(second)
            time.sleep(0.6)
            before, after = self.landed(side, first), self.landed(side, second)
            said[side] = ({"typed before": before, "palette opened": opened, "palette closed": closed, "after Escape": focus, "typed after": after}, before and opened and closed and after)
        self.judged(4, "after the command palette is put away with Escape, typing goes back where it was", said["web"], said["note"])
    def focus_moves(self) -> None:
        self.keeps_keyboard()
        self.palette_and_back()
        said: dict[str, Any] = {}
        unsure = ""
        for side in ("note", "web"):
            if not self.staged(side):
                unsure = f"the {side} side could not be given the keyboard by a click"
                break
            token = self.token()
            back = self.focus_note("Firstline")
            self.keys.typed(token)
            one = self.js(f"orden.workspace.tabs.find((one) => one.id === {json.dumps(self.ids['one'])})?.doc.includes({json.dumps(token)})") is True
            other = self.landed(side, token)
            said[side] = ({"keyboard in the other pane after the click": back, "typed landed in it": one, "typed landed in the slot too": other}, back and one and not other)
        if unsure:
            self.row(4, "a click on the slot, then on a note, sends typing to the note", None, None, None, unsure)
        else:
            self.judged(4, "a click on the slot, then on a note, sends typing to the note", said["web"], said["note"])
        said = {}
        unsure = ""
        for side in ("note", "web"):
            self.reset()
            self.show(self.ids["web"] if side == "web" else self.ids["two"])
            if not self.focus_note("Firstline"):
                unsure = "the note beside could not be given the keyboard"
                break
            ring = "[...document.querySelectorAll('[data-region=\"foot\"] button, [data-region=\"space\"] button, button.orden-glyph.overview')].find((one) => one.getBoundingClientRect().width > 0)"
            box = self.js(f"(() => {{ const one = {ring}; if (!one) return null; const r = one.getBoundingClientRect(); return {{ x: r.x, y: r.y, width: r.width, height: r.height }} }})()")
            if not isinstance(box, dict):
                unsure = "the app has no button beside the panes to hold a focus ring"
                break
            def crop() -> Image.Image:
                a = self.screen.at(box["x"] - 4, box["y"] - 4)
                b = self.screen.at(box["x"] + box["width"] + 4, box["y"] + box["height"] + 4)
                r = self.screen.ratio
                return self.screen.shot().crop((round(a[0] * r), round(a[1] * r), round(b[0] * r), round(b[1] * r))).convert("L")
            plain = crop()
            self.keys.chord("Shift")
            self.js(f"{ring}.focus({{ focusVisible: true }}); return true")
            time.sleep(0.5)
            ringed = crop()
            differ = lambda one, other: ImageStat.Stat(ImageChops.difference(one, other)).mean[0]  # noqa: E731
            if differ(ringed, plain) < 2:
                unsure = "the app's focus ring could not be seen on its button"
                break
            token = self.token()
            if side == "web":
                asked = time.monotonic()
                self.keys.click(*self.in_page(150, 46))
                took = page_said("main", asked + 0.2).get("focus") is True
            else:
                at = self.word_at("Keyline")
                if at:
                    self.keys.click(*at)
                took = self.js(f"{IN_NOTE}('Keyline')") is True
            time.sleep(0.4)
            after = crop()
            self.keys.typed(token)
            typed = self.landed(side, token)
            self.js(f"{ring}.blur(); return true")
            time.sleep(0.4)
            bare = crop()
            for name, image in (("plain", plain), ("ringed", ringed), ("after", after), ("bare", bare)):
                image.save(self.out / f"ring-{side}-{name}.png")
            shown, left = differ(ringed, plain), differ(after, bare)
            gone = left < shown / 3
            said[side] = ({"took the keyboard": took, "app focus ring gone": gone, "ring left": round(left, 1), "ring shown": round(shown, 1), "typed landed": typed}, took and gone and typed)
        if unsure:
            self.row(4, "a click on the slot gives it the keyboard and takes the app's focus ring away", None, None, None, unsure)
        else:
            self.judged(4, "a click on the slot gives it the keyboard and takes the app's focus ring away", said["web"], said["note"])
        self.tab_in()
        self.tab_out()
    def tab_in(self) -> None:
        said: dict[str, Any] = {}
        sensed: dict[str, Any] = {}
        unsure = ""
        for side in ("note", "web"):
            self.reset()
            self.show(self.ids["web"] if side == "web" else self.ids["two"])
            if not self.focus_note("Firstline"):
                unsure = "the note beside could not be given the keyboard"
                break
            pick = self.control_before(side)
            named = self.js(f"(() => {{ const one = {pick}; if (!one) return null; one.focus(); return document.activeElement === one && document.hasFocus() ? {DESCRIBE}(one) : null }})()")
            if not isinstance(named, str):
                unsure = f"the app's control before the {side} slot could not be focused: {named}"
                break
            self.keys.chord("Tab")
            time.sleep(0.4)
            sensed[side] = self.sensed_focus(side)
            token = self.token()
            self.keys.typed(token)
            typed = self.landed(side, token)
            now = self.js(f"{DESCRIBE}(document.hasFocus() ? document.activeElement : null)")
            said[side] = ({"from": named, "typed landed": typed, "app focus after": now}, typed)
        if unsure:
            self.row(4, "one Tab from the app's control before the slot goes into it", None, None, None, unsure)
            self.row(9, "one Tab from the app's last element reaches the slot's first element, as the screen reader sees it", None, None, None, unsure)
            return
        self.judged(4, "one Tab from the app's control before the slot goes into it", said["web"], said["note"])
        self.judged(9, "one Tab from the app's last element reaches the slot's first element, as the screen reader sees it", sensed["web"], sensed["note"], self.reader_unsure)
    def tab_out(self) -> None:
        said: dict[str, Any] = {}
        unsure = ""
        before = self.control_before("web")
        for side in ("note", "web"):
            if side == "web":
                if not self.staged("web"):
                    unsure = "the page could not be given the keyboard by a click"
                    break
                start = "field"
            else:
                self.reset()
                self.show(self.ids["web"])
                if not self.focus_note("Firstline"):
                    unsure = "the note beside could not be given the keyboard"
                    break
                start = self.js(f"(() => {{ const one = {before}; if (!one) return null; one.focus(); return document.activeElement === one && document.hasFocus() ? {DESCRIBE}(one) : null }})()")
                if not isinstance(start, str):
                    unsure = f"the web bar's last control could not be focused: {start}"
                    break
            asked = time.monotonic()
            self.keys.chord("Shift-Tab")
            time.sleep(0.4)
            app = self.js(f"(() => document.hasFocus() && document.activeElement && document.activeElement !== document.body ? {DESCRIBE}(document.activeElement) : null)()")
            left = page_said("main", asked + 0.2).get("focus") is not True if side == "web" else app != start
            said[side] = ({"from": start, "app focus after": app, "left where it was": left}, isinstance(app, str) and left)
        check = "Shift+Tab from the page's first element goes back to the app, as Shift+Tab moves between the app's own controls"
        if unsure:
            self.row(4, check, None, None, None, unsure)
        else:
            self.judged(4, check, said["web"], said["note"])
    def strip_click(self, tab: str) -> bool:
        box = self.js(f"(() => {{ const one = [...document.querySelectorAll('.pick[data-tab=\"' + {json.dumps(tab)} + '\"]')].find((it) => it.getBoundingClientRect().width > 0); const r = one?.getBoundingClientRect(); return r ? {{ x: r.x + r.width / 2, y: r.y + r.height / 2 }} : null }})()")
        if not isinstance(box, dict):
            return False
        self.keys.click(*self.screen.at(box["x"], box["y"]))
        return True
    def by_number(self, tab: str) -> bool:
        at = self.js(f"orden.workspace.tabsIn(orden.workspace.panes.focusedId).findIndex((one) => one.id === {json.dumps(tab)})")
        if not isinstance(at, int) or not 0 <= at < 8:
            return False
        self.keys.chord(f"Mod-{at + 1}" if MAC else f"Mod-Alt-{at + 1}")
        return True
    def by_overview(self, tab: str) -> bool:
        name = self.js(f"orden.workspace.tabs.find((one) => one.id === {json.dumps(tab)})?.shown")
        if not isinstance(name, str):
            return False
        self.keys.chord("Alt Alt")
        if self.app.until(f"{OVERVIEW} || null", 4) is None:
            return False
        time.sleep(0.8)
        spot = self.js(importlib.import_module("overview_pick").bubble(name))
        if not isinstance(spot, dict):
            self.keys.chord("Escape")
            return False
        self.keys.click(*self.screen.at(spot["x"], spot["y"]))
        return self.app.until(f"!{OVERVIEW} || null", 4) is not None
    def typed_page(self, who: str) -> str | None:
        self.show(self.ids["web"])
        self.focus_page()
        self.keys.chord("Mod-t")
        if self.app.until("(document.activeElement?.closest?.('.webbar') && document.activeElement.tagName === 'INPUT') || null", 4) is None:
            return None
        tab = self.js("orden.workspace.activeTabId")
        self.js(f"const one = document.activeElement; one.value = {json.dumps(self.url + '?' + who)}; one.dispatchEvent(new Event('input', {{ bubbles: true }})); return true")
        time.sleep(0.3)
        self.keys.chord("Return")
        if not isinstance(tab, str) or self.app.until(f"orden.pages.each().some(([id, one]) => id === {json.dumps(tab)} && one.live && one.sent && one.sent.visible) || null", 40) is None:
            return None
        time.sleep(1.5)
        return tab
    def web_return(self) -> None:
        check = "a loaded web tab entered again gives the keyboard to its page, never its address"
        self.reset()
        made = [self.typed_page(who) for who in ("second", "third")]
        if not all(made):
            self.row(4, check, made, None, None, "a web tab could not be opened from a new tab's address")
            return
        first, second = made
        pages = {first: "second", second: "third"}
        ready = {}
        for tab, who in pages.items():
            self.show(tab)
            ready[who] = self.focus_page(who)
        if not all(ready.values()):
            self.row(4, check, ready, None, None, "a page could not be given the keyboard by a click")
            return
        address = "(() => { const one = document.activeElement; const bar = !!one?.closest?.('.webbar') && one.tagName === 'INPUT'; return { tab: orden.workspace.activeTabId, active: " + DESCRIBE + "(one), address: bar, picked: bar && one.selectionStart !== one.selectionEnd } })()"
        ways: list[tuple[str, Callable[[str], bool]]] = [("a click on its tab", self.strip_click), ("its number", self.by_number), ("the overview", self.by_overview)]
        legs = [(first, self.ids["three"], first, "note"), (second, None, first, "web"), (first, None, second, "web")]
        for name, way in ways:
            said: list[dict[str, Any]] = []
            ok = True
            for start, away, back, kind in legs:
                self.show(start)
                self.focus_page(pages[start])
                went = way(away) if away else True
                if away:
                    time.sleep(1.0)
                came = way(back)
                time.sleep(1.2)
                state = self.js(address)
                token = self.token()
                asked = time.monotonic()
                self.keys.typed(token)
                time.sleep(0.6)
                page = token in str(page_said(pages[back], asked + 0.3).get("value", ""))
                typed_address = self.js(f"[...document.querySelectorAll('.webbar input')].some((one) => one.value.includes({json.dumps(token)}))") is True
                said.append({"from": kind, "went": went, "came": came, "state": state, "typed in the page": page, "typed in the address": typed_address})
                ok = ok and went and came and isinstance(state, dict) and state.get("tab") == back and not state.get("address") and not state.get("picked") and page and not typed_address
            self.row(4, f"{check}: by {name}", said, "no note counterpart: a note has no address", ok)
        self.reset()
        before = self.js("orden.workspace.tabs.length")
        self.show(self.ids["web"])
        self.focus_page()
        self.keys.chord("Mod-t")
        time.sleep(1.2)
        state = self.js(address)
        made = self.js("orden.workspace.tabs.length")
        fresh = isinstance(before, int) and isinstance(made, int) and made > before
        self.row(4, "a new empty tab (Mod-t) starts in its address", {"opened": fresh, "state": state}, "no note counterpart", fresh and isinstance(state, dict) and state.get("address") is True)
        self.reset()
    def bar_popups(self) -> None:
        listen = (
            "window.__barLog = []; if (!window.__barHeard) { window.__barHeard = true;"
            " for (const kind of ['blur', 'focus']) addEventListener(kind, (e) => window.__barLog?.push([kind, Math.round(performance.now()), e.isTrusted, e.target === window]), true) }"
            " return Math.round(performance.now())"
        )
        for name, opened in (("More", "!!document.querySelector('[role=menu]')"), ("Extensions", "!!document.querySelector('.extensions.orden-bubble')")):
            check = f"a click on the web bar's {name} button keeps its popup open"
            self.reset()
            self.show(self.ids["web"])
            if not self.focus_page():
                self.row(7, check, None, "no note counterpart: a note has no web bar", None, "the page could not be given the keyboard by a click")
                continue
            time.sleep(0.5)
            box = self.js(f"(() => {{ const one = [...document.querySelectorAll('button[aria-label=\"{name}\"]')].find((it) => it.getBoundingClientRect().width > 0); const r = one?.getBoundingClientRect(); return r ? {{ x: r.x + r.width / 2, y: r.y + r.height / 2 }} : null }})()")
            if not isinstance(box, dict):
                self.row(7, check, {"button": False}, "no note counterpart: a note has no web bar", False)
                continue
            start = self.js(listen)
            self.keys.click(*self.screen.at(box["x"], box["y"]))
            seen = []
            for _ in range(8):
                time.sleep(0.25)
                seen.append(self.js(opened) is True)
            log = self.js("window.__barLog || []") or []
            heard = [[one[0], one[1] - start, one[2], one[3]] for one in log if isinstance(one, list) and isinstance(start, (int, float))]
            self.row(7, check, {"open every 250 ms for 2 s": seen, "window blur and focus (ms after, trusted, on the window)": heard[:12]}, "no note counterpart: a note has no web bar", all(seen))
            self.keys.chord("Escape")
            time.sleep(0.5)
        self.reset()
    def dead_keys(self) -> None:
        layout = self.dead_layout()
        if layout is not None:
            self.row(4, "a dead key (acute, then e) types an accented e", None, None, None, layout)
        else:
            said: dict[str, Any] = {}
            unsure = ""
            for side in ("note", "web"):
                if PLATFORM == "windows" and side != "note":
                    self.undo_layout()
                    switched = self.dead_layout()
                    if switched is not None:
                        said[side] = (switched, False)
                        unsure = switched
                        continue
                if not self.staged(side):
                    said[side] = ("no keyboard", False)
                    unsure = f"the {side} side could not be given the keyboard by a click"
                    continue
                self.keys.chord("Shift")
                if MAC:
                    self.keys.chord("Alt-e")
                else:
                    self.keys.chord("Quote")
                self.keys.typed("e")
                typed = self.landed(side, "é")
                if side == "web":
                    tail = str(page_said("main", time.monotonic()).get("value", ""))[-6:]
                else:
                    tail = str(self.js(f"orden.workspace.tabs.find((one) => one.id === {json.dumps(self.ids['two'])})?.doc") or "")[-6:]
                said[side] = ({"é typed": typed, "ends with": tail}, typed)
            self.judged(4, "a dead key (acute, then e) types an accented e", said["web"], said["note"], unsure)
            self.undo_layout()
        self.row(4, "an IME composes text", None, None, None, "no input method can be driven on the CI runners: not measured")
    def dead_layout(self) -> str | None:
        if MAC:
            return None
        if PLATFORM == "linux":
            return None if self.keys.code_of("Quote") else "the X keyboard has no dead acute key (setxkbmap us intl failed)"
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.LoadKeyboardLayoutW.restype = ctypes.c_void_p
        user32.GetKeyboardLayout.restype = ctypes.c_void_p
        from probe_app import main_window
        hwnd = main_window(self.pid)
        self.layout_was = user32.GetKeyboardLayout(user32.GetWindowThreadProcessId(hwnd, None))
        self.layout = user32.LoadKeyboardLayoutW("00020409", 1)
        user32.PostMessageW(hwnd, 0x0050, 0, ctypes.c_void_p(self.layout))
        time.sleep(1)
        now = user32.GetKeyboardLayout(user32.GetWindowThreadProcessId(hwnd, None))
        print(f"the app's keyboard layout: {now:#x}, US-International {self.layout or 0:#x}", flush=True)
        return None if now == self.layout else f"the app's thread did not take the US-International layout ({now or 0:#x})"
    def undo_layout(self) -> None:
        if PLATFORM == "windows" and getattr(self, "layout_was", None):
            from probe_app import main_window
            ctypes.WinDLL("user32", use_last_error=True).PostMessageW(main_window(self.pid), 0x0050, 0, ctypes.c_void_p(self.layout_was))
            time.sleep(0.5)
    def seen(self, act: Callable[[], None], seconds: float = 3.0, region: tuple[float, float, float, float] | None = None) -> dict[str, Any]:
        windows = self.windows.now()
        layers = self.js(LAYERS) or []
        r = self.screen.ratio
        cut = (round(region[0] * r), round(region[1] * r), round(region[2] * r), round(region[3] * r)) if region else None
        first = self.screen.shot().crop(cut).convert("L") if cut else None
        act()
        until = time.monotonic() + seconds
        new_windows: dict[Any, Any] = {}
        new_layers: list[Any] = []
        while time.monotonic() < until:
            time.sleep(0.25)
            now = self.windows.now()
            new_windows = {k: v for k, v in now.items() if k not in windows}
            got = self.js(LAYERS)
            new_layers = [one for one in (got if isinstance(got, list) else []) if one not in layers]
            if new_windows or new_layers:
                time.sleep(0.6)
                now = self.windows.now()
                new_windows = {k: v for k, v in now.items() if k not in windows}
                got = self.js(LAYERS)
                new_layers = [one for one in (got if isinstance(got, list) else []) if one not in layers]
                break
        image = self.screen.shot()
        for one in new_windows.values():
            box = one["box"]
            if PLATFORM == "windows":
                x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            else:
                x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            one["colour"] = self.screen.colour(image, x, y)
            cx, cy = self.screen.css(box[0], box[1])
            one["at"] = [round(cx), round(cy)]
        drawn = "both" if new_windows and new_layers else "system" if new_windows else "orden" if new_layers else "none"
        changed = None
        if cut and first is not None:
            changed = round(ImageStat.Stat(ImageChops.difference(first, image.crop(cut).convert("L"))).mean[0], 1)
            if drawn == "none" and changed > 3:
                drawn = "chromium, inside the page"
        return {"drawn": drawn, "windows": list(new_windows.values()), "layers": new_layers, "ids": list(new_windows.keys()), "page changed": changed}
    def dismissed(self, seen: dict[str, Any], closed: Callable[[], bool] | None = None) -> list[Any]:
        left: list[Any] = []
        for key in ("Escape", "Escape", "Return"):
            self.keys.chord(key)
            time.sleep(0.6)
            now = self.windows.now()
            left = [one for one in seen["ids"] if one in now]
            layers = self.js(LAYERS) or []
            if not left and not [one for one in seen["layers"] if one in layers] and (closed is None or closed()):
                return []
        if left:
            self.windows.close(left)
            time.sleep(1)
        if closed is not None and not closed():
            print("::warning::the page's own dialog stayed open after Escape and Return; the page is loaded again", flush=True)
            web = json.dumps(self.ids["web"])
            self.js(f"window.__TAURI_INTERNALS__.invoke('web_navigate', {{ tab: {web}, url: {json.dumps(self.url + '?main')} }}).then(() => true, () => false)")
            self.app.until(f"orden.pages.each().some(([id, one]) => id === {web} && one.live && one.sent && one.sent.visible && !one.sent.away) || null", 20)
            time.sleep(2)
            return ["the page's dialog"] + [one for one in seen["ids"] if one in self.windows.now()]
        return [one for one in seen["ids"] if one in self.windows.now()]
    def menu_now(self) -> dict[str, Any]:
        said = self.js(MENU_NOW)
        return said if isinstance(said, dict) else {"items": [], "active": None}
    def menu_keys(self, opening: Callable[[], None], away: tuple[float, float]) -> dict[str, Any]:
        found: dict[str, Any] = {}
        opening()
        time.sleep(1.2)
        found["opened"] = bool(self.menu_now()["items"])
        self.keys.click(*away)
        time.sleep(1.0)
        found["closed by a left click"] = found["opened"] and not self.menu_now()["items"]
        self.keys.chord("Escape")
        time.sleep(0.4)
        opening()
        time.sleep(1.2)
        self.keys.chord("Escape")
        time.sleep(0.8)
        found["closed by Escape"] = found["opened"] and not self.menu_now()["items"]
        opening()
        time.sleep(1.2)
        first = self.menu_now()
        self.keys.chord("ArrowDown")
        time.sleep(0.4)
        self.keys.chord("ArrowDown")
        time.sleep(0.4)
        second = self.menu_now()
        found["arrows move"] = bool(second["items"]) and second["active"] is not None and second["active"] != first["active"]
        found["active"] = [first["active"], second["active"]]
        for _ in range(2):
            self.keys.chord("Escape")
            time.sleep(0.4)
        return found
    def menu_regressions(self) -> None:
        self.reset()
        self.show(self.ids["two"])
        self.focus_note("Keyline")
        at = self.word_at("Lodestar")
        note = self.menu_keys(lambda: self.keys.click(*at, right=True), self.word_at("Firstline") or at) if at else None
        self.reset()
        self.show(self.ids["web"])
        web = None
        if self.focus_page():
            web = self.menu_keys(lambda: self.keys.click(*self.in_page(265, 384), right=True), self.in_page(60, 440))
        for check in ("closed by a left click", "closed by Escape", "arrows move"):
            web_ok = bool(web and web.get(check))
            note_ok = bool(note and note.get(check))
            self.row(7, f"the page's own right-click menu is {check}, as the note's", {key: web.get(key) for key in ("opened", check, "active")} if web else None, {key: note.get(key) for key in ("opened", check, "active")} if note else None, web_ok and note_ok if web is not None else None, "" if web is not None else "the page could not be given the keyboard by a click")
        self.reset()
        self.show(self.ids["web"])
        if not self.focus_page():
            self.row(7, "after a pick in the page's <select>, a right click on a link gives the link's menu", None, None, None, "the page could not be given the keyboard by a click")
            return
        self.keys.click(*self.in_page(99, 272))
        time.sleep(1.2)
        listed = self.js("return [...document.querySelectorAll('[role=listbox] [role=option]')].map((one) => one.textContent.trim())") or []
        self.keys.chord("ArrowDown")
        time.sleep(0.3)
        self.keys.chord("Return")
        time.sleep(1.0)
        menus = []
        for spot in ((320, 460), (265, 384), (320, 460), (265, 384)):
            self.keys.click(*self.in_page(*spot), right=True)
            time.sleep(1.2)
            menus.append(self.menu_now()["items"])
            self.js("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.body.click(); return true")
            time.sleep(0.6)
            for _ in range(2):
                self.keys.chord("Escape")
                time.sleep(0.3)
        links = [one for at, one in enumerate(menus) if at % 2 == 1]
        linked = all(any("link" in item.lower() for item in one) for one in links) and all(menus)
        self.row(7, "after a pick in the page's <select>, a right click on a link gives the link's menu", {"select listed": listed, "menus": menus}, "no note counterpart: a note has no <select>", linked)
    def window_size(self) -> tuple[float, float]:
        size = self.js("[innerWidth, innerHeight]")
        return (float(size[0]), float(size[1])) if isinstance(size, list) else (0.0, 0.0)
    def page_ui(self) -> None:
        self.reset()
        self.show(self.ids["two"])
        self.focus_note("Keyline")
        at = self.word_at("Lodestar")
        clicked = self.screen.css(*at) if at else (0.0, 0.0)
        menu = self.seen(lambda: self.keys.click(*at, right=True)) if at else {"drawn": "none", "windows": [], "layers": [], "ids": []}
        self.dismissed(menu)
        menu_layer = next(iter(menu["layers"]), None)
        menu_ref = {
            "drawn": menu["drawn"],
            "ground": menu_layer["ground"] if menu_layer else None,
            "from the click": [round(menu_layer["x"] - clicked[0]), round(menu_layer["y"] - clicked[1])] if menu_layer else None,
            "layer": menu_layer["name"] if menu_layer else None,
        }
        menu_ok = menu["drawn"] == "orden"
        self.reset()
        self.focus_note("Firstline")
        asked = self.js(
            "orden.workspace.openBlank('Asked', ''); const id = orden.workspace.activeTabId;"
            " const tab = orden.workspace.tabs.find((one) => one.id === id); orden.workspace.replace('words to keep', tab); return id"
        )
        time.sleep(1)
        self.focus_note("Firstline")
        sheet = self.seen(lambda: self.js(f"orden.workspace.closeAsking({json.dumps(asked)}); return true"))
        reference = "the unsaved-note sheet"
        if sheet["drawn"] == "none":
            self.focus_note("Firstline")
            sheet = self.seen(lambda: self.keys.chord("Mod-o"))
            reference = "the palette"
        width, height = self.window_size()
        sheet_layer = next((one for one in sheet["layers"] if "sheet" in one["name"] or "dialog" in one["name"] or "palette" in one["name"]), next(iter(sheet["layers"]), None))
        self.dismissed(sheet)
        self.js(f"orden.workspace.closeEach([{json.dumps(asked)}], false); return true")
        sheet_ref = {
            "drawn": sheet["drawn"],
            "ground": sheet_layer["ground"] if sheet_layer else None,
            "from the middle": [round(sheet_layer["x"] + sheet_layer["w"] / 2 - width / 2), round(sheet_layer["y"] + sheet_layer["h"] / 2 - height / 2)] if sheet_layer else None,
            "layer": sheet_layer["name"] if sheet_layer else None,
            "which": reference,
        }
        sheet_ok = sheet["drawn"] == "orden"
        print(f"Orden's own menu: {menu_ref}; Orden's own dialog: {sheet_ref}", flush=True)
        cases = [
            ("context menu (a right click)", "menu", None, (300, 104), True),
            ("<select> popup", "menu", "pick", (99, 272), False),
            ("alert()", "dialog", "alert", (99, 160), False),
            ("confirm()", "dialog", "confirm", (265, 160), False),
            ("prompt()", "dialog", "prompt", (99, 216), False),
            ("camera permission (getUserMedia)", "dialog", "camera", (265, 272), False),
            ("location permission (geolocation)", "dialog", "where", (99, 328), False),
            ("notification permission", "dialog", "notify", (265, 328), False),
        ]
        for name, kind, answer, spot, right in cases:
            self.reset()
            self.show(self.ids["web"])
            if not self.focus_page():
                self.row(7, name, None, None, None, "the page could not be given the keyboard by a click")
                continue
            where = self.in_page(*spot)
            asked_at = time.monotonic()
            region = (*self.in_page(0, 0), *self.in_page(360, 420))
            got = self.seen(lambda: self.keys.click(*where, right=right), 4.0, region)
            width, height = self.window_size()
            spot_css = self.screen.css(*where)
            closed = (lambda: answer in page_said("main", time.monotonic(), 1.0).get("answers", {})) if answer and answer != "pick" else None
            left = self.dismissed(got, closed)
            replied = page_said("main", asked_at + 0.2, 4.0).get("answers", {}).get(answer) if answer else None
            layer = next(iter(got["layers"]), None)
            window = next(iter(got["windows"]), None)
            web: dict[str, Any] = {"drawn": got["drawn"], "page changed": got["page changed"]}
            if layer:
                web["layer"] = layer["name"]
                web["ground"] = layer["ground"]
            if window:
                web["window"] = window["kind"]
                web["colour"] = window["colour"]
            box = layer or ({"x": window["at"][0], "y": window["at"][1], "w": (window["box"][2] - window["box"][0]) / self.screen.origin()[2], "h": (window["box"][3] - window["box"][1]) / self.screen.origin()[2]} if window else None)
            if box:
                if kind == "menu":
                    web["from the click"] = [round(box["x"] - spot_css[0]), round(box["y"] - spot_css[1])]
                else:
                    web["from the middle"] = [round(box["x"] + box["w"] / 2 - width / 2), round(box["y"] + box["h"] / 2 - height / 2)]
            if answer:
                web["page heard"] = replied
            if left:
                web["left open"] = len(left)
                self.fresh_page()
            reference, ref_ok = (menu_ref, menu_ok) if kind == "menu" else (sheet_ref, sheet_ok)
            same = got["drawn"] == "orden" and layer is not None and layer["ground"] == reference.get("ground")
            if same and kind == "menu" and answer is None and reference.get("from the click") and box:
                same = anchored(box, spot_css, (width, height), reference["from the click"])
            if same and kind == "dialog" and reference.get("from the middle"):
                same = all(abs(a - b) <= 80 for a, b in zip(web.get("from the middle", [999, 999]), reference["from the middle"]))
            if answer == "camera" and got["drawn"] == "none" and isinstance(replied, list) and str(replied[0]).startswith("error NotFoundError"):
                self.row(7, f"the page's {name} is drawn by Orden like Orden's own", web, reference, None, "the runner has no camera, so nothing is asked")
                continue
            self.judged(7, f"the page's {name} is drawn by Orden like Orden's own", (web, same), (reference, ref_ok))
        self.file_picker()
        self.download()
    def file_picker(self) -> None:
        self.reset()
        self.focus_note("Firstline")
        own = self.seen(lambda: self.js("orden.invoke('plugin:dialog|open', { options: {} }).catch(() => null); return true"), 5.0)
        self.dismissed(own)
        own_kind = sorted({one["kind"] for one in own["windows"]})
        self.reset()
        self.show(self.ids["web"])
        if not self.focus_page():
            self.row(7, "the page's file picker (<input type=file>) is the one Orden opens", None, {"drawn": own["drawn"], "windows": own_kind}, None, "the page could not be given the keyboard by a click")
            return
        asked = time.monotonic()
        got = self.seen(lambda: self.keys.click(*self.in_page(265, 216)), 5.0)
        left = self.dismissed(got)
        kinds = sorted({one["kind"] for one in got["windows"]})
        web = {"drawn": got["drawn"], "windows": kinds, "page heard": page_said("main", asked + 0.2, 3.0).get("answers", {}).get("file")}
        if left:
            web["left open"] = len(left)
        self.judged(
            7,
            "the page's file picker (<input type=file>) is the one Orden opens",
            (web, got["drawn"] == own["drawn"] and kinds == own_kind),
            ({"drawn": own["drawn"], "windows": own_kind}, own["drawn"] == "system"),
        )
    def download(self) -> None:
        self.reset()
        self.show(self.ids["web"])
        if not self.focus_page():
            self.row(7, "a download asks nothing of the system and lands in Orden's list", None, None, None, "the page could not be given the keyboard by a click")
            return
        count = "orden.invoke('web_downloads').then((all) => all.length, () => -1)"
        before = self.js(count)
        got = self.seen(lambda: self.keys.click(*self.in_page(99, 384)), 4.0)
        left = self.dismissed(got)
        after = before
        until = time.monotonic() + 5
        while time.monotonic() < until and after == before:
            after = self.js(count)
            time.sleep(0.3)
        listed = isinstance(before, int) and isinstance(after, int) and after > before >= 0
        web = {"drawn": got["drawn"], "windows": sorted({one["kind"] for one in got["windows"]}), "layers": [one["name"] for one in got["layers"]], "listed by Orden": listed}
        if left:
            web["left open"] = len(left)
        self.row(7, "a download asks nothing of the system and lands in Orden's list", web, "no note counterpart: Orden keeps its own downloads list", got["drawn"] != "system" and got["drawn"] != "both" and listed)
    reader_unsure = ""
    def reader(self) -> None:
        self.reset()
        self.show(self.ids["two"])
        self.focus_note("Keyline")
        note_at = self.word_at("Lodestar")
        self.show(self.ids["web"])
        page_at = self.in_page(99, 104)
        try:
            sense = Reader(self.pid)
        except Exception as error:  # noqa: BLE001 - any failure to reach the accessibility layer is reported
            self.reader_unsure = f"the accessibility layer could not be reached: {error}"
            for check in ("the page's button is in the app window's tree", "a hit test over the page's button finds the button"):
                self.row(9, check, None, None, None, self.reader_unsure)
            return
        self.sense = sense
        found_web = sense.find("Pressable")
        self.show(self.ids["two"])
        found_note = sense.find("Lodestar words")
        self.judged(9, "the page's button is in the app window's tree", (found_web, found_web is not None), (found_note, found_note is not None))
        self.show(self.ids["web"])
        print(f"the page's button is at {[round(n) for n in page_at]} on the screen", flush=True)
        hit_web = sense.at(*page_at, "Pressable")
        self.show(self.ids["two"])
        hit_note = sense.at(*note_at, "Lodestar") if note_at else None
        self.judged(9, "a hit test over the page's button finds the button", (hit_web, "Pressable" in str(hit_web)), (hit_note, "Lodestar" in str(hit_note)))
    def sensed_focus(self, side: str) -> Any:
        sense = getattr(self, "sense", None)
        if sense is None:
            return (None, False)
        if side == "web":
            a, b = self.in_page(24, 24), self.in_page(284, 68)
        else:
            box = self.js(
                f"(() => {{ const one = [...document.querySelectorAll('.pane[data-pane={json.dumps(self.ids['right'])}] .cm-content')]"
                ".map((e) => e.getBoundingClientRect()).find((r) => r.width > 0 && r.height > 0);"
                " return one ? [one.x, one.y, one.right, one.bottom] : null })()"
            )
            if not isinstance(box, list):
                return ({"focused": None, "why": "the note's editor has no place"}, False)
            a, b = self.screen.at(box[0], box[1]), self.screen.at(box[2], box[3])
        told, rect = sense.focused()
        inside = rect is not None and a[0] - 4 <= (rect[0] + rect[2]) / 2 <= b[0] + 4 and a[1] - 4 <= (rect[1] + rect[3]) / 2 <= b[1] + 4
        return ({"focused": told, "at": [round(one) for one in rect] if rect else None, "expected in": [round(a[0]), round(a[1]), round(b[0]), round(b[1])]}, inside)
class Reader:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        if PLATFORM == "windows":
            import comtypes.client
            comtypes.client.GetModule("UIAutomationCore.dll")
            from comtypes.gen import UIAutomationClient as uia
            from probe_app import main_window
            self.uia = uia
            self.client = comtypes.client.CreateObject(uia.CUIAutomation, interface=uia.IUIAutomation)
            self.root = self.client.ElementFromHandle(main_window(pid))
        elif MAC:
            import ApplicationServices as AS
            self.AS = AS
            self.app = AS.AXUIElementCreateApplication(pid)
            said = AS.AXUIElementSetAttributeValue(self.app, "AXManualAccessibility", True)
            print(f"AXManualAccessibility asked for: {said}", flush=True)
            time.sleep(2)
        else:
            if not shutil.which("gdbus"):
                raise RuntimeError("no gdbus on this machine")
            out = self.gdbus("--session", "--dest", "org.a11y.Bus", "--object-path", "/org/a11y/bus", "--method", "org.a11y.Bus.GetAddress")
            found = re.search(r"'([^']+)'", out)
            if not found:
                raise RuntimeError(f"no AT-SPI bus: {out.strip()}")
            self.address = found.group(1)
            self.apps = self.mine()
            if not self.apps:
                raise RuntimeError(f"the app is not on the AT-SPI bus, which lists {self.listed}")
    def gdbus(self, *words: str) -> str:
        said = subprocess.run(["gdbus", "call", *words], capture_output=True, text=True, timeout=8, check=False)
        return said.stdout or said.stderr
    def call(self, ref: tuple[str, str], method: str, *args: str) -> str:
        return self.gdbus("--address", self.address, "--dest", ref[0], "--object-path", ref[1], "--method", method, *args)
    def kids(self, ref: tuple[str, str]) -> list[tuple[str, str]]:
        return re.findall(r"\('([^']+)', (?:objectpath )?'([^']+)'\)", self.call(ref, "org.a11y.atspi.Accessible.GetChildren"))
    def name(self, ref: tuple[str, str]) -> str:
        said = self.call(ref, "org.freedesktop.DBus.Properties.Get", "org.a11y.atspi.Accessible", "Name")
        found = re.search(r"<'(.*)'>", said)
        text = self.call(ref, "org.a11y.atspi.Text.GetText", "0", "-1")
        words = re.search(r"\('(.*)',\)", text)
        return ((found.group(1) if found else "") + " " + (words.group(1) if words else "")).strip()
    def mine(self) -> list[tuple[str, str]]:
        found = []
        self.listed: list[str] = []
        for ref in self.kids((("org.a11y.atspi.Registry", "/org/a11y/atspi/accessible/root"))):
            said = self.gdbus("--address", self.address, "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.GetConnectionUnixProcessID", ref[0])
            pid = re.search(r"uint32 (\d+)", said)
            self.listed.append(f"{ref[0]} {pid.group(1) if pid else said.strip()} {self.name(ref)}")
            if pid and int(pid.group(1)) in self.family():
                found.append(ref)
        return found
    def family(self) -> set[int]:
        family = {self.pid}
        try:
            listed = subprocess.run(["ps", "-e", "-o", "pid=,ppid="], capture_output=True, text=True, check=False).stdout.split()
            pairs = [(int(listed[i]), int(listed[i + 1])) for i in range(0, len(listed) - 1, 2)]
            grew = True
            while grew:
                grew = False
                for pid, parent in pairs:
                    if parent in family and pid not in family:
                        family.add(pid)
                        grew = True
        except ValueError:
            pass
        return family
    def described_uia(self, one: Any) -> str:
        if not one:
            return "nothing"
        return f"{one.CurrentControlType}:{one.CurrentName}"
    def ax(self, one: Any, name: str) -> Any:
        error, value = self.AS.AXUIElementCopyAttributeValue(one, name, None)
        return value if error == 0 else None
    def described_ax(self, one: Any) -> str:
        if one is None:
            return "nothing"
        return "|".join(str(self.ax(one, name)) for name in ("AXRole", "AXTitle", "AXDescription", "AXValue") if self.ax(one, name) not in (None, ""))
    def find(self, word: str, seconds: float = 40) -> str | None:
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if PLATFORM == "windows":
                named = self.client.CreatePropertyCondition(self.uia.UIA_NamePropertyId, word)
                one = self.root.FindFirst(self.uia.TreeScope_Descendants, named)
                if one:
                    r = one.CurrentBoundingRectangle
                    return f"{self.described_uia(one)} at {[r.left, r.top, r.right, r.bottom]}"
            elif MAC:
                stack, seen = [self.app], 0
                while stack and seen < 8000 and time.monotonic() < until:
                    one = stack.pop()
                    seen += 1
                    told = self.described_ax(one)
                    if word in told:
                        at = re.findall(r"[xywh]:(-?[\d.]+)", f"{self.ax(one, 'AXPosition')} {self.ax(one, 'AXSize')}")
                        return f"{told} at {[round(float(n)) for n in at]}"
                    stack.extend(self.ax(one, "AXChildren") or [])
            else:
                stack, seen = list(self.apps), 0
                while stack and seen < 3000 and time.monotonic() < until:
                    one = stack.pop()
                    seen += 1
                    told = self.name(one)
                    if word in told:
                        return f"{one[1]}:{told}"
                    stack.extend(self.kids(one))
            time.sleep(2)
        return None
    def at(self, x: float, y: float, word: str) -> str:
        told = "nothing"
        for _ in range(8):
            if PLATFORM == "windows":
                from ctypes import wintypes
                told = self.described_uia(self.client.ElementFromPoint(wintypes.POINT(round(x), round(y))))
            elif MAC:
                error, one = self.AS.AXUIElementCopyElementAtPosition(self.AS.AXUIElementCreateSystemWide(), x, y, None)
                told = self.described_ax(one) if error == 0 else f"error {error}"
            else:
                told = "nothing"
                for app in self.apps:
                    for ref in self.kids(app):
                        deepest = None
                        while True:
                            said = self.call(ref, "org.a11y.atspi.Component.GetAccessibleAtPoint", str(round(x)), str(round(y)), "0")
                            found = re.search(r"\('([^']+)', (?:objectpath )?'([^']+)'\)", said)
                            if not found or found.group(2).endswith("/null") or (found.group(1), found.group(2)) == ref:
                                break
                            ref = deepest = (found.group(1), found.group(2))
                        if deepest:
                            told = f"{deepest[1]}:{self.name(deepest)}"
                            break
            if word in told:
                return told
            time.sleep(1.5)
        return told
    def focused(self) -> tuple[str, tuple[float, float, float, float] | None]:
        if PLATFORM == "windows":
            one = self.client.GetFocusedElement()
            if not one:
                return "nothing", None
            r = one.CurrentBoundingRectangle
            return self.described_uia(one), (r.left, r.top, r.right, r.bottom)
        if MAC:
            one = self.ax(self.app, "AXFocusedUIElement")
            if one is None:
                return "nothing", None
            at = re.findall(r"[xywh]:(-?[\d.]+)", f"{self.ax(one, 'AXPosition')} {self.ax(one, 'AXSize')}")
            rect = (float(at[0]), float(at[1]), float(at[0]) + float(at[2]), float(at[1]) + float(at[3])) if len(at) >= 4 else None
            return self.described_ax(one), rect
        stack, seen = list(self.apps), 0
        until = time.monotonic() + 40
        while stack and seen < 3000 and time.monotonic() < until:
            one = stack.pop()
            seen += 1
            state = re.findall(r"uint32 (\d+)", self.call(one, "org.a11y.atspi.Accessible.GetState"))
            if state and int(state[0]) & (1 << 12) and one not in self.apps:
                box = [float(n) for n in re.findall(r"-?\d+", self.call(one, "org.a11y.atspi.Component.GetExtents", "0"))[:4]]
                rect = (box[0], box[1], box[0] + box[2], box[1] + box[3]) if len(box) == 4 else None
                return f"{one[1]}:{self.name(one)}", rect
            stack.extend(self.kids(one))
        return "nothing", None
def table(rows: list[dict[str, Any]]) -> str:
    lines = ["| item | check | platform | ok | web | note |", "|---|---|---|---|---|---|"]
    for one in rows:
        cell = lambda value: json.dumps(value, ensure_ascii=False).replace("|", "/")[:220]  # noqa: E731
        ok = {True: "yes", False: "NO", None: "not measured"}[one["ok"]]
        lines.append(f"| {one['item']} | {one['check']} | {one['platform']} | {ok} | {cell(one['web'])} | {cell(one['note']) if 'why' not in one else one['why']} |")
    return "\n".join(lines)
OPENBOX = """<?xml version="1.0"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
<desktops><number>1</number></desktops>
<keyboard></keyboard>
<mouse></mouse>
</openbox_config>
"""
def openbox_rc() -> pathlib.Path:
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / "openbox" / "rc.xml"
def prepared_linux() -> bool:
    if PLATFORM != "linux":
        return False
    wrote = False
    rc = openbox_rc()
    if shutil.which("openbox") and not rc.exists():
        rc.parent.mkdir(parents=True, exist_ok=True)
        rc.write_text(OPENBOX, encoding="utf-8")
        said = subprocess.run(["openbox", "--reconfigure"], capture_output=True, text=True, check=False)
        print(f"openbox without its desktop keys: {said.returncode}", flush=True)
        wrote = True
    if shutil.which("setxkbmap"):
        said = subprocess.run(["setxkbmap", "-layout", "us", "-variant", "intl"], capture_output=True, text=True, check=False)
        print(f"setxkbmap us intl: {said.returncode} {said.stderr.strip()}", flush=True)
    if shutil.which("gdbus"):
        said = subprocess.run(
            ["gdbus", "call", "--session", "--dest", "org.a11y.Bus", "--object-path", "/org/a11y/bus", "--method",
             "org.freedesktop.DBus.Properties.Set", "org.a11y.Status", "IsEnabled", "<true>"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        print(f"AT-SPI asked on: {said.returncode} {(said.stdout + said.stderr).strip()}", flush=True)
    return wrote
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if MAC:
        info = plistlib.loads((args.exe.parent.parent / "Info.plist").read_bytes())
        if info.get("CFBundleShortVersionString") != "99.0.0":
            raise SystemExit(f"{args.exe} is not a probe build: it would fetch the real update")
    elif PLATFORM == "windows":
        from probe_app import refuse_updating
        refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)
    wrote_rc = prepared_linux()
    refuser = importlib.import_module("web-under-mac-drive").Refuser() if MAC else None
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/keys"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-keys-spaces-"))
    said = open(args.out / "app.log", "wb")
    reading = {"ACCESSIBILITY_ENABLED": "1"} if PLATFORM == "linux" else {}
    process = subprocess.Popen([str(args.exe)], env={**os.environ, **reading, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    rows: list[dict[str, Any]] = []
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
        drive = Drive(app, process.pid, url, args.out)
        drive.build()
        forward(app, process.pid)
        drive.reader()
        drive.shortcuts()
        drive.focus_moves()
        drive.web_return()
        drive.bar_popups()
        drive.dead_keys()
        drive.menu_regressions()
        drive.page_ui()
        rows = drive.rows
        drive.screen.shot().save(args.out / "end.png")
    finally:
        if refuser is not None:
            refuser.stop()
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        if wrote_rc:
            openbox_rc().unlink(missing_ok=True)
            subprocess.run(["openbox", "--reconfigure"], capture_output=True, check=False)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(table(rows), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"\n### Keys, {PLATFORM}\n\n{table(rows)}\n")
    wrong = [one for one in rows if one["ok"] is False]
    for one in wrong:
        print(f"::error::[{one['item']}] {one['check']}", flush=True)
    print(f"{len(wrong)} not ok, {sum(1 for one in rows if one['ok'] is None)} not measured, {len(rows)} checks", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
