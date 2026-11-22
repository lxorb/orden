from __future__ import annotations
import argparse
import http.server
import json
import os
import pathlib
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any
from devtools import Session, targets
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint, forward

KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAm4E3EbEEMas0rGBZRWZoOyGu3Z/1Y22lP3fgQOsPwbaq9e8ON7honIRq3ElbT+VLAQOIGJbY4RjdYeUUW28wp4E7rqpINGjPbGX413t7tlgq9+ePjxIGJofzLkXwooA1c2daTlX/Gz1IZYJYhi59i4UWOfhc245xMs/XoUzBJOAzGK91qKKSjWSMxQAqZpxCxeMDsFGWJLKR1d6rWoGSO9/LjyigCaFTTB6OTWu8jalQ+z0LtbnIK20vHPmXe6LMsRX4Jz+pkQR8SdOQZ7R1JuhHmLrsqzGzgJTn7040vU1WjCDP5TpVeHP7PyWHbxrrjijUx8HxxVKF5jKPazGoCQIDAQAB"
ID = "pdpohffpigmmcalppcomfihphbdjlckg"
POPUP = f"chrome-extension://{ID}/popup.html"
OWN = "d2504d2504d2504d"
MARK = "data-web-data-drive"
PAGE = b"<!doctype html><title>a page</title><p style='font:20px sans-serif;margin:40px'>a page"
MANIFEST = {
    "manifest_version": 3,
    "name": "Web data drive",
    "version": "1.0",
    "key": KEY,
    "permissions": ["storage", "tabs"],
    "action": {"default_popup": "popup.html"},
    "content_scripts": [{"matches": ["<all_urls>"], "js": ["mark.js"], "run_at": "document_start"}],
}
MARKS = f"document.documentElement.getAttribute({json.dumps(MARK)})"
SEEN = "document.title.startsWith('{') ? document.title : null"
class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)
class Stop(Exception):
    pass
def free_port() -> int:
    with socket.socket() as one:
        one.bind(("127.0.0.1", 0))
        return int(one.getsockname()[1])
