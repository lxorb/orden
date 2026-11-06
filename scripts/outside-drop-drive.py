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
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable

WIDTH, HEIGHT = 1100, 720
SETTLE = 25.0

def a_pdf(words: str) -> bytes:
    stream = f"BT /F1 24 Tf 72 700 Td ({words}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    starts = []
    for number, body in enumerate(objects, 1):
        starts.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    table = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for start in starts:
        out += b"%010d 00000 n \n" % start
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, table)
    return bytes(out)

def config_of(identifier: str) -> pathlib.Path:
    if sys.platform == "win32":
        return pathlib.Path(os.environ["APPDATA"]) / identifier
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 20) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                answer = json.loads(said.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            return {"error": f"{error.code} {error.read().decode('utf-8', 'replace')[:300]}"}
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}
        return answer.get("value") if answer.get("ok") else {"error": answer}

def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

def waited(check: Callable[[], bool], seconds: float = SETTLE) -> bool:
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if check():
            return True
        time.sleep(0.5)
    return False

class Windows:
    def __init__(self, pid: int) -> None:
        import ctypes
        from ctypes import wintypes

        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        from probe_app import main_window

        self.ctypes, self.wintypes = ctypes, wintypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        self.hwnd = 0
        until = time.monotonic() + 60
        while not self.hwnd and time.monotonic() < until:
            self.hwnd = main_window(pid)
            time.sleep(0.25)
        if not self.hwnd:
            raise SystemExit("the app showed no window")
        self.user32.ShowWindow(self.hwnd, 9)
        wide = self.user32.GetSystemMetrics(0)
        high = self.user32.GetSystemMetrics(1)
        self.user32.SetWindowPos(self.hwnd, None, 0, 0, min(WIDTH, wide - 160), min(HEIGHT, high - 80), 0x0004)

    def origin(self, app: App) -> tuple[float, float, float]:
        ctypes, wintypes = self.ctypes, self.wintypes
        at = wintypes.POINT(0, 0)
        self.user32.ClientToScreen(self.hwnd, ctypes.byref(at))
        scale = float(app.eval("devicePixelRatio") or 1)
        return at.x, at.y, scale

    def away(self) -> tuple[int, int]:
        width = self.user32.GetSystemMetrics(0)
        height = self.user32.GetSystemMetrics(1)
        return width - 40, height // 2

    def drop(self, path: pathlib.Path, start: tuple[int, int], end: tuple[int, int]) -> str:
        from comtypes import COMMETHOD, COMObject, GUID, HRESULT, IUnknown

        ctypes, wintypes = self.ctypes, self.wintypes
        ole32 = ctypes.WinDLL("ole32")
        shell32 = ctypes.WinDLL("shell32")
        ole32.OleInitialize(None)

        class IDropSource(IUnknown):
            _iid_ = GUID("{00000121-0000-0000-C000-000000000046}")
            _methods_ = [
                COMMETHOD([], HRESULT, "QueryContinueDrag", (["in"], wintypes.BOOL, "escape"), (["in"], wintypes.DWORD, "keys")),
                COMMETHOD([], HRESULT, "GiveFeedback", (["in"], wintypes.DWORD, "effect")),
            ]

        class IShellItem(IUnknown):
            _iid_ = GUID("{43826d1e-e718-42ee-bc55-a1e261c37bfe}")
            _methods_ = [
                COMMETHOD(
                    [],
                    HRESULT,
                    "BindToHandler",
                    (["in"], ctypes.c_void_p, "context"),
                    (["in"], ctypes.POINTER(GUID), "handler"),
                    (["in"], ctypes.POINTER(GUID), "wanted"),
                    (["out"], ctypes.POINTER(ctypes.c_void_p), "made"),
                ),
            ]

        let_go = threading.Event()
        over = threading.Event()

        class Source(COMObject):
            _com_interfaces_ = [IDropSource]

            def QueryContinueDrag(self, this: Any, escape: int, keys: int) -> int:  # noqa: N802 - the interface's name
                if escape:
                    return 0x00040101
                return 0x00040100 if let_go.is_set() else 0

            def GiveFeedback(self, this: Any, effect: int) -> int:  # noqa: N802 - the interface's name
                return 0x00040102

        item = ctypes.POINTER(IShellItem)()
        shell32.SHCreateItemFromParsingName(
            ctypes.c_wchar_p(str(path)), None, ctypes.byref(IShellItem._iid_), ctypes.byref(item)
        )
        data = item.BindToHandler(None, GUID("{B8C0BD9F-ED24-455c-83E6-D5390C4FE8C4}"), GUID("{0000010e-0000-0000-C000-000000000046}"))
        source = Source().QueryInterface(IDropSource)

        user32 = self.user32
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.CreateWindowExW.argtypes = [
            wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
        ]
        holder = user32.CreateWindowExW(
            0x00000008 | 0x00000080, "STATIC", "a file", 0x80000000 | 0x10000000,
            start[0] - 30, start[1] - 30, 60, 60, None, None, None, None,
        )
        message = wintypes.MSG()
        shown = time.monotonic() + 1
        while time.monotonic() < shown:
            while user32.PeekMessageW(ctypes.byref(message), None, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
            time.sleep(0.02)
        pressed = threading.Event()

        def moved() -> None:
            user32.SetCursorPos(*start)
            time.sleep(0.2)
            user32.mouse_event(0x0002, 0, 0, 0, 0)
            pressed.set()
            time.sleep(0.6)
            steps = 30
            for step in range(1, steps + 1):
                x = round(start[0] + (end[0] - start[0]) * step / steps)
                y = round(start[1] + (end[1] - start[1]) * step / steps)
                user32.SetCursorPos(x, y)
                time.sleep(0.04)
            for turn in range(16):
                user32.SetCursorPos(end[0] + turn % 2, end[1])
                time.sleep(0.1)
            let_go.set()
            until = time.monotonic() + 30
            while not over.is_set() and time.monotonic() < until:
                user32.SetCursorPos(end[0], end[1] + 1)
                time.sleep(0.05)
                user32.SetCursorPos(end[0], end[1])
                time.sleep(0.05)
            if not over.is_set():
                user32.keybd_event(0x1B, 0, 0, 0)
                time.sleep(0.05)
                user32.keybd_event(0x1B, 0, 0x2, 0)
            user32.mouse_event(0x0004, 0, 0, 0, 0)

        mover = threading.Thread(target=moved, daemon=True)
        mover.start()
        pressed.wait(10)
        effect = wintypes.DWORD(0)
        said = ole32.DoDragDrop(ctypes.c_void_p(data), source, wintypes.DWORD(7), ctypes.byref(effect))
        over.set()
        mover.join(40)
        user32.DestroyWindow(holder)
        return f"DoDragDrop {said & 0xFFFFFFFF:#x}, effect {effect.value}"

class X11:
    def __init__(self, pid: int) -> None:
        from Xlib import X, display

        self.X = X
        self.display = display.Display()
        self.root = self.display.screen().root
        self.pid = pid
        self.atoms = {
            name: self.display.intern_atom(name)
            for name in [
                "XdndAware", "XdndProxy", "XdndEnter", "XdndPosition", "XdndStatus", "XdndLeave",
                "XdndDrop", "XdndFinished", "XdndSelection", "XdndActionCopy", "text/uri-list",
                "TARGETS", "_NET_WM_PID", "NIB_TIME",
            ]
        }
        self.top = None
        until = time.monotonic() + 60
        while self.top is None and time.monotonic() < until:
            self.top = self.owned()
            time.sleep(0.5)
        if self.top is None:
            raise SystemExit("the app showed no X window")

    def owned(self) -> Any:
        for one in self.root.query_tree().children:
            said = one.get_full_property(self.atoms["_NET_WM_PID"], 0)
            if said and said.value and int(said.value[0]) == self.pid and one.get_attributes().map_state == self.X.IsViewable:
                return one
        return None

    def page(self) -> Any:
        best, area = self.top, 0
        stack = [self.top]
        while stack:
            one = stack.pop()
            try:
                kids = one.query_tree().children
            except Exception:
                continue
            for kid in kids:
                try:
                    shape = kid.get_geometry()
                    if kid.get_attributes().map_state != self.X.IsViewable:
                        continue
                except Exception:
                    continue
                if shape.width * shape.height > area:
                    best, area = kid, shape.width * shape.height
                stack.append(kid)
        return best

    def origin(self, app: App) -> tuple[float, float, float]:
        page = self.page()
        at = self.root.translate_coords(page, 0, 0)
        scale = float(app.eval("devicePixelRatio") or 1)
        return at.x, at.y, scale

    def corner(self) -> tuple[int, int]:
        shape = self.root.get_geometry()
        return shape.width - 20, shape.height - 20

    def away(self) -> tuple[int, int]:
        return self.corner()

    def target_at(self, x: int, y: int) -> Any:
        aware = self.atoms["XdndAware"]
        for one in reversed(self.root.query_tree().children):
            try:
                if one.get_attributes().map_state != self.X.IsViewable:
                    continue
                shape = one.get_geometry()
            except Exception:
                continue
            if not (shape.x <= x < shape.x + shape.width and shape.y <= y < shape.y + shape.height):
                continue
            window = one
            while window is not None:
                proxy = window.get_full_property(self.atoms["XdndProxy"], 0)
                if proxy and proxy.value:
                    return self.display.create_resource_object("window", int(proxy.value[0]))
                if window.get_full_property(aware, 0):
                    return window
                inner = window.translate_coords(self.root, x, y)
                window = inner.child if inner.child else None
            return None
        return None

    def drop(self, path: pathlib.Path, start: tuple[int, int], end: tuple[int, int]) -> str:
        from Xlib import Xatom
        from Xlib.ext import xtest
        from Xlib.protocol import event

        X, atoms, display = self.X, self.atoms, self.display
        source = self.root.create_window(-10, -10, 1, 1, 0, X.CopyFromParent, X.InputOutput, event_mask=X.PropertyChangeMask)
        source.change_property(atoms["NIB_TIME"], Xatom.STRING, 8, b"now")
        display.flush()
        stamp = X.CurrentTime
        until = time.monotonic() + 3
        while time.monotonic() < until:
            if display.pending_events():
                seen = display.next_event()
                if seen.type == X.PropertyNotify:
                    stamp = seen.time
                    break
            else:
                time.sleep(0.02)
        source.set_selection_owner(atoms["XdndSelection"], stamp)
        uri = pathlib.Path(path).resolve().as_uri().encode() + b"\r\n"

        def told(window: Any, kind: str, data: list[int]) -> None:
            message = event.ClientMessage(window=window, client_type=atoms[kind], data=(32, (data + [0] * 5)[:5]))
            window.send_event(message, event_mask=X.NoEventMask, propagate=False)
            display.flush()

        log: list[str] = []
        state = {"accepted": False, "finished": False}

        def heard(seconds: float) -> None:
            until = time.monotonic() + seconds
            while time.monotonic() < until and not state["finished"]:
                if not display.pending_events():
                    time.sleep(0.02)
                    continue
                seen = display.next_event()
                if seen.type == X.ClientMessage and seen.client_type == atoms["XdndStatus"]:
                    state["accepted"] = bool(seen.data[1][1] & 1)
                elif seen.type == X.ClientMessage and seen.client_type == atoms["XdndFinished"]:
                    state["finished"] = True
                elif seen.type == X.SelectionRequest:
                    into = seen.property or seen.target
                    if seen.target == atoms["text/uri-list"]:
                        seen.requestor.change_property(into, atoms["text/uri-list"], 8, uri)
                    elif seen.target == atoms["TARGETS"]:
                        seen.requestor.change_property(into, Xatom.ATOM, 32, [atoms["TARGETS"], atoms["text/uri-list"]])
                    else:
                        into = X.NONE
                    log.append(f"asked for {display.get_atom_name(seen.target)}")
                    answer = event.SelectionNotify(
                        time=seen.time, requestor=seen.requestor, selection=seen.selection, target=seen.target, property=into
                    )
                    seen.requestor.send_event(answer, event_mask=X.NoEventMask, propagate=False)
                    display.flush()

        target = self.target_at(*end)
        if target is None:
            return "no XdndAware window under the drop"
        log.append(f"target {target.id:#x}")
        xtest.fake_input(display, X.MotionNotify, x=start[0], y=start[1])
        display.flush()
        told(target, "XdndEnter", [source.id, 5 << 24, atoms["text/uri-list"], 0, 0])
        steps = 20
        for step in range(1, steps + 1):
            x = round(start[0] + (end[0] - start[0]) * step / steps)
            y = round(start[1] + (end[1] - start[1]) * step / steps)
            xtest.fake_input(display, X.MotionNotify, x=x, y=y)
            told(target, "XdndPosition", [source.id, 0, (x << 16) | y, stamp, atoms["XdndActionCopy"]])
            heard(0.05)
        for turn in range(10):
            told(target, "XdndPosition", [source.id, 0, ((end[0] + turn % 2) << 16) | end[1], stamp, atoms["XdndActionCopy"]])
            heard(0.15)
        log.append(f"accepted {state['accepted']}")
        if not state["accepted"]:
            told(target, "XdndLeave", [source.id])
            source.destroy()
            display.flush()
            return "; ".join(log)
        told(target, "XdndDrop", [source.id, 0, stamp])
        heard(10)
        log.append(f"finished {state['finished']}")
        source.destroy()
        display.flush()
        return "; ".join(log)

class Mac:
    HELPER = r"""
import sys
from AppKit import (NSApplication, NSApp, NSWindow, NSView, NSColor, NSBackingStoreBuffered, NSDraggingItem,
    NSApplicationActivationPolicyRegular, NSFloatingWindowLevel, NSDragOperationCopy)
from Foundation import NSURL, NSMakeRect, NSObject
import objc

path, x, y = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])

class Holder(NSView):
    def drawRect_(self, rect):
        NSColor.orangeColor().set()
        from AppKit import NSRectFill
        NSRectFill(rect)

    def mouseDown_(self, event):
        item = NSDraggingItem.alloc().initWithPasteboardWriter_(NSURL.fileURLWithPath_(path))
        item.setDraggingFrame_contents_(self.bounds(), None)
        self.beginDraggingSessionWithItems_event_source_([item], event, self)

    def draggingSession_sourceOperationMaskForDraggingContext_(self, session, context):
        return NSDragOperationCopy

    def acceptsFirstMouse_(self, event):
        return True

app = NSApplication.sharedApplication()
app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(NSMakeRect(x, y, 80, 80), 0, NSBackingStoreBuffered, False)
window.setLevel_(NSFloatingWindowLevel)
window.setContentView_(Holder.alloc().initWithFrame_(NSMakeRect(0, 0, 80, 80)))
window.makeKeyAndOrderFront_(None)
app.activateIgnoringOtherApps_(True)
print("ready", flush=True)
app.run()
"""

    def __init__(self, pid: int) -> None:
        import Quartz
        from AppKit import NSScreen

        self.Quartz = Quartz
        self.screen = NSScreen.mainScreen().frame()
        self.helper: subprocess.Popen[str] | None = None

    def origin(self, app: App) -> tuple[float, float, float]:
        inner = app.eval(
            "const i = window.__TAURI_INTERNALS__;"
            "const at = await i.invoke('plugin:window|inner_position', { label: 'main' });"
            "const scale = await i.invoke('plugin:window|scale_factor', { label: 'main' });"
            "return { x: at.x / scale, y: at.y / scale }"
        )
        if not isinstance(inner, dict) or "x" not in inner:
            raise SystemExit(f"where the window is was not said: {inner}")
        return inner["x"], inner["y"], 1.0

    def away(self) -> tuple[int, int]:
        return int(self.screen.size.width) - 60, int(self.screen.size.height) // 2

    def post(self, kind: int, at: tuple[float, float]) -> None:
        Quartz = self.Quartz
        made = Quartz.CGEventCreateMouseEvent(None, kind, at, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, made)

    def drop(self, path: pathlib.Path, start: tuple[int, int], end: tuple[int, int]) -> str:
        Quartz = self.Quartz
        flipped_y = self.screen.size.height - start[1] - 40
        helper = subprocess.Popen(
            [sys.executable, "-c", self.HELPER, str(path), str(start[0] - 40), str(flipped_y)],
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            assert helper.stdout is not None
            helper.stdout.readline()
            time.sleep(1.5)
            self.post(Quartz.kCGEventMouseMoved, start)
            time.sleep(0.3)
            self.post(Quartz.kCGEventLeftMouseDown, start)
            time.sleep(0.3)
            steps = 30
            for step in range(1, steps + 1):
                at = (start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps)
                self.post(Quartz.kCGEventLeftMouseDragged, at)
                time.sleep(0.04)
            for turn in range(12):
                self.post(Quartz.kCGEventLeftMouseDragged, (end[0] + turn % 2, end[1]))
                time.sleep(0.1)
            self.post(Quartz.kCGEventLeftMouseUp, end)
            time.sleep(1.5)
        finally:
            helper.kill()
            helper.wait(10)
        return "dragged from a window of another app"

def screen_of(pid: int) -> Any:
    if sys.platform == "win32":
        return Windows(pid)
    if sys.platform == "darwin":
        return Mac(pid)
    return X11(pid)

WATCH = (
    "window.__outside = [];"
    "for (const type of ['dragenter', 'dragover', 'drop', 'dragleave']) window.addEventListener(type, (event) => {"
    " const last = window.__outside.at(-1);"
    " const said = type + (event.isTrusted ? '' : ' (made)') + ' ' + [...(event.dataTransfer?.types ?? [])].join(',');"
    " if (last !== said) window.__outside.push(said) }, true);"
    "return true"
)

LISTED_PDFS = (
    "const found = [];"
    "const walk = (one) => { if (!one) return;"
    " if (!one.is_dir && /\\.pdf$/i.test(one.name)) found.push(one.name);"
    " for (const child of one.children ?? []) walk(child) };"
    "walk(nib.workspace.tree);"
    "return found"
)

BOX = (
    "const one = document.querySelector({selector});"
    "if (!one) return null;"
    "const box = one.getBoundingClientRect();"
    "return box.width > 4 && box.height > 4 ? {{ x: box.x + box.width * {along}, y: box.y + box.height / 2,"
    " under: document.elementFromPoint(box.x + box.width * {along}, box.y + box.height / 2)?.className?.toString().slice(0, 80) }} : null"
)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    config = config_of(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-outside-spaces-"))
    outside = pathlib.Path(tempfile.mkdtemp(prefix="nib-outside-files-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "NIB_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        if not waited(lambda: app.eval("!!nib.workspace") is True, 90):
            raise SystemExit("the workspace never came up")
        made = app.eval(
            "if (!nib.workspace.spaces.length) await nib.workspace.addSpace('Dropped');"
            "return nib.workspace.activeSpace ? nib.workspace.activeSpace.root : null",
            60,
        )
        if not isinstance(made, str):
            raise SystemExit(f"no space: {made}")
        root = pathlib.Path(made)
        print(f"space at {root}", flush=True)
        app.eval("nib.workspace.openBlank('Here', '# Here\\n\\nSome words.'); return true")
        print(f"tabs: {app.eval('return nib.workspace.tabs.map((one) => one.kind)')}", flush=True)
        screen = screen_of(process.pid)
        time.sleep(3)
        app.eval(WATCH)

        def pdfs_in_space() -> list[str]:
            said = app.eval(LISTED_PDFS)
            return sorted(said) if isinstance(said, list) else [f"the space's list could not be read: {said}"]

        def pages_tabs() -> int:
            said = app.eval("return nib.workspace.tabs.filter((one) => one.kind === 'pages').length")
            return said if isinstance(said, int) else -1

        def dropped(name: str, selector: str, along: float = 0.5) -> tuple[str, str]:
            path = outside / f"{name}.pdf"
            path.write_bytes(a_pdf(f"Dropped on the {name}"))
            box = app.eval(BOX.format(selector=json.dumps(selector), along=along))
            if not isinstance(box, dict):
                return "", f"{name}: there is no {selector} to drop on: {box}"
            left, top, scale = screen.origin(app)
            end = (round(left + box["x"] * scale), round(top + box["y"] * scale))
            app.eval("window.__outside = []; return true")
            how = screen.drop(path, screen.away(), end)
            seen = app.eval("return window.__outside")
            print(f"{name}: at {end} over {box.get('under')!r}: {how}; the page saw {seen}", flush=True)
            return path.name, ""

        before = pages_tabs()
        name, why = dropped("note", "[data-pane] .cm-content")
        if why:
            wrong.append(why)
        elif not waited(lambda: pages_tabs() > before):
            wrong.append(f"a PDF dropped on a note opened no page note ({pages_tabs()} page tabs, {before} before)")
        elif pdfs_in_space():
            wrong.append(f"a PDF dropped on a note was put in the space: {pdfs_in_space()}")
        else:
            print("note: the PDF opened as a page note and the space is untouched", flush=True)

        before = pages_tabs()
        name, why = dropped("strip", ".tabs", 0.92)
        if why:
            print(f"::notice::{why}", flush=True)
        elif not waited(lambda: pages_tabs() > before):
            wrong.append(f"a PDF dropped on the tab strip opened no page note ({pages_tabs()} page tabs, {before} before)")
        else:
            print("strip: the PDF opened as a page note", flush=True)

        name, why = dropped("list", "[data-space-rest]")
        if why:
            wrong.append(why)
        elif not waited(lambda: any(one.startswith(name.removesuffix(".pdf")) for one in pdfs_in_space())):
            wrong.append(f"a PDF dropped on the file list did not land in the space: {pdfs_in_space()}")
        else:
            print(f"list: the PDF landed in the space: {pdfs_in_space()}", flush=True)
    finally:
        process.kill()
        process.wait(20)
        shutil.rmtree(spaces, ignore_errors=True)
        shutil.rmtree(outside, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
