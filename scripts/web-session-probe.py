from __future__ import annotations

import argparse
import ctypes
import http.server
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

from probe_app import close_app, run_probe, main_window, sized

PORT_FROM = 22300
PORT_TO = 22399

SPACES_DIR = "ORDEN_SPACES_DIR"

SPACE = "Web session probe"
NOTE = "Idea"
SITE = "A site I log in to"
BESIDE = "The same site in another tab"
OWN = "The widget's own site"

SID = "NIBSESSION"
PID = "NIBPERSIST"
TOKEN = "NIBTOKEN"
PART = "NIBPART"
IDB = "NIBIDB"

ZOOMED = 1.1

PARTITIONED = f"part={PART}; Path=/; Secure; SameSite=None; Partitioned"

TWIN = f"part={PART}; Path=/; Secure; SameSite=None; Expires=Wed, 03 Nov 2027 00:00:00 GMT"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")

FILLER = """<p>This paragraph is here only so the reader keeps the article rather than the body,
which needs a couple of hundred characters of it before it will. It says nothing that
the line above did not, and the probe reads the markers on that line regardless.</p>"""

APP = """<!doctype html>
<title>App</title>
<body style="margin:0;font:16px system-ui">
<article style="padding:2rem">
WAITING
__FILLER__
</article>
</body>
<script>
  function value(name) {
    var found = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return found ? found[1] : ''
  }
  var sid = value('sid')
  var pid = value('pid')
  var token = ''
  try { token = localStorage.getItem('token') || '' } catch (error) { token = '' }
  // The rest of what a site keeps: an IndexedDB record, a service worker, a permission
  // and the size it is drawn at, each read before the markers are shown.
  function stored() {
    return new Promise(function (done) {
      var open = indexedDB.open('probe', 1)
      open.onupgradeneeded = function () { open.result.createObjectStore('kept') }
      open.onerror = function () { done('') }
      open.onsuccess = function () {
        var asked = open.result.transaction('kept').objectStore('kept').get('idb')
        asked.onsuccess = function () { done(asked.result || '') }
        asked.onerror = function () { done('') }
      }
    })
  }
  function worker() {
    return navigator.serviceWorker.getRegistration('/').then(function (one) {
      return one ? 'registered' : ''
    }, function () { return '' })
  }
  function allowed() {
    return navigator.permissions.query({ name: 'notifications' }).then(function (one) {
      return one.state
    }, function () { return '' })
  }
  var rest = Promise.all([stored(), worker(), allowed()])
  window.addEventListener('message', function (event) {
    if (event.origin !== '__WIDGET__') return
    var part = event.data
    rest.then(function (kept) {
      document.querySelector('article').firstChild.textContent =
        '\\nRESULT|sid:' + sid + '|pid:' + pid + '|token:' + token + '|part:' + part +
        '|idb:' + kept[0] + '|sw:' + kept[1] + '|perm:' + kept[2] +
        '|dpr:' + window.devicePixelRatio + '|END\\n'
    })
  })
  var frame = document.createElement('iframe')
  frame.src = '__WIDGET__/frame'
  document.body.appendChild(frame)
</script>
"""

LOGIN = """<!doctype html>
<title>Signing in</title>
<body style="margin:0;font:16px system-ui"><p>Signing in...</p></body>
<script>
  document.cookie = 'sid=__SID__; path=/'
  document.cookie = 'pid=__PID__; path=/; max-age=99999'
  try { localStorage.setItem('token', '__TOKEN__') } catch (error) {}
  // An IndexedDB record and a service worker, both written before the page leaves.
  var written = new Promise(function (done) {
    var open = indexedDB.open('probe', 1)
    open.onupgradeneeded = function () { open.result.createObjectStore('kept') }
    open.onerror = function () { done() }
    open.onsuccess = function () {
      var putting = open.result.transaction('kept', 'readwrite')
      putting.objectStore('kept').put('__IDB__', 'idb')
      putting.oncomplete = function () { done() }
      putting.onerror = function () { done() }
    }
  })
  var registered = navigator.serviceWorker.register('/sw.js').then(function () {
    return navigator.serviceWorker.ready
  }, function () {})
  window.addEventListener('message', function (event) {
    if (event.origin !== '__WIDGET__') return
    Promise.all([written, registered]).then(function () { location.replace('/app') })
  })
  var frame = document.createElement('iframe')
  frame.src = '__WIDGET__/frame-login'
  document.body.appendChild(frame)
</script>
"""

WORKER = "self.addEventListener('fetch', function () {})\n"

ASK = """<!doctype html>
<title>Asking</title>
<body><p>Asking</p></body>
<script>Notification.requestPermission()</script>
"""

