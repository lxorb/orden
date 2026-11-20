#!/usr/bin/env python3
import argparse
import http.client
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request

import psutil


def listening(pid: int) -> list[int]:
    ports: set[int] = set()
    try:
        root = psutil.Process(pid)
        every = [root, *root.children(recursive=True)]
    except psutil.Error:
        return []
    for one in every:
        try:
            for link in one.net_connections(kind="tcp"):
                if link.status == psutil.CONN_LISTEN:
                    ports.add(link.laddr.port)
        except psutil.Error:
            pass
    return sorted(ports)


def speaks_cdp(port: int) -> str | None:
    for path in ("/json/version", "/json/list", "/json"):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=3) as said:
                body = said.read(65536).decode("utf-8", "replace")
        except (OSError, http.client.HTTPException, ValueError):
            continue
        if "webSocketDebuggerUrl" in body or '"Protocol-Version"' in body:
            return f"{path} answered {body[:200]}"
    return None


def ended(app: subprocess.Popen) -> None:
    try:
        family = psutil.Process(app.pid).children(recursive=True)
    except psutil.Error:
        family = []
    app.terminate()
    try:
        app.wait(15)
    except subprocess.TimeoutExpired:
        app.kill()
    for one in family:
        try:
            one.kill()
        except psutil.Error:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    extension = pathlib.Path(tempfile.mkdtemp())
    (extension / "manifest.json").write_text(
        json.dumps({"manifest_version": 3, "name": "Pipe probe", "version": "1.0"}), encoding="utf-8"
    )
    env = {**os.environ, "ORDEN_BROWSER_PIPE_PROBE": str(extension), "ORDEN_SPACES_DIR": tempfile.mkdtemp()}
    env.pop("ORDEN_CEF_DEBUG_PORT", None)
    if sys.platform.startswith("linux"):
        env["ORDEN_CEF_ARGS"] = "no-sandbox"
    logged = args.out / "app.log"
    with open(logged, "wb") as log:
        app = subprocess.Popen([str(args.exe)], env=env, stdout=log, stderr=subprocess.STDOUT, cwd=str(args.exe.parent))
    wrong: list[str] = []
    said = None
    stop = time.monotonic() + 300
    while time.monotonic() < stop and app.poll() is None:
        text = logged.read_text(encoding="utf-8", errors="replace")
        said = next((line for line in text.splitlines() if line.startswith("browser pipe: ")), None)
        if said:
            break
        time.sleep(1)
    print(said or "browser pipe: nothing said", flush=True)
    if app.poll() is not None:
        wrong.append(f"the app ended with {app.returncode} before the pipe answered")
    elif not said or not said.startswith("browser pipe: ok") or '"id"' not in said:
        wrong.append(f"Extensions.loadUnpacked over the browser pipe did not give an id: {said}")
    time.sleep(5)
    ports = listening(app.pid)
    print(f"the app listens on {ports}", flush=True)
    for port in ports:
        cdp = speaks_cdp(port)
        if cdp:
            wrong.append(f"port {port} speaks the DevTools protocol: {cdp}")
    ended(app)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
