"""Does a terminal turn into the file explorer of its folder and back, its shell running on? Linux, macOS and Windows.

#2274. One app, the explorer switched on under Experimental:

1. a terminal goes into a new folder, sets a mark in its shell and reports the folder;
2. its turn button shows the file explorer in the same place, on that folder;
3. the explorer goes up one folder and turns back with Ctrl+Alt+U: the same shell
   still holds the mark and its scrollback, and the strip has as many tabs as before;
4. turned again, the explorer stays where it was left, since the shell did not move;
   once the shell has gone somewhere else, the explorer follows it there;
5. a new file explorer turns into a terminal in its folder;
6. with the explorer switched off, a tab showing its explorer shows its own shell again and
   neither button is offered;
7. a terminal tucked behind its explorer comes back with it after a restart.

    python scripts/turn-drive.py --exe <probe orden> --identifier <probe id> --out <folder> [--shell powershell|cmd]
"""
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
import time
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh  # noqa: E402
from native_app import INNER, App, config_of, endpoint, forward  # noqa: E402

MAC = sys.platform == "darwin"
WINDOWS = sys.platform == "win32"
class Posix:
    id = os.environ.get("SHELL") or "/bin/bash"
    @staticmethod
    def into(folder: pathlib.Path) -> str:
        return f"mkdir -p '{folder}' && cd '{folder}' && export TURNMARK=42 && echo SCROLLBACK-TURN-7"
    @staticmethod
    def mark(path: pathlib.Path) -> str:
        return f"echo $TURNMARK > '{path}'"
    @staticmethod
    def up_two() -> str:
        return "cd ../.."
    @staticmethod
    def where(path: pathlib.Path) -> str:
        return f"pwd > '{path}'"
class PowerShell:
    id = "powershell"
    @staticmethod
    def into(folder: pathlib.Path) -> str:
        return f"New-Item -ItemType Directory -Force -Path '{folder}' | Out-Null; Set-Location '{folder}'; $env:TURNMARK=42; echo SCROLLBACK-TURN-7"
    @staticmethod
    def mark(path: pathlib.Path) -> str:
        return f"$env:TURNMARK | Out-File -Encoding ascii '{path}'"
    @staticmethod
    def up_two() -> str:
        return "Set-Location ..\\.."
    @staticmethod
    def where(path: pathlib.Path) -> str:
        return f"(Get-Location).Path | Out-File -Encoding ascii '{path}'"
class Cmd:
    id = "cmd"
    @staticmethod
    def into(folder: pathlib.Path) -> str:
        return f'mkdir "{folder}" & cd /d "{folder}" & set "TURNMARK=42" & echo SCROLLBACK-TURN-7'
    @staticmethod
    def mark(path: pathlib.Path) -> str:
        return f'(echo %TURNMARK%)> "{path}"'
    @staticmethod
    def up_two() -> str:
        return "cd /d ..\\.."
    @staticmethod
    def where(path: pathlib.Path) -> str:
        return f'(cd)> "{path}"'
SHELLS = {"posix": Posix, "powershell": PowerShell, "pwsh": PowerShell, "cmd": Cmd}
def kind_of(shell: str) -> Any:
    name = pathlib.PureWindowsPath(shell).name.lower() if WINDOWS else shell
    if "cmd" in name:
        return Cmd
    if "pwsh" in name or "powershell" in name:
        return PowerShell
    return Posix
ON = ["experimental", "experimental-explorer"]
TERMINAL_TURN = 'button[aria-label^="Show in file explorer"], button[aria-label^="Back to the file explorer"]'
EXPLORER_TURN = 'button[aria-label^="Terminal here"], button[aria-label^="Back to the terminal"]'
failures: list[str] = []
def say(words: str) -> None:
    print(words, flush=True)
def check(ok: bool, words: str) -> bool:
    say(f"{'ok  ' if ok else 'FAIL'} {words}")
    if not ok:
        failures.append(words)
    return ok