FRAME = """<!doctype html>
<script>
  var found = document.cookie.match(/(?:^|; )part=([^;]*)/)
  parent.postMessage(found ? found[1] : '', '*')
</script>
"""

OWN_PAGE = """<!doctype html>
<title>Widget</title>
<body style="margin:0;font:16px system-ui">
<article style="padding:2rem">
WAITING
__FILLER__
</article>
</body>
<script>
  var found = document.cookie.match(/(?:^|; )part=([^;]*)/)
  document.querySelector('article').firstChild.textContent =
    '\\nRESULT|own:' + (found ? found[1] : '') + '|END\\n'
</script>
"""

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

def widget(port: int) -> str:

    return f"http://localhost:{port}"

def serve(port: int) -> Server:
    def page(text: str) -> bytes:
        return (
            text.replace("__SID__", SID)
            .replace("__PID__", PID)
            .replace("__TOKEN__", TOKEN)
            .replace("__WIDGET__", widget(port))
            .replace("__FILLER__", FILLER)
            .replace("__IDB__", IDB)
            .encode()
        )

    pages = {
        "/login": page(LOGIN),
        "/app": page(APP),
        "/frame": page(FRAME),
        "/frame-login": page(FRAME),
        "/own": page(OWN_PAGE),
        "/plant": page(OWN_PAGE),
        "/ask": page(ASK),
        "/sw.js": WORKER.encode(),
    }
    cookies = {"/frame-login": PARTITIONED, "/plant": TWIN}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            body = pages.get(path)
            self.send_response(200 if body else 404)
            kind = "text/javascript" if path.endswith(".js") else "text/html; charset=utf-8"
            self.send_header("content-type", kind)
            if path in cookies:
                self.send_header("set-cookie", cookies[path])
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made

def spaces_root() -> pathlib.Path:

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-session-probe-"))
    os.environ[SPACES_DIR] = str(made)
    return made

def shortcut(url: str, title: str) -> str:
    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Nib-Added=2026-09-13T08:00:00.000Z\r\n"
    )

def space(port: int) -> pathlib.Path:

    made = spaces_root() / SPACE
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(
        f"# {NOTE}\n\nAn ordinary note, to switch away to.\n", encoding="utf-8"
    )
    (made / f"{SITE}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/app", SITE), encoding="utf-8"
    )
    (made / f"{BESIDE}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/app", BESIDE), encoding="utf-8"
    )
    (made / f"{OWN}.url").write_text(shortcut(f"{widget(port)}/own", OWN), encoding="utf-8")
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

