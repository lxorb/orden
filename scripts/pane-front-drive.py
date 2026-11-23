"""Does the pane show the tab in front, on the screen? Windows and Linux.

#2416. One pane holds two notes, a terminal that keeps printing and renaming itself, and two
web tabs. The terminal paints its rows magenta and each page is one flat colour, so one pixel
in the middle of the pane says which of them the screen shows; a note is none of those colours.

Tabs are switched many times in a seeded order: told through the app, pressed on the tab strip
after resting on the tab for a while or with the pointer slipping during the press, by
Ctrl+Tab, and through the overview, opened by two taps of Alt and left by a window, by Escape
or by two more taps, with a press on a tab right behind it. After each switch the drive waits for three things to agree with the tab the
workspace says is in front: the tab the strip marks, the surfaces the pane has not hidden, and
the colour on the screen. It fails when they do not agree within the time a switch may take,
and says what the pane held. It also fails when the app's own watch wrote to its log that a
pane showed another tab than the one in front.

A press that leaves another tab in front, with the strip, the pane and the screen all on that
tab, is not this failure: it is told as known, with the tabs the workspace had in front right
after the press.

    python scripts/pane-front-drive.py --exe <probe orden> --identifier <probe id> [--switches N] [--seed N]
"""
from __future__ import annotations
import argparse
import ctypes
import http.server
import importlib
import json
import os
import pathlib
import random
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh  # noqa: E402
from native_app import INNER, App, config_of, endpoint, forward, known  # noqa: E402

switch = importlib.import_module("web-switch-drive")
PAGES = ("red", "green")
TERMINAL = (255, 0, 255)
ARRIVES = 2.5
TOLD = "pane shows another tab than the one in front"
STAYS = 0.4
LOOK = """
const ws = orden.workspace
const pane = ws.panes.focused
const node = document.querySelector(`[data-pane="${pane.id}"]`)
const card = node ? node.querySelector(':scope > .card') : null
const kinds = { terminal: '.terminal', web: '.web', note: '.editor[data-region="editor"]' }
const shown = card
  ? Object.entries(kinds).filter(([, mark]) => [...card.querySelectorAll(mark)].some((one) => one.checkVisibility())).map(([kind]) => kind)
  : []
const held = card
  ? [...card.children].filter((one) => one.matches('.front, .editor, .kept')).map((one) => `${one.className.replace(/svelte-\\S+/g, '').trim()}${one.hidden ? ' hidden' : ''}:${one.querySelector('.terminal') ? 'terminal' : one.querySelector('.web') ? 'web' : one.querySelector('.cm-content') ? 'note' : 'empty'}`)
  : []
const strip = document.querySelector(`[data-strip="${pane.id}"] .tab.active .pick`)
return {
  front: pane.activeTabId,
  strip: strip ? strip.getAttribute('data-tab') : null,
  shown,
  held,
  overview: document.documentElement.dataset.overview || (document.querySelector('.canvas .window') ? 'windows' : null),
  style: node ? node.getAttribute('style') : null,
}
"""
WINDOWS = """
return [...document.querySelectorAll('.canvas .window')].map((one) => {
  const box = one.getBoundingClientRect()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, wide: box.width }
}).filter((one) => one.wide > 8)
"""
SPOT = """
const pick = document.querySelector(`[data-strip] .pick[data-tab="${ID}"]`)
const box = pick ? pick.getBoundingClientRect() : null
return box && box.width > 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
"""
MIDDLE = """
const card = document.querySelector(`[data-pane="${orden.workspace.panes.focusedId}"] > .card`)
const box = card ? card.getBoundingClientRect() : null
return box && box.width > 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
"""
TYPE = """
const field = [...document.querySelectorAll('.xterm-helper-textarea')].find((one) => one.closest('.xterm')?.offsetParent !== null)
if (field) field.dispatchEvent(new InputEvent('input', { data: TEXT, inputType: 'insertText', bubbles: true }))
return !!field
"""
def painting(shell: str) -> str:
    if "powershell" in shell.lower() or "pwsh" in shell.lower():
        return (
            "$e=[char]27; $b=[char]7; $i=0; while($true){ $i++; $w=[Math]::Max(20,$Host.UI.RawUI.WindowSize.Width-1);"
            " [Console]::Write(\"$e]0;spin $i$b$e[48;2;255;0;255m\" + (\" line $i\").PadRight($w) + \"$e[0m`n\");"
            " Start-Sleep -Milliseconds 60 }"
        )
    return (
        "i=0; while :; do i=$((i+1)); printf '\\033]0;spin %s\\007\\033[48;2;255;0;255m%-*s\\033[0m\\n'"
        " \"$i\" \"$(( $(tput cols) - 1 ))\" \" line $i\"; sleep 0.06; done"
    )
