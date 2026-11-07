from __future__ import annotations

import argparse
import http.server
import json
import pathlib
import random
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import importlib

drive = importlib.import_module("web-tab-drive")

PAGES: dict[str, str] = {
    "plain": "<!doctype html><title>plain</title><p>a page",
    "busy": "<!doctype html><title>busy</title><script>setTimeout(() => { for (;;) {} }, 300)</script><p>busy",
    "leave": "<!doctype html><title>leave</title><script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = '' })</script><input autofocus value=typed><p>leave",
    "alert": "<!doctype html><title>alert</title><script>setTimeout(() => alert('hello'), 200)</script><p>alert",
    "confirm": "<!doctype html><title>confirm</title><script>setTimeout(() => confirm('sure?'), 200)</script><p>confirm",
    "popup": "<!doctype html><title>popup</title><script>setTimeout(() => window.open(location.origin + '/plain?p', '_blank', 'popup,width=300,height=300'), 200)</script><p>popup",
    "big": "<!doctype html><title>big</title><script>for (let i = 0; i < 20000; i++) document.body.append(Object.assign(document.createElement('div'), { textContent: 'row ' + i }))</script>",
    "frames": "<!doctype html><title>frames</title>" + "".join(f"<iframe src='/plain?f{i}'></iframe>" for i in range(8)),
    "redirect": "<!doctype html><title>redirect</title><script>setTimeout(() => location.href = '/plain?r' + Math.random(), 100)</script>",
    "focus": "<!doctype html><title>focus</title><input id=a><script>setInterval(() => a.focus(), 50)</script>",
    "history": "<!doctype html><title>history</title><script>let n = 0; const t = setInterval(() => { history.pushState({}, '', '?h' + n++); if (n > 50) clearInterval(t) }, 20)</script>",
    "geo": "<!doctype html><title>geo</title><script>setTimeout(() => navigator.geolocation.getCurrentPosition(() => {}, () => {}), 200)</script><p>geo",
    "notify": "<!doctype html><title>notify</title><script>setTimeout(() => Notification.requestPermission(), 200)</script><p>notify",
    "framed": "<!doctype html><title>framed</title><script>const f = document.createElement('iframe'); f.src = location.href.includes('localhost') ? location.href.replace('localhost', '127.0.0.1').replace(/framed.*/, 'alert?in') : location.href.replace('127.0.0.1', 'localhost').replace(/framed.*/, 'alert?in'); document.body.append(f); setTimeout(() => location.href = '/plain?left', 1500)</script>",
    "titles": "<!doctype html><title>titles</title><script>let n = 0; setInterval(() => { document.title = 't' + n++ }, 2)</script>",
    "sound": "<!doctype html><title>sound</title><script>const c = new AudioContext(); setInterval(() => { const o = c.createOscillator(); o.connect(c.destination); o.start(); o.stop(c.currentTime + 0.05) }, 100)</script>",
}

SLOW = 25


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        name = urllib.parse.urlparse(self.path).path.strip("/") or "plain"
        if name == "slow":
            time.sleep(SLOW)
            body = b"<!doctype html><title>slow</title><p>slow"
        elif name == "favicon.ico":
            self.send_response(404)
            self.end_headers()
            return
        else:
            body = PAGES.get(name, PAGES["plain"]).encode()
        try:
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass


TAP_ALT = """
for (let i = 0; i < 2; i++) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', code: 'AltLeft', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft', bubbles: true }))
}
return true
"""


