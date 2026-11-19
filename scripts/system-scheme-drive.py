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
from typing import Any
from fresh_app import ended, fresh
from native_app import config_of, endpoint, known

PAGE = b"""<!doctype html><title>scheme</title><p>a page
<script>
const media = matchMedia('(prefers-color-scheme: dark)')
const say = () => fetch('/heard', { method: 'POST', body: media.matches ? 'dark' : 'light' }).catch(() => {})
media.addEventListener('change', say)
setInterval(say, 500)
say()
</script>"""
PAGE_SAID: dict[str, str] = {}
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)
    def do_POST(self) -> None:  # noqa: N802 - the standard library's name
        PAGE_SAID["scheme"] = self.rfile.read(int(self.headers.get("content-length") or 0)).decode()
        self.send_response(204)
        self.end_headers()
LISTEN = """(() => { const i = window.__TAURI_INTERNALS__; window.__schemeHeard = [];
  const handler = i.transformCallback((event) => window.__schemeHeard.push(event && event.payload));
  return i.invoke('plugin:event|listen', { event: 'tauri://theme-changed', target: { kind: 'Any' }, handler })
    .then(() => 'listening', (error) => 'refused: ' + error) })()"""
STATE = """(async () => {
  let native = null
  try { native = await window.__TAURI_INTERNALS__.invoke('plugin:window|theme', { label: 'main' }) } catch (error) { native = 'refused: ' + error }
  return {
    app: document.documentElement.dataset.theme ?? null,
    media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    native,
    heard: window.__schemeHeard ?? null,
    background: getComputedStyle(document.body).backgroundColor,
  }
})()"""
class Mac:
    def wear(self, scheme: str) -> None:
        dark = "true" if scheme == "dark" else "false"
        subprocess.run(
            ["osascript", "-e", f'tell application "System Events" to tell appearance preferences to set dark mode to {dark}'],
            check=True,
        )
    def worn(self) -> str:
        said = subprocess.run(["defaults", "read", "-g", "AppleInterfaceStyle"], capture_output=True, text=True)
        return "dark" if said.stdout.strip() == "Dark" else "light"
    def close(self) -> None:
        pass
class Windows:
    KEY = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
    def wear(self, scheme: str) -> None:
        import ctypes
        import winreg
        light = 0 if scheme == "dark" else 1
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, self.KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, "AppsUseLightTheme", 0, winreg.REG_DWORD, light)
            winreg.SetValueEx(key, "SystemUsesLightTheme", 0, winreg.REG_DWORD, light)
        result = ctypes.c_size_t(0)
        ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x001A, 0, "ImmersiveColorSet", 0x0002, 5000, ctypes.byref(result))
    def worn(self) -> str:
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self.KEY) as key:
                return "light" if winreg.QueryValueEx(key, "AppsUseLightTheme")[0] else "dark"
        except OSError:
            return "light"
    def close(self) -> None:
        pass