class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def open(self, path: str, space_name: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space_name:
            args["space"] = space_name
        return act(self.port, self.secret, "open", args)

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

TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  id: one.id, kind: one.kind, name: one.name, path: one.path,
})))"""

def tab_of(app: App, name: str) -> str | None:
    said = app.ask(TABS)
    if not isinstance(said, list):
        return None
    for one in said:
        if isinstance(one, dict) and str(one.get("name", "")).startswith(name):
            return str(one.get("id"))
    return None

def wait_for_tab(app: App, name: str, seconds: float = 25) -> str:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        found = tab_of(app, name)
        if found:
            return found
        time.sleep(0.3)
    raise SystemExit(f"the app never opened {name}")

def seen(app: App, tab: str, seconds: float = 20) -> dict[str, str]:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        said = app.ask(
            "window.__TAURI_INTERNALS__.invoke('web_clip', { tab: '"
            + tab
            + "', selection: false })"
        )
        html = said.get("html") if isinstance(said, dict) else None
        if isinstance(html, str):
            found = re.search(r"RESULT\|(.*?)\|END", html)
            if found:
                return {
                    name: value
                    for name, _, value in (pair.partition(":") for pair in found[1].split("|"))
                }
        time.sleep(0.4)
    return {}

def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret = endpoint(identifier, 90, unlike)

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        hwnd = main_window(app.pid)
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    sized(hwnd, 1280, 860)
    time.sleep(1.5)
    return app, App(port, secret)

def quit(app: subprocess.Popen[bytes]) -> None:

    if not close_app(app):
        app.kill()
        raise SystemExit("the app did not quit when its window was closed")

def logged_in(state: dict[str, str]) -> bool:
    return (
        state.get("sid") == SID
        and state.get("pid") == PID
        and state.get("token") == TOKEN
        and state.get("part") == PART
    )

def kept_the_rest(state: dict[str, str], base: float) -> bool:

    try:
        ratio = float(state.get("dpr", "0")) / base
    except ValueError:
        ratio = 0.0
    return (
        state.get("idb") == IDB
        and state.get("sw") == "registered"
        and state.get("perm") == "granted"
        and abs(ratio - ZOOMED) < 0.02
    )

def apart(state: dict[str, str]) -> bool:

    return state.get("own") == ""

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    made = space(port)
    url_file = made / f"{SITE}.url"

    said: dict[str, object] = {}
    running = None
    ok = True
    try:
        running, app = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(args.identifier)
        time.sleep(1)

        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)

        def navigate(on: str, url: str) -> object:
            return app.ask(
                "window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '"
                + on
                + f"', url: '{url}' }})"
            )

        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        said["signed out to begin with"] = seen(app, tab)

        navigate(tab, f"http://127.0.0.1:{port}/login")
        time.sleep(4)

        said["signed in"] = seen(app, tab)
        ok = ok and logged_in(said["signed in"])
        base = float(said["signed in"].get("dpr", "1") or "1")

        navigate(tab, f"http://127.0.0.1:{port}/ask")
        bubble = ".ask .nib-button:not(.is-quiet)"
        until = time.perf_counter() + 15
        while time.perf_counter() < until and not app.ask(f"!!document.querySelector('{bubble}')"):
            time.sleep(0.3)
        said["the bubble asked"] = app.ask(f"!!document.querySelector('{bubble}')")
        app.ask(f"document.querySelector('{bubble}')?.click(); true")
        time.sleep(1)

        navigate(tab, f"http://127.0.0.1:{port}/app")
        time.sleep(3)
        app.ask(
            "window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal',"
            " ctrlKey: true, bubbles: true, cancelable: true })); true"
        )
        time.sleep(1.5)
        said["zoomed to"] = app.ask(f"nib.pages.of('{tab}').zoom")
        ok = ok and said["zoomed to"] == ZOOMED

        app.open(f"{OWN}.url")
        own = wait_for_tab(app, OWN)
        time.sleep(3)
        said["the widget's own site after signing in"] = seen(app, own)
        ok = ok and apart(said["the widget's own site after signing in"])

        navigate(own, f"{widget(port)}/plant")
        time.sleep(3)
        planted = seen(app, own)
        said["a copy without the partition, planted"] = planted
        ok = ok and planted.get("own") == PART
        navigate(own, f"{widget(port)}/own")
        time.sleep(3)
        said["the copy after the next page load"] = seen(app, own)
        ok = ok and apart(said["the copy after the next page load"])
        navigate(tab, f"http://127.0.0.1:{port}/app")
        time.sleep(3)
        said["the partitioned cookie after the copy went"] = seen(app, tab)
        ok = ok and logged_in(said["the partitioned cookie after the copy went"])
        app.ask(f"nib.workspace.close('{own}')")
        time.sleep(1)

        said["the file the keeper wrote"] = (
            url_file.read_text(encoding="utf-8").replace("\r\n", " | ").strip()
        )
        url_file.write_text(shortcut(f"http://127.0.0.1:{port}/app", SITE), encoding="utf-8")

        app.open(f"{BESIDE}.url")
        beside = wait_for_tab(app, BESIDE)
        time.sleep(3)
        alongside = seen(app, beside)
        said["a second tab open at once"] = alongside
        said["two tabs share one session"] = alongside.get("sid") == SID
        app.ask(f"nib.workspace.close('{beside}')")
        time.sleep(1)

        app.ask(f"nib.workspace.close('{tab}')")
        time.sleep(2)
        said["closed"] = tab_of(app, SITE) is None

        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        after = seen(app, tab)
        said["after close and reopen"] = after
        said["session kept on reopen"] = after.get("sid") == SID
        said["still logged in on reopen"] = logged_in(after)
        ok = ok and logged_in(after)

        quit(running)
        time.sleep(2)
        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        relaunched = seen(app, tab)
        said["after relaunch"] = relaunched
        said["still logged in on relaunch"] = logged_in(relaunched)
        ok = ok and logged_in(relaunched)
        navigate(tab, f"http://127.0.0.1:{port}/app")
        time.sleep(3)
        relaunched = seen(app, tab)
        said["after relaunch, loaded again"] = relaunched
        said["the rest kept on relaunch"] = kept_the_rest(relaunched, base)
        said["the tab's zoom on relaunch"] = app.ask(f"nib.pages.of('{tab}').zoom")
        ok = ok and kept_the_rest(relaunched, base) and said["the tab's zoom on relaunch"] == ZOOMED

        app.open(f"{OWN}.url")
        own = wait_for_tab(app, OWN)
        time.sleep(3)
        said["the widget's own site after relaunch"] = seen(app, own)
        ok = ok and apart(said["the widget's own site after relaunch"])
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
        shutil.rmtree(made.parent, ignore_errors=True)

    print(json.dumps(said, indent=2))
    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1

if __name__ == "__main__":
    raise SystemExit(main())
