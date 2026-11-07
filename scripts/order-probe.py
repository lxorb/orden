from __future__ import annotations

import argparse
import atexit
import ctypes
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from probe_app import close_app, run_probe, main_window, sized

SPACES_DIR = "ORDEN_SPACES_DIR"
SPACE = "Order"
SHOTS = pathlib.Path(__file__).resolve().parents[1] / "target" / "order-probe"

ORDERS = [
    ("name", "Name, A to Z"),
    ("name-desc", "Name, Z to A"),
    ("modified-desc", "Modified, newest first"),
    ("modified-asc", "Modified, oldest first"),
    ("created-desc", "Created, newest first"),
    ("created-asc", "Created, oldest first"),
    ("manual", "Manual"),
]

user32 = ctypes.windll.user32 if sys.platform == "win32" else None
problems: list[str] = []

def say(words: str) -> None:
    print(f"  {words}", flush=True)

def wrong(words: str) -> None:
    problems.append(words)
    print(f"  WRONG: {words}", flush=True)

def spaces_root() -> pathlib.Path:
    made = pathlib.Path(tempfile.mkdtemp(prefix="orden-order-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made

TOP = ["zeta", "Note 12", "Note 2", "Note 10", "Alpha", "Note 1", "beta", "Note 3"]
NESTED = {
    "Reading": ["Chapter two", "Chapter one", "Notes on it", "Later", "Earlier"],
    "Reading/Deep": ["Attention", "Residuals", "Scaling"],
    "Work": ["Q3 plan", "Budget", "Hiring", "Retro", "Offsite", "Roadmap"],
    "Work/Q3": ["Week 2", "Week 10", "Week 1", "Week 20"],
    "Archive": ["Last year", "Older still", "Oldest of all"],
}
FILLER = 60 - len(TOP) - sum(len(names) for names in NESTED.values())

def space() -> pathlib.Path:
    made = spaces_root() / SPACE
    made.mkdir(parents=True, exist_ok=True)

    def write(folder: pathlib.Path, name: str, at: float) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{name}.md"
        path.write_text(f"# {name}\n\nwritten for the drive\n", encoding="utf-8")
        os.utime(path, (at, at))

    started = time.time() - 60 * 60 * 24
    step = 0
    for name in TOP:
        write(made, name, started + step * 60)
        step += 1
    for folder, names in NESTED.items():
        for name in names:
            write(made / folder, name, started + step * 60)
            step += 1
    for index in range(FILLER):
        write(made, f"Filler {index + 1}", started + step * 60)
        step += 1

    later = time.time() - 60 * 5
    for name in ("Note 12", "Alpha"):
        path = made / f"{name}.md"
        path.write_text(f"# {name}\n\nwritten in again\n", encoding="utf-8")
        os.utime(path, (later, later))
        later += 60

    return made

def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier

def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier

def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(one, ignore_errors=True)

def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")

def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")

def act(port: int, secret: str, verb: str, args: dict[str, object], seconds: float = 90) -> object:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=seconds) as answer:
            return json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return {"ok": False, "error": f"no answer: {error}"}

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def ask(self, code: str, seconds: float = 90) -> object:
        said = act(self.port, self.secret, "eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value

def launch(exe: pathlib.Path, identifier: str, unlike: int = 0):
    app = run_probe(exe, quiet=True)
    port, secret = endpoint(identifier, 120, unlike)

    hwnd = 0
    until = time.perf_counter() + 120
    while time.perf_counter() < until and not hwnd:
        hwnd = main_window(app.pid)
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    sized(hwnd, 1280, 900)
    time.sleep(2.0)
    return app, App(port, secret)

def stop(app: subprocess.Popen) -> None:
    if close_app(app, 40):
        return
    say("the window would not close when it was asked, so it is being ended")

    subprocess.run(
        ["taskkill", "/T", "/F", "/PID", str(app.pid)], capture_output=True, check=False
    )
    try:
        app.wait(timeout=30)
    except subprocess.TimeoutExpired:
        app.kill()

def shot(pid: int, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    script = pathlib.Path(__file__).resolve().parent / "capture-window.ps1"
    out = SHOTS / f"{name}.png"
    done = subprocess.run(
        ["powershell", "-NoProfile", "-File", str(script), "-Pid", str(pid), "-Out", str(out)],
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        wrong(f"no picture of {name}: {done.stdout} {done.stderr}")
    else:
        say(f"wrote {out.name}: {(done.stdout or '').strip()}")

TOP_NAMES = """JSON.stringify(nib.workspace.shownTree
  ? nib.workspace.shownTree.children.map((one) => one.name) : [])"""

MOVE_ZETA_UP = r"""(() => {
  const path = nib.workspace.activeSpace.root + '\\zeta.md'
  const row = [...document.querySelectorAll('.row[data-path]')].find(
    (one) => one.dataset.path === path,
  )
  if (!row) return false
  row.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowUp', code: 'ArrowUp', altKey: true, bubbles: true, cancelable: true,
  }))
  return true
})()"""

KEPT = """JSON.stringify({
  mode: nib.workspace.sortMode,
  arranged: nib.workspace.arranged.of(nib.workspace.activeSpace.root),
  files: nib.workspace.files.length,
})"""

def showing(app: App) -> None:
    app.ask("nib.workspace.panel === 'tree' ? true : nib.workspace.showPanel('tree')")
    time.sleep(0.8)

def ready(app: App) -> None:
    until = time.perf_counter() + 90
    while time.perf_counter() < until:
        held = app.ask("JSON.stringify(nib.workspace.files.length)")
        if isinstance(held, int) and held >= 50:
            return
        time.sleep(0.5)
    wrong(f"the space never came up: {app.ask(KEPT)}")

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.order")
    args = parsed.parse_args()

    if not args.exe.exists():
        raise SystemExit(f"no exe at {args.exe}")

    made = space()
    say(f"the space is {made}")
    wipe(args.identifier)
    shutil.rmtree(SHOTS, ignore_errors=True)

    app, first = launch(args.exe, args.identifier)
    stop(app)
    allow_eval(args.identifier)
    say(f"eval is on for the probe identifier, whose first launch listened on {first.port}")

    app, talk = launch(args.exe, args.identifier, first.port)
    was_on = talk.port
    arranged_order: list[str] = []
    try:
        ready(talk)
        showing(talk)

        orders: dict[str, list[str]] = {}
        for mode, label in ORDERS:
            talk.ask(f"nib.workspace.setSort({mode!r})")
            time.sleep(0.5)
            names = talk.ask(TOP_NAMES)
            if not isinstance(names, list):
                wrong(f"{mode}: no order came back: {names}")
                continue
            orders[mode] = names
            say(f"{label}: {' | '.join(names[:12])}")
            shot(app.pid, f"order-{mode}")

        folders = ["Archive", "Reading", "Work"]
        for mode, names in orders.items():
            if sorted(names[:3]) != folders:
                wrong(f"{mode} did not put the folders first: {names[:3]}")
        by_name = orders.get("name", [])
        if "Note 2.md" in by_name and by_name.index("Note 2.md") > by_name.index("Note 10.md"):
            wrong("Note 10 came before Note 2, so the digits were spelled rather than counted")
        if orders.get("modified-desc") == orders.get("created-desc"):
            wrong("the modified order and the created order were the same list")
        if orders.get("manual") != by_name:
            wrong("Manual did not start out as name order for a space nobody has arranged")

        talk.ask("nib.workspace.setSort('manual')")
        time.sleep(0.3)
        before = talk.ask(TOP_NAMES)
        pressed = talk.ask(MOVE_ZETA_UP)
        time.sleep(0.6)
        after = talk.ask(TOP_NAMES)
        say(f"after: {' | '.join(after[:12]) if isinstance(after, list) else after}")
        if pressed is not True:
            wrong(f"zeta's row was not in the page to press on: {pressed}")
        if before == after:
            wrong("the move changed nothing")
        if isinstance(after, list):
            arranged_order = after
        shot(app.pid, "order-arranged")

        kept = talk.ask(KEPT)
        say(f"kept: {json.dumps(kept, ensure_ascii=False)}")
        if not isinstance(kept, dict) or not kept.get("arranged"):
            wrong(f"nothing was written down for the space: {kept}")

        time.sleep(1.5)
    finally:
        stop(app)

    app, talk = launch(args.exe, args.identifier, was_on)
    try:
        ready(talk)
        showing(talk)

        kept = talk.ask(KEPT)
        names = talk.ask(TOP_NAMES)
        say(f"after a relaunch: {json.dumps(kept, ensure_ascii=False)}")
        say(f"the order is {' | '.join(names[:12]) if isinstance(names, list) else names}")

        if not isinstance(kept, dict) or kept.get("mode") != "manual":
            wrong(f"the chosen order did not survive the relaunch: {kept}")
        if arranged_order and names != arranged_order:
            wrong(f"the arranged order did not survive:\n  was {arranged_order}\n  now {names}")
        shot(app.pid, "order-relaunched")
    finally:
        stop(app)

    if problems:
        print("\n%d thing(s) were wrong:" % len(problems), flush=True)
        for one in problems:
            print(f"  - {one}", flush=True)
        return 1

    print(f"\nthe built app read the space seven ways and kept the seventh; shots in {SHOTS}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
