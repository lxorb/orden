"""Does the window go on answering while terminals and the file explorer are worked hard? Windows only.

The user's Windows machine froze several times a day, until Task Manager ended it. This
drives the parts of the app that talk to other processes and the disk the hardest, in
the packaged app, and watches the window the whole time the way Explorer does: a
`WM_NULL` sent with `SendMessageTimeout` and `IsHungAppWindow`, every quarter second,
and one cheap automation verb a second, which is the window's own page answering.

Phases, one app:

* **open**: four Command Prompts and two PowerShells, opened together.
* **flood**: every one lists System32 recursively at once, while keys are typed.
* **paste**: two megabytes pasted into a shell that is not reading its input.
* **ask**: the busy, program and folder questions asked of every terminal in a loop,
  with typing in between.
* **resize**: the window made narrow and wide twenty times while they print.
* **churn**: twenty terminals opened and closed at once, and the flooding ones closed
  while they print.
* **explorer**: a file explorer on System32, its views switched and a search below it.

The verdict is the worst answer of each phase and a non-zero exit when the window was
hung for longer than `--most` seconds, or the page stopped answering.

    python scripts/tools-freeze-drive.py --exe <probe nib.exe> --identifier <probe id>
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import threading
import time

from probe_app import main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent


def borrowed(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tabs = borrowed("tabs", "new-tabs-probe.py")
freeze = borrowed("freeze", "web-freeze-probe.py")
terminal = borrowed("terminal", "terminal-probe.py")


class Watch:
    def __init__(self, hwnd: int, port: int, secret: str) -> None:
        self.hwnd = hwnd
        self.port = port
        self.secret = secret
        self.phase = "launch"
        self.pumps: list[tuple[str, bool, float, bool]] = []
        self.beats: list[tuple[str, bool, float]] = []
        self.going = True

    def start(self) -> None:
        threading.Thread(target=self.pump, daemon=True).start()
        threading.Thread(target=self.beat, daemon=True).start()

    def pump(self) -> None:
        while self.going:
            answered, cost = freeze.ask(self.hwnd)
            hung = bool(freeze.user32.IsHungAppWindow(self.hwnd))
            self.pumps.append((self.phase, answered, cost, hung))
            time.sleep(0.25)

    def beat(self) -> None:
        while self.going:
            began = time.perf_counter()
            said = freeze.act(self.port, self.secret, "window", {}, seconds=10)
            cost = (time.perf_counter() - began) * 1000
            self.beats.append((self.phase, said.startswith('{"ok":true'), cost))
            time.sleep(1.0)

    def longest_hang(self, phase: str) -> float:
        longest = 0.0
        run = 0.0
        for one, answered, cost, hung in self.pumps:
            if one != phase:
                continue
            if not answered or hung:
                run += 0.25 + cost / 1000
                longest = max(longest, run)
            else:
                run = 0.0
        return longest

    def report(self, phase: str) -> tuple[float, float, int]:
        pump = max((cost for one, _, cost, _ in self.pumps if one == phase), default=0.0)
        beat = max((cost for one, _, cost in self.beats if one == phase), default=0.0)
        missed = sum(1 for one, ok, _ in self.beats if one == phase and not ok)
        return pump, beat, missed


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows only")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    freeze.bind_names()

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--most", type=float, default=3.0)
    args = parsed.parse_args()

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-tools-"))
    (spaces / "Tools probe").mkdir(parents=True, exist_ok=True)
    (spaces / "Tools probe" / "A note.md").write_text("# A note\n", encoding="utf-8")
    environment = {**os.environ, "ORDEN_SPACES_DIR": str(spaces)}

    exe = pathlib.Path(args.exe).resolve()
    tabs.wipe(args.identifier)
    first = run_probe(exe, env=environment)
    was, _ = tabs.endpoint(args.identifier, 150)
    tabs.allow_eval(args.identifier)
    first.terminate()
    first.wait(timeout=15)
    time.sleep(6.0)

    app = run_probe(exe, env=environment)
    phases: list[str] = []
    failed_columns = True
    try:
        hwnd = terminal.until(lambda: main_window(app.pid), 120, 0.25)
        if not hwnd:
            raise SystemExit("the window never appeared")
        port, secret = tabs.endpoint(args.identifier, 150, unlike=was)
        window = terminal.Window(port, secret)
        terminal.until(lambda: window.run("1 + 1") == 2, 30)
        watch = Watch(hwnd, port, secret)
        watch.start()

        def phase(name: str) -> None:
            watch.phase = name
            phases.append(name)
            print(f"-- {name}", flush=True)

        time.sleep(3)
        phase("open")
        shells = ["cmd", "cmd", "cmd", "cmd", "powershell", "powershell"]
        opened = [window.open(shell, f"T{at}", f"probe-t{at}") for at, shell in enumerate(shells)]
        time.sleep(8)

        phase("flood")
        flood = (
            "(async () => { const ts = nib.workspace.tabs.filter((one) => one.kind === 'terminal');"
            " for (const one of ts) { nib.workspace.activeTabId = one.id;"
            " await new Promise((r) => setTimeout(r, 300));"
            " const field = document.querySelector('.xterm-helper-textarea');"
            " field && field.dispatchEvent(new InputEvent('input', { data: 'dir /s C:\\\\Windows\\\\System32\\r', inputType: 'insertText', bubbles: true })); }"
            " return ts.length })()"
        )
        print("flooding", window.run(flood), flush=True)
        for _ in range(40):
            window.typed("x")
            time.sleep(0.25)
        time.sleep(5)

        phase("paste")
        window.open("cmd", "Paste", "probe-paste")
        time.sleep(3)
        window.typed("timeout /t 120\r")
        time.sleep(1)
        big = "echo " + ("y" * 120) + "\r"
        paste = (
            "(() => { const field = document.querySelector('.xterm-helper-textarea');"
            " const event = new Event('paste', { bubbles: true, cancelable: true });"
            f" const words = {json.dumps(big)}.repeat(16000);"
            " Object.defineProperty(event, 'clipboardData', { value: { getData: (t) => t === 'text/plain' ? words : '', files: [] } });"
            " field.dispatchEvent(event); return words.length })()"
        )
        print("pasted", window.run(paste), flush=True)
        time.sleep(4)
        window.run("(() => { const b = [...document.querySelectorAll('button')].find((one) => /paste/i.test(one.textContent)); b && b.click(); return !!b })()")
        time.sleep(15)

        phase("ask")
        ask = (
            "(async () => { const inv = window.__TAURI_INTERNALS__.invoke;"
            " const ids = nib.workspace.tabs.filter((one) => one.kind === 'terminal').map((one) => JSON.parse(one.doc || '{}').key).filter(Boolean);"
            " let n = 0; const until = Date.now() + 15000;"
            " while (Date.now() < until) { await Promise.all(ids.flatMap((id) => [inv('pty_busy', { id }).catch(() => 0), inv('pty_program', { id }).catch(() => 0), inv('pty_folder', { id }).catch(() => 0), inv('pty_write', { id, data: '', binary: false }).catch(() => 0)])); n++ }"
            " return n })()"
        )
        print("asked", window.run(ask), flush=True)

        phase("resize")
        resize = (
            "(async () => { const ids = nib.workspace.tabs.filter((one) => one.kind === 'terminal').map((one) => JSON.parse(one.doc || '{}').key).filter(Boolean);"
            " const inv = window.__TAURI_INTERNALS__.invoke;"
            " for (let i = 0; i < 40; i++) { await Promise.all(ids.map((id) => inv('pty_resize', { id, cols: 40 + (i % 2) * 120, rows: 10 + (i % 2) * 40 }).catch(() => 0))); await new Promise((r) => setTimeout(r, 100)) }"
            " return ids.length })()"
        )
        print("resized", window.run(resize), flush=True)
        for at in range(10):
            sized(hwnd, 500 + (at % 2) * 900, 400 + (at % 2) * 500)
            time.sleep(0.4)

        phase("churn")
        for at in range(20):
            window.open("cmd", f"C{at}", f"probe-c{at}")
        time.sleep(3)
        close_all = (
            "(() => { const ws = nib.workspace; const ts = ws.tabs.filter((one) => one.kind === 'terminal');"
            " for (const one of ts) ws.close(one.id); return ts.length })()"
        )
        print("closed", window.run(close_all), flush=True)
        time.sleep(8)

        phase("explorer")
        explorer = (
            "(() => { const ws = nib.workspace;"
            " ws.openUnsaved('explorer', JSON.stringify({ folder: 'C:\\\\Windows\\\\System32', back: [], ahead: [] }), 'System32');"
            " return ws.activeTabId })()"
        )
        print("explorer", window.run(explorer), flush=True)
        time.sleep(10)
        for key in ["2", "3", "1", "2", "3", "1"]:
            window.run(
                "(() => { const press = new KeyboardEvent('keydown', { key: "
                + json.dumps(key)
                + ", ctrlKey: true, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(press); return true })()"
            )
            time.sleep(1.5)
        time.sleep(10)

        phase("columns")
        window.run(
            "(() => { const press = new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true, cancelable: true });"
            " document.activeElement.dispatchEvent(press); return true })()"
        )
        time.sleep(3)
        scroll = (
            "(async () => { const out = [];"
            " for (const column of document.querySelectorAll('.explorer .column')) {"
            " for (let at = 1; at <= 30; at++) { column.scrollTop = (column.scrollHeight - column.clientHeight) * at / 30;"
            " await new Promise((done) => requestAnimationFrame(() => done())) }"
            " await new Promise((done) => setTimeout(done, 300));"
            " const box = column.getBoundingClientRect();"
            " const shown = [...column.querySelectorAll('li')].filter((one) => { const r = one.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom }).length;"
            " out.push([column.scrollHeight > column.clientHeight + 1, shown]) }"
            " return out })()"
        )
        scrolled = window.run(scroll)
        print("columns", scrolled, flush=True)
        if not isinstance(scrolled, list) or not scrolled:
            print("the columns were never shown", flush=True)
            failed_columns = True
        else:
            failed_columns = any(long and shown == 0 for long, shown in scrolled)
            if failed_columns:
                print("a column scrolled to its end shows no rows", flush=True)
        time.sleep(3)
        watch.going = False
        time.sleep(1.5)
    finally:
        try:
            app.terminate()
            app.wait(timeout=20)
        except Exception:  # noqa: BLE001 - a frozen app is killed
            app.kill()

    worst = 0.0
    failed = failed_columns
    for name in phases:
        pump, beat, missed = watch.report(name)
        hang = watch.longest_hang(name)
        worst = max(worst, hang)
        print(f"{name:9} pump worst {pump:7.0f} ms  page worst {beat:7.0f} ms  page missed {missed}  hung {hang:5.1f} s")
        if hang > args.most or missed > 0:
            failed = True
    print(f"longest hang {worst:.1f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