def named(pixel: tuple[int, int, int]) -> str:
    if all(abs(one - other) <= 40 for one, other in zip(pixel, TERMINAL)):
        return "terminal"
    return switch.named(pixel)
class Pointer:
    def __init__(self) -> None:
        if sys.platform == "win32":
            self.user32 = ctypes.WinDLL("user32", use_last_error=True)
            self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
            self.user32.mouse_event.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_size_t]
            return
        self.x11 = ctypes.CDLL("libX11.so.6")
        self.test = ctypes.CDLL("libXtst.so.6")
        self.x11.XOpenDisplay.restype = ctypes.c_void_p
        self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x11.XFlush.argtypes = [ctypes.c_void_p]
        self.x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.test.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        self.test.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.test.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.shown = self.x11.XOpenDisplay(os.environ.get("DISPLAY", ":0").encode())
    def move(self, x: int, y: int) -> None:
        if sys.platform == "win32":
            self.user32.SetCursorPos(x, y)
            return
        self.test.XTestFakeMotionEvent(self.shown, -1, x, y, 0)
        self.x11.XFlush(self.shown)
    def button(self, down: bool) -> None:
        if sys.platform == "win32":
            self.user32.mouse_event(0x0002 if down else 0x0004, 0, 0, 0, 0)
            return
        self.test.XTestFakeButtonEvent(self.shown, 1, 1 if down else 0, 0)
        self.x11.XFlush(self.shown)
    def keys(self, strokes: list[tuple[str, bool]], gap: float = 0.02) -> None:
        for name, down in strokes:
            if sys.platform == "win32":
                code = {"control": 0x11, "tab": 0x09, "alt": 0x12, "escape": 0x1B}[name]
                self.user32.keybd_event(code, self.user32.MapVirtualKeyW(code, 0), 0 if down else 2, 0)
            else:
                sym = {"control": 0xFFE3, "tab": 0xFF09, "alt": 0xFFE9, "escape": 0xFF1B}[name]
                self.test.XTestFakeKeyEvent(self.shown, self.x11.XKeysymToKeycode(self.shown, sym), 1 if down else 0, 0)
                self.x11.XFlush(self.shown)
            time.sleep(gap)
    def next_tab(self) -> None:
        self.keys([("control", True), ("tab", True), ("tab", False), ("control", False)])
    def alt_alt(self) -> None:
        self.keys([("alt", True), ("alt", False)], 0.03)
        time.sleep(0.04)
        self.keys([("alt", True), ("alt", False)], 0.03)
    def escape(self) -> None:
        self.keys([("escape", True), ("escape", False)])