def until(ask: Any, seconds: float = 20, every: float = 0.25) -> Any:
    stop = time.monotonic() + seconds
    got = ask()
    while not got and time.monotonic() < stop:
        time.sleep(every)
        got = ask()
    return got
class Drive:
    def __init__(self, app: App, pid: int, out: pathlib.Path) -> None:
        self.app, self.pid, self.out = app, pid, out
    def run(self, code: str) -> Any:
        return self.app.eval(code)
    def active(self) -> dict[str, Any]:
        said = self.run(
            "const ws = orden.workspace; const tab = ws.active;"
            " return tab ? { id: tab.id, kind: tab.kind, doc: tab.doc, tabs: ws.tabs.length,"
            " twin: ws.twinOf(tab.id)?.id ?? null } : {}"
        )
        return said if isinstance(said, dict) and "error" not in said else {}
    def folder(self) -> str | None:
        try:
            return json.loads(self.active().get("doc") or "{}").get("folder")
        except ValueError:
            return None
    def twin_folder(self) -> str | None:
        said = self.run("const ws = orden.workspace; const twin = ws.twinOf(ws.active?.id ?? ''); return twin ? JSON.parse(twin.doc || '{}').folder ?? null : null")
        return said if isinstance(said, str) else None
    def typed(self, words: str) -> None:
        self.run(
            "const field = [...document.querySelectorAll('.xterm-helper-textarea')].find((one) => one.closest('.xterm')?.offsetParent !== null);"
            " if (!field) return false;"
            f" field.dispatchEvent(new InputEvent('input', {{ data: {json.dumps(words)}, inputType: 'insertText', bubbles: true }}));"
            " return true"
        )
    def rows(self) -> list[str]:
        said = self.run(
            "const shown = [...document.querySelectorAll('.xterm')].find((one) => one.offsetParent !== null);"
            " return [...(shown ? shown.querySelectorAll('.xterm-rows > div') : [])]"
            ".map((row) => row.textContent.replace(/\\u00a0/g, ' ').trimEnd())"
        )
        return said if isinstance(said, list) else []
    def button(self, which: str) -> str | None:
        said = self.run(f"return [...document.querySelectorAll({json.dumps(which)})].find((one) => one.offsetParent !== null)?.getAttribute('aria-label') ?? null")
        return said if isinstance(said, str) else None
    def press(self, which: str) -> bool:
        return self.run(f"const one = [...document.querySelectorAll({json.dumps(which)})].find((one) => one.offsetParent !== null); one?.click(); return !!one") is True
    def chord(self, letter: str) -> None:
        forward(self.app, self.pid)
        time.sleep(0.3)
        if WINDOWS:
            self.windows_chord(letter)
            return
        if not MAC and shutil.which("xdotool"):
            subprocess.run(["xdotool", "key", "--clearmodifiers", f"ctrl+alt+{letter}"], check=False)
            return
        code = f"Key{letter.upper()}"
        mods = "metaKey: true, altKey: true" if MAC else "ctrlKey: true, altKey: true"
        self.run(
            f"const press = new KeyboardEvent('keydown', {{ key: {json.dumps(letter)}, code: {json.dumps(code)}, {mods}, bubbles: true, cancelable: true }});"
            " (document.activeElement ?? document.body).dispatchEvent(press); return true"
        )
    def windows_chord(self, letter: str) -> None:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]
        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]
        class EITHER(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]
        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("u", EITHER)]
        def send(one: Any) -> None:
            user32.SendInput(1, ctypes.byref(one), ctypes.sizeof(INPUT))
        spot = self.run(
            "const pane = [...document.querySelectorAll('.xterm-screen, [data-pane]')].find((one) => one.offsetParent !== null);"
            " if (!pane) return null; const r = pane.getBoundingClientRect();"
            " return { x: r.x + r.width / 2, y: r.y + Math.min(r.height - 8, 60) }"
        )
        inner = self.run(INNER)
        if isinstance(spot, dict) and isinstance(inner, dict) and "x" in inner:
            user32.SetCursorPos(round(inner["x"] + spot["x"] * inner["scale"]), round(inner["y"] + spot["y"] * inner["scale"]))
            time.sleep(0.15)
            for flag in (0x2, 0x4):
                one = INPUT(type=0)
                one.u.mi = MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=flag, time=0, dwExtraInfo=0)
                send(one)
                time.sleep(0.05)
            time.sleep(0.3)
        keys = (0x11, 0x12, ord(letter.upper()))
        for up in (False, True):
            for vk in (reversed(keys) if up else keys):
                one = INPUT(type=1)
                one.u.ki = KEYBDINPUT(wVk=vk, wScan=user32.MapVirtualKeyW(vk, 0), dwFlags=0x2 if up else 0, time=0, dwExtraInfo=0)
                send(one)
                time.sleep(0.05)
    def shot(self, name: str) -> None:
        try:
            import mss
            import mss.tools
            with getattr(mss, "MSS", mss.mss)() as grab:
                picture = grab.grab(grab.monitors[1])
                mss.tools.to_png(picture.rgb, picture.size, output=str(self.out / f"{name}.png"))
        except Exception as error:  # noqa: BLE001 - a picture is a help, not a check
            say(f"     no picture {name}: {error}")
    def wrote(self, path: pathlib.Path, seconds: float = 10) -> str:
        found = until(lambda: path.exists() and path.read_text(encoding="utf-8", errors="replace").strip(), seconds)
        return found or ""
