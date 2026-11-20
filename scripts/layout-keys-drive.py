from __future__ import annotations
import argparse
import ctypes
import http.server
import importlib
import json
import os
import pathlib
import plistlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

pk = importlib.import_module("parity-keys-drive")
PLATFORM, MAC = pk.PLATFORM, pk.MAC
PLACES = {"E": (26, 0x12, 14), "F": (41, 0x21, 3), "T": (28, 0x14, 17), "Y": (29, 0x15, 16), "K": (45, 0x25, 40)}
LAYOUTS = {
    "qwerty": {"f": "F", "t": "T", "x": ["-layout", "us"], "win": "00000409", "mac": "com.apple.keylayout.US"},
    "colemak": {"f": "E", "t": "F", "x": ["-layout", "us", "-variant", "colemak"], "mac": "com.apple.keylayout.Colemak"},
    "dvorak": {"f": "Y", "t": "K", "x": ["-layout", "us", "-variant", "dvorak"], "win": "00010409", "mac": "com.apple.keylayout.Dvorak"},
    "colemak-second": {"f": "E", "t": "F", "x": ["-layout", "us,us", "-variant", ",colemak", "-option", "grp:alt_shift_toggle"], "second": True},
    "ru": {"f": "F", "x": ["-layout", "ru,us"], "win": "00000419", "mac": "com.apple.keylayout.Russian"},
}
PICK = """import Carbon
let id = CommandLine.arguments[1]
let found = TISCreateInputSourceList([kTISPropertyInputSourceID as String: id] as CFDictionary, true).takeRetainedValue() as! [TISInputSource]
guard let one = found.first else { print("missing"); exit(1) }
TISEnableInputSource(one)
TISSelectInputSource(one)
Thread.sleep(forTimeInterval: 0.5)
let now = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
let named = Unmanaged<CFString>.fromOpaque(TISGetInputSourceProperty(now, kTISPropertyInputSourceID)).takeUnretainedValue() as String
print(named)
"""
FINDS = "[...document.querySelectorAll('.findbar')].filter((one) => one.getBoundingClientRect().width > 0).length"
HEARD_KEYS = "(() => { if (!window.__heard) { window.__heard = []; addEventListener('keydown', (e) => window.__heard.push([e.key, e.code, String(e.target?.className || e.target?.tagName || '').slice(0, 40), null]), true); addEventListener('keydown', (e) => { const last = window.__heard.at(-1); if (last) last[3] = e.defaultPrevented }) } window.__heard.length = 0; return true })()"
KNOWN = "known, not judged: on macOS a web page's Cmd+F opens no find bar on any layout, QWERTY too"
def chosen(layout: str) -> tuple[str, Any]:
    names = {"latin": ["colemak", "dvorak"], "second": ["colemak-second"]}.get(layout, [layout])
    if PLATFORM == "windows":
        names = [one for one in names if "win" in LAYOUTS[one]]
    for name in names:
        one = LAYOUTS[name]
        if PLATFORM == "linux":
            said = subprocess.run(["setxkbmap", *one["x"]], capture_output=True, text=True, check=False)
            print(f"setxkbmap {' '.join(one['x'])}: {said.returncode} {said.stderr.strip()}", flush=True)
            if said.returncode == 0 and one.get("second"):
                keys = pk.Input()
                alt, shift = keys.code_of("Alt"), keys.code_of("Shift")
                for kind, code in ((keys.X.KeyPress, alt), (keys.X.KeyPress, shift), (keys.X.KeyRelease, shift), (keys.X.KeyRelease, alt)):
                    keys.xtest.fake_input(keys.display, kind, code)
                    keys.display.sync()
                    time.sleep(0.05)
                print("the second layout group locked with Alt+Shift", flush=True)
            if said.returncode == 0:
                return name, None
        elif MAC:
            script = pathlib.Path(tempfile.mkdtemp(prefix="orden-layout-")) / "pick.swift"
            script.write_text(PICK, encoding="utf-8")
            said = subprocess.run(["swift", str(script), one["mac"]], capture_output=True, text=True, check=False, timeout=240)
            print(f"input source {one['mac']}: {said.returncode} {said.stdout.strip()} {said.stderr.strip()[-300:]}", flush=True)
            if said.returncode == 0 and said.stdout.strip().endswith(one["mac"]):
                return name, None
        else:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            user32.LoadKeyboardLayoutW.restype = ctypes.c_void_p
            hkl = user32.LoadKeyboardLayoutW(one["win"], 0x1)
            held = ctypes.c_void_p(hkl)
            user32.SystemParametersInfoW(0x5A, 0, ctypes.byref(held), 0x2)
            print(f"keyboard layout {one['win']}: {hkl}", flush=True)
            if hkl:
                return name, hkl
    raise SystemExit(f"no {layout} layout could be chosen on {PLATFORM}")