class Drive:
    def __init__(self, app: App, pid: int, tabs: dict[str, str], luck: random.Random) -> None:
        self.app, self.pid, self.tabs, self.luck = app, pid, tabs, luck
        self.read = switch.reader()
        self.pointer = Pointer()
        self.wrong: list[str] = []
        self.unpressed: list[str] = []
        self.trail: list[str | None] = []
        self.inner: dict[str, Any] = {}
        self.middle = (0, 0)
        self.away = (0, 0)
    def on_screen(self, x: float, y: float) -> tuple[int, int]:
        return round(self.inner["x"] + x * self.inner["ratio"]), round(self.inner["y"] + y * self.inner["ratio"])
    def placed(self) -> None:
        inner = self.app.eval(INNER)
        middle = self.app.eval(MIDDLE)
        if not isinstance(inner, dict) or not isinstance(middle, dict):
            raise SystemExit(f"the pane has no place on the screen: {inner} {middle}")
        self.inner = inner
        self.middle = self.on_screen(middle["x"], middle["y"])
        self.away = self.on_screen(middle["x"] * 1.2, middle["y"] * 1.3)
    def kind(self, name: str) -> str:
        return "note" if name.startswith("note") else "web" if name in PAGES else "terminal"
    def colour(self, name: str) -> str:
        return name if name in PAGES else "terminal" if name == "terminal" else "other"
    def name_of(self, tab: str | None) -> str | None:
        return next((name for name, one in self.tabs.items() if one == tab), None)
    def told(self, name: str) -> str:
        self.trail = []
        self.app.eval(f"orden.workspace.activate({json.dumps(self.tabs[name])}); return true")
        return name
    def pressed(self, name: str, how: str) -> str | None:
        spot = self.app.eval(SPOT.replace("${ID}", self.tabs[name]))
        if not isinstance(spot, dict):
            return None
        x, y = self.on_screen(spot["x"], spot["y"])
        self.pointer.move(x - 4, y + 1)
        time.sleep(0.03)
        self.pointer.move(x, y)
        if how == "rested":
            time.sleep(self.luck.choice([0.3, 0.7, 1.1]))
        self.pointer.button(True)
        time.sleep(0.02)
        if how == "slipped":
            self.pointer.move(x + self.luck.choice([2, 5, 8]), y + self.luck.choice([0, 1, 3]))
            time.sleep(0.03)
        self.pointer.button(False)
        time.sleep(0.02)
        self.pointer.move(*self.away)
        self.trail = []
        for wait in (0.03, 0.1, 0.2):
            time.sleep(wait)
            self.trail.append(self.front())
        return name
    def keyed(self) -> str | None:
        self.trail = []
        self.pointer.next_tab()
        time.sleep(0.15)
        return self.front()
    def overview(self) -> tuple[str, str | None]:
        self.pointer.alt_alt()
        time.sleep(self.luck.choice([0.12, 0.3, 0.6, 1.0]))
        windows = self.app.eval(WINDOWS)
        if not isinstance(windows, list) or not windows:
            self.pointer.escape()
            return "overview that never opened", self.front()
        way = self.luck.choice(["window", "window", "window", "escape", "taps"])
        if way == "window":
            one = self.luck.choice(windows)
            x, y = self.on_screen(one["x"], one["y"])
            self.pointer.move(x, y)
            time.sleep(0.05)
            self.pointer.button(True)
            time.sleep(0.03)
            self.pointer.button(False)
        elif way == "escape":
            self.pointer.escape()
        else:
            self.pointer.alt_alt()
        said = f"overview left by {way}"
        wait = self.luck.choice([0.0, 0.05, 0.15, 0.3, 0.6])
        time.sleep(wait)
        if self.luck.random() < 0.6:
            name = self.luck.choice(list(self.tabs))
            if self.pressed(name, "pressed") is not None:
                said += f" and a press on {name} {round(wait * 1000)} ms later"
        time.sleep(0.2)
        if self.app.eval("return !!document.querySelector('.canvas .window') && document.querySelector('.orden-glyph.overview')?.getAttribute('aria-pressed') === 'true'") is True:
            self.pointer.escape()
            said += ", then Escape"
            time.sleep(0.2)
        return said, self.front()
    def front(self) -> str | None:
        return self.name_of(self.app.eval("return orden.workspace.activeTabId"))
    def settled(self, name: str, how: str, step: int) -> bool:
        want = {"front": self.tabs[name], "kind": self.kind(name), "colour": self.colour(name)}
        seen: dict[str, Any] = {}
        colour = "?"
        stop = time.monotonic() + ARRIVES
        agreed: float | None = None
        while time.monotonic() < stop:
            seen = self.app.eval(LOOK) or {}
            colour = named(self.read(*self.middle))
            fits = (
                isinstance(seen, dict)
                and seen.get("front") == want["front"]
                and seen.get("strip") == want["front"]
                and seen.get("shown") == [want["kind"]]
                and seen.get("overview") is None
                and not seen.get("style")
                and colour == want["colour"]
            )
            if not fits:
                agreed = None
            elif agreed is None:
                agreed = time.monotonic()
            elif time.monotonic() - agreed >= STAYS:
                return True
            time.sleep(0.05)
        front = self.name_of(seen.get("front"))
        whole = (
            front is not None
            and front != name
            and seen.get("strip") == seen.get("front")
            and seen.get("shown") == [self.kind(front)]
            and seen.get("overview") is None
            and colour == self.colour(front)
        )
        if whole and self.trail:
            self.unpressed.append(
                f"switch {step}, {how} to {name}: the press left {front} in front, strip, pane and screen alike;"
                f" right after the press the workspace had {self.trail} in front"
            )
            return False
        self.wrong.append(
            f"switch {step}, {how} to {name}: the workspace has {self.name_of(seen.get('front'))} in front,"
            f" the strip marks {self.name_of(seen.get('strip'))}, the pane has not hidden {seen.get('shown')}"
            f" and the screen shows {colour}, where {want['kind']} and {want['colour']} belong;"
            f" the pane holds {seen.get('held')}, overview {seen.get('overview')}, style {seen.get('style')}"
        )
        return False
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--switches", type=int, default=120)
    parser.add_argument("--seed", type=int, default=2416)
    parser.add_argument("--stop-at", type=int, default=3, help="how many wrong switches end the drive")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if sys.platform == "darwin":
        print("this drive reads the screen on Windows and Linux only", flush=True)
        return 0
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), switch.Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-pane-front-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret, 8)
        if app.until("orden.workspace && orden.workspace.activeSpace ? true : null", 90) is not True:
            raise SystemExit("the app never answered")
        time.sleep(2)
        app.eval(
            "for (const one of document.querySelectorAll('button')) if (one.textContent.trim() === 'Keep running') one.click();"
            " for (const tab of [...orden.workspace.tabs]) orden.workspace.close(tab.id, false); return true"
        )
        time.sleep(1)
        tabs: dict[str, str] = {}
        for name in ("note one", "note two"):
            tab = app.eval(f"orden.workspace.openBlank({json.dumps(name)}, {json.dumps('# ' + name + chr(10) + chr(10) + 'Words of ' + name + '.' + chr(10))}); return orden.workspace.activeTabId")
            if not isinstance(tab, str):
                raise SystemExit(f"{name} was not opened: {tab}")
            tabs[name] = tab
            time.sleep(0.5)
        shells = app.eval("return await orden.invoke('terminal_shells')", 20)
        known = [one.get("id") for one in shells] if isinstance(shells, list) else []
        base = lambda one: str(one).replace("\\", "/").rsplit("/", 1)[-1].removesuffix(".exe").lower()
        shell = next((one for want in ("powershell", "pwsh", "bash", "zsh", "sh") for one in known if base(one) == want), None)
        if shell is None:
            raise SystemExit(f"no shell to paint the terminal with among {known}")
        tab = app.eval(
            "const ws = orden.workspace;"
            f" return ws.openUnsaved('terminal', JSON.stringify({{ shell: {json.dumps(shell)}, folder: ws.activeSpace.root, key: 'pane-front' }}), 'Shell').id"
        )
        if not isinstance(tab, str):
            raise SystemExit(f"the terminal was not opened: {tab}")
        tabs["terminal"] = tab
        time.sleep(5)
        if app.until(TYPE.replace("TEXT", json.dumps(painting(shell) + chr(13))).replace("return !!field", "return field ? true : null"), 30) is not True:
            raise SystemExit("the terminal took no keys")
        for name in PAGES:
            tab = app.eval(f"return orden.workspace.openPage({json.dumps(url + name)})", 20)
            if not isinstance(tab, str):
                raise SystemExit(f"the {name} tab was not opened: {tab}")
            tabs[name] = tab
            live = app.until(f"orden.pages.of({json.dumps(tab)}).live && orden.pages.of({json.dumps(tab)}).shown ? true : null", 30)
            if live is not True:
                raise SystemExit(f"the {name} page never came up")
            time.sleep(1.5)
        forward(app, process.pid)
        time.sleep(1)
        luck = random.Random(args.seed)
        drive = Drive(app, process.pid, tabs, luck)
        drive.placed()
        names = list(tabs)
        for name in names:
            drive.told(name)
            if not drive.settled(name, "told first", 0):
                raise SystemExit(f"the drive cannot tell the tabs apart: {drive.wrong[-1]}")
        print(f"tabs {tabs}; the middle of the pane is at {drive.middle}", flush=True)
        front = names[-1]
        for step in range(1, args.switches + 1):
            how = luck.choice(["told", "pressed", "pressed", "rested", "slipped", "keyed", "overview", "overview"])
            to = luck.choice([one for one in names if one != front])
            if step % 20 == 0:
                forward(app, process.pid)
            if how == "told":
                went = drive.told(to)
            elif how == "keyed":
                went = drive.keyed()
            elif how == "overview":
                how, went = drive.overview()
            else:
                went = drive.pressed(to, how)
            if went is None:
                print(f"switch {step}: {how} to {to} found nothing to act on, so it is told", flush=True)
                went = drive.told(to)
            before = len(drive.wrong)
            if drive.settled(went, how, step):
                front = went
            else:
                front = drive.front() or went
                if len(drive.wrong) > before:
                    print(f"::error::{drive.wrong[-1]}", flush=True)
                if len(drive.wrong) >= args.stop_at:
                    break
            time.sleep(luck.choice([0.0, 0.05, 0.2, 0.5]))
            if step % 20 == 0:
                print(f"switch {step}: {how} to {went}, fine so far" if not drive.wrong else f"switch {step}: {len(drive.wrong)} wrong", flush=True)
        wrong = drive.wrong
        for one in drive.unpressed:
            known(2416, one)
        said = app.eval("return (await orden.invoke('read_log')).split('\\n').filter((one) => / error /.test(one) || one.includes(TOLD)).slice(-30)".replace("TOLD", json.dumps(TOLD)), 20)
        if isinstance(said, list) and said:
            print(f"the app's log: {json.dumps(said)[:6000]}", flush=True)
            if any(TOLD in one for one in said):
                wrong.append("the app itself wrote that a pane showed another tab than the one in front")
    finally:
        ended(process)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    if not wrong:
        print(f"the pane showed the tab in front after each of {args.switches} switches", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
