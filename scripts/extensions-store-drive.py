from __future__ import annotations
import argparse
import http.server
import json
import os
import pathlib
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from typing import Any
from devtools import Session, targets
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint, forward

ID = "ghmbeldphafepmbegfdlkpapadhbakde"
NAME = "Proton Pass"
LINK = f"https://chromewebstore.google.com/detail/proton-pass-free-password/{ID}"
FIELD = "Paste a Chrome Web Store or Firefox Add-ons link"
ORIGIN = f"chrome-extension://{ID}"
PENDING = "Starts when Orden next opens"
AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
FIRST = b"<!doctype html><title>a page</title><p style='font:20px sans-serif;margin:40px'>a page to start from"
LOGIN = b"""<!doctype html><title>sign in</title>
<body style="font:18px sans-serif;margin:40px">
<form id="login" action="/signed" method="post" style="display:grid;gap:12px;max-width:320px">
<label>Email <input id="email" type="email" name="email" autocomplete="username"></label>
<label>Password <input id="password" type="password" name="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button>
</form>"""
class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        body = LOGIN if self.path.startswith("/login") else FIRST
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
class Stop(Exception):
    pass
SHOWN = (
    "(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible);"
    " return all[0] ? { tab: all[0][0], url: all[0][1].url } : null })()"
)
BUBBLE = "document.querySelector('[role=dialog][aria-label=\"Extensions\"]')?.innerText ?? null"
FILL = f"""(() => {{
  const field = document.querySelector('input[aria-label={json.dumps(FIELD)}]')
  if (!field || field.disabled) return null
  field.focus()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, {json.dumps(LINK)})
  field.dispatchEvent(new Event('input', {{ bubbles: true }}))
  field.form.requestSubmit()
  return 'submitted'
}})()"""
LISTED = "return JSON.stringify(await window.__TAURI_INTERNALS__.invoke('extensions_list'))"
SETTINGS = (
    "(() => { const head = [...document.querySelectorAll('h3')].find((one) => one.innerText.trim() === 'Extensions');"
    " if (!head) return null; const card = head.nextElementSibling; return card ? card.innerText : '' })()"
)
REJECT = """(() => {
  const all = [...document.querySelectorAll('button, input[type=submit], [role=button]')]
  const words = (one) => (one.innerText || one.value || one.getAttribute('aria-label') || '').trim()
  const no = all.find((one) => /^reject all$/i.test(words(one))) || all.find((one) => /reject all/i.test(words(one)))
  if (!no) return { buttons: all.map(words).filter(Boolean).slice(0, 12) }
  no.click()
  return 'rejected'
})()"""
ADD = """(() => {
  if (document.readyState !== 'complete') return { loading: true }
  const all = [...document.querySelectorAll('button')]
  const add = all.find((one) => /add to chrome/i.test(one.innerText || one.getAttribute('aria-label') || ''))
  if (!add) return { text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 400), buttons: all.map((one) => one.innerText.trim()).filter(Boolean).slice(0, 16) }
  add.scrollIntoView({ block: 'center' })
  const box = add.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  const at = document.elementFromPoint(x, y)
  return { x, y, disabled: add.disabled, hit: !!at && (at === add || add.contains(at)), words: add.innerText.trim() }
})()"""
MARKS = """(() => {
  const found = new Set()
  for (const one of document.querySelectorAll('*')) {
    if (/protonpass/i.test(one.tagName)) found.add(one.tagName.toLowerCase())
    for (const attribute of one.attributes) if (/protonpass/i.test(attribute.name)) found.add(attribute.name)
  }
  return [...found]
})()"""
def free_port() -> int:
    with socket.socket() as one:
        one.bind(("127.0.0.1", 0))
        return int(one.getsockname()[1])
