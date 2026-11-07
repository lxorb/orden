from __future__ import annotations

import argparse
import http.server
import importlib
import json
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

fuzz = importlib.import_module("freeze-fuzz")
drive = fuzz.drive

STORMS = {
    "quiet": "",
    "title": "let n = 0; setInterval(() => { for (let i = 0; i < 20; i++) document.title = 't' + n++ }, 1)",
    "push": "let n = 0; setInterval(() => { for (let i = 0; i < 20; i++) history.pushState({}, '', '?p=' + n++) }, 1)",
    "replace": "let n = 0; setInterval(() => { for (let i = 0; i < 20; i++) history.replaceState({}, '', '?r=' + n++) }, 1)",
    "hash": "let n = 0; setInterval(() => { for (let i = 0; i < 20; i++) location.hash = 'h' + n++ }, 1)",
    "icon": "let n = 0; setInterval(() => { const l = document.querySelector('link[rel=icon]') || document.head.appendChild(Object.assign(document.createElement('link'), {rel: 'icon'})); l.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22><text y=%2216%22>' + (n++) + '</text></svg>' }, 5)",
    "audio": "const c = new AudioContext(); setInterval(() => { const o = c.createOscillator(); o.connect(c.destination); o.start(); o.stop(c.currentTime + 0.01) }, 20)",
    "print": "setTimeout(() => print(), 300)",
    "full": "setInterval(() => { document.documentElement.requestFullscreen().catch(() => {}); setTimeout(() => document.exitFullscreen().catch(() => {}), 50) }, 120)",
    "open": "setInterval(() => { const w = window.open('about:blank', '_blank'); if (w) w.close() }, 200)",
    "reload": "setTimeout(() => location.reload(), 150)",
    "openurl": "let n = 0; setInterval(() => { for (let i = 0; i < 20; i++) window.open(location.origin + '/quiet?o' + n++) }, 1)",
    "unplayable": "setInterval(() => { for (let i = 0; i < 10; i++) { const v = document.createElement('video'); v.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t'; document.body.append(v); setTimeout(() => v.remove(), 50) } }, 5)",
    "nav": "let n = 0; setInterval(() => { location.replace(location.pathname + '?n' + n++) }, 2)",
    "frames": "setInterval(() => { for (let i = 0; i < 5; i++) { const f = document.createElement('iframe'); f.src = 'about:blank'; document.body.append(f); setTimeout(() => f.remove(), 30) } }, 3)",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        name = self.path.strip("/").split("?")[0] or "quiet"
        body = f"<!doctype html><title>{name}</title><script>{STORMS.get(name, '')}</script><p>{name}".encode()
        try:
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--seconds", type=int, default=20)
    args = parser.parse_args()
    fuzz.args_exe = args.exe

    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{site.server_address[1]}"
    config = drive.config_of(args.identifier)
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-storm-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**drive.os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    bad: list[str] = []
    try:
        app = drive.endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace").get("value") is not True:
            time.sleep(1)
        time.sleep(2)
        note = app.eval("return nib.workspace.openBlank('One', '# One\\n\\nwords')", 20).get("value")
        only = [one for one in drive.os.environ.get('ONLY', '').split(',') if one]
        for name in [one for one in STORMS if not only or one in only]:
            for where in ("front", "behind"):
                tab = app.eval(f"return nib.workspace.openPage({json.dumps(f'{origin}/{name}?{where}')}, 'front')", 20).get("value")
                if where == "behind":
                    time.sleep(1)
                    app.eval(f"nib.workspace.activate({json.dumps(note)}); return true", 20)
                times: list[float] = []
                frames: list[float] = []
                end = time.monotonic() + args.seconds
                while time.monotonic() < end:
                    asked = time.monotonic()
                    said = app.eval("return await new Promise((go) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => go(performance.now() - t))) })", 15)
                    took = time.monotonic() - asked
                    times.append(took)
                    if isinstance(said.get("value"), (int, float)):
                        frames.append(said["value"])
                    if "error" in said:
                        bad.append(f"{name} {where}: the app did not answer: {said['error']}")
                        break
                    if why := drive.window_answers(process.pid):
                        bad.append(f"{name} {where}: {why}")
                        break
                    time.sleep(0.2)
                times.sort()
                frames.sort()
                worst = times[-1] if times else -1
                p90 = times[int(len(times) * 0.9)] if times else -1
                fworst = frames[-1] if frames else -1
                print(f"storm| {name} {where}: {len(times)} asks, p90 {p90 * 1000:.0f} ms, worst {worst * 1000:.0f} ms, two frames worst {fworst:.0f} ms; {fuzz.census(process.pid)}", flush=True)
                if worst > 3:
                    bad.append(f"{name} {where}: worst answer {worst:.1f} s")
                app.eval(f"nib.workspace.close({json.dumps(tab)}); return true", 20)
                time.sleep(1.5)
                if process.poll() is not None:
                    bad.append(f"the app exited with {process.returncode & 0xFFFFFFFF:#x} after {name}")
                    return 1
        count = app.eval("return nib.workspace.tabs.length", 20).get("value")
        print(f"storm| tabs left {count}", flush=True)
    finally:
        process.kill()
        process.wait(20)
        site.shutdown()
        for line in drive.stalls(args.identifier):
            print(f"stall| {line}", flush=True)
        shutil.rmtree(spaces, ignore_errors=True)
        for one in bad:
            print(f"wrong| {one}", flush=True)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