def same(one: str | None, two: pathlib.Path) -> bool:
    return bool(one) and os.path.normcase(os.path.realpath(str(one))) == os.path.normcase(os.path.realpath(str(two)))
def gate(drive: Drive, on: bool) -> None:
    kinds = ON if on else ["experimental"]
    drive.run(f"localStorage.setItem('orden:hidden-kinds', {json.dumps(json.dumps(kinds))}); setTimeout(() => location.reload(), 50); return true")
    time.sleep(1.5)
    has = "true" if on else "false"
    if not drive.app.until(
        "if (!orden.workspace) return null;"
        f" return JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]').includes('experimental-explorer') === {has} || null",
        60,
    ):
        raise SystemExit("the explorer gate never took")
    time.sleep(2)
def terminal(drive: Drive, folder: pathlib.Path, key: str, shell: str) -> str:
    tab = drive.run(
        "const ws = orden.workspace;"
        f" ws.openUnsaved('terminal', JSON.stringify({{ shell: {json.dumps(shell)}, folder: {json.dumps(str(folder))}, key: {json.dumps(key)} }}), 'Turn');"
        " return ws.activeTabId"
    )
    if not until(lambda: drive.run("return !!document.querySelector('.xterm-helper-textarea')") is True, 30):
        raise SystemExit("the terminal never drew")
    time.sleep(2)
    return str(tab)
