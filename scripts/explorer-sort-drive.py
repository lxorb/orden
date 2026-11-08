from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
WINDOWS = sys.platform == "win32"
DAY = 86_400
BASE = 1_767_225_600

NAMED: list[tuple[str, int, int]] = [
    ("file 10.txt", 2_000_000, 3),
    ("File 2.md", 900, 1),
    ("photo.PNG", 1_500, 6),
    ("Ärger.pdf", 40, 2),
    ("日記.txt", 50_000, 5),
]
FOLDERS: list[tuple[str, int]] = [("Folder 10", 4), ("folder 9", 7)]
MORE = 300

BY_NAME = ["Ärger.pdf", "File 2.md", "file 10.txt", "photo.PNG"]
FOLDERS_BY_NAME = ["folder 9", "Folder 10"]

ROWS = """JSON.stringify((() => {
  const rows = [...document.querySelectorAll('.explorer .entry')]
  const at = (one) => [parseFloat(one.style.top) || 0, parseFloat(one.style.insetInlineStart) || 0]
  rows.sort((one, other) => at(one)[0] - at(other)[0] || at(one)[1] - at(other)[1])
  const heads = [...document.querySelectorAll('.explorer .head .column')].map((one) => one.textContent.trim())
  return {
    rows: rows.map((one) => one.querySelector('.orden-row-label')?.textContent ?? ''),
    heads,
    scrim: document.querySelectorAll('.orden-scrim').length,
    said: [...document.querySelectorAll('.explorer .said')].map((one) => one.textContent),
    focused: document.hasFocus(),
  }
})())"""