def kept(config: pathlib.Path) -> None:
    library = config / "extensions"
    folder = library / ID / "1.0"
    folder.mkdir(parents=True)
    (folder / "manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
    (folder / "mark.js").write_text(
        f"document.documentElement.setAttribute({json.dumps(MARK)}, 'runs');"
        "chrome.storage.local.set({ last: location.href })",
        encoding="utf-8",
    )
    (folder / "popup.html").write_text("<!doctype html><title>popup</title><body style='width:200px;height:80px'>popup<script src='popup.js'></script>", encoding="utf-8")
    (folder / "popup.js").write_text(
        "chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => chrome.storage.local.get('last', (said) =>"
        " { document.title = JSON.stringify({ tabs: (tabs || []).map((one) => one.url || ''), last: said.last || null }) }))",
        encoding="utf-8",
    )
    entry = {"id": ID, "store": "chrome", "version": "1.0", "enabled": True, "pinned": True}
    (library / "library.json").write_text(json.dumps([entry]), encoding="utf-8")
    (library / ".preinstalled").write_text("none", encoding="utf-8")
class Drive:
    def __init__(self, exe: pathlib.Path, identifier: str, out: pathlib.Path) -> None:
        self.exe, self.out = exe, out
        self.config = config_of(identifier)
        self.secret = secrets.token_hex(32)
        self.debug = free_port()
        self.spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-web-data-spaces-"))
        self.process: subprocess.Popen[bytes] | None = None
        self.app: App | None = None
        self.after = "it started"
    def step(self, what: str) -> None:
        self.after = what
        print(f"step: {what}", flush=True)
    def fail(self, what: str) -> None:
        raise Stop(what)
    def alive(self) -> None:
        code = self.process.poll() if self.process else None
        if code is not None:
            self.process = None
            self.fail(f"the app died after {self.after} (exit code {code})")
    def start(self, again: bool = False) -> None:
        if not again:
            fresh(self.config)
            kept(self.config)
        (self.config / "automation.json").write_text(json.dumps({"port": 0, "secret": self.secret, "eval": True}), encoding="utf-8")
        env = {**os.environ, "ORDEN_SPACES_DIR": str(self.spaces), "ORDEN_CEF_DEBUG_PORT": str(self.debug)}
        self.process = subprocess.Popen([str(self.exe)], env=env, cwd=str(self.exe.parent))
        self.app = endpoint(self.config, self.process.pid, self.secret)
        self.waited("!!orden.workspace", 90, "the app never showed its workspace")
        forward(self.app, self.process.pid)
        time.sleep(2)
    def stopped(self) -> None:
        if self.process:
            ended(self.process, gentle=True)
            self.process = None
    def eval(self, code: str, seconds: float | None = None) -> Any:
        self.alive()
        assert self.app is not None
        return self.app.eval(code, seconds)
    def waited(self, code: str, seconds: float, why: str) -> Any:
        until = time.monotonic() + seconds
        last: Any = None
        while time.monotonic() < until:
            last = self.eval(code)
            if last not in (None, False, "", []) and not (isinstance(last, dict) and "error" in last):
                return last
            time.sleep(0.5)
        self.fail(f"{why}: {last!r}")
    def every(self) -> list[dict[str, Any]]:
        self.alive()
        try:
            return list(targets(self.debug))
        except (OSError, ValueError):
            return []
    def opened(self, url: str) -> str:
        self.eval(f"orden.workspace.openPage({json.dumps(url)}, 'front'); return true")
        return str(self.waited(f"orden.workspace.tabs.find((tab) => (tab.address ?? '').startsWith({json.dumps(url)}))?.id ?? null", 40, f"no tab opened {url}"))
    def separate(self, tab: str) -> None:
        self.shown(tab)
        moved = (
            f"const tab = orden.workspace.tabs.find((one) => one.id === {json.dumps(tab)}); tab.apart = {json.dumps(OWN)};"
            f" await orden.pages.rehouse({json.dumps(tab)}, {json.dumps(OWN)}); return orden.pages.of({json.dumps(tab)}).store ?? null"
        )
        print(f"tab {tab} has separate web data: {self.waited(moved, 60, 'the tab never moved to separate web data')}", flush=True)
    def shown(self, tab: str) -> None:
        shown = (
            f"(() => {{ const page = orden.pages.of({json.dumps(tab)}); if (page.live && page.sent?.visible) return true;"
            f" orden.workspace.activate({json.dumps(tab)}); return null }})()"
        )
        self.waited(shown, 40, f"tab {tab} never showed")
        time.sleep(1)
    def page(self, path: str) -> Session:
        until = time.monotonic() + 30
        while time.monotonic() < until:
            found = next((one for one in self.every() if one.get("type") == "page" and str(one.get("url", "")).split("?")[0].endswith(path)), None)
            if found:
                return Session(found)
            time.sleep(0.5)
        self.fail(f"no page at {path}: {[one.get('url') for one in self.every()]}")
        raise AssertionError
    def runs(self, tab: str, path: str, again: str) -> bool:
        self.shown(tab)
        page = self.page(path)
        try:
            page.call("Page.navigate", {"url": str(page.value("location.origin")) + path + "?" + again})
            until = time.monotonic() + 20
            while time.monotonic() < until:
                if page.value("location.search") == "?" + again and page.value("document.readyState") == "complete":
                    break
                time.sleep(0.3)
            time.sleep(1.5)
            return page.value(MARKS) == "runs"
        finally:
            page.close()
    def popup(self, tab: str) -> dict[str, Any]:
        self.shown(tab)
        self.waited(
            f"(() => {{ const button = [...document.querySelectorAll('button[data-extension=\"{ID}\"]')].find((one) => one.offsetParent);"
            " if (!button) return null; button.click(); return 'pressed' })()",
            30,
            "the extension has no button in this tab's web bar",
        )
        said: Any = None
        until = time.monotonic() + 30
        while time.monotonic() < until:
            target = next((one for one in self.every() if str(one.get("url", "")).startswith((POPUP, "chrome-error"))), None)
            if target:
                page = Session(target)
                said = page.value(f"location.href.startsWith('chrome-error') ? 'refused: ' + (document.querySelector('.error-code')?.textContent ?? '') : ({SEEN})")
                page.close()
                if said:
                    break
            time.sleep(0.5)
        self.eval("await window.__TAURI_INTERNALS__.invoke('extension_popup_close', {}); return true")
        time.sleep(1)
        if not isinstance(said, str) or not said.startswith("{"):
            problem = self.eval(f"return JSON.stringify((await window.__TAURI_INTERNALS__.invoke('extensions_list')).find((one) => one.id === {json.dumps(ID)}) ?? null)", 40)
            self.fail(f"the popup did not show what it read: {said!r} (listed: {problem})")
        return json.loads(said)
    def turned(self, verb: str, args: dict[str, Any]) -> None:
        said = self.eval(f"return await window.__TAURI_INTERNALS__.invoke({json.dumps(verb)}, {json.dumps(args)}).then(() => 'done', (error) => 'ERR ' + error)", 120)
        print(f"{verb} {args}: {said}", flush=True)
        if said != "done":
            self.fail(f"{verb} failed: {said}")
ALLOY_ONLY = sys.platform == "darwin"
def drive(it: Drive, base: str) -> None:
    it.start()
    count = iter(range(1, 100))
    def pair(what: str) -> dict[str, tuple[str, str]]:
        it.step(f"a tab in the global web data and a tab in separate web data are opened {what}")
        at = next(count)
        one, two = it.opened(f"{base}/one{at}"), it.opened(f"{base}/two{at}")
        it.separate(two)
        return {"global": (one, f"/one{at}"), "separate": (two, f"/two{at}")}
    def everywhere(tabs: dict[str, tuple[str, str]], running: bool, what: str) -> None:
        for name, (tab, path) in tabs.items():
            until = time.monotonic() + (20 if running else 0)
            while True:
                runs = it.runs(tab, path, f"{what.replace(' ', '-')}{int(time.monotonic() * 1000)}")
                if runs == running or time.monotonic() >= until:
                    break
            if runs != running:
                it.fail(f"{what}, it {'does not run' if running else 'still runs'} in the tab with the {name} web data")
    def restarted() -> None:
        it.stopped()
        it.start(again=True)
    tabs = pair("at the start")
    it.step("the extension runs in both web data")
    everywhere(tabs, True, "installed")
    it.step("each tab's popup reads its own tab and its own web data's storage")
    for name, (tab, path) in tabs.items():
        said = it.popup(tab)
        print(f"the popup over the {name} tab: {said}", flush=True)
        if not str(said.get("last") or "").split("?")[0].endswith(path):
            it.fail(f"the popup over the {name} tab read another web data's storage: {said}")
        seen = [str(url).split("?")[0][-len(path):] for url in said.get("tabs") or []]
        if ALLOY_ONLY and not seen:
            print(f"::warning::on macOS every page is an Alloy view with no tab Chromium can name, so the popup over the {name} tab sees none", flush=True)
        elif seen != [path]:
            it.fail(f"the popup over the {name} tab sees another tab as its tab: {said}")
    if ALLOY_ONLY:
        it.step("turned off, it stops in both web data once Orden restarts")
        it.turned("extensions_set", {"id": ID, "enabled": False})
        restarted()
        everywhere(pair("after the restart"), False, "turned off and restarted")
        it.step("turned on, it runs in both web data once Orden restarts")
        it.turned("extensions_set", {"id": ID, "enabled": True})
        restarted()
        everywhere(pair("after the restart"), True, "turned on and restarted")
    else:
        it.step("turned off, it stops in both web data")
        it.turned("extensions_set", {"id": ID, "enabled": False})
        everywhere(tabs, False, "turned off")
        it.step("turned on, it runs again in both web data")
        it.turned("extensions_set", {"id": ID, "enabled": True})
        everywhere(tabs, True, "turned back on")
        it.step("turned off with the separate tab closed, Orden restarts and it is turned on: it runs at once")
        it.turned("extensions_set", {"id": ID, "enabled": False})
        it.eval(f"orden.workspace.close({json.dumps(tabs['separate'][0])}); return true")
        time.sleep(2)
        restarted()
        three = it.opened(f"{base}/three")
        it.turned("extensions_set", {"id": ID, "enabled": True})
        everywhere({"global": (three, "/three")}, True, "turned off, restarted and turned on")
        it.step("Orden restarts and a tab in that separate web data opens: it runs there too")
        restarted()
        tabs = pair("after the restart")
        everywhere(tabs, True, "turned on while no tab used that web data")
    if ALLOY_ONLY:
        print("::warning::on macOS an extension Chromium loaded at start can be neither taken out through the browser pipe nor through the extensions page, so Remove is not driven here", flush=True)
        return
    it.step("removed, it is gone from both web data")
    it.turned("extensions_remove", {"id": ID})
    everywhere(tabs, False, "removed")
    restarted()
    everywhere(pair("after the restart"), False, "removed and restarted")
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", default="extensions-web-data", type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Site)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    it = Drive(args.exe, args.identifier, args.out)
    wrong = None
    try:
        drive(it, f"http://127.0.0.1:{site.server_address[1]}")
    except Stop as stop:
        wrong = str(stop)
    except (OSError, ConnectionError) as error:
        wrong = f"the drive lost the app after {it.after}: {error}"
    finally:
        it.stopped()
        site.shutdown()
        shutil.rmtree(it.spaces, ignore_errors=True)
    if wrong:
        print(f"::error::{wrong}", flush=True)
        return 1
    print("an extension's popup, storage, on and off and removal follow each tab's own web data", flush=True)
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
