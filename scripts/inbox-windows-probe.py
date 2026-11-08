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

EACH = 15
failures: list[str] = []


def say(words: str) -> None:
    print(words, flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    say(f"WRONG: {words}")


def config_dir(identifier: str) -> pathlib.Path:
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dirs(identifier: str) -> list[pathlib.Path]:
    if sys.platform == "darwin":
        home = pathlib.Path.home() / "Library"
        return [home / "WebKit" / identifier, home / "Caches" / identifier]
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return [pathlib.Path(local) / identifier]


class App:
    def __init__(self, exe: pathlib.Path, identifier: str, secret: str, env: dict[str, str]) -> None:
        self.identifier, self.secret = identifier, secret
        self.process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent))
        path = config_dir(identifier) / "automation.json"
        until = time.monotonic() + 150
        self.port = 0
        while time.monotonic() < until and not self.port:
            try:
                said = json.loads(path.read_text(encoding="utf-8-sig"))
                if said.get("port") and int(said.get("pid") or 0) == self.process.pid:
                    self.port = int(said["port"])
                    crash_told.told(self.port, secret)
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        if not self.port:
            raise SystemExit(f"the app never wrote {path}")

    def eval(self, code: str, seconds: float = 45) -> Any:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                answer = json.loads(said.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            return {"error": f"{refused.code}: {refused.read().decode('utf-8', 'replace')}"}
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}
        if isinstance(answer, dict) and "value" in answer:
            return answer["value"]
        return answer

    def until(self, code: str, seconds: float = 90) -> Any:
        said: Any = None
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            said = self.eval(code)
            if said is True or (said and not (isinstance(said, dict) and "error" in said)):
                return said
            time.sleep(1)
        return said

    def stop(self) -> None:
        ended(self.process, 30, gentle=True)


SETUP = """
const i = window.__TAURI_INTERNALS__
if (!window.__deafened) {
  window.__deafened = true
  window.__refused = 0
  const deaf = (command) => command === 'automation_claim' && Date.now() < (window.__deafUntil ?? 0)
  const fetched = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '')
    if (deaf(decodeURIComponent(url.split('?')[0].split('/').at(-1) ?? ''))) {
      window.__refused++
      return Promise.resolve(new Response('false', {
        headers: { 'Tauri-Response': 'ok', 'content-type': 'application/json' },
      }))
    }
    return fetched(input, init)
  }
  const real = i.invoke
  try {
    i.invoke = (command, args, options) => {
      if (!deaf(command)) return real(command, args, options)
      window.__refused++
      return Promise.resolve(false)
    }
  } catch {}
  window.__listen = () => real('automation_listening')
  window.__warned = []
  const warn = console.warn
  console.warn = (...said) => {
    const words = said.map(String).join(' ')
    if (words.includes('of the account inbox')) window.__warned.push(words)
    warn(...said)
  }
}
const root = orden.workspace.shownSpaces[0]?.root
if (!root) return null
const sep = root.includes('\\\\') ? '\\\\' : '/'
window.__inbox = root.replace(/[\\\\/]+$/, '') + sep + '.orden-inbox.md'
window.__legacy = root.replace(/[\\\\/]+$/, '') + sep + '.Inbox.md'
window.__add = async (words) => {
  const path = window.__inbox
  const before = (await orden.workspace.noteText(path)) ?? ''
  const gap = before && !before.endsWith('\\n') ? '\\n' : ''
  await orden.workspace.writeNoteText(path, before, before + gap + '- [ ] ' + words + '\\n')
}
window.__todos = async () =>
  ((await orden.workspace.noteText(window.__inbox)) ?? '')
    .split('\\n').filter((line) => /^- \\[.\\] /.test(line)).map((line) => line.slice(6))
return { label: i.metadata?.currentWindow?.label ?? null, inbox: window.__inbox }
"""

DEAF = """
const i = window.__TAURI_INTERNALS__
window.__deafUntil = Date.now() + %d
setTimeout(() => void window.__listen(), %d + 100)
return i.metadata?.currentWindow?.label ?? null
"""

LABEL = "return window.__TAURI_INTERNALS__.metadata?.currentWindow?.label ?? null"

SHOWN = """
await orden.workspace.open(window.__inbox)
for (let i = 0; i < 100 && !document.querySelector('.view-tab .task'); i++)
  await new Promise((go) => setTimeout(go, 100))
await new Promise((go) => setTimeout(go, 1500))
return [...document.querySelectorAll('.view-tab .task .words')].map((one) => one.textContent.trim())
"""


def ready(app: App, want_main: bool) -> dict[str, Any] | None:
    deadline = time.monotonic() + 120
    said: Any = None
    while time.monotonic() < deadline:
        said = app.eval(SETUP)
        if isinstance(said, dict) and said.get("inbox") and (said.get("label") == "main") == want_main:
            return said
        time.sleep(1)
    wrong(f"no {'main' if want_main else 'second'} window answered: {said}")
    return None


def todos(app: App) -> list[str]:
    said = app.eval("return await window.__todos()")
    return said if isinstance(said, list) else []


def once(found: list[str], wanted: list[str], where: str) -> None:
    twice = sorted({one for one in found if found.count(one) > 1})
    if twice:
        wrong(f"[{where}] more than once: {twice}")
    missing = [one for one in wanted if one not in found]
    if missing:
        wrong(f"[{where}] missing: {missing}")
    else:
        say(f"[{where}] all {len(wanted)} there, once each")