def acts(url: str) -> list[tuple[str, str]]:
    names = [*PAGES, "slow"]
    return [
        ("open", "nib.workspace.openPage({u}, 'front'); return true"),
        ("open behind", "nib.workspace.openPage({u}, 'behind'); return true"),
        ("go", "const t = nib.workspace.active; if (t?.kind === 'web') nib.pages.go(t.id, {u}); return true"),
        ("close web", "const w = nib.workspace.tabs.filter((t) => t.kind === 'web'); const t = w[Math.floor(Math.random() * w.length)]; if (t) nib.workspace.close(t.id); return true"),
        ("close active", "const t = nib.workspace.activeTabId; if (t) nib.workspace.close(t); return true"),
        ("open close", "const id = nib.workspace.openPage({u}, 'front'); if (id) setTimeout(() => nib.workspace.close(id), {ms}); return true"),
        ("activate", "const ts = nib.workspace.tabs; const t = ts[Math.floor(Math.random() * ts.length)]; if (t) nib.workspace.activate(t.id); return true"),
        ("split", "nib.workspace.split(Math.random() < 0.5 ? 'row' : 'column'); return true"),
        ("close pane", "nib.workspace.closePane(); return true"),
        ("overview", TAP_ALT),
        ("back", "const t = nib.workspace.active; if (t?.kind === 'web') nib.workspace.goBack(t.id, 'plain'); return true"),
        ("reload", "const t = nib.workspace.active; if (t?.kind === 'web') nib.pages.step(t.id, 'reload'); return true"),
        ("reopen", "nib.workspace.reopenClosed(); return true"),
        ("private", "nib.workspace.openWebsite(true); return true"),
        ("new tab", "nib.workspace.newTab(); return true"),
        ("note", "nib.workspace.openBlank('N' + Math.random(), '# N\\n\\nwords'); return true"),
        ("freeze", "const w = nib.workspace.tabs.filter((t) => t.kind === 'web' && t.id !== nib.workspace.activeTabId); const t = w[Math.floor(Math.random() * w.length)]; if (t) nib.pages.freeze(t.id); return true"),
        ("unload", "const w = nib.workspace.tabs.filter((t) => t.kind === 'web' && t.id !== nib.workspace.activeTabId); const t = w[Math.floor(Math.random() * w.length)]; if (t) nib.pages.park(t.id); return true"),
        ("answer", "const b = [...document.querySelectorAll('.ask[role=\"dialog\"] .rows button, .dialog[role=\"alertdialog\"] .rows button')]; const one = b[Math.floor(Math.random() * b.length)]; one?.click(); return true"),
    ], names