def store_reachable() -> str:
    asked = urllib.request.Request(LINK, headers={"user-agent": AGENT})
    try:
        with urllib.request.urlopen(asked, timeout=30) as said:
            return f"{said.status} at {said.geturl()}"
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise Stop(f"the Chrome Web Store is unreachable from this machine, so nothing can be installed from it: {error}") from error
class Drive:
    def __init__(self, exe: pathlib.Path, identifier: str, out: pathlib.Path) -> None:
        self.exe, self.out = exe, out
        self.config = config_of(identifier)
        self.secret = secrets.token_hex(32)
        self.debug = free_port()
        self.spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-store-spaces-"))
        self.process: subprocess.Popen[bytes] | None = None
        self.app: App | None = None
        self.shots = 0
        self.after = "it started"
    def shot(self, name: str) -> None:
        self.shots += 1
        path = self.out / f"{self.shots:02d}-{name}.png"
        try:
            import mss
            import mss.tools
            with mss.mss() as screen:
                grabbed = screen.grab(screen.monitors[0])
                mss.tools.to_png(grabbed.rgb, grabbed.size, output=str(path))
            print(f"screenshot: {path.name}", flush=True)
        except Exception as error:  # noqa: BLE001 - a screenshot never decides the drive
            print(f"::warning::no screenshot {path.name}: {error}", flush=True)
    def kept_logs(self) -> None:
        for one in [*self.config.glob("*.log"), self.config / "chromium" / "cef.log"]:
            if one.is_file():
                shutil.copy(one, self.out / one.name)
                said = [line for line in one.read_text(errors="replace").splitlines() if re.search(r"extension|webstore|crx", line, re.I)]
                for line in said[-15:]:
                    print(f"{one.name}: {line[:300]}", flush=True)
    def fail(self, what: str) -> None:
        raise Stop(what)
    def alive(self) -> None:
        code = self.process.poll() if self.process else None
        if code is not None:
            self.process = None
            self.fail(f"the app died after {self.after} (exit code {code}, {code & 0xFFFFFFFF:#x})")
    def step(self, what: str) -> None:
        self.after = what
        print(f"step: {what}", flush=True)
    def start(self, again: bool = False) -> App:
        if not again:
            fresh(self.config)
            old_extension(self.config / "extensions")
        (self.config / "automation.json").write_text(json.dumps({"port": 0, "secret": self.secret, "eval": True}), encoding="utf-8")
        env = {**os.environ, "ORDEN_SPACES_DIR": str(self.spaces), "ORDEN_CEF_DEBUG_PORT": str(self.debug)}
        self.process = subprocess.Popen([str(self.exe)], env=env, cwd=str(self.exe.parent))
        self.app = endpoint(self.config, self.process.pid, self.secret)
        self.waited("!!orden.workspace", 90, "the app never showed its workspace")
        forward(self.app, self.process.pid)
        time.sleep(2)
        return self.app
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
            self.alive()
            assert self.app is not None
            last = self.app.eval(code)
            if last not in (None, False, "", []) and not (isinstance(last, dict) and "error" in last):
                return last
            time.sleep(0.5)
        self.fail(f"{why}: {last!r}")
    def listed(self) -> dict[str, Any] | None:
        said = self.eval(LISTED, 40)
        try:
            return next((one for one in json.loads(said) if one.get("id") == ID), None)
        except (TypeError, ValueError):
            return None
    def pages(self) -> list[dict[str, Any]]:
        self.alive()
        try:
            return [one for one in targets(self.debug) if one.get("type") == "page"]
        except (OSError, ValueError):
            return []
    def every(self) -> list[dict[str, Any]]:
        self.alive()
        try:
            return list(targets(self.debug))
        except (OSError, ValueError):
            return []
    def page_at(self, wanted: re.Pattern[str]) -> dict[str, Any] | None:
        return next((one for one in self.pages() if wanted.search(str(one.get("url", "")))), None)
    def opened(self, url: str) -> None:
        self.eval(f"orden.workspace.openPage({json.dumps(url)}, 'front'); return true")
        front = (
            f"(() => {{ const shown = {SHOWN}; if (shown && shown.url && shown.url.startsWith({json.dumps(url)})) return shown;"
            f" const tab = orden.workspace.tabs.find((one) => (one.address ?? '').startsWith({json.dumps(url)}));"
            " if (tab) orden.workspace.activate(tab.id); return null })()"
        )
        self.waited(front, 40, f"the web tab never showed {url}")
STORE = re.compile(rf"^https://(chromewebstore\.google\.com/detail/[^?#]*{ID}|consent\.google\.com/)")
def bubble_said(drive: Drive) -> Any:
    return drive.eval("document.querySelector('[role=dialog][aria-label=\"Extensions\"] .said')?.innerText ?? null")
