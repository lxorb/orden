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
import urllib.error
import urllib.request
from typing import Any

import crash_told
from fresh_app import ended, fresh

WINDOWS = sys.platform == "win32"
WITHIN = 20

WATCH = """(() => {
  if (window.__wire) return true
  window.__wire = []
  window.__seen = []
  const t0 = performance.now()
  const note = (words) => {
    if (window.__wire.length < 300)
      window.__wire.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${words}`)
  }
  addEventListener('unhandledrejection', (event) => window.__seen.push(String(event.reason?.stack ?? event.reason)))
  addEventListener('error', (event) => window.__seen.push(String(event.error?.stack ?? event.message)))
  const fetched = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : (input?.url ?? ''))
    const command = url.split('?')[0].split('/').at(-1) ?? ''
    const asked = fetched(input, init)
    if (!command.startsWith('wire_') && !command.includes('__TAURI_CHANNEL__')) return asked
    const body = init?.body
    const size = body && typeof body !== 'string' && 'byteLength' in body ? ` ${body.byteLength} bytes` : ''
    note(`> ${command}${size}`)
    asked.then(
      (answer) => note(`< ${command} ${answer.status} ${answer.headers.get('Tauri-Response') ?? ''}`),
      (error) => note(`< ${command} failed: ${error}`),
    )
    return asked
  }
  return true
})()"""

STATE = """JSON.stringify({
  qr: !!document.querySelector('.add-chat [aria-label="QR code"] svg'),
  screen: document.querySelector('.add-chat .screen')?.innerText ?? null,
  problem: document.querySelector('.add-chat .failed .reason')?.innerText ?? null,
})"""


def say(words: str) -> None:
    print(words, flush=True)


def config_dir(identifier: str, home: pathlib.Path | None) -> pathlib.Path:
    if WINDOWS:
        roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
        return pathlib.Path(roaming) / identifier
    return (home or pathlib.Path.home()) / ".config" / identifier


class App:
    def __init__(self, exe: pathlib.Path, identifier: str) -> None:
        self.home: pathlib.Path | None = None
        env = {**os.environ, "ORDEN_SPACES_DIR": tempfile.mkdtemp(prefix="orden-wa-spaces-")}
        if not WINDOWS:
            self.home = pathlib.Path(tempfile.mkdtemp(prefix="orden-wa-home-"))
            env.update(
                HOME=str(self.home),
                XDG_CONFIG_HOME=str(self.home / ".config"),
                XDG_DATA_HOME=str(self.home / ".local" / "share"),
                XDG_CACHE_HOME=str(self.home / ".cache"),
                ORDEN_CEF_SANDBOX="off",
                LD_LIBRARY_PATH=str(exe.parent),
            )
        config = config_dir(identifier, self.home)
        fresh(config)
        self.secret = secrets.token_hex(32)
        (config / "automation.json").write_text(
            json.dumps({"port": 0, "secret": self.secret, "eval": True, "pid": 0}), encoding="utf-8"
        )
        if WINDOWS:
            from probe_app import run_probe

            self.process = run_probe(exe, env)
        else:
            self.log = open(self.home / "app.log", "w") if self.home else None
            self.process = subprocess.Popen([str(exe)], env=env, stdout=self.log, stderr=self.log)
        self.port = 0
        until = time.monotonic() + 180
        while time.monotonic() < until and not self.port:
            try:
                said = json.loads((config / "automation.json").read_text(encoding="utf-8-sig"))
                if said.get("port") and int(said.get("pid") or 0) == self.process.pid:
                    self.port = int(said["port"])
                    crash_told.told(self.port, self.secret)
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        if not self.port:
            raise SystemExit("the app wrote no endpoint")

    def eval(self, code: str, seconds: float = 30) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as answer:
                said = json.loads(answer.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}
        return said.get("value") if said.get("ok") else {"error": said}

    def until(self, code: str, seconds: float = 60) -> Any:
        said: Any = None
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            said = self.eval(code)
            if said is True or (said and not (isinstance(said, dict) and "error" in said)):
                return said
            time.sleep(0.5)
        return None

    def stop(self) -> None:
        ended(self.process, 30, gentle=True)
        if self.home:
            shutil.rmtree(self.home, ignore_errors=True)


def connect(app: App, phone: str) -> list[str]:
    wrong: list[str] = []
    if not app.until("!!window.ordenApp && !!document.querySelector('aside')", 150):
        return ["the window never came up"]
    app.eval("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['shown-chats'])); location.reload(); true")
    time.sleep(3)
    if not app.until("!!window.ordenApp && !!document.querySelector('aside')", 120):
        return ["the window never came back after turning chats on"]
    app.eval(
        "(() => { [...document.querySelectorAll('.sheet button')].find((one) => /Continue/.test(one.textContent))?.click(); return true })()"
    )
    app.eval(WATCH)
    app.eval("ordenApp.account.token = 'probe'; ordenApp.account.user = { id: 'probe', email: 'probe@example.org' }; true")
    if not app.until(
        "(() => { const tab = document.querySelector('[aria-label=Chats]'); tab?.click(); return !!tab })()", 30
    ):
        return ["no Chats tab"]
    if not app.until(
        "(() => { const add = document.querySelector('button.add[aria-label^=Add]'); add?.click(); return !!add })()", 30
    ):
        return ["no button to add a chat account"]
    if not app.until(
        "(() => { const one = [...document.querySelectorAll('.add-chat .tile')].find((it) => it.textContent.includes('WhatsApp')); one?.click(); return !!one })()",
        30,
    ):
        return ["WhatsApp is not offered"]
    time.sleep(0.5)
    if phone:
        app.eval(
            "(() => { const field = document.querySelector('.add-chat input[type=tel]'); field.value = %s;"
            " field.dispatchEvent(new Event('input', { bubbles: true })); return true })()" % json.dumps(phone)
        )
    app.eval("(() => { const box = document.querySelector('.add-chat .understood input'); if (!box.checked) box.click(); return true })()")
    time.sleep(0.3)
    app.eval("(() => { document.querySelector('.add-chat form button[type=submit]').click(); return true })()")
    started = time.monotonic()
    last: Any = None
    shown = False
    while time.monotonic() - started < WITHIN + 70:
        state = app.eval(STATE)
        if state != last:
            say(f"{time.monotonic() - started:5.1f}s {state}")
            last = state
        found = json.loads(state) if isinstance(state, str) else {}
        code = found.get("qr") if not phone else "Link with phone number" in (found.get("screen") or "")
        if code:
            took = time.monotonic() - started
            say(f"the {'pairing code' if phone else 'QR code'} came in {took:.1f}s")
            if took > WITHIN:
                wrong.append(f"the code took {took:.0f}s")
            shown = True
            break
        if found.get("problem"):
            wrong.append(f"Connect said: {found['problem']}")
            break
        time.sleep(0.5)
    if not shown and not wrong:
        wrong.append("neither a code nor a reason came")
    say("what the page asked of the native WebSocket:")
    for line in app.eval("window.__wire") or []:
        say(f"  {line}")
    seen = app.eval("window.__seen") or []
    if seen:
        say(f"errors on the page: {seen}")
    return wrong


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--phone", default="")
    args = parser.parse_args()
    if WINDOWS and "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier; refusing to wipe it")
    app = App(args.exe.resolve(), args.identifier)
    try:
        wrong = connect(app, args.phone)
    finally:
        app.stop()
    for one in wrong:
        say(f"WRONG: {one}")
    say("FAIL" if wrong else "PASS")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