def warned(app: App, where: str) -> None:
    said = app.eval("return window.__warned ?? []")
    if said:
        wrong(f"[{where}] a command asked for the inbox as a file: {said}")


def deafen_main(app: App, seconds: int) -> dict[str, Any] | None:
    app.eval(DEAF % (seconds * 1000, seconds * 1000))
    found = ready(app, want_main=False)
    if not found:
        say(f"refused by main: {app.eval('return window.__refused')}")
    return found


def main_again(app: App) -> None:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if app.eval(LABEL) == "main":
            return
        time.sleep(1)
    wrong("the main window never listened again")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier; refusing to wipe it")

    config = config_dir(args.identifier)
    for path in local_dirs(args.identifier):
        shutil.rmtree(path, ignore_errors=True)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-inbox-spaces-"))
    env = {**os.environ, "ORDEN_SPACES_DIR": str(spaces)}

    wanted: list[str] = []
    app = App(args.exe, args.identifier, secret, env)
    try:
        first = ready(app, want_main=True)
        if not first:
            return 1
        say(f"the inbox is asked at {first['inbox']}")
        say(f"[main window] the Inbox view opens empty: {app.eval(SHOWN)}")

        app.eval(
            "const words = '- [ ] Legacy one\\n- [ ] Legacy two\\n';"
            "await orden.invoke('write_note', { path: window.__legacy, content: words });"
            "orden.links.noteSaved(window.__legacy, words); return true"
        )
        moved = app.until(
            "const all = await window.__todos();"
            "const there = await orden.invoke('path_exists', { path: window.__legacy }).catch(() => true);"
            "return all.includes('Legacy one') && all.includes('Legacy two') && there === false"
        )
        if moved is not True:
            wrong(f"the old .Inbox.md was not moved in: {todos(app)}")
        wanted += ["Legacy one", "Legacy two"]

        app.eval("await window.__add('Main first'); return true")
        wanted.append("Main first")
        app.eval("await orden.invoke('new_window'); return true")
        time.sleep(8)
        say(f"windows: {app.eval('return (await orden.invoke(\'plugin:window|get_all_windows\').catch((e) => String(e)))')}")
        say(f"invoke writable: {app.eval('return JSON.stringify(Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__, \'invoke\'), (k, v) => typeof v === \'function\' ? \'fn\' : v)')}")

        at = app.eval("return Date.now() + 60000")
        app.eval(
            "const at = %d; window.__burst = (async () => {"
            " await new Promise((go) => setTimeout(go, at - Date.now()));"
            " for (let n = 0; n < %d; n++) await window.__add('main ' + n) })(); return true" % (at, EACH)
        )
        second = deafen_main(app, 35)
        if not second:
            return 1
        say(f"the second window is {second['label']}")
        once(todos(app), wanted, "second window, at once")
        shown = app.eval(SHOWN)
        say(f"[second window] the Inbox view shows {shown}")
        if not isinstance(shown, list) or "Main first" not in shown:
            wrong(f"[second window] the Inbox view lacks what the main window wrote: {shown}")
        app.eval("await window.__add('Second first'); return true")
        wanted.append("Second first")
        app.eval(
            "const at = %d; window.__burst = (async () => {"
            " await new Promise((go) => setTimeout(go, at - Date.now()));"
            " for (let n = 0; n < %d; n++) await window.__add('second ' + n) })(); return true" % (at, EACH)
        )
        main_again(app)
        wanted += [f"main {n}" for n in range(EACH)] + [f"second {n}" for n in range(EACH)]

        wait = max(0.0, (at - int(app.eval("return Date.now()") or 0)) / 1000) + 30
        say(f"both windows write {EACH} to-dos at the same moment; waiting {wait:.0f}s")
        time.sleep(wait)
        app.until("await window.__burst; return true", 120)
        app.until("return (await window.__todos()).includes('second %d')" % (EACH - 1), 60)
        once(todos(app), wanted, "main window, after both wrote")
        shown = app.eval(SHOWN)
        if not isinstance(shown, list) or "second 1" not in shown or "Second first" not in shown:
            wrong(f"[main window] the Inbox view lacks what the second window wrote: {shown}")
        warned(app, "main window")

        if deafen_main(app, 25):
            app.until("await window.__burst; return true", 120)
            once(todos(app), wanted, "second window, after both wrote")
            shown = app.eval(SHOWN)
            if not isinstance(shown, list) or "main 1" not in shown:
                wrong(f"[second window] the Inbox view lacks what the main window wrote: {shown}")
            warned(app, "second window")
            main_again(app)
    finally:
        app.stop()

    again = App(args.exe, args.identifier, secret, env)
    try:
        if ready(again, want_main=True):
            again.until("return (await window.__todos()).length > 0", 60)
            once(todos(again), wanted, "started again")
            warned(again, "started again")
    finally:
        again.stop()

    inbox_files = [str(one) for one in spaces.rglob("*") if "inbox" in one.name.lower()]
    if inbox_files:
        wrong(f"files for the inbox in the space: {inbox_files}")

    say("PASS" if not failures else f"FAIL: {len(failures)} wrong")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
