from __future__ import annotations

import argparse
import atexit
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

PORT_FROM = 23840
PORT_TO = 23859

SPACE = "Default browser probe"
NOTE = "Idea"

def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            name = self.path.strip("/") or "home"
            body = f"<!doctype html><title>{name}</title><h1>{name}</h1>".encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made

def spaces_root() -> pathlib.Path:

    made = pathlib.Path(tempfile.mkdtemp(prefix="orden-browser-probe-"))
    os.environ["ORDEN_SPACES_DIR"] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
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

def endpoint(identifier: str, seconds: float, pid: int) -> tuple[int, str]:

    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said.get("pid") or 0) == pid:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path} for pid {pid}: is another probe running?")

def allow_eval(identifier: str) -> None:

    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))

def act(port: int, secret: str, verb: str, args: dict[str, object]) -> object:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as answer:
            return json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return {"ok": False, "error": f"no answer: {error}"}

def ask(port: int, secret: str, code: str) -> object:
    said = act(port, secret, "eval", {"code": code, "yes": True})
    if not isinstance(said, dict) or not said.get("ok"):
        return {"error": said}
    value = said.get("value")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value

TABS = r"""
(() => {
  const ws = orden.workspace
  const front = ws.tabs.find((one) => one.id === ws.activeTabId)
  const pane = front ? front.paneId : null
  const strip = ws.tabs.filter((one) => one.paneId === pane)
  return JSON.stringify({
    strip: strip.map((one) => (one.kind === 'web' ? one.address ?? '' : `${one.kind}:${one.name}`)),
    front: front ? (front.kind === 'web' ? front.address ?? '' : `${front.kind}:${front.name}`) : null,
  })
})()
"""

PRESS = r"""
(async () => {
  const call = window.__TAURI_INTERNALS__.invoke
  const is = await call('default_browser').catch((error) => `failed: ${error}`)
  const made = await call('make_default_browser').then(() => 'made', (error) => String(error))
  return JSON.stringify({ is, made })
})()
"""

def tabs(port: int, secret: str) -> dict[str, object]:
    said = ask(port, secret, TABS)
    return said if isinstance(said, dict) else {"error": said}

def settled_tabs(port: int, secret: str, want: int) -> dict[str, object]:

    until = time.perf_counter() + 60
    said: dict[str, object] = {}
    while time.perf_counter() < until:
        said = tabs(port, secret)
        strip = said.get("strip")
        if isinstance(strip, list) and sum(1 for one in strip if str(one).startswith("http")) >= want:
            return said
        time.sleep(0.3)
    return said

def shown(pid: int) -> None:

    until = time.perf_counter() + 60
    while not main_window(pid):
        if time.perf_counter() > until:
            raise SystemExit("the app never showed a window")
        time.sleep(0.1)

def hand_over(exe: pathlib.Path, *args: str) -> None:

    second = run_probe(exe, quiet=True, args=args)
    try:
        second.wait(timeout=30)
    except subprocess.TimeoutExpired:
        second.kill()
        raise SystemExit(f"a second launch with {args} did not hand over and exit") from None

def photograph(pid: int, out: pathlib.Path) -> None:

    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-Pid",
            str(pid),
            "-Out",
            str(out),
        ],
        check=False,
        capture_output=True,
    )

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    parsed.add_argument("--keep-eval", action="store_true")
    options = parsed.parse_args()

    wipe(options.identifier)
    port = free_port()
    serve(port)
    site = f"http://127.0.0.1:{port}"
    space = spaces_root() / SPACE
    space.mkdir(parents=True)
    (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")

    wrong: list[str] = []
    said: dict[str, object] = {}
    running: subprocess.Popen[bytes] | None = None
    try:
        running = run_probe(options.exe, quiet=True)
        port_, secret = endpoint(options.identifier, 90, running.pid)
        shown(running.pid)
        act(port_, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        allow_eval(options.identifier)

        running = run_probe(options.exe, quiet=True, args=["--url", f"{site}/cold"])
        port_, secret = endpoint(options.identifier, 90, running.pid)
        shown(running.pid)
        time.sleep(3)
        cold = settled_tabs(port_, secret, 1)
        said["cold"] = cold
        if f"{site}/cold" not in (cold.get("strip") or []):
            wrong.append(f"a launch for a link did not open it: {cold}")
        if cold.get("front") != f"{site}/cold":
            wrong.append(f"the link a launch was for is not the tab in front: {cold}")

        hand_over(options.exe, "--url", f"{site}/one")
        hand_over(options.exe, "--url", f"{site}/two?a=1|2")
        warm = settled_tabs(port_, secret, 3)
        said["warm"] = warm
        strip = [str(one) for one in (warm.get("strip") or [])]
        expected = [f"{site}/cold", f"{site}/one", f"{site}/two?a=1|2"]
        webs = [one for one in strip if one.startswith("http")]
        if webs != expected:
            wrong.append(f"links while running did not land beside, in order: {strip}")
        if warm.get("front") != expected[-1]:
            wrong.append(f"the last link is not the tab in front: {warm}")

        note = str(space / f"{NOTE}.md")
        hand_over(options.exe, "--url", pathlib.Path(note).as_uri())
        hand_over(options.exe, "--url", note)
        hand_over(options.exe, pathlib.Path(note).as_uri())
        time.sleep(2)
        after = tabs(port_, secret)
        said["refused"] = after
        if after.get("strip") != warm.get("strip"):
            wrong.append(f"a file handed over as a link opened something: {after}")

        hand_over(options.exe, "--url", f"{site}/smuggled", note)
        smuggled = settled_tabs(port_, secret, 4)
        said["smuggled"] = smuggled
        added = [str(one) for one in (smuggled.get("strip") or []) if one not in (after.get("strip") or [])]
        if len(added) != 1 or not added[0].startswith(f"{site}/smuggled"):
            wrong.append(f"a path smuggled after a link opened as something else: {added}")

        press = ask(port_, secret, PRESS)
        said["press"] = press
        if not isinstance(press, dict) or press.get("made") == "made":
            wrong.append(f"a probe was allowed to ask to be the default browser: {press}")
        if isinstance(press, dict) and not isinstance(press.get("is"), bool):
            wrong.append(f"whether Orden is the default browser was not answered: {press}")

        ask(port_, secret, "nib.settings.show('general')")
        hwnd = main_window(running.pid)
        if hwnd:
            sized(hwnd, 1180, 900)
        time.sleep(1.5)
        ask(
            port_,
            secret,
            "document.querySelector('.pane')?.scrollTo({ top: 1e6 })",
        )
        time.sleep(0.8)
        out = options.shots / "default-browser-row.png"
        photograph(running.pid, out)
        said["shot"] = str(out)
    finally:
        if running and running.poll() is None:
            running.terminate()

    for name, value in said.items():
        print(f"{name:8} {value}")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    sys.exit(main())
