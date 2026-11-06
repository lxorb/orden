from __future__ import annotations

import argparse
import base64
import ctypes
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
from ctypes import wintypes

from devtools import Session, debugged, port, targets
from probe_app import run_probe, sized

TOP: dict[str, str] = {
    "uBlock Origin Lite": "https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh",
    "Bitwarden": "https://chromewebstore.google.com/detail/bitwarden-password-manager/nngceckbapebfimnlniiiahkandclblb",
    "Dark Reader": "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh",
    "1Password": "https://chromewebstore.google.com/detail/1password-password-manager/aeblfdkhhhdcdjpifhhbdiojplfjncoa",
    "Grammarly": "https://chromewebstore.google.com/detail/grammarly-ai-writing-and-grammar/kbfnbcaeplbcioakkpcpgfkobkghlhen",
    "Google Translate": "https://chromewebstore.google.com/detail/google-translate/aapbdbdomjkkjkaonfhkkikfgjllcleb",
    "Vimium": "https://chromewebstore.google.com/detail/vimium/dbepggeogbaibhgnhhndojpepiihcmeb",
    "React Developer Tools": "https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi",
    "Honey": "https://chromewebstore.google.com/detail/honey-automatic-coupons-re/bmnlcjabgnpnenekpadlanbbkooimhnj",
    "LastPass": "https://chromewebstore.google.com/detail/lastpass-free-password-ma/hdokiejnpimakedhajhdlcegeplioahd",
    "uBlock Origin Lite (Edge Add-ons)": "https://microsoftedge.microsoft.com/addons/detail/ublock-origin-lite/cimighlppcgcoapaliogpjjdehbnofhn",
}

SPACE = "Extensions probe"
NOTE = "Idea"
SITE = "Shop"

PAGE = b"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Shop</title></head>
<body>
<h1>Willkommen im Laden</h1>
<p>Dies ist ein Satz mit einem Fehlr, den eine Rechtschreibhilfe finden sollte.</p>
<form action="/login" method="post">
  <input type="email" name="email" autocomplete="username" placeholder="E-Mail">
  <input type="password" name="password" autocomplete="current-password" placeholder="Passwort">
  <button>Anmelden</button>
</form>
<textarea>Ein Feld zum Schreiben.</textarea>
<p class="price">CHF 49.90</p>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
  onload="document.title += ' ad-loaded'" onerror="document.title += ' ad-blocked'"></script>
</body></html>
"""

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

def serve() -> int:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(PAGE)))
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *_args: object) -> None:
            return

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        free = sock.getsockname()[1]
    made = Server(("127.0.0.1", free), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return free

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

class App:
    def __init__(self, at: int, secret: str) -> None:
        self.at = at
        self.secret = secret

    def act(self, verb: str, args: dict[str, object], seconds: float = 120) -> object:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.at}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=seconds) as answer:
                return json.loads(answer.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}

    def open(self, path: str, space: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space:
            args["space"] = space
        return self.act("open", args)

    def ask(self, code: str, seconds: float = 120) -> object:
        said = self.act("eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value

    def invoke(self, command: str, args: dict[str, object] | None = None) -> object:
        return self.ask(
            f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args or {})})"
            ".then((said) => JSON.stringify({ ok: true, said }), (why) => JSON.stringify({ ok: false, why: String(why) }))"
        )

TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({ id: one.id, kind: one.kind, name: one.name })))"""

def tabs(app: App) -> list[dict[str, str]]:
    said = app.ask(TABS)
    return [one for one in said if isinstance(one, dict)] if isinstance(said, list) else []

def wait_for_tab(app: App, name: str, seconds: float = 25) -> str:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        for one in tabs(app):
            if str(one.get("name", "")).startswith(name):
                return str(one["id"])
        time.sleep(0.3)
    raise SystemExit(f"the app never opened {name}: {app.ask(TABS)}")

def windows_of(pid: int) -> list[int]:
    assert user32 is not None
    found: list[int] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found

GONE = 120