def family(pid: int) -> list[dict[str, Any]]:
    script = (
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,"
        "UserModeTime,KernelModeTime,WorkingSetSize,CommandLine | ConvertTo-Json -Compress"
    )
    told = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True, timeout=120, check=False)
    try:
        every = json.loads(told.stdout)
    except ValueError:
        return []
    kids: dict[int, list[dict[str, Any]]] = {}
    for one in every:
        kids.setdefault(int(one["ParentProcessId"] or 0), []).append(one)
    out: list[dict[str, Any]] = []
    todo = [pid]
    seen = {pid}
    while todo:
        for one in kids.get(todo.pop(), []):
            if int(one["ProcessId"]) in seen:
                continue
            seen.add(int(one["ProcessId"]))
            line = one.get("CommandLine") or ""
            kind = line.split("--type=", 1)[1].split(" ", 1)[0] if "--type=" in line else "browser"
            out.append({"pid": int(one["ProcessId"]), "name": one["Name"], "kind": kind, "line": line,
                        "cpu": (int(one["UserModeTime"] or 0) + int(one["KernelModeTime"] or 0)) / 1e7,
                        "mb": int(one["WorkingSetSize"] or 0) // 2**20})
            todo.append(int(one["ProcessId"]))
    return out


def web_browsers(pid: int, config: pathlib.Path) -> list[int]:
    mark = str(config / "web").lower()
    return [one["pid"] for one in family(pid) if one["kind"] == "browser" and one["name"].lower().startswith("msedgewebview2") and mark in one["line"].lower()]


def kill_browsers(pid: int, config: pathlib.Path) -> list[int]:
    gone = web_browsers(pid, config)
    for one in gone:
        subprocess.run(["taskkill", "/F", "/PID", str(one)], capture_output=True, check=False)
    return gone


def waited(app: Any, code: str, seconds: float) -> Any:
    until = time.monotonic() + seconds
    said = None
    while time.monotonic() < until:
        said = app.eval(code, 15).get("value")
        if said:
            return said
        time.sleep(0.5)
    return said


def kill_check(app: Any, pid: int, origin: str, config: pathlib.Path, wrong: list[str], round: int) -> None:
    tab = app.eval(f"return nib.workspace.openPage({json.dumps(origin + '/plain?kill' + str(round))}, 'front')", 15).get("value")
    if not tab:
        wrong.append(f"kill check {round}: no tab opened")
        return
    t = json.dumps(tab)
    live = waited(app, f"return !!nib.pages.peek({t})?.live", 30)
    before = web_browsers(pid, config)
    killed = kill_browsers(pid, config)
    crashed = waited(app, f"return !!nib.pages.peek({t})?.crashed", 20)
    app.eval(f"nib.workspace.activate({t}); nib.pages.step({t}, 'reload'); return true", 15)
    back = waited(app, f"const p = nib.pages.peek({t}); return !!p?.live && !p.crashed", 40)
    after = web_browsers(pid, config)
    print(f"kill check {round}: live before {live}, browsers {before}, killed {killed}, crashed {crashed}, live after reload {back}, browsers now {after}", flush=True)
    if not crashed:
        wrong.append(f"kill check {round}: the tab did not say its browser ended")
    if not back:
        wrong.append(f"kill check {round}: Reload did not bring the page back")
    app.eval(f"nib.workspace.close({t}); return true", 15)


ORPHANS = """
const kinds = Object.fromEntries(nib.workspace.tabs.map((t) => [t.id, t.kind]))
const born = nib.pages.born ?? new Map()
const gone = nib.pages.gone ?? new Set()
return nib.pages.each().filter(([id]) => kinds[id] !== 'web').map(([id, p]) => [id.slice(0, 8), kinds[id] ?? 'gone', gone.has(id), !!p.live, !!p.opening, !!p.crashed, !!p.inPrivate, !!p.title, (born.get(id) ?? '').split('\\n').slice(2, 9).map((l) => l.trim().replace(/\\(.*\\)$/, '')).join(' < ')])
"""


def census(pid: int) -> str:
    kinds: dict[str, int] = {}
    for one in family(pid):
        kind = one["kind"] if one["name"].lower().startswith("msedgewebview2") else one["name"]
        kinds[kind] = kinds.get(kind, 0) + 1
    return ", ".join(f"{k} {v}" for k, v in sorted(kinds.items()))


def engine_stacks(pid: int) -> None:
    first = {one["pid"]: one for one in family(pid)}
    time.sleep(3)
    then = family(pid)
    busy = []
    for one in then:
        was = first.get(one["pid"], {}).get("cpu", one["cpu"])
        print(f"engine| {one['pid']} {one['kind']} {one['mb']} MB, {one['cpu']:.1f} s cpu, {one['cpu'] - was:+.2f} s in 3 s", flush=True)
        if one["kind"] == "browser" or one["cpu"] - was > 1:
            busy.append(one)
    for one in busy[:4]:
        print(f"engine| stacks of {one['pid']} ({one['kind']})", flush=True)
        stacks(one["pid"], "~0kc 50" if one["kind"] != "browser" else "~*kc 25", "engine")


def stacks(pid: int, which: str = "~*kc 40", tag: str = "stack") -> None:
    kits = pathlib.Path(r"C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe")
    if not kits.exists():
        print("no cdb to read the stacks with", flush=True)
        return
    symbols = f"srv*{tempfile.gettempdir()}\\sym*https://msdl.microsoft.com/download/symbols;{args_exe.parent}"
    told = subprocess.run(
        [str(kits), "-pv", "-p", str(pid), "-y", symbols, "-c", f".reload; {which}; qd"],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    for line in told.stdout.splitlines():
        if line.strip() and not line.startswith(("Symbol search", "Microsoft (R)", "Copyright", "CommandLine")):
            print(f"{tag}| {line}", flush=True)


args_exe = pathlib.Path(".")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--minutes", type=float, default=20)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    global args_exe
    args_exe = args.exe
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{site.server_address[1]}"
    other = f"http://localhost:{site.server_address[1]}"

    config = drive.config_of(args.identifier)
    for _ in range(20):
        shutil.rmtree(config, ignore_errors=True)
        if not config.exists():
            break
        time.sleep(1)
    config.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-freeze-spaces-"))
    dumps = pathlib.Path(tempfile.gettempdir()) / "orden-dumps"
    dumps.mkdir(exist_ok=True)
    for exe in ("orden.exe", "msedgewebview2.exe"):
        key = "HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting\\LocalDumps\\" + exe
        for name, kind, value in (("DumpFolder", "REG_EXPAND_SZ", str(dumps)), ("DumpType", "REG_DWORD", "1"), ("DumpCount", "REG_DWORD", "5")):
            subprocess.run(["reg", "add", key, "/v", name, "/t", kind, "/d", value, "/f"], capture_output=True, check=False)
    process = subprocess.Popen([str(args.exe)], env={**drive.os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    procdump = pathlib.Path(drive.os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / "procdump" / "procdump64.exe"
    if procdump.exists():
        subprocess.Popen([str(procdump), "-accepteula", "-e", "-ma", str(process.pid), str(dumps)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rng = random.Random(args.seed)
    trail: list[str] = []
    wrong: list[str] = []
    try:
        app = drive.endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace").get("value") is not True:
            time.sleep(1)
        time.sleep(2)
        app.eval("nib.workspace.openBlank('One', '# One\\n\\nSome words.'); return true", 20)
        drive.forward(process.pid)
        for round in (1, 2):
            kill_check(app, process.pid, origin, config, wrong, round)
        table, names = acts(origin)
        ends = time.monotonic() + args.minutes * 60
        step = 0
        while time.monotonic() < ends:
            step += 1
            name, code = rng.choice(table)
            page = rng.choice(names)
            base = rng.choice([origin, other])
            url = json.dumps(f"{base}/{page}?{step}")
            code = code.replace("{u}", url).replace("{ms}", str(rng.choice([0, 30, 200, 900])))
            if rng.random() < 0.004:
                trail.append(f"{step} kill browser")
                print(f"step {step}: killed web browsers {kill_browsers(process.pid, config)}", flush=True)
            trail.append(f"{step} {name} {page}")
            asked = time.monotonic()
            said = app.eval(code, 15)
            took = time.monotonic() - asked
            if "error" in said and "timed out" in str(said["error"]).lower():
                wrong.append(f"step {step} ({name} {page}): the endpoint did not answer in 15 s")
            elif took > 5:
                print(f"slow: step {step} {name} {page} took {took:.1f} s", flush=True)
            if process.poll() is not None:
                wrong.append(f"step {step} ({name} {page}): the app exited with {process.returncode & 0xFFFFFFFF:#x}")
                break
            if why := drive.window_answers(process.pid):
                time.sleep(2)
                if process.poll() is not None:
                    wrong.append(f"step {step} ({name} {page}): the app exited with {process.returncode & 0xFFFFFFFF:#x}")
                    break
                wrong.append(f"step {step} ({name} {page}): {why}")
            if not wrong and step % 5 == 0:
                said = app.eval("return nib.workspace.tabs.length", 15)
                if "error" in said:
                    wrong.append(f"step {step}: the app stopped answering a plain question: {said['error']}")
            if not wrong and step % 25 == 0:
                said = app.eval("const t = nib.workspace.active; if (t?.kind !== 'web') return 'none'; const p = nib.pages.of(t.id); return await Promise.race([p.lulling.then(() => 'thawed'), new Promise((go) => setTimeout(() => go('still asleep'), 8000))])", 15)
                if said.get("value") == "still asleep":
                    time.sleep(4)
                    again = app.eval("const t = nib.workspace.active; if (t?.kind !== 'web') return 'none'; const p = nib.pages.of(t.id); return await Promise.race([p.lulling.then(() => 'thawed'), new Promise((go) => setTimeout(() => go('still asleep'), 2000))])", 15)
                    if again.get("value") == "still asleep":
                        wrong.append(f"step {step}: the tab in front is still being put to sleep or woken after 14 s")
            if step % 50 == 0:
                said = app.eval("const p = nib.pages.each().map(([, one]) => one); return [nib.workspace.tabs.length, nib.workspace.tabs.filter((t) => t.kind === 'web').length, p.length, p.filter((one) => one.live).length, p.filter((one) => one.crashed).length]", 15)
                print(f"step {step}: tabs, web tabs, pages, live, crashed {said.get('value')}; {census(process.pid)}", flush=True)
            if step % 250 == 0:
                for one in (app.eval(ORPHANS, 15).get("value") or [])[:40]:
                    print(f"orphan| {one}", flush=True)
            if wrong:
                for one in wrong:
                    print(f"wrong| {one}", flush=True)
                try:
                    stacks(process.pid)
                    engine_stacks(process.pid)
                except (subprocess.TimeoutExpired, OSError) as stuck:
                    print(f"wrong| the stacks could not be read: {stuck}", flush=True)
                time.sleep(5)
                late = app.eval("return nib.workspace.tabs.length", 15)
                answers = drive.window_answers(process.pid)
                wrong.append(f"20 s later: endpoint {late}, window {answers or 'answers'}")
                break
            if process.poll() is not None:
                wrong.append(f"step {step} ({name} {page}): the app exited with {process.returncode}")
                break
            time.sleep(rng.choice([0, 0.05, 0.3, 1.0]))
        print(f"{step} steps", flush=True)
    finally:
        if wrong:
            print("last steps: " + " | ".join(trail[-25:]), flush=True)
        process.kill()
        process.wait(20)
        site.shutdown()
        for line in drive.stalls(args.identifier):
            print(line, flush=True)
        for log in pathlib.Path(drive.os.environ.get("LOCALAPPDATA") or ".").joinpath(args.identifier).glob("**/nib.log"):
            for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
                if " web: " in line or "stall:" in line:
                    print(f"told| {line}", flush=True)
        kits = pathlib.Path(r"C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe")
        engine_dumps = [*dumps.glob("msedgewebview2*.dmp"), *config.glob("**/Crashpad/reports/*.dmp"), *pathlib.Path(drive.os.environ.get("LOCALAPPDATA") or ".").joinpath(args.identifier).glob("**/Crashpad/reports/*.dmp")]
        print(f"engine crash dumps: {len(engine_dumps)}", flush=True)
        for dump in engine_dumps[:4]:
            symbols = f"srv*{tempfile.gettempdir()}\\sym*https://msdl.microsoft.com/download/symbols"
            told = subprocess.run([str(kits), "-z", str(dump), "-y", symbols, "-c", ".ecxr; kc 50; q"], capture_output=True, text=True, timeout=900, check=False)
            print(f"edump| {dump}", flush=True)
            for line in told.stdout.splitlines():
                if line.strip() and not line.startswith(("Symbol search", "Microsoft (R)", "Copyright")):
                    print(f"edump| {line}", flush=True)
        if wrong:
            for log in pathlib.Path(drive.os.environ.get("LOCALAPPDATA") or ".").joinpath(args.identifier).glob("**/nib.log"):
                for line in log.read_text(encoding="utf-8", errors="replace").splitlines()[-40:]:
                    print(f"log| {line}", flush=True)
            kits = pathlib.Path(r"C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe")
            for dump in sorted(dumps.glob("*.dmp"))[-2:]:
                symbols = f"srv*{tempfile.gettempdir()}\\sym*https://msdl.microsoft.com/download/symbols;{args.exe.parent}"
                told = subprocess.run([str(kits), "-z", str(dump), "-y", symbols, "-c", ".ecxr; kc 60; ~*kc 30; q"], capture_output=True, text=True, timeout=900, check=False)
                for line in told.stdout.splitlines():
                    if line.strip() and not line.startswith(("Symbol search", "Microsoft (R)", "Copyright")):
                        print(f"dump| {line}", flush=True)
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