class Portal:
    XML = """<node><interface name="org.freedesktop.portal.Settings">
  <method name="ReadAll"><arg type="as" name="namespaces" direction="in"/><arg type="a{sa{sv}}" name="value" direction="out"/></method>
  <method name="Read"><arg type="s" name="namespace" direction="in"/><arg type="s" name="key" direction="in"/><arg type="v" name="value" direction="out"/></method>
  <method name="ReadOne"><arg type="s" name="namespace" direction="in"/><arg type="s" name="key" direction="in"/><arg type="v" name="value" direction="out"/></method>
  <signal name="SettingChanged"><arg type="s" name="namespace"/><arg type="s" name="key"/><arg type="v" name="value"/></signal>
  <property name="version" type="u" access="read"/>
</interface></node>"""
    PATH = "/org/freedesktop/portal/desktop"
    NAMESPACE = "org.freedesktop.appearance"
    def __init__(self) -> None:
        from gi.repository import Gio, GLib
        self.Gio, self.GLib = Gio, GLib
        self.scheme = "light"
        self.asked: list[str] = []
        self.bus: Any = None
        self.owned = threading.Event()
        self.loop = GLib.MainLoop()
        self.info = Gio.DBusNodeInfo.new_for_xml(self.XML).interfaces[0]
        threading.Thread(target=self.loop.run, daemon=True).start()
        GLib.idle_add(self.own)
        if not self.owned.wait(10):
            raise SystemExit("the stand-in portal never owned org.freedesktop.portal.Desktop")
    def own(self) -> bool:
        def acquired(bus: Any, _name: str) -> None:
            self.bus = bus
            bus.register_object(self.PATH, self.info, self.call, self.property_of, None)
        self.Gio.bus_own_name(
            self.Gio.BusType.SESSION,
            "org.freedesktop.portal.Desktop",
            self.Gio.BusNameOwnerFlags.NONE,
            acquired,
            lambda *_: self.owned.set(),
            None,
        )
        return False
    def value(self) -> Any:
        return self.GLib.Variant("u", 1 if self.scheme == "dark" else 2)
    def call(self, _bus: Any, _sender: str, _path: str, _interface: str, method: str, params: Any, invocation: Any) -> None:
        GLib = self.GLib
        self.asked.append(method)
        args = params.unpack()
        if method == "ReadAll":
            wanted = args[0]
            found = {self.NAMESPACE: {"color-scheme": self.value()}} if not wanted or self.NAMESPACE in wanted else {}
            invocation.return_value(GLib.Variant("(a{sa{sv}})", (found,)))
        elif (args[0], args[1]) != (self.NAMESPACE, "color-scheme"):
            invocation.return_dbus_error("org.freedesktop.portal.Error.NotFound", "no such setting")
        elif method == "Read":
            invocation.return_value(GLib.Variant("(v)", (GLib.Variant("v", self.value()),)))
        else:
            invocation.return_value(GLib.Variant("(v)", (self.value(),)))
    def property_of(self, *_: Any) -> Any:
        return self.GLib.Variant("u", 2)
    def wear(self, scheme: str) -> None:
        self.scheme = scheme
        done = threading.Event()
        def send() -> bool:
            self.bus.emit_signal(
                None,
                self.PATH,
                "org.freedesktop.portal.Settings",
                "SettingChanged",
                self.GLib.Variant("(ssv)", (self.NAMESPACE, "color-scheme", self.value())),
            )
            done.set()
            return False
        self.GLib.idle_add(send)
        done.wait(5)
    def worn(self) -> str:
        return self.scheme
    def close(self) -> None:
        print(f"the portal was asked: {sorted(set(self.asked))}", flush=True)
        self.loop.quit()
def system() -> Mac | Windows | Portal:
    if sys.platform == "darwin":
        return Mac()
    if sys.platform == "win32":
        return Windows()
    return Portal()
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("system-scheme"))
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    desk = system()
    was = desk.worn()
    desk.wear("light")
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-scheme-spaces-"))
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen(
        [str(args.exe)],
        env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)},
        cwd=str(args.exe.parent),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    wrong: list[str] = []
    seen: list[dict[str, Any]] = []
    try:
        app = endpoint(config, process.pid, secret, 20)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        print(f"listening for the window's theme: {app.eval(LISTEN)}", flush=True)
        app.eval(f"orden.workspace.openPage({json.dumps(url)}); return true")
        time.sleep(4)
        for want in ["light", "dark", "light", "dark"]:
            if desk.worn() != want or seen:
                desk.wear(want)
            state: Any = None
            stop = time.monotonic() + 20
            while time.monotonic() < stop:
                state = app.eval(STATE)
                if isinstance(state, dict) and state.get("app") == want and PAGE_SAID.get("scheme") == want:
                    break
                time.sleep(0.5)
            state = state if isinstance(state, dict) else {"error": state}
            state.update(system=want, page=PAGE_SAID.get("scheme"))
            seen.append(state)
            print(f"the system wears {want}: {json.dumps(state)}", flush=True)
            if state.get("app") != want:
                wrong.append(f"the system turned {want} and the app stayed {state.get('app')} (its media query says {state.get('media')}, its window {state.get('native')})")
            if state.get("page") != want:
                wrong.append(f"the system turned {want} and a web page's media query says {state.get('page')}")
    finally:
        ended(process)
        site.shutdown()
        desk.wear(was)
        desk.close()
        shutil.rmtree(spaces, ignore_errors=True)
    (args.out / "seen.json").write_text(json.dumps({"seen": seen, "wrong": wrong}, indent=1), encoding="utf-8")
    if wrong and sys.platform.startswith("linux"):
        for one in wrong:
            known(2218, f"{one}: nothing hears the portal's color-scheme on Linux yet")
        return 0
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
