from __future__ import annotations

import argparse
import ctypes
import json
import os
import pathlib
import secrets
import shutil
import sys
import tempfile
import time
import urllib.request
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe

DWMWA_SYSTEMBACKDROP_TYPE = 38

BACKDROPS = {"mica-alt": 4, "mica": 2, "acrylic": 3, "clear": 1}

failures: list[str] = []

def say(words: str) -> None:
    print(f"  {words}", flush=True)

def wrong(words: str) -> None:
    failures.append(words)
    say(f"WRONG {words}")

def attribute(hwnd: int, which: int) -> int:
    held = ctypes.c_int(0)
    ctypes.windll.dwmapi.DwmGetWindowAttribute(
        wintypes.HWND(hwnd), ctypes.c_uint(which), ctypes.byref(held), ctypes.sizeof(held)
    )
    return held.value

def roaming(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier

def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe's identifier; nothing is wiped")
    shutil.rmtree(roaming(identifier), ignore_errors=True)
    shutil.rmtree(pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier, ignore_errors=True)

def allow_eval(identifier: str) -> pathlib.Path:
    path = roaming(identifier) / "automation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"port": 0, "secret": secrets.token_hex(32), "eval": True}), encoding="utf-8")
    return path

def endpoint(path: pathlib.Path, patience: float = 90) -> dict:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            held = json.loads(path.read_text(encoding="utf-8"))
            if held.get("port") and held.get("secret"):
                return held
        except (OSError, ValueError):
            pass
        time.sleep(0.3)
    raise SystemExit(f"no endpoint at {path} after {patience:.0f}s")

def asked(held: dict, verb: str, args: dict) -> dict:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{held['port']}/",
        data=body,
        headers={"authorization": f"Bearer {held['secret']}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.loads(answer.read().decode())

def ran(held: dict, code: str) -> object:
    try:
        answer = asked(held, "eval", {"code": code, "yes": True})
    except OSError as error:
        return f"unanswered: {error}"
    return answer.get("value") if answer.get("ok") else f"refused: {answer.get('error')}"

def started(exe: pathlib.Path, identifier: str, spaces: pathlib.Path):
    path = allow_eval(identifier)
    app = run_probe(exe, env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, quiet=True)
    held = endpoint(path)
    until = time.monotonic() + 30
    while not main_window(app.pid) and time.monotonic() < until:
        time.sleep(0.2)
    time.sleep(2.5)
    return app, held

def ended(app) -> None:
    if not close_app(app):
        app.kill()
        app.wait(timeout=30)

CHOOSE = """
(() => {
  const kept = JSON.parse(localStorage.getItem('nib:theme-settings') || '{}')
  kept.glass = { ...kept.glass, material: %s }
  localStorage.setItem('nib:theme-settings', JSON.stringify(kept))
  localStorage.setItem('nib:theme', 'glass')
  setTimeout(() => location.reload(), 50)
  return true
})()
"""

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    options = parser.parse_args()

    wipe(options.identifier)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-material-"))
    app, held = started(options.exe, options.identifier, spaces)
    try:
        hwnd = main_window(app.pid)
        for kind, backdrop in BACKDROPS.items():
            ran(held, CHOOSE % json.dumps(kind))
            time.sleep(4)
            found = attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE)
            said = ran(held, "document.documentElement.dataset.translucent ?? ''")
            if found == backdrop or (kind == "clear" and found in (0, 1)):
                say(f"ok   {kind}: DWM draws backdrop {found}, the page says {said!r}")
            else:
                wrong(f"{kind}: DWM draws backdrop {found}, wanted {backdrop}; the page says {said!r}")

        ran(held, CHOOSE % json.dumps("acrylic"))
        time.sleep(4)
    finally:
        ended(app)

    kept = (roaming(options.identifier) / "material.txt").read_text(encoding="utf-8") if (
        roaming(options.identifier) / "material.txt"
    ).exists() else ""
    (say if kept == "acrylic" else wrong)(f"the crate keeps {kept!r} for the next launch")

    app, held = started(options.exe, options.identifier, spaces)
    try:
        found = attribute(main_window(app.pid), DWMWA_SYSTEMBACKDROP_TYPE)
        (say if found == BACKDROPS["acrylic"] else wrong)(f"the next launch stands on backdrop {found}")
    finally:
        ended(app)
        shutil.rmtree(spaces, ignore_errors=True)

    print("\n" + ("every material held" if not failures else f"{len(failures)} wrong"))
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main())