class Places:
    def __init__(self, keys: Any) -> None:
        self.keys = keys
    def scan(self, code: int, down: bool) -> None:
        one = self.keys.INPUT(type=1)
        one.u.ki = self.keys.KEYBDINPUT(wVk=0, wScan=code, dwFlags=0x8 | (0 if down else 0x2), time=0, dwExtraInfo=0)
        self.keys.send(one)
        time.sleep(0.03)
    def press(self, place: str, mod: bool) -> None:
        x, win, mac = PLACES[place]
        if PLATFORM == "windows":
            if mod:
                self.scan(0x1D, True)
            self.scan(win, True)
            self.scan(win, False)
            if mod:
                self.scan(0x1D, False)
        elif MAC:
            Q = self.keys.Q
            flags = Q.kCGEventFlagMaskCommand if mod else 0
            def post(code: int, down: bool, flags: int, changed: bool = False) -> None:
                event = Q.CGEventCreateKeyboardEvent(None, code, down)
                if changed:
                    Q.CGEventSetType(event, Q.kCGEventFlagsChanged)
                Q.CGEventSetFlags(event, flags)
                Q.CGEventPost(Q.kCGHIDEventTap, event)
                time.sleep(0.03)
            if mod:
                post(55, True, flags, True)
            post(mac, True, flags)
            post(mac, False, flags)
            if mod:
                post(55, False, 0, True)
        else:
            X, xtest, display = self.keys.X, self.keys.xtest, self.keys.display
            ctrl = self.keys.code_of("Ctrl")
            for kind, code in ([(X.KeyPress, ctrl)] if mod else []) + [(X.KeyPress, x), (X.KeyRelease, x)] + ([(X.KeyRelease, ctrl)] if mod else []):
                xtest.fake_input(display, kind, code)
                display.sync()
                time.sleep(0.03)
        time.sleep(0.4)