def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    running = run_probe(exe, env=debugged(), quiet=True)
    at, secret = endpoint(identifier, 90, unlike)
    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = windows_of(running.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")
    sized(hwnd, 1280, 860)
    time.sleep(1.5)
    return running, App(at, secret)

def shoot(target: dict | None, to: pathlib.Path) -> None:

    if target is None:
        return
    to.parent.mkdir(parents=True, exist_ok=True)
    session = Session(target)
    try:
        said = session.call("Page.captureScreenshot", {"format": "png"})
        if "data" in said:
            to.write_bytes(base64.b64decode(said["data"]))
    finally:
        session._socket.close()

def interface(identifier: str) -> dict | None:

    at = port(local_dir(identifier))
    if not at:
        return None
    for one in targets(at):
        if one.get("type") == "page" and "tauri" in str(one.get("url", "")):
            return one
    return None

def page_target(web_port: int, prefix: str) -> dict | None:
    for one in targets(web_port):
        if one.get("type") == "page" and str(one.get("url", "")).startswith(prefix):
            return one
    return None

def worlds(target: dict) -> dict[str, str]:

    session = Session(target)
    try:
        session.call("Runtime.enable")
        session.listen(1.5)
        found: dict[str, str] = {}
        for event in session.events:
            if event.get("method") != "Runtime.executionContextCreated":
                continue
            context = event["params"]["context"]
            origin = str(context.get("origin", ""))
            if origin.startswith("chrome-extension://"):
                found[origin.removeprefix("chrome-extension://").strip("/")] = str(context.get("name", ""))
        return found
    finally:
        session._socket.close()

def page_says(target: dict, expression: str) -> object:
    session = Session(target)
    try:
        return session.value(expression)
    finally:
        session._socket.close()

def main() -> int:
    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.extensions")
    parsed.add_argument("--shots", type=pathlib.Path, default=None)
    parsed.add_argument("--only", default="")
    args = parsed.parse_args()

    wipe(args.identifier)
    at = serve()
    site = f"http://127.0.0.1:{at}/shop"

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-extensions-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(root / "spaces")
    space = root / "spaces" / SPACE
    space.mkdir(parents=True)
    (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note.\n", encoding="utf-8")
    (space / f"{SITE}.url").write_text(f"[InternetShortcut]\r\nURL={site}\r\nTitle={SITE}\r\n", encoding="utf-8")

    chosen = {name: link for name, link in TOP.items() if not args.only or name in args.only.split(",")}
    report: dict[str, dict[str, object]] = {name: {} for name in chosen}
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=GONE)
        allow_eval(args.identifier)
        time.sleep(1)
        running, app = launch(args.exe, args.identifier, unlike=app.at)

        until = time.perf_counter() + 60
        while time.perf_counter() < until and not isinstance(app.ask("nib.workspace.tabs.length"), int):
            time.sleep(0.5)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(2)
        app.open(f"{SITE}.url", SPACE)
        tab = wait_for_tab(app, SITE)
        time.sleep(4)

        for name, link in chosen.items():
            started = time.perf_counter()
            said = app.invoke("extensions_install", {"link": link})
            ok = isinstance(said, dict) and said.get("ok") is True
            shown = said.get("said") if ok and isinstance(said, dict) else None
            report[name]["installed"] = ok
            report[name]["install s"] = round(time.perf_counter() - started, 1)
            if ok and isinstance(shown, dict):
                report[name]["id"] = shown.get("id")
                report[name]["version"] = shown.get("version")
                report[name]["popup page"] = shown.get("popup")
                report[name]["name"] = shown.get("name")
                report[name]["options page"] = shown.get("options")
            else:
                report[name]["why"] = said
            print(name, json.dumps(report[name]), flush=True)

        time.sleep(3)
        app.invoke("web_step", {"tab": tab, "step": "reload"})
        time.sleep(8)

        web = config_dir(args.identifier) / "web"
        web_port = port(web)
        listed = app.invoke("extensions_list")
        report["(list)"] = {"said": listed}
        if not web_port:
            report["(engine)"] = {"why": "no debugging port in the web store"}
        else:
            target = page_target(web_port, site)
            ran = worlds(target) if target else {}
            title = page_says(target, "document.title") if target else None
            react = page_says(target, "typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__") if target else None
            dark = page_says(target, "document.documentElement.getAttribute('data-darkreader-scheme') || (document.querySelector('style.darkreader') ? 'style' : null)") if target else None
            fetched = page_says(target, "performance.getEntriesByType('resource').some((one) => one.name.includes('googlesyndication'))") if target else None
            everything = targets(web_port)
            report["(page)"] = {"title": title, "ad script fetched": fetched, "react hook": react, "dark reader": dark, "worlds": ran}
            for name in chosen:
                one = report[name]
                ident = str(one.get("id") or "")
                if not ident:
                    continue
                one["content"] = ident in ran
                one["background"] = any(
                    str(t.get("url", "")).startswith(f"chrome-extension://{ident}/")
                    and t.get("type") in ("service_worker", "background_page", "other", "shared_worker")
                    for t in everything
                )

            for name in chosen:
                one = report[name]
                ident = str(one.get("id") or "")
                if not ident or not one.get("popup page"):
                    continue
                press = (
                    "(() => { const all = [...document.querySelectorAll('.webbar button.extension')];"
                    f" const one = all.find((b) => b.title === {json.dumps(str(one.get('name') or ''))});"
                    " one?.click(); return JSON.stringify(!!one) })()"
                )
                one["button"] = app.ask(press)
                time.sleep(3)
                popup = page_target(web_port, f"chrome-extension://{ident}/")
                one["popup"] = bool(popup) and page_says(popup, "document.body ? document.body.innerText.trim().length + document.body.querySelectorAll('*').length : 0")
                one["bubble"] = app.ask("JSON.stringify((() => { const b = document.querySelector('.popup.nib-bubble'); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })())")
                if args.shots:
                    shoot(interface(args.identifier), args.shots / f"popup-{ident}-bubble.png")
                    shoot(popup or None, args.shots / f"popup-{ident}.png")
                app.ask(press)
                time.sleep(0.8)

            for name in chosen:
                one = report[name]
                ident = str(one.get("id") or "")
                if not ident or not one.get("options page"):
                    continue
                address = f"chrome-extension://{ident}/{one['options page']}"
                app.ask(f"nib.workspace.openPage({json.dumps(address)}, 'front')")
                time.sleep(3)
                options = page_target(web_port, f"chrome-extension://{ident}/")
                one["options"] = bool(options) and page_says(options, "document.body ? document.body.querySelectorAll('*').length : 0")
                for other in tabs(app):
                    if other["id"] != tab and str(other.get("kind")) == "web":
                        app.ask(f"nib.workspace.close('{other['id']}')")
                time.sleep(0.5)

        store_page = "https://chromewebstore.google.com/detail/json-formatter/bcjindcccaagfpapjjmafapmmgkkhgoa"
        app.ask(f"nib.workspace.activate?.('{tab}')")
        app.invoke("web_navigate", {"tab": tab, "url": store_page})
        time.sleep(8)
        offered = app.ask("JSON.stringify(!!document.querySelector('.webbar .add'))")
        store_target = page_target(web_port, "https://chromewebstore.google.com/") if web_port else None
        buttons = page_says(store_target, "JSON.stringify([...document.querySelectorAll('button')].map((b) => [b.innerText.trim(), b.disabled]).filter((b) => b[0]).slice(0, 12))") if store_target else None
        report["(store page)"] = {"bar offers Add": offered, "store buttons": buttons}
        if args.shots:
            shoot(interface(args.identifier), args.shots / "store.png")

        if args.shots:
            app.invoke("web_navigate", {"tab": tab, "url": site})
            time.sleep(3)
            time.sleep(1)
            shoot(interface(args.identifier), args.shots / "bar.png")
            app.ask("document.querySelector('.webbar [aria-label=\"Extensions\"]')?.click()")
            time.sleep(1)
            shoot(interface(args.identifier), args.shots / "list.png")
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=GONE)
            except subprocess.TimeoutExpired:
                running.kill()
        shutil.rmtree(root, ignore_errors=True)

    print(json.dumps(report, indent=2, default=str))
    return 0

if __name__ == "__main__":
    sys.exit(main())
