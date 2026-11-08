from __future__ import annotations

import argparse
import http.server
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from typing import Any
import crash_told
from fresh_app import fresh

SPACE = "Protect probe"
NOTE = "Diary.md"
PASSWORD = "tulip ladder"
WORDS = "the secret words"
PAGE = b"<!doctype html><title>a page</title><p>a page beside the note"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 60) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
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

    def until(self, code: str, seconds: float = 30) -> Any:
        last: Any = None
        stop = time.monotonic() + seconds
        while time.monotonic() < stop:
            last = self.eval(code)
            if last not in (None, False) and not (isinstance(last, dict) and "error" in last):
                return last
            time.sleep(0.25)
        return last


def config_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    stop = time.monotonic() + 120
    while time.monotonic() < stop:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                crash_told.told(int(said["port"]), secret)
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")


FIND = """
(async () => {
  const ws = orden.workspace
  const space = ws.spaces.find((one) => one.name === %(space)s)
  if (!space) return null
  if (ws.activeSpace?.root !== space.root) await ws.showSpace(space.id)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === %(note)s)
  if (!note) return null
  await ws.openEntry(note.path, { activate: true })
  if (ws.panel !== 'tree') ws.showPanel('tree')
  window.__seen = []
  addEventListener('unhandledrejection', (event) => window.__seen.push(String(event.reason)))
  addEventListener('error', (event) => window.__seen.push(String(event.message)))
  return { root: space.root, path: note.path }
})()
"""

DEVICE = """
(async () => {
  const ask = window.__TAURI_INTERNALS__.invoke
  const can = await ask('owner_can').catch((error) => 'error: ' + String(error))
  const began = Date.now()
  const said = await Promise.race([
    ask('owner_check', { reason: 'The protect drive' }).then(
      (yes) => 'answered ' + String(yes),
      (error) => 'refused: ' + String(error),
    ),
    new Promise((done) => setTimeout(() => done('no answer'), 130000)),
  ])
  return { can, said, seconds: (Date.now() - began) / 1000 }
})()
"""

MENU = """
(() => {
  const row = document.querySelector(`.row[data-path="${CSS.escape(%(path)s)}"]`)
  if (!row) return 'no row'
  const box = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    clientX: box.left + 8, clientY: box.top + 4 }))
  return true
})()
"""

PRESS = """
(() => {
  const found = [...document.querySelectorAll(%(where)s)].find((one) => one.textContent.trim() === %(label)s)
  if (!found) return false
  found.click()
  return true
})()
"""

TYPE = """
(() => {
  const fields = [...document.querySelectorAll(%(where)s)]
  if (fields.length < %(count)s) return false
  for (const field of fields.slice(0, %(count)s)) {
    field.value = %(words)s
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return true
})()
"""

SUBMIT = """
(() => {
  const button = document.querySelector('.locked button[type=submit]')
  if (!button || button.disabled) return false
  button.click()
  return true
})()
"""

TROUBLE = "(() => document.querySelector('.track.failed .said')?.textContent ?? '')()"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows only")
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-protect-"))
    (spaces / SPACE).mkdir()
    (spaces / SPACE / NOTE).write_text(f"# Diary\n\n{WORDS}\n", encoding="utf-8")
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(
        json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8"
    )
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen(
        [str(args.exe)],
        env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)},
        cwd=str(args.exe.parent),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    wrong: list[str] = []

    def step(code: str, what: str, seconds: float = 30) -> Any:
        said = app.until(code, seconds)
        if said in (None, False) or (isinstance(said, dict) and "error" in said):
            wrong.append(f"{what}: {said}")
            raise RuntimeError(what)
        print(f"{what}: {json.dumps(said)}", flush=True)
        return said

    try:
        app = endpoint(config, process.pid, secret)
        app.until("!!orden.workspace", 90)
        time.sleep(3)
        app.eval(
            "for (const one of document.querySelectorAll('button'))"
            " if (one.textContent.trim() === 'Keep running') one.click(); return true"
        )
        where = step(FIND % {"space": json.dumps(SPACE), "note": json.dumps(NOTE)}, "the note", 60)

        app.eval(f"nib.workspace.openPage({json.dumps(url)}); return true")
        step(
            "nib.pages.each().some(([, page]) => page.live)",
            "a web page in the window beside the app's own webview",
            60,
        )
        app.eval(FIND % {"space": json.dumps(SPACE), "note": json.dumps(NOTE)}, 60)
        device = app.eval(DEVICE, 140)
        print(f"the device: {json.dumps(device)}", flush=True)
        said = str(device.get("said", "")) if isinstance(device, dict) else ""
        if said == "no answer":
            wrong.append(f"Windows Hello was asked and never answered: {device}")
        elif said.startswith("refused:") and not said.startswith("refused: Windows Hello"):
            wrong.append(f"Windows Hello was never asked, the call was refused: {device}")

        step(MENU % {"path": json.dumps(where["path"])}, "the row's menu")
        step(PRESS % {"where": json.dumps("[role=menuitem]"), "label": json.dumps("Protect")}, "Protect")
        time.sleep(1)
        if app.eval(PRESS % {"where": json.dumps(".orden-screen button"), "label": json.dumps("Password")}):
            print("chose the password over the device", flush=True)
        step(
            TYPE % {"where": json.dumps(".orden-screen input[type=password]"), "count": 2, "words": json.dumps(PASSWORD)},
            "the new password typed",
        )
        step(PRESS % {"where": json.dumps(".orden-screen button[type=submit]"), "label": json.dumps("Protect")}, "the password's Protect")
        step(
            f"nib.workspace.protection.own({json.dumps(where['root'])}, {json.dumps(where['path'])})?.way === 'password'",
            "the note protected with the password",
            60,
        )
        step(
            f"!!document.querySelector(`.row[data-path=\"${{CSS.escape({json.dumps(where['path'])})}}\"] [aria-label=\"Protected\"]`)",
            "the row's lock mark",
        )

        step(MENU % {"path": json.dumps(where["path"])}, "the row's menu again")
        step(PRESS % {"where": json.dumps("[role=menuitem]"), "label": json.dumps("Lock")}, "Lock")
        step("!!document.querySelector('.locked input[type=password]')", "the lock screen")
        if WORDS in str(app.eval("document.querySelector('.pane')?.innerText ?? ''")):
            wrong.append("the lock screen shows the note's words")

        step(TYPE % {"where": json.dumps(".locked input[type=password]"), "count": 1, "words": json.dumps("wrong")}, "a wrong password typed")
        step(SUBMIT, "the wrong password sent")
        step("!!document.querySelector('.locked [role=alert]')", "the wrong password said", 60)
        step(TYPE % {"where": json.dumps(".locked input[type=password]"), "count": 1, "words": json.dumps(PASSWORD)}, "the password typed")
        step(SUBMIT, "the password sent")
        step("!document.querySelector('.locked') && !!document.querySelector('.cm-content')", "the note open again", 60)

        trouble = app.eval(TROUBLE)
        if trouble:
            wrong.append(f"something was said to have failed: {trouble}")
        seen = app.eval("window.__seen")
        if seen:
            wrong.append(f"errors on the page: {seen}")
    except RuntimeError:
        print(f"the trouble line: {app.eval(TROUBLE)}", flush=True)
        print(f"errors on the page: {app.eval('window.__seen')}", flush=True)
    finally:
        process.terminate()
        try:
            process.wait(20)
        except subprocess.TimeoutExpired:
            process.kill()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    (args.out / "wrong.json").write_text(json.dumps(wrong, indent=1), encoding="utf-8")
    print(f"{len(wrong)} wrong", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
