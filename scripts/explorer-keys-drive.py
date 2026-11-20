"""Does the file explorer keep the keyboard when the focused row goes? Linux, macOS and Windows.

#2359. A folder with alpha.txt, beta.txt, gamma.txt and a folder docs, the explorer on it:

1. beta.txt picked from the keyboard and put in the trash with Delete: the keyboard stays
   in the list, on gamma.txt, and Ctrl+Z right after brings beta.txt back;
2. the arrows still walk the list from there;
3. the focused file moved away by another program: the keyboard stays on the next row;
4. everything picked with Ctrl+A and put in the trash: the keyboard stays on the empty
   list, and Ctrl+Z brings it all back.

    python scripts/explorer-keys-drive.py --exe <probe orden> --identifier <probe id> --out <folder>
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
from native_app import App, config_of, endpoint, forward  # noqa: E402

MAC = sys.platform == "darwin"
XDOTOOL = sys.platform.startswith("linux") and shutil.which("xdotool") is not None
failures: list[str] = []
def say(words: str) -> None:
    print(words, flush=True)
def check(ok: bool, words: str) -> bool:
    say(f"{'ok  ' if ok else 'FAIL'} {words}")
    if not ok:
        failures.append(words)
    return ok
def until(ask: Any, seconds: float = 10, every: float = 0.2) -> Any:
    stop = time.monotonic() + seconds
    got = ask()
    while not got and time.monotonic() < stop:
        time.sleep(every)
        got = ask()
    return got
class Drive:
    def __init__(self, app: App, pid: int, folder: pathlib.Path) -> None:
        self.app, self.pid, self.folder = app, pid, folder
    def run(self, code: str) -> Any:
        return self.app.eval(code)
    def on_disk(self) -> list[str]:
        return sorted(one.name for one in self.folder.iterdir())
    def focused(self) -> str | None:
        said = self.run(
            "const now = document.activeElement; const list = now?.closest('.explorer .rows');"
            " if (!list) return now ? `outside: ${now.tagName}` : 'nothing';"
            " if (now === list) return 'the list';"
            " return now.querySelector('.orden-row-label')?.textContent ?? `in the list: ${now.tagName}`"
        )
        return said if isinstance(said, str) else None
    def key(self, name: str, ctrl: bool = False) -> None:
        if XDOTOOL:
            subprocess.run(["xdotool", "key", "--clearmodifiers", f"ctrl+{name}" if ctrl else name], check=False)
        else:
            key = {"Up": "ArrowUp", "Down": "ArrowDown"}.get(name, name)
            mods = ("metaKey: true" if MAC else "ctrlKey: true") if ctrl else ""
            self.run(
                f"const press = new KeyboardEvent('keydown', {{ key: {json.dumps(key)}, {mods}, bubbles: true, cancelable: true }});"
                " (document.activeElement ?? document.body).dispatchEvent(press); return true"
            )
        time.sleep(0.6)
def gate(drive: Drive) -> None:
    drive.run(
        "localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-explorer']));"
        " setTimeout(() => location.reload(), 50); return true"
    )
    time.sleep(1.5)
    if not drive.app.until(
        "return !!orden.workspace?.activeSpace && JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]')"
        ".includes('experimental-explorer') || null",
        60,
    ):
        raise SystemExit("the explorer gate never took")
    time.sleep(2)
def steps(drive: Drive) -> None:
    gate(drive)
    words = json.dumps({"folder": str(drive.folder), "back": [], "ahead": []})
    drive.run(f"orden.workspace.openUnsaved('explorer', {json.dumps(words)}, 'keys'); return true")
    if not until(lambda: drive.run("return document.querySelectorAll('.explorer .rows [data-index]').length") == 4, 20):
        raise SystemExit("the explorer never listed its folder")
    forward(drive.app, drive.pid)
    time.sleep(0.5)
    drive.run("document.querySelector('.explorer .rows [data-entry]')?.focus(); return true")
    drive.key("b")
    check(drive.focused() == "beta.txt", f"1. b reaches beta.txt ({drive.focused()})")
    drive.key("Delete")
    check(until(lambda: "beta.txt" not in drive.on_disk()), f"1. Delete puts beta.txt in the trash ({drive.on_disk()})")
    check(until(lambda: drive.focused() == "gamma.txt"), f"1. the keyboard stays on the next row, gamma.txt ({drive.focused()})")
    drive.key("z", ctrl=True)
    check(until(lambda: "beta.txt" in drive.on_disk()), f"1. Ctrl+Z right after brings beta.txt back ({drive.on_disk()})")
    until(lambda: drive.run("return document.querySelectorAll('.explorer .rows [data-index]').length") == 4)
    focused = drive.focused()
    drive.key("Up")
    walked = until(lambda: drive.focused() in ("alpha.txt", "beta.txt", "docs") and drive.focused() != focused)
    check(bool(walked), f"2. the arrows still walk the list ({focused} then {drive.focused()})")
    drive.key("g")
    check(drive.focused() == "gamma.txt", f"3. g reaches gamma.txt ({drive.focused()})")
    away = pathlib.Path(tempfile.mkdtemp(prefix="orden-keys-away-"))
    shutil.move(str(drive.folder / "gamma.txt"), str(away / "gamma.txt"))
    check(until(lambda: drive.run("return document.querySelectorAll('.explorer .rows [data-index]').length") == 3, 15), "3. the explorer hears gamma.txt go")
    check(until(lambda: drive.focused() == "beta.txt"), f"3. the keyboard stays on the row before, beta.txt ({drive.focused()})")
    shutil.move(str(away / "gamma.txt"), str(drive.folder / "gamma.txt"))
    shutil.rmtree(away, ignore_errors=True)
    until(lambda: drive.run("return document.querySelectorAll('.explorer .rows [data-index]').length") == 4, 15)
    drive.key("a", ctrl=True)
    drive.key("Delete")
    check(until(lambda: drive.on_disk() == []), f"4. Ctrl+A and Delete put everything in the trash ({drive.on_disk()})")
    check(until(lambda: drive.focused() == "the list"), f"4. the keyboard stays on the empty list ({drive.focused()})")
    drive.key("z", ctrl=True)
    check(until(lambda: len(drive.on_disk()) == 4), f"4. Ctrl+Z brings it all back ({drive.on_disk()})")
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    config = config_of(args.identifier)
    fresh(config)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-keys-spaces-"))
    folder = pathlib.Path(tempfile.mkdtemp(prefix="orden-keys-"))
    for name in ("alpha.txt", "beta.txt", "gamma.txt"):
        (folder / name).write_text(name, encoding="utf-8")
    (folder / "docs").mkdir()
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen(
        [str(args.exe)],
        env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)},
        cwd=str(args.exe.parent),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        app = endpoint(config, process.pid, secret, 30)
        if not app.until("return !!orden.workspace?.activeSpace", 90):
            raise SystemExit("the app never opened a space")
        steps(Drive(app, process.pid, folder))
    finally:
        ended(process, gentle=True)
        log.close()
        shutil.rmtree(folder, ignore_errors=True)
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "results.json").write_text(json.dumps({"failures": failures}, indent=2), encoding="utf-8")
    say(f"\n{'FAILED ' + str(len(failures)) if failures else 'the keyboard stayed in the list each time its row went'}")
    return 1 if failures else 0
if __name__ == "__main__":
    sys.exit(main())