class Check:
    def __init__(self, drive: Any, layout: str) -> None:
        self.drive, self.layout = drive, layout
        self.places = Places(drive.keys)
        self.rows: list[dict[str, Any]] = []
    def row(self, check: str, side: str, said: Any, ok: bool | None, why: str = "") -> None:
        one = {"check": check, "platform": PLATFORM, "layout": self.layout, "side": side, "said": said, "ok": ok}
        if why:
            one["why"] = why
        self.rows.append(one)
        print(f"[{self.layout} {side}] {check}: ok {ok}; {json.dumps(said)[:500]}{'; ' + why if why else ''}", flush=True)
    def staged(self, side: str) -> bool:
        self.drive.reset()
        for _ in range(2):
            if self.drive.js(f"{FINDS}") in (0, None):
                break
            self.drive.keys.chord("Escape")
            time.sleep(0.4)
        if side == "web":
            self.drive.show(self.drive.ids["web"])
            return self.drive.focus_page()
        self.drive.show(self.drive.ids["two"])
        return self.drive.focus_note("Keyline")
    def wrote(self, side: str, place: str) -> Any:
        if side == "web":
            asked = time.monotonic()
            self.places.press(place, False)
            said = pk.page_said("main", asked + 0.3)
            return [one[1] for one in said.get("log", []) if one[0] == "keydown"][-1:]
        self.drive.js(HEARD_KEYS)
        self.places.press(place, False)
        return self.drive.js("window.__heard.map((one) => one[0])")
    def state(self) -> dict[str, Any]:
        said = self.drive.js(f"({{ tabs: orden.workspace.tabs.length, finds: {FINDS}, active: orden.workspace.activeTabId }})")
        return said if isinstance(said, dict) else {}
    def shortcut(self, side: str, letter: str, place: str) -> None:
        name = f"{'Cmd' if MAC else 'Ctrl'} with the key that writes {letter.upper()} ({place} on QWERTY)"
        if not self.staged(side):
            self.row(name, side, None, None, f"the {side} side could not be given the keyboard by a click")
            return
        self.drive.js(HEARD_KEYS)
        before = self.state()
        self.places.press(place, True)
        time.sleep(1.2)
        after = self.state()
        heard = self.drive.js("window.__heard.filter((one) => !['Control', 'Meta'].includes(one[0]))")
        tabs = (after.get("tabs") or 0) - (before.get("tabs") or 0)
        finds = (after.get("finds") or 0) - (before.get("finds") or 0)
        ok = finds > 0 and tabs == 0 if letter == "f" else tabs == 1 and finds <= 0
        said = {"new tabs": tabs, "find bars opened": finds, "keydown in the app (key, code, target, prevented)": heard, "before": before, "after": after}
        if not ok and MAC and side == "web" and letter == "f" and tabs == 0 and finds == 0:
            self.row(name, side, said, None, KNOWN)
            return
        self.row(name, side, said, ok)
    def run(self, name: str) -> None:
        one = LAYOUTS[name]
        for side in ("note", "web"):
            if self.staged(side):
                self.row("the layout writes its own letter on the key", side, {"F place": self.wrote(side, "F"), "f place": self.wrote(side, one["f"])}, None, "a record of which letters the layout gives, not judged")
            for letter in ("f", "t"):
                if letter in one:
                    self.shortcut(side, letter, one[letter])
        self.drive.reset()
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--layout", choices=["qwerty", "latin", "second", "ru"], default="latin")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    wrote_rc = pk.prepared_linux()
    name, hkl = chosen(args.layout)
    refuser = importlib.import_module("web-under-mac-drive").Refuser() if MAC else None
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), pk.Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/keys"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-layout-spaces-"))
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
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
            user32.PostMessageW(hwnd, 0x50, 0, ctypes.c_void_p(hkl))
        forward(app, process.pid)
        time.sleep(22)
        app.eval("document.querySelector('.orden-screen.sheet[role=\"dialog\"] button[data-lands]')?.click(); return true")
        drive = pk.Drive(app, process.pid, url, args.out)
        drive.build()
        forward(app, process.pid)
        if PLATFORM == "windows":
            user32.PostMessageW(hwnd, 0x50, 0, ctypes.c_void_p(hkl))
            time.sleep(0.5)
        check = Check(drive, name)
        check.run(name)
        rows = check.rows
        drive.screen.shot().save(args.out / "end.png")
    finally:
        if refuser is not None:
            refuser.stop()
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        if wrote_rc:
            pk.openbox_rc().unlink(missing_ok=True)
            subprocess.run(["openbox", "--reconfigure"], capture_output=True, check=False)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    lines = ["| layout | side | check | platform | ok | said |", "|---|---|---|---|---|---|"]
    lines += [f"| {one['layout']} | {one['side']} | {one['check']} | {one['platform']} | {'n/a' if one['ok'] is None else 'yes' if one['ok'] else 'NO'} | {json.dumps(one['said'], ensure_ascii=False)[:300]} |" for one in rows]
    print("\n".join(lines), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"\n### Layout keys, {name}, {PLATFORM}\n\n" + "\n".join(lines) + "\n")
    wrong = [one for one in rows if one["ok"] is False]
    for one in wrong:
        print(f"::error::[{one['layout']} {one['side']}] {one['check']}", flush=True)
    judged = [one for one in rows if one["ok"] is not None]
    if not judged:
        print("::error::no shortcut could be judged", flush=True)
        return 1
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
