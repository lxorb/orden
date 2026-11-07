from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any

HOME = pathlib.Path(__file__).resolve().parent.parent / "apps/desktop/src-tauri/src/old_home.rs"


def said_in_home(name: str) -> str:
    found = re.search(rf'const {name}: &str = "([^"]+)";', HOME.read_text(encoding="utf-8"))
    if not found:
        raise SystemExit(f"{HOME} names no {name}")
    return found.group(1)


OLD = said_in_home("OLD")
NEW = said_in_home("NEW")
SPACE = "Work"
PLAN = "Projects/Plan.md"
GROCERIES = "Lists/Groceries.md"
LATER = "Lists/Later.md"
NOTES = {
    PLAN: "# Plan\n\n- [ ] ship the carry\n",
    GROCERIES: "# Groceries\n\n- [ ] buy oat milk\n",
    LATER: "# Later\n\n- [ ] read the letter\n",
    "Diary.md": "# Diary\n\n- [ ] a box that is only a box\n",
}


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def ask(self, verb: str, args: dict[str, Any], seconds: float = 60) -> Any:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                answer = json.loads(said.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}
        return answer.get("value") if answer.get("ok", answer.get("status") == "ok") else answer

    def eval(self, code: str, seconds: float = 60) -> Any:
        return self.ask("eval", {"code": code, "yes": True}, seconds)

    def until(self, code: str, seconds: float = 60) -> Any:
        last: Any = None
        stop = time.monotonic() + seconds
        while time.monotonic() < stop:
            last = self.eval(code)
            if last not in (None, False) and not (isinstance(last, dict) and "error" in last):
                return last
            time.sleep(0.5)
        return last


def roaming(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def local(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier


def endpoint(config: pathlib.Path, pid: int, secret: str, seconds: float = 120) -> App:
    path = config / "automation.json"
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"the app never wrote {path}")


def allow(config: pathlib.Path) -> str:
    config.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(
        json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8"
    )
    return secret


def clean() -> None:
    for identifier in (OLD, NEW):
        for base in (roaming(identifier), local(identifier)):
            for one in [base, *base.parent.glob(f"{identifier}*")]:
                shutil.rmtree(one, ignore_errors=True)


SPACE_ROOT = """
(async () => {
  const space = orden.workspace.spaces.find((one) => one.name === %(space)s)
  return space ? space.root : null
})()
"""

MARK = """
(async () => {
  const ws = orden.workspace
  const space = ws.spaces.find((one) => one.name === %(space)s)
  if (!space) return null
  for (const [path, patch] of %(patches)s) ws.itemMeta.setMany(space.root, { [path]: patch })
  return space.root
})()
"""

META = """
(() => {
  const ws = orden.workspace
  const space = ws.spaces.find((one) => one.name === %(space)s)
  if (!space) return null
  return ws.itemMeta.itemsOf(space.root)
})()
"""


DIAGNOSE = """
(async () => {
  const keys = Object.keys(localStorage).sort()
  const meta = localStorage.getItem('orden:item-meta')
  const former = await orden.invoke('former_homes').catch((error) => 'error: ' + String(error))
  return {
    keys,
    carried: localStorage.getItem('orden:home-carried'),
    metaRoots: meta ? Object.keys(JSON.parse(meta)) : null,
    spaces: orden.workspace.spaces.map((one) => [one.name, one.root]),
    former,
  }
})()
"""


def listing(name: str) -> None:
    for identifier in (OLD, NEW):
        for base in (roaming(identifier), local(identifier)):
            if not base.exists():
                print(f"{name}: {base} is not there", flush=True)
                continue
            found = sorted(
                str(one.relative_to(base)) for one in base.rglob("*") if len(one.relative_to(base).parts) <= 4
            )
            print(f"{name}: {base} holds {found[:60]}", flush=True)


class Run:
    def __init__(self, exe: pathlib.Path, identifier: str, out: pathlib.Path, name: str) -> None:
        self.exe, self.identifier, self.out, self.name = exe, identifier, out, name
        self.process: subprocess.Popen[bytes] | None = None
        self.app: App | None = None

    def start(self) -> App:
        secret = allow(roaming(self.identifier))
        log = open(self.out / f"{self.name}.log", "ab")
        self.process = subprocess.Popen(
            [str(self.exe)], cwd=str(self.exe.parent), stdout=log, stderr=subprocess.STDOUT
        )
        stop = time.monotonic() + 180
        while True:
            try:
                self.app = endpoint(roaming(self.identifier), self.process.pid, secret, 20)
                break
            except RuntimeError:
                if time.monotonic() > stop:
                    raise
                self.process = self.relaunched() or self.process
        self.app.until("!!orden.workspace", 120)
        time.sleep(3)
        self.app.eval(
            "for (const one of document.querySelectorAll('button'))"
            " if (one.textContent.trim() === 'Keep running') one.click(); return true"
        )
        return self.app

    def relaunched(self) -> subprocess.Popen[bytes] | None:
        if self.process is None or self.process.poll() is None:
            return None
        found = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-Process | Where-Object {{ $_.Path -eq '{self.exe}' }} | Select-Object -First 1).Id"],
            capture_output=True, text=True,
        ).stdout.strip()
        if not found:
            return None
        print(f"{self.name}: the app started again as {found}", flush=True)
        return _Adopted(int(found))  # type: ignore[return-value]

    def stop(self) -> None:
        time.sleep(6)
        subprocess.run(["taskkill", "/IM", self.exe.name], capture_output=True)
        time.sleep(4)
        subprocess.run(["taskkill", "/F", "/IM", self.exe.name], capture_output=True)
        time.sleep(8)


class _Adopted:
    def __init__(self, pid: int) -> None:
        self.pid = pid

    def poll(self) -> int | None:
        return None