def installed(drive: Drive, how: str) -> dict[str, Any]:
    until = time.monotonic() + 120
    while time.monotonic() < until:
        one = drive.listed()
        if one:
            return one
        failed = bubble_said(drive)
        if failed:
            drive.shot("bubble-said")
            drive.fail(f"{how}: the bubble said {failed!r}")
        time.sleep(1)
    tabs = drive.eval("JSON.stringify(orden.workspace.tabs.map((tab) => tab.address ?? tab.kind ?? tab.id))")
    drive.shot("nothing-installed")
    drive.fail(f"{how}: nothing was installed within 120 s (bubble: {drive.eval(BUBBLE)!r}, tabs: {tabs})")
    return {}
def pasted(drive: Drive) -> dict[str, Any]:
    drive.step("the Extensions button in the web bar is pressed")
    drive.waited("!!document.querySelector('[data-opens=\"extensions\"]')", 30, "the web bar has no Extensions button")
    drive.eval("document.querySelector('[data-opens=\"extensions\"]').click(); return true")
    drive.waited(BUBBLE, 15, "the Extensions bubble did not open")
    drive.step("the Web Store link is pasted into the bubble's field and sent")
    drive.waited(FILL, 15, f"the bubble has no field labelled {FIELD!r}")
    time.sleep(1)
    drive.shot("link-sent")
    one = installed(drive, "pasting the Web Store link")
    drive.shot("link-installed")
    return one
def store_page(drive: Drive) -> Session:
    drive.step("the Web Store page is opened in a web tab")
    drive.eval(f"orden.workspace.openPage({json.dumps(LINK)}, 'front'); return true")
    page: Session | None = None
    until = time.monotonic() + 90
    while time.monotonic() < until and page is None:
        drive.alive()
        target = drive.page_at(STORE)
        if not target:
            time.sleep(1)
            continue
        url = str(target.get("url"))
        if "consent.google.com" not in url:
            page = Session(target)
            break
        drive.shot("consent")
        consent = Session(target)
        said = consent.value(REJECT)
        consent.close()
        print(f"the consent page: {said}", flush=True)
        time.sleep(3)
    if page is None:
        drive.fail(f"the store page never opened in a web tab: {[each.get('url') for each in drive.pages()]}")
    assert page is not None
    return page
def store_button(drive: Drive) -> dict[str, Any] | None:
    page = store_page(drive)
    found: Any = None
    until = time.monotonic() + 60
    while time.monotonic() < until:
        drive.alive()
        found = page.value(ADD)
        if isinstance(found, dict) and found.get("hit") and not found.get("disabled"):
            break
        time.sleep(1)
    drive.shot("store-page")
    if not (isinstance(found, dict) and found.get("hit")):
        location = page.value("location.href")
        page.close()
        if str(location).startswith("chrome-error://"):
            drive.fail(f"the store page did not load in the web tab, the store is unreachable from it: {location}")
        if sys.platform == "darwin":
            print(f"::warning::the store page on macOS shows no Add to Chrome button to press: {found}", flush=True)
            return None
        drive.fail(f"the store page shows no Add to Chrome button that can be pressed: {found}")
    print(f"Add to Chrome at {found['x']:.0f},{found['y']:.0f}: {found.get('words')!r}", flush=True)
    drive.step("Add to Chrome is pressed on the store page")
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        page.call("Input.dispatchMouseEvent", {"type": kind, "x": found["x"], "y": found["y"], "button": "left", "buttons": 1 if kind == "mousePressed" else 0, "clickCount": 1})
        time.sleep(0.1)
    page.close()
    drive.step("Add to Chrome was pressed: Orden installs it, Chrome's own dialog never shows")
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        drive.alive()
        shown = chrome_dialog(drive)
        if shown:
            drive.shot("chrome-dialog")
            drive.fail(f"Chrome's own install dialog showed ({shown}); its Add extension crashes a CEF tab")
        time.sleep(1)
    one = installed(drive, "pressing Add to Chrome on the store page")
    print(f"the store tab's bubble: {drive.eval(BUBBLE)!r}", flush=True)
    drive.shot("store-installed")
    return one