def borrowed(name: str, file: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def made_folder(root: pathlib.Path) -> None:
    root.mkdir(parents=True)
    for name, size, day in NAMED:
        path = root / name
        path.write_bytes(b"x" * size)
        os.utime(path, (BASE + day * DAY, BASE + day * DAY))
        time.sleep(0.05)
    for name, day in FOLDERS:
        (root / name).mkdir()
        (root / name / "inner.txt").write_bytes(b"x")
        os.utime(root / name, (BASE + day * DAY, BASE + day * DAY))
    for one in range(MORE):
        path = root / f"zz {one}.bin"
        path.write_bytes(b"x" * (101 + one * 7))
        os.utime(path, (BASE - (one + 1) * DAY, BASE - (one + 1) * DAY))
        time.sleep(0.02)


class Linux:
    def __init__(self, exe: pathlib.Path) -> None:
        self.home = pathlib.Path(tempfile.mkdtemp(prefix="orden-sort-drive-"))
        config = self.home / ".config" / "so.orden.Orden"
        config.mkdir(parents=True)
        (config / "automation.json").write_text(
            json.dumps({"port": 0, "secret": secrets.token_hex(32), "eval": True, "pid": 0})
        )
        os.chmod(config / "automation.json", 0o600)
        self.config = config
        self.env = dict(os.environ, HOME=str(self.home), XDG_CONFIG_HOME=str(self.home / ".config"))
        self.env["XDG_DATA_HOME"] = str(self.home / ".local" / "share")
        self.running = subprocess.Popen([str(exe)], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.port, self.secret = 0, ""
        for _ in range(240):
            try:
                kept = json.loads((config / "automation.json").read_text())
                if kept.get("port"):
                    self.port, self.secret = int(kept["port"]), str(kept["secret"])
                    break
            except (OSError, ValueError):
                pass
            time.sleep(0.5)
        if not self.port:
            raise SystemExit("the app wrote no endpoint")

    def ask(self, code: str) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        for _ in range(10):
            try:
                with urllib.request.urlopen(request, timeout=30) as answer:
                    said = json.loads(answer.read())
                break
            except OSError:
                time.sleep(1)
        else:
            return None
        value = said.get("value") if said.get("ok") else {"error": said}
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value

    def click(self, x: float, y: float) -> None:
        window = subprocess.run(
            ["xdotool", "search", "--pid", str(self.running.pid), "--onlyvisible"],
            env=self.env, capture_output=True, text=True, check=False,
        ).stdout.split()
        geometry = subprocess.run(
            ["xdotool", "getwindowgeometry", "--shell", window[-1]],
            env=self.env, capture_output=True, text=True, check=False,
        ).stdout if window else ""
        at = dict(line.split("=", 1) for line in geometry.split())
        left, top = int(at.get("X", 0)), int(at.get("Y", 0))
        subprocess.run(["xdotool", "mousemove", str(int(left + x)), str(int(top + y)), "click", "1"], env=self.env, check=False)

    def end(self) -> None:
        self.running.terminate()
        try:
            self.running.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.running.kill()
        shutil.rmtree(self.home, ignore_errors=True)


class Windows:
    def __init__(self, exe: pathlib.Path, identifier: str) -> None:
        sys.path.insert(0, str(HERE))
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        from probe_app import main_window

        self.main_window = main_window
        probe = borrowed("downloads_probe", "web-downloads-probe.py")
        self.spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-sort-spaces-"))
        os.environ["ORDEN_SPACES_DIR"] = str(self.spaces)
        probe.wipe(identifier)
        running, app = probe.launch(exe, identifier)
        running.terminate()
        running.wait(timeout=30)
        probe.allow_eval(identifier)
        self.running, self.app = probe.launch(exe, identifier, unlike=app.port)
        self.probe = probe
        probe.quiet(self.app)

    def ask(self, code: str) -> Any:
        return self.app.ask(code)

    def click(self, x: float, y: float) -> None:
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        hwnd = self.main_window(self.running.pid)
        origin = wintypes.POINT(0, 0)
        user32.ClientToScreen(hwnd, ctypes.byref(origin))
        front = user32.GetForegroundWindow()
        theirs = user32.GetWindowThreadProcessId(front, None)
        ours = ctypes.windll.kernel32.GetCurrentThreadId()
        user32.AttachThreadInput(ours, theirs, True)
        user32.SetForegroundWindow(hwnd)
        user32.BringWindowToTop(hwnd)
        user32.AttachThreadInput(ours, theirs, False)
        time.sleep(0.2)
        user32.SetCursorPos(int(origin.x + x), int(origin.y + y))
        time.sleep(0.1)
        user32.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.05)
        user32.mouse_event(0x0004, 0, 0, 0, 0)

    def end(self) -> None:
        self.running.terminate()
        try:
            self.running.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.running.kill()
        shutil.rmtree(self.spaces, ignore_errors=True)


def press(app: Any, selector: str, wrong: list[str]) -> None:
    for _ in range(5):
        said = app.ask(
            "JSON.stringify((() => { const one = document.querySelector(" + json.dumps(selector) + ");"
            " if (!one) return null; const box = one.getBoundingClientRect();"
            " const x = box.left + box.width / 2, y = box.top + box.height / 2;"
            " const there = document.elementFromPoint(x, y);"
            " return { x: x * devicePixelRatio, y: y * devicePixelRatio, hit: !!there && one.contains(there) } })())"
        )
        if isinstance(said, dict) and said.get("hit"):
            app.click(said["x"], said["y"])
            time.sleep(0.8)
            return
        app.ask("document.querySelector('.orden-scrim')?.click(); document.activeElement?.blur(); 1")
        time.sleep(0.5)
    wrong.append(f"{selector} could not be clicked: {said}")


def menu_item(app: Any, label: str, wrong: list[str]) -> None:
    press(app, ".explorer .bar .sort", wrong)
    found = app.ask(
        "(() => { const one = [...document.querySelectorAll('.menu [role=menuitem]')].find((row) =>"
        " row.querySelector('.orden-row-label')?.textContent === " + json.dumps(label) + ");"
        " if (!one) return false; one.dataset.driven = 'yes'; return true })()"
    )
    if found is not True:
        wrong.append(f"the sort menu has no {label}")
        return
    press(app, ".menu [data-driven=yes]", wrong)


def natural(name: str) -> list[Any]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", name)]


def created(down: bool) -> list[str]:
    folders = [name for name, _ in FOLDERS]
    files = [name for name, _, _ in NAMED] + [f"zz {one}.bin" for one in range(MORE)]
    return (folders[::-1] + files[::-1]) if down else (folders + files)


def expected(root: pathlib.Path, key: str, down: bool) -> list[str]:
    def of(one: pathlib.Path) -> float:
        if key == "size":
            return 0 if one.is_dir() else one.stat().st_size
        return one.stat().st_mtime

    def ordered(group: list[pathlib.Path]) -> list[str]:
        named = sorted(group, key=lambda one: natural(one.name))
        return [one.name for one in sorted(named, key=of, reverse=down)]

    every = list(root.iterdir())
    return ordered([one for one in every if one.is_dir()]) + ordered([one for one in every if one.is_file()])


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="so.orden.Orden.probe.sort")
    args = parsed.parse_args()

    root = pathlib.Path(tempfile.mkdtemp(prefix="orden-sort-")).resolve() / "sorted"
    made_folder(root)
    wrong: list[str] = []
    app: Any = None
    try:
        app = Windows(args.exe, args.identifier) if WINDOWS else Linux(args.exe)
        for _ in range(60):
            if app.ask("typeof orden !== 'undefined' && !!orden.workspace") is True:
                break
            time.sleep(1)
        time.sleep(3)
        spec = json.dumps({"folder": str(root), "back": [], "ahead": []})
        app.ask(
            "localStorage.removeItem('orden:explorer');"
            f" orden.workspace.openUnsaved('explorer', {json.dumps(spec)}, 'sorted'); 1"
        )
        time.sleep(4)

        def seen(step: str, want: list[str], head: int | None = None, mark: str | None = None) -> None:
            said = app.ask(ROWS)
            rows = said.get("rows", []) if isinstance(said, dict) else []
            print(step, json.dumps(said, ensure_ascii=False)[:600], flush=True)
            if rows[: len(want)] != want:
                wrong.append(f"{step}: shown {rows[: len(want)]}, wanted {want}")
            if head is not None and mark is not None:
                heads = said.get("heads", []) if isinstance(said, dict) else []
                if len(heads) <= head or not heads[head].endswith(mark):
                    wrong.append(f"{step}: header {heads} has no {mark}")

        seen("name up", FOLDERS_BY_NAME + BY_NAME, 0, "↑")
        press(app, ".explorer .head .column.name", wrong)
        seen("name down", list(reversed(FOLDERS_BY_NAME)), 0, "↓")
        for key, at in (("size", 2), ("modified", 1)):
            press(app, f".explorer .head .column.{key}", wrong)
            seen(f"{key} down", expected(root, key, True)[:20], at, "↓")
            press(app, f".explorer .head .column.{key}", wrong)
            seen(f"{key} up", expected(root, key, False)[:20], at, "↑")
        press(app, ".explorer .head .column.kind", wrong)
        seen("kind up", FOLDERS_BY_NAME + ["zz 0.bin", "zz 1.bin", "zz 2.bin"], 3, "↑")
        press(app, ".explorer .head .column.kind", wrong)
        seen("kind down", FOLDERS_BY_NAME + ["file 10.txt", "日記.txt", "photo.PNG"], 3, "↓")

        menu_item(app, "Created", wrong)
        seen("created down", created(True)[:20])
        menu_item(app, "Ascending", wrong)
        seen("created up", created(False)[:20])

        press(app, ".explorer .head .column.size", wrong)
        (root / "big new.bin").write_bytes(b"x" * 5_000_000)
        time.sleep(3)
        seen("size down after a change", FOLDERS_BY_NAME + ["big new.bin", "file 10.txt", "日記.txt"], 2, "↓")
    finally:
        if app is not None:
            app.end()
        shutil.rmtree(root.parent, ignore_errors=True)
    for one in wrong:
        print(f"WRONG: {one}")
    print("PASS" if not wrong else f"FAIL ({len(wrong)})")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