def tasks_text(app: App) -> str:
    return json.dumps(app.ask("tasks.list", {}))


def wait_for(app: App, words: list[str], seconds: float = 120) -> str:
    stop = time.monotonic() + seconds
    text = ""
    while time.monotonic() < stop:
        text = tasks_text(app)
        if all(one in text for one in words):
            return text
        time.sleep(1)
    return text


def old_profile(exe: pathlib.Path, out: pathlib.Path, wrong: list[str]) -> None:
    spaces = local(OLD) / "Spaces" / SPACE
    for path, text in NOTES.items():
        (spaces / path).parent.mkdir(parents=True, exist_ok=True)
        (spaces / path).write_text(text, encoding="utf-8")
    run = Run(exe, OLD, out, "old")
    app = run.start()
    root = app.until(SPACE_ROOT % {"space": json.dumps(SPACE)}, 60)
    print(f"old: the space is at {root}", flush=True)
    patches = [[GROCERIES, {"todo-list": "yes", "inbox": "yes"}]]
    app.until(MARK % {"space": json.dumps(SPACE), "patches": json.dumps(patches)}, 30)
    text = wait_for(app, ["ship the carry", "buy oat milk"])
    print(f"old: the todos {text}", flush=True)
    if "buy oat milk" not in text or "ship the carry" not in text:
        wrong.append(f"the old build never showed its own todos: {text}")
    print(f"old: the meta {json.dumps(app.eval(META % {'space': json.dumps(SPACE)}))}", flush=True)
    run.stop()
    listing("old stopped")


def upgraded(exe: pathlib.Path, out: pathlib.Path, name: str, wrong: list[str], more: list[str]) -> App:
    run = Run(exe, NEW, out, name)
    app = run.start()
    root = app.until(SPACE_ROOT % {"space": json.dumps(SPACE)}, 90)
    print(f"{name}: the space is at {root}", flush=True)
    if not isinstance(root, str) or NEW not in root:
        wrong.append(f"{name}: the space is not under {NEW}: {root}")
    print(f"{name}: inside {json.dumps(app.eval(DIAGNOSE))}", flush=True)
    listing(name)
    words = ["ship the carry", "buy oat milk", *more]
    text = wait_for(app, words)
    print(f"{name}: the todos {text}", flush=True)
    for one in words:
        if one not in text:
            wrong.append(f"{name}: the todo '{one}' is gone after the update")
    if "a box that is only a box" in text:
        wrong.append(f"{name}: a box in a plain note became a todo")
    meta = app.eval(META % {"space": json.dumps(SPACE)})
    print(f"{name}: the meta {json.dumps(meta)}", flush=True)
    if not isinstance(meta, dict) or (meta.get(GROCERIES) or {}).get("inbox") != "yes":
        wrong.append(f"{name}: the chosen inbox is not marked any more: {meta}")
    run.stop()
    shutil.copytree(local(NEW) / "logs", out / f"{name}-logs", dirs_exist_ok=True)
    return app


def half_moved(old_exe: pathlib.Path, new_exe: pathlib.Path, out: pathlib.Path, wrong: list[str]) -> None:
    old_profile(old_exe, out, wrong)
    held = open(local(OLD) / "held-open", "w", encoding="utf-8")
    print(f"half: {OLD}'s own folder is held open, so the first start cannot move it", flush=True)
    run = Run(new_exe, NEW, out, "half-first")
    app = run.start()
    root = app.until(SPACE_ROOT % {"space": json.dumps(SPACE)}, 30)
    print(f"half-first: the space is at {root}", flush=True)
    if isinstance(root, str):
        patches = [[LATER, {"todo-list": "yes"}]]
        app.until(MARK % {"space": json.dumps(SPACE), "patches": json.dumps(patches)}, 30)
        print(f"half-first: the todos {tasks_text(app)}", flush=True)
    run.stop()
    held.close()
    os.remove(local(OLD) / "held-open")
    later = ["read the letter"] if isinstance(root, str) else []
    upgraded(new_exe, out, "half-after", wrong, later)
    aside = list(local(NEW).glob("EBWebView.after-move-*"))
    print(f"half: put aside {[one.name for one in aside]}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--names", action="store_true", help="say the old and the new identifier")
    parser.add_argument("--old-exe", type=pathlib.Path)
    parser.add_argument("--new-exe", type=pathlib.Path)
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    if args.names:
        print(f"{OLD} {NEW}")
        return 0
    if not (args.old_exe and args.new_exe and args.out):
        raise SystemExit("--old-exe, --new-exe and --out are needed")
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows only")
    if os.environ.get("CI") != "true":
        raise SystemExit(f"this drive empties {OLD} and {NEW}; it runs on a throwaway CI machine only")
    args.out.mkdir(parents=True, exist_ok=True)
    wrong: list[str] = []
    for name, drive in (
        ("moved", lambda: (old_profile(args.old_exe, args.out, wrong), upgraded(args.new_exe, args.out, "moved", wrong, []))),
        ("half", lambda: half_moved(args.old_exe, args.new_exe, args.out, wrong)),
    ):
        clean()
        print(f"== {name}", flush=True)
        try:
            drive()
        except Exception as error:  # noqa: BLE001 - one drive's failure is reported, the next still runs
            wrong.append(f"{name}: {error!r}")
        subprocess.run(["taskkill", "/F", "/IM", args.new_exe.name], capture_output=True)
        subprocess.run(["taskkill", "/F", "/IM", args.old_exe.name], capture_output=True)
        time.sleep(5)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    (args.out / "wrong.json").write_text(json.dumps(wrong, indent=1), encoding="utf-8")
    print(f"{len(wrong)} wrong", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