def chrome_dialog(drive: Drive) -> str | None:
    if sys.platform == "win32":
        import comtypes.client
        comtypes.client.GetModule("UIAutomationCore.dll")
        from comtypes.gen import UIAutomationClient as uia
        client = comtypes.client.CreateObject(uia.CUIAutomation, interface=uia.IUIAutomation)
        assert drive.process is not None
        mine = client.CreatePropertyCondition(uia.UIA_ProcessIdPropertyId, drive.process.pid)
        buttons = client.CreatePropertyCondition(uia.UIA_ControlTypePropertyId, uia.UIA_ButtonControlTypeId)
        try:
            windows = client.GetRootElement().FindAll(uia.TreeScope_Children, mine)
            for index in range(windows.Length):
                each = windows.GetElement(index).FindAll(uia.TreeScope_Descendants, buttons)
                for at in range(each.Length):
                    if (each.GetElement(at).CurrentName or "").strip().lower() == "add extension":
                        return "a window with an Add extension button"
        except Exception as error:  # noqa: BLE001 - a window may go while it is read
            print(f"the window list changed while it was read: {error}", flush=True)
        return None
    if sys.platform == "darwin":
        return None
    from Xlib import display
    shown = display.Display()
    net_name = shown.intern_atom("_NET_WM_NAME")
    stack = [shown.screen().root]
    while stack:
        one = stack.pop()
        try:
            said = one.get_full_property(net_name, 0)
            name = said.value.decode("utf-8", "replace") if said else (one.get_wm_name() or "")
            if isinstance(name, bytes):
                name = name.decode("utf-8", "replace")
            if name.startswith("Add") and NAME in name:
                return f"window {name!r}"
            stack.extend(one.query_tree().children)
        except Exception:  # noqa: BLE001 - a window may go while it is read
            pass
    return None
def removed(drive: Drive) -> None:
    drive.step("the extension is removed again, so the link installs it afresh")
    drive.eval(f"return await window.__TAURI_INTERNALS__.invoke('extensions_remove', {{ id: {json.dumps(ID)} }}).then(() => 'removed')", 60)
    until = time.monotonic() + 30
    while time.monotonic() < until and drive.listed():
        time.sleep(1)
    if drive.listed():
        drive.fail("extensions_remove left the extension listed")
def restarted(drive: Drive) -> None:
    drive.step("the extension is pending until Orden opens again")
    restart = drive.eval("[...document.querySelectorAll('button')].map((one) => one.innerText.trim()).find((words) => /^restart/i.test(words)) ?? null")
    print(f"a restart button: {restart!r}", flush=True)
    drive.eval("orden.settings.show('general'); return true")
    rows = drive.waited(SETTINGS, 20, "Settings has no Extensions card")
    drive.shot("pending")
    if PENDING not in str(rows):
        drive.fail(f"Settings does not say it starts when Orden next opens: {rows!r}")
    print(f"Settings says: {str(rows).strip()[:160]!r}", flush=True)
    drive.stopped()
    drive.step("Orden was started again on the same profile")
    drive.start(again=True)
def ran(drive: Drive, login: str) -> None:
    one = drive.listed()
    print(f"extensions_list: {json.dumps(one)}", flush=True)
    if not one:
        drive.fail(f"extensions_list does not list {ID}")
    assert one is not None
    if one.get("pending") or not one.get("enabled", True):
        drive.fail(f"the extension is listed but not running: enabled {one.get('enabled')}, pending {one.get('pending')}")
    drive.step("a login page the drive serves is opened in a web tab")
    drive.opened(login)
    wanted = re.compile("^" + re.escape(login))
    seen: list[str] = []
    marks: Any = []
    for attempt in range(2):
        target = None
        until = time.monotonic() + 20
        while time.monotonic() < until and not target:
            target = drive.page_at(wanted)
            time.sleep(0.5)
        if not target:
            drive.fail(f"no page target for {login} among {[each.get('url') for each in drive.pages()]}")
        assert target is not None
        page = Session(target)
        page.call("Runtime.enable")
        until = time.monotonic() + 20
        while time.monotonic() < until:
            drive.alive()
            page.listen(1)
            worlds = [each["params"]["context"] for each in page.events if each.get("method") == "Runtime.executionContextCreated"]
            seen = sorted({f"{each.get('origin')} {each.get('name')!r}" for each in worlds})
            ours = [each for each in worlds if str(each.get("origin", "")).startswith(ORIGIN)]
            marks = page.value(MARKS)
            if ours or (isinstance(marks, list) and marks):
                page.close()
                drive.shot("content-script-runs")
                print(f"the content script runs in the web tab: worlds {[each.get('name') for each in ours]}, marks {marks}", flush=True)
                return
        if attempt == 0:
            page.call("Page.reload")
            page.close()
            time.sleep(2)
        else:
            page.close()
    drive.shot("no-content-script")
    drive.fail(f"Proton Pass's content script never ran in the web tab on {login}: worlds {seen}, marks {marks}")