def steps(drive: Drive, tmp: pathlib.Path, restart: Any, shell: Any) -> None:
    deep = tmp / "a" / "b"
    marks = tmp / "marks"
    marks.mkdir()
    gate(drive, True)
    terminal(drive, tmp, "turn-one", shell.id)
    drive.typed(shell.into(deep) + "\r")
    check(until(lambda: same(drive.folder(), deep), 20), f"1. the terminal reports its folder {deep} (it said {drive.folder()})")
    before = drive.active()
    tabs = before.get("tabs")
    label = drive.button(TERMINAL_TURN)
    check(label is not None and label.startswith("Show in file explorer"), f"2. the terminal offers its turn button ({label!r})")
    drive.press(TERMINAL_TURN)
    shown = until(lambda: drive.active().get("kind") == "explorer" and drive.active(), 10) or {}
    check(shown.get("kind") == "explorer", f"2. the button shows a file explorer in its place ({shown.get('kind')})")
    check(same(drive.folder(), deep), f"2. the explorer is on {deep} ({drive.folder()})")
    check(shown.get("tabs") == tabs, f"2. the strip keeps {tabs} tabs ({shown.get('tabs')})")
    check(drive.button(EXPLORER_TURN) is not None and drive.button(EXPLORER_TURN).startswith("Back to the terminal"), f"2. the explorer offers Back to the terminal ({drive.button(EXPLORER_TURN)!r})")
    drive.shot("2-explorer")
    drive.press('button[aria-label="Folder above"]')
    check(until(lambda: same(drive.folder(), tmp / "a"), 10), f"3. the explorer goes up to {tmp / 'a'} ({drive.folder()})")
    left = drive.twin_folder()
    drive.chord("u")
    back = until(lambda: drive.active().get("kind") == "terminal" and drive.active(), 10) or {}
    check(back.get("kind") == "terminal", f"3. Ctrl+Alt+U turns back to the terminal ({back.get('kind')})")
    check(back.get("id") == before.get("id"), f"3. it is the same terminal tab ({back.get('id')} was {before.get('id')})")
    check(back.get("tabs") == tabs, f"3. the strip keeps {tabs} tabs ({back.get('tabs')})")
    time.sleep(1)
    drive.typed(shell.mark(marks / "mark") + "\r")
    check(drive.wrote(marks / "mark") == "42", f"3. the shell still holds its mark ({drive.wrote(marks / 'mark', 1)!r})")
    rows = drive.rows()
    check(any("SCROLLBACK-TURN-7" in row for row in rows), f"3. the scrollback is still there ({len(rows)} rows drawn)")
    drive.shot("3-terminal")
    drive.press(TERMINAL_TURN)
    check(until(lambda: drive.active().get("kind") == "explorer", 10), "4. turned again, the explorer shows")
    time.sleep(1)
    check(same(drive.folder(), tmp / "a"), f"4. the shell did not move, so the explorer stays on {tmp / 'a'} ({drive.folder()}; the shell says {drive.twin_folder()}, it said {left!r} when turned away)")
    drive.press(EXPLORER_TURN)
    check(until(lambda: drive.active().get("kind") == "terminal", 10), "4. and back to the terminal")
    time.sleep(1)
    drive.typed(shell.up_two() + "\r")
    check(until(lambda: same(drive.folder(), tmp), 20), f"4. the shell reports {tmp} ({drive.folder()})")
    drive.press(TERMINAL_TURN)
    check(until(lambda: drive.active().get("kind") == "explorer" and same(drive.folder(), tmp), 10), f"4. the explorer follows the shell to {tmp} ({drive.folder()})")
    drive.shot("4-followed")
    drive.chord("e")
    made = until(lambda: drive.active().get("kind") == "explorer" and drive.active().get("id") != shown.get("id") and drive.active(), 10) or {}
    check(bool(made), "5. Ctrl+Alt+E opens a new file explorer")
    start = drive.folder()
    label = drive.button(EXPLORER_TURN)
    check(label is not None and label.startswith("Terminal here"), f"5. it offers Terminal here ({label!r})")
    drive.press(EXPLORER_TURN)
    check(until(lambda: drive.active().get("kind") == "terminal" and drive.run("return !!document.querySelector('.xterm-helper-textarea')") is True, 30), "5. it turns into a terminal")
    time.sleep(2)
    here = kind_of(drive.run("return JSON.parse(orden.workspace.active?.doc || '{}').shell ?? ''") or "")
    drive.typed(here.where(marks / "pwd") + "\r")
    where = drive.wrote(marks / "pwd")
    check(bool(start) and same(where, pathlib.Path(start or "/nowhere")), f"5. the terminal starts in the explorer's folder {start} ({where!r})")
    drive.shot("5-terminal-here")
    drive.run(f"orden.workspace.activeTabId = {json.dumps(shown.get('id'))}; return true")
    check(until(lambda: drive.active().get("kind") == "explorer", 10), "6. the first tab shows its explorer, the shell tucked behind it")
    gate(drive, False)
    first = drive.run(
        "const ws = orden.workspace; const tab = ws.tabs.find((one) => one.kind === 'terminal' && JSON.parse(one.doc || '{}').key === 'turn-one');"
        " if (tab) ws.activeTabId = tab.id; return { found: !!tab, tucked: ws.tucked.length, explorers: ws.tabs.filter((one) => one.kind === 'explorer').length }"
    )
    check(isinstance(first, dict) and first.get("found") is True, f"6. off, the first tab is its terminal again ({first})")
    check(isinstance(first, dict) and first.get("tucked") == 0, f"6. off, nothing is tucked behind a tab ({first})")
    until(lambda: drive.run("return !!document.querySelector('.xterm-helper-textarea')") is True, 30)
    time.sleep(1)
    drive.typed("\r")
    time.sleep(1)
    drive.typed(shell.mark(marks / "after-off") + "\r")
    check(drive.wrote(marks / "after-off") == "42", f"6. off, it is the same shell, still holding its mark ({drive.wrote(marks / 'after-off', 1)!r})")
    check(drive.button(TERMINAL_TURN) is None, f"6. off, a terminal offers no turn button ({drive.button(TERMINAL_TURN)!r})")
    drive.run(
        "orden.workspace.openUnsaved('explorer', JSON.stringify({ folder: "
        + json.dumps(str(tmp))
        + ", back: [], ahead: [] }), 'Off'); return true"
    )
    time.sleep(2)
    check(drive.button(EXPLORER_TURN) is None, f"6. off, an explorer offers no turn button ({drive.button(EXPLORER_TURN)!r})")
    drive.shot("6-off")
    gate(drive, True)
    terminal(drive, tmp, "turn-again", shell.id)
    offered = until(lambda: drive.button(TERMINAL_TURN), 20)
    check(bool(offered), f"7. on again, a new terminal offers its turn button ({offered!r})")
    drive.press(TERMINAL_TURN)
    tucked = until(lambda: drive.active().get("kind") == "explorer" and drive.active(), 10) or {}
    check(bool(tucked), "7. a terminal turns into its explorer")
    drive.run("await orden.workspace.writesSettled?.(); return true")
    time.sleep(1)
    restart(drive)
    again = until(lambda: drive.active().get("kind") and drive.active(), 30) or {}
    check(again.get("kind") == "explorer", f"7. after a restart the tab still shows the explorer ({again.get('kind')})")
    label = drive.button(EXPLORER_TURN)
    check(label is not None and label.startswith("Back to the terminal"), f"7. and offers Back to the terminal ({label!r})")
    drive.press(EXPLORER_TURN)
    check(until(lambda: drive.active().get("kind") == "terminal" and drive.run("return !!document.querySelector('.xterm-helper-textarea')") is True, 30), "7. which turns it into its terminal")
    drive.shot("7-restarted")
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--shell", choices=sorted(SHELLS), default="powershell" if WINDOWS else "posix")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    config = config_of(args.identifier)
    fresh(config)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-turn-spaces-"))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="orden-turn-"))
    log = open(args.out / "app.log", "wb")
    running: list[subprocess.Popen[bytes]] = []
    def launch() -> tuple[App, int]:
        secret = secrets.token_hex(32)
        (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
        process = subprocess.Popen(
            [str(args.exe)],
            env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)},
            cwd=str(args.exe.parent),
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        running.append(process)
        app = endpoint(config, process.pid, secret, 30)
        if not app.until("return !!orden.workspace?.activeSpace", 90):
            raise SystemExit("the app never opened a space")
        return app, process.pid
    def restart(drive: Drive) -> None:
        ended(running.pop(), gentle=True)
        time.sleep(3)
        drive.app, drive.pid = launch()
        time.sleep(3)
    try:
        app, pid = launch()
        steps(Drive(app, pid, args.out), tmp, restart, SHELLS[args.shell])
    finally:
        for process in running:
            ended(process, gentle=True)
        log.close()
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "results.json").write_text(json.dumps({"failures": failures}, indent=2), encoding="utf-8")
    say(f"\n{'FAILED ' + str(len(failures)) if failures else 'every turn kept its place, its folder and its shell'}")
    return 1 if failures else 0
if __name__ == "__main__":
    sys.exit(main())