POPUP = f"{ORIGIN}/popup.html"
SHOWN_UI = """(() => {
  const words = (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  const drawn = [...document.querySelectorAll('body *')].filter((one) => { const box = one.getBoundingClientRect(); return box.width > 0 && box.height > 0 }).length
  return { href: location.href, title: document.title, words: words.slice(0, 160), drawn }
})()"""
def popup(drive: Drive, login: str) -> None:
    drive.step("Proton Pass's button in the web bar is pressed and its popup opens")
    drive.opened(login)
    pressed = drive.waited(
        f"(() => {{ const button = document.querySelector('button[data-extension=\"{ID}\"]');"
        " if (!button) return null; button.click(); return 'pressed' })()",
        30,
        "Proton Pass has no button in the web bar",
    )
    print(f"its button: {pressed}", flush=True)
    target = None
    until = time.monotonic() + 30
    while time.monotonic() < until and not target:
        drive.alive()
        target = next((each for each in drive.every() if str(each.get("url", "")).startswith(POPUP) or "chrome-error" in str(each.get("url", ""))), None)
        if not target:
            time.sleep(0.5)
    if not target:
        problem = drive.eval(BUBBLE)
        drive.shot("no-popup")
        drive.fail(f"pressing Proton Pass's button opened no popup: {[(each.get('type'), each.get('url')) for each in drive.every()]} (bubble: {problem!r})")
    assert target is not None
    page = Session(target)
    said: Any = None
    until = time.monotonic() + 30
    while time.monotonic() < until:
        drive.alive()
        said = page.value(SHOWN_UI)
        if isinstance(said, dict) and (str(said.get("href", "")).startswith("chrome-error") or (said.get("drawn", 0) >= 5 and said.get("words"))):
            break
        time.sleep(1)
    page.close()
    drive.shot("popup")
    if not isinstance(said, dict) or not str(said.get("href", "")).startswith(POPUP):
        drive.fail(f"Proton Pass's popup did not load its page: {said}")
    if "blocked" in str(said.get("words", "")).lower() or said.get("drawn", 0) < 5 or not said.get("words"):
        drive.fail(f"Proton Pass's popup shows no UI: {said}")
    print(f"the popup shows its UI: {said}", flush=True)
OLD_ID = "odfafepnkmbhccpbejgmiehpchacaeak"
OLD_VERSION = "2026.1115.76.4"
OLD_NAME = "uBlock Origin"
OLD_WORDS = "old format"
def old_extension(root: pathlib.Path) -> None:
    folder = root / OLD_ID / OLD_VERSION
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(json.dumps({"manifest_version": 2, "name": OLD_NAME, "version": OLD_VERSION, "background": {"scripts": ["bg.js"]}}), encoding="utf-8")
    (folder / "bg.js").write_text("", encoding="utf-8")
    (root / "library.json").write_text(json.dumps([{"id": OLD_ID, "store": "edge", "version": OLD_VERSION, "enabled": True, "pinned": True}]), encoding="utf-8")
def native_load_error(drive: Drive) -> str | None:
    if sys.platform == "win32":
        import comtypes.client
        comtypes.client.GetModule("UIAutomationCore.dll")
        from comtypes.gen import UIAutomationClient as uia
        client = comtypes.client.CreateObject(uia.CUIAutomation, interface=uia.IUIAutomation)
        assert drive.process is not None
        try:
            found = client.GetRootElement().FindAll(uia.TreeScope_Descendants, client.CreatePropertyCondition(uia.UIA_ProcessIdPropertyId, drive.process.pid))
            for index in range(found.Length):
                name = found.GetElement(index).CurrentName or ""
                if "Error Loading Extension" in name or "manifest version" in name:
                    return name
        except Exception as error:  # noqa: BLE001 - a window may go while it is read
            print(f"the window list changed while it was read: {error}", flush=True)
        return None
    if sys.platform == "darwin":
        return None
    from Xlib import display
    shown = display.Display()
    net_name = shown.intern_atom("_NET_WM_NAME")
    stack = [shown.screen().root]
    while stack:
        one = stack.pop()
        try:
            said = one.get_full_property(net_name, 0)
            name = said.value.decode("utf-8", "replace") if said else (one.get_wm_name() or "")
            if isinstance(name, bytes):
                name = name.decode("utf-8", "replace")
            if "Error Loading Extension" in name:
                return name
            stack.extend(one.query_tree().children)
        except Exception:  # noqa: BLE001 - a window may go while it is read
            pass
    return None
def load_errors(drive: Drive) -> list[str]:
    said: list[str] = []
    for log in [drive.config / "chromium" / "cef.log", *drive.config.glob("*.log")]:
        if log.is_file():
            said += [line.strip()[:240] for line in log.read_text(errors="replace").splitlines() if re.search(r"Failed to load extension|unsupported manifest version|Error Loading Extension", line)]
    return said
def old_one(drive: Drive) -> None:
    drive.step("an old Manifest V2 extension left on disk by an older Orden is in the library at start")
    until = time.monotonic() + 8
    while time.monotonic() < until:
        dialog = native_load_error(drive)
        if dialog:
            drive.shot("native-load-error")
            drive.fail(f"Chromium showed its own extension error dialog: {dialog!r}")
        time.sleep(1)
    errors = load_errors(drive)
    if errors:
        drive.fail(f"Chromium was handed the old extension and refused it: {errors[:3]}")
    said = drive.eval(LISTED, 40)
    try:
        row = next((one for one in json.loads(said) if one.get("id") == OLD_ID), None)
    except (TypeError, ValueError):
        row = None
    print(f"the old extension's row: {json.dumps(row)[:300]}", flush=True)
    if not row or OLD_WORDS not in str(row.get("cannotRun") or ""):
        drive.fail(f"the old extension is not listed as unable to run with its reason: {row}")
    drive.step("the extensions menu says it does not work, and offers Remove")
    drive.waited("!!document.querySelector('[data-opens=\"extensions\"]')", 30, "the web bar has no Extensions button")
    drive.eval("document.querySelector('[data-opens=\"extensions\"]').click(); return true")
    bubble = drive.waited(BUBBLE, 15, "the Extensions bubble did not open")
    drive.shot("old-extension")
    if OLD_NAME not in str(bubble) or "Not working" not in str(bubble) or OLD_WORDS not in str(bubble):
        drive.fail(f"the bubble does not say the old extension is not working and why: {bubble!r}")
    if drive.eval(f"!!document.querySelector('button[data-extension=\"{OLD_ID}\"]')"):
        drive.fail("the old extension has a button in the web bar")
    pressed = drive.eval(
        "(() => { const bubble = document.querySelector('[role=dialog][aria-label=\"Extensions\"]');"
        " const button = [...(bubble?.querySelectorAll('button') ?? [])].find((one) => /^remove/i.test(one.innerText.trim()));"
        " if (!button) return null; button.click(); return 'removed' })()"
    )
    if not pressed:
        drive.fail(f"the bubble offers no Remove for the old extension: {bubble!r}")
    until = time.monotonic() + 30
    while time.monotonic() < until:
        said = drive.eval(LISTED, 40)
        if OLD_ID not in str(said):
            break
        time.sleep(1)
    else:
        drive.fail("Remove left the old extension listed")
    drive.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true")
    print("the old extension showed as not working, with no Chromium dialog, and Remove took it away", flush=True)
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", default="extensions-store", type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Site)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{site.server_address[1]}"
    drive = Drive(args.exe, args.identifier, args.out)
    wrong = None
    try:
        print(f"the store answers: {store_reachable()}", flush=True)
        drive.start()
        drive.step("a web tab is opened")
        drive.opened(f"{base}/start")
        old_one(drive)
        if store_button(drive) is not None:
            removed(drive)
            drive.opened(f"{base}/start")
        one = pasted(drive)
        print(f"the link installed: {json.dumps(one)}", flush=True)
        if one.get("pending"):
            restarted(drive)
        ran(drive, f"{base}/login")
        popup(drive, f"{base}/login")
    except Stop as stop:
        wrong = str(stop)
    except (OSError, ConnectionError) as error:
        wrong = f"the drive lost the app after {drive.after}: {error}"
    finally:
        if wrong:
            drive.shot("failed")
        if drive.process:
            code = drive.process.poll()
            if code is not None and not wrong:
                wrong = f"the app died after {drive.after} (exit code {code})"
        drive.stopped()
        drive.kept_logs()
        site.shutdown()
        shutil.rmtree(drive.spaces, ignore_errors=True)
    if wrong:
        print(f"::error::{wrong}", flush=True)
        return 1
    print(f"{NAME} was installed from its Web Store link through the extensions bubble and runs in a web tab", flush=True)
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
