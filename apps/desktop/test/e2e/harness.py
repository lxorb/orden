from __future__ import annotations

import contextlib
import errno
import faulthandler
import functools
import hashlib
import http.server
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
APP = ROOT / "apps" / "desktop"
DIST = APP / os.environ.get("ORDEN_DIST", "dist")
OWN_BUILD = "ORDEN_DIST" not in os.environ
WORKER_DIST = APP / os.environ.get("ORDEN_WORKER_DIST", "dist-worker")
SERVICE = ROOT / "services" / "sync"
MACHINE = ROOT / "services" / "machine"
MACHINE_BUNDLE = MACHINE / "dist" / "machine.bin"
SHOTS = HERE / "shots"

POINTED = ".orden-build"

SEED_PATH = "/seed.html"
SEED_PAGE = "<!doctype html><title>seed</title><p>seeding"

BUILT_IN = (
    "try { if (localStorage.getItem('orden:theme') === null) {"
    " localStorage.setItem('orden:theme', 'default'); localStorage.setItem('orden:theme-moved', 'yes') }"
    " if (localStorage.getItem('orden:renamed') === null) localStorage.setItem('orden:renamed', 'told');"
    " if (localStorage.getItem('orden:crash-reports-told') === null) {"
    " localStorage.setItem('orden:crash-reports-told', 'true'); localStorage.setItem('orden:crash-reports', 'false') } }"
    " catch {}"
)

ANSWERED = (
    "Object.defineProperty(window, 'ordenApp', { configurable: true, set(app) {"
    " Object.defineProperty(window, 'ordenApp', { value: app, writable: true, configurable: true, enumerable: true });"
    " const held = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(app.settings), 'setup');"
    " Object.defineProperty(app.settings, 'setup', { configurable: true, get: () => held.get.call(app.settings),"
    " set: (at) => { if (at !== -1) held.set.call(app.settings, at) } }) } })"
)

MAC_PLATFORM = (
    "if (/Macintosh/.test(navigator.userAgent) && navigator.platform !== 'MacIntel')"
    " Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' })"
)

WEBKIT_CLIPBOARD = (
    "(() => { const c = navigator.clipboard; if (!c) return; let kept = '';"
    " const write = c.writeText.bind(c), read = c.readText.bind(c);"
    " c.writeText = (text) => { kept = String(text); return write(text).catch(() => undefined) };"
    " c.readText = () => read().catch(() => kept) })()"
)

MAC_SELECT_ALL = (
    "addEventListener('keydown', (event) => { const at = event.target;"
    " if (!event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== 'a') return;"
    " if (!(at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement)) return;"
    " setTimeout(() => { if (!event.defaultPrevented) at.select() }) }, true)"
)

WEBKIT_SOCKETS = (
    "(() => { const Native = window.WebSocket; if (!Native || window.__nibSockets) return;"
    " const open = new Set(); window.__nibSockets = open; window.__nibOffline = false;"
    " window.WebSocket = class extends Native { constructor(url, ...rest) {"
    " super(window.__nibOffline ? 'ws://offline.invalid/' : url, ...rest);"
    " open.add(this); this.addEventListener('close', () => open.delete(this)) } } })()"
)

WEBKIT_WORKERS = "block"

PATIENCE = 30

HARMLESS = (
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
)

CANCELLED = re.compile(r"^Fetch API cannot load (\w+):/*(\S+) due to access control checks\.$")

def harmless(error: Any, origin: str | None = None) -> bool:
    said = str(getattr(error, "message", None) or error).strip()
    if said.startswith(HARMLESS):
        return True
    if not (WEBKIT and origin):
        return False
    name = getattr(error, "name", None)
    cancelled = CANCELLED.match(f"{name}:{said}" if name else said)
    if not cancelled:
        return False
    return _origin(f"{cancelled.group(1)}://{cancelled.group(2)}") == _origin(origin)

def _origin(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"

ENGINE = os.environ.get("ORDEN_ENGINE", "chromium")
WEBKIT = ENGINE == "webkit"

MOD = "Meta" if WEBKIT else "Control"

WORKER_PATIENCE = 90
BUILD_PATIENCE = 600

TEARDOWN = 90

NEEDS = {
    "native": "a native probe build (Windows, ORDEN_PROBE_EXE and ORDEN_PROBE_IDENTIFIER)",
    "chromium": "Chromium's own DevTools, flags or routing, which WebKit does not have",
    "tab-stops": "Tab stopping at buttons, which a Mac leaves to Keyboard navigation, off on a runner",
}

RELEASE_IDENTIFIER = "so.orden.Orden"

LAUNCHED = "orden: launch order finished"

CHATS_ON = (
    "try { const kept = JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]');"
    " const list = Array.isArray(kept) ? kept : [];"
    " if (!list.includes('shown-chats'))"
    " localStorage.setItem('orden:hidden-kinds', JSON.stringify([...list, 'shown-chats'])) }"
    " catch {}"
)

def say(words: str) -> None:
    print(f"  {words}", flush=True)

if os.environ.get("ORDEN_HANG_AFTER"):
    faulthandler.dump_traceback_later(float(os.environ["ORDEN_HANG_AFTER"]), exit=False)

for _stream in (sys.stdout, sys.stderr):
    with contextlib.suppress(AttributeError, ValueError):
        _stream.reconfigure(errors="backslashreplace")  # type: ignore[union-attr]

def answering(browser: Any) -> Any:
    made_context = browser.new_context
    made_page = browser.new_page

    def answered(context: Any, first_look: bool) -> None:
        if WEBKIT:
            context.add_init_script(MAC_PLATFORM)
            context.add_init_script(WEBKIT_CLIPBOARD)
            context.add_init_script(WEBKIT_SOCKETS)
            context.add_init_script(MAC_SELECT_ALL)
        if not first_look:
            context.add_init_script(BUILT_IN)
            context.add_init_script(ANSWERED)

    def new_context(*args: Any, first_look: bool = False, **options: Any) -> Any:
        if WEBKIT:
            options.setdefault("service_workers", WEBKIT_WORKERS)
        context = made_context(*args, **options)
        answered(context, first_look)
        return context

    def new_page(*args: Any, first_look: bool = False, **options: Any) -> Any:
        if WEBKIT:
            options.setdefault("service_workers", WEBKIT_WORKERS)
        page = made_page(*args, **options)
        answered(page.context, first_look)
        return page

    browser.new_context = new_context
    browser.new_page = new_page
    return browser

REGISTRIES = (
    APP / "src" / "lib" / "shortcuts" / "registry.ts",
    ROOT / "packages" / "editor" / "src" / "keymap.ts",
)

_MODIFIERS = ("Control", "Meta", "Alt", "Shift")

_CHARACTERS = {
    "Backquote": "`",
    "BracketLeft": "[",
    "BracketRight": "]",
    "Minus": "-",
    "Equal": "=",
    "Slash": "/",
    "Backslash": "\\",
    "Semicolon": ";",
    "Quote": "'",
    "Comma": ",",
    "Period": ".",
    **{f"Digit{digit}": str(digit) for digit in range(10)},
    **{f"Key{chr(letter)}": chr(letter).lower() for letter in range(65, 91)},
}

TEXT_KEYS = {
    "ArrowLeft": ("Alt", "ArrowLeft"),
    "ArrowRight": ("Alt", "ArrowRight"),
    "Backspace": ("Alt", "Backspace"),
    "Delete": ("Alt", "Delete"),
    "Home": ("Meta", "ArrowUp"),
    "End": ("Meta", "ArrowDown"),
}

def _chord(written: str, mod: str) -> tuple[frozenset[str], str]:
    parts = re.split(r"[-+](?!$)", written)
    named = {"mod": mod, "ctrl": "Control", "control": "Control", "cmd": "Meta", "meta": "Meta"}
    named |= {"alt": "Alt", "option": "Alt", "shift": "Shift"}
    held = frozenset(named[one.lower()] for one in parts[:-1] if one.lower() in named)
    key = _CHARACTERS.get(parts[-1], parts[-1])
    return held, key.lower() if len(key) == 1 else key

def _written(held: frozenset[str], key: str) -> str:
    return "+".join([*(one for one in _MODIFIERS if one in held), key])

@functools.cache
def mac_bindings() -> dict[tuple[frozenset[str], str], str]:
    found: dict[tuple[frozenset[str], str], str] = {}
    source = "".join(one.read_text(encoding="utf-8") for one in REGISTRIES)
    for entry in re.finditer(r"\{[^{}]*?\bkey: '([^']+)',[^{}]*?\bmac: '([^']+)'", source):
        held, key = _chord(entry.group(1), "Control")
        if not held and key in ("Delete", "Backspace"):
            continue
        found[held, key] = _written(*_chord(entry.group(2), "Meta"))
    found[frozenset({"Control"}), "y"] = "Meta+Shift+z"
    return found

def mac_key(pressed: str) -> str:
    if pressed in ("Control", "ControlOrMeta"):
        return "Meta"
    chord = _chord(pressed, "Control")
    if chord in mac_bindings():
        return mac_bindings()[chord]
    held, key = chord
    if "Control" in held and key in TEXT_KEYS:
        moved, to = TEXT_KEYS[key]
        return _written((held - {"Control"}) | {moved}, to)
    if "Control" not in held:
        return pressed
    return _written((held - {"Control"}) | {"Meta"}, pressed.rsplit("+", 1)[-1])

def _mac_modifiers(modifiers: Sequence[str] | None) -> list[str] | None:
    if modifiers is None:
        return None
    return ["Meta" if one in ("Control", "ControlOrMeta") else one for one in modifiers]

def _press_as_a_mac() -> None:
    import weakref

    from playwright.sync_api import (
        Browser,
        BrowserContext,
        ElementHandle,
        Frame,
        Keyboard,
        Locator,
        Page,
    )

    other: weakref.WeakSet[Any] = weakref.WeakSet()

    def noted(method: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(method)
        def making(*args: Any, **kwargs: Any) -> Any:
            if "permissions" in kwargs:
                kwargs["permissions"] = [one for one in kwargs["permissions"] if one != "clipboard-write"]
            made = method(*args, **kwargs)
            agent = kwargs.get("user_agent")
            context = made.context if isinstance(made, Page) else made
            if (agent and "Mac" not in agent) or context in other:
                other.add(context)
                for page in context.pages:
                    other.add(page.keyboard)
            if isinstance(made, Page) and made.context in other:
                other.add(made.keyboard)
            return made

        return making

    Browser.new_context = noted(Browser.new_context)  # type: ignore[method-assign]
    Browser.new_page = noted(Browser.new_page)  # type: ignore[method-assign]
    BrowserContext.new_page = noted(BrowserContext.new_page)  # type: ignore[method-assign]

    def a_mac(owner: Any) -> bool:
        if isinstance(owner, Keyboard):
            return owner not in other
        page = owner if isinstance(owner, Page) else getattr(owner, "page", None)
        if page is None and isinstance(owner, Frame):
            page = owner.page
        return page is None or page.context not in other

    def keyed(method: Callable[..., Any], at: int) -> Callable[..., Any]:
        @functools.wraps(method)
        def pressing(*args: Any, **kwargs: Any) -> Any:
            if a_mac(args[0]):
                if "key" in kwargs:
                    kwargs["key"] = mac_key(kwargs["key"])
                elif len(args) > at:
                    args = (*args[:at], mac_key(args[at]), *args[at + 1 :])
            return method(*args, **kwargs)

        return pressing

    def modified(method: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(method)
        def clicking(*args: Any, **kwargs: Any) -> Any:
            if "modifiers" in kwargs and a_mac(args[0]):
                kwargs["modifiers"] = _mac_modifiers(kwargs["modifiers"])
            return method(*args, **kwargs)

        return clicking

    for name in ("press", "down", "up"):
        setattr(Keyboard, name, keyed(getattr(Keyboard, name), 1))
    for kind in (Page, Frame):
        kind.press = keyed(kind.press, 2)  # type: ignore[method-assign]
    for kind in (Locator, ElementHandle):
        kind.press = keyed(kind.press, 1)  # type: ignore[method-assign]
    for kind in (Page, Frame, Locator, ElementHandle):
        for name in ("click", "dblclick", "hover", "tap"):
            setattr(kind, name, modified(getattr(kind, name)))

if WEBKIT:
    _press_as_a_mac()

def _offline_as_chromium() -> None:
    from playwright.sync_api import BrowserContext

    went = BrowserContext.set_offline

    def set_offline(self: Any, offline: bool) -> None:
        went(self, offline)
        for page in self.pages:
            with contextlib.suppress(Exception):
                page.evaluate(
                    """(away) => {
                      window.__nibOffline = away
                      if (away) for (const one of [...(window.__nibSockets ?? [])]) one.close()
                    }""",
                    offline,
                )

    BrowserContext.set_offline = set_offline  # type: ignore[method-assign]

if WEBKIT:
    _offline_as_chromium()

def _hear_no_harmless() -> None:
    from playwright.sync_api import Page

    listen = Page.on

    def on(self: Any, event: str, handler: Any) -> Any:
        if event == "pageerror":
            heard = handler
            page = self

            def handler(error: Any) -> Any:
                return None if harmless(error, page.url) else heard(error)

        return listen(self, event, handler)

    Page.on = on  # type: ignore[method-assign]

_hear_no_harmless()

def tool(package: Path, name: str) -> list[str]:
    shim = package / "node_modules" / ".bin" / (f"{name}.cmd" if os.name == "nt" else name)
    if shim.exists():
        return [str(shim)]
    return [shutil.which("npx") or "npx", name]

def build(into: Path = DIST, served_by_worker: bool = False) -> None:
    kind = "worker" if served_by_worker else "plain"
    if os.environ.get("ORDEN_SKIP_BUILD") and built(into, kind):
        say(f"reusing the build in {into.name}")
        if served_by_worker:
            machine_bundle(fresh=False)
        return

    say(f"building the web app into {into.name}")
    started = time.monotonic()
    shutil.rmtree(into, ignore_errors=True)
    environment = {**os.environ}
    environment.pop("NODE_ENV", None)
    if served_by_worker:
        environment["VITE_ORDEN_API"] = ""
    else:
        environment.pop("VITE_ORDEN_API", None)
    done = subprocess.run(
        [*tool(APP, "vite"), "build", "--mode", "drive", "--outDir", str(into), "--emptyOutDir"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=BUILD_PATIENCE,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(f"the build failed:\n{done.stdout}\n{done.stderr}")
    (into / POINTED).write_text(kind, encoding="utf-8")
    (into / SEED_PATH.lstrip("/")).write_text(SEED_PAGE, encoding="utf-8")
    say(f"built in {time.monotonic() - started:.0f}s")
    if served_by_worker:
        machine_bundle(fresh=True)

def machine_bundle(fresh: bool) -> None:
    if not fresh and MACHINE_BUNDLE.exists():
        return
    say("building the online machine's bundle the Worker carries")
    done = subprocess.run(
        [shutil.which("node") or "node", "build.ts"],
        cwd=MACHINE,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=BUILD_PATIENCE,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(f"the machine's bundle failed:\n{done.stdout}\n{done.stderr}")

def built(into: Path, kind: str) -> bool:
    if not (into / "index.html").exists():
        return False
    pointed = into / POINTED
    said = pointed.read_text(encoding="utf-8").strip() if pointed.exists() else "plain"
    return said == kind

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    "": "application/octet-stream",
}

STAMP = "Mon, 01 Jan 2024 00:00:00 GMT"

Answer = Callable[["Files"], bool]

class Files(http.server.SimpleHTTPRequestHandler):

    protocol_version = "HTTP/1.1"
    extensions_map = TYPES
    timeout = 10

    folder = str(DIST)
    answer: Answer | None = None
    extra: Mapping[str, str] = {}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=self.folder, **kwargs)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def tally(self) -> dict[str, int]:
        return self.server.tally  # type: ignore[attr-defined, no-any-return]

    def do_GET(self) -> None:  # noqa: N802 - the name http.server wants
        if self.answer is not None and self.answer(self):
            return
        if self.path == SEED_PATH and not (Path(self.folder) / SEED_PATH.lstrip("/")).exists():
            self.reply(SEED_PAGE)
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self.answer is not None and self.answer(self):
            return
        super().do_HEAD()

    def send_response(self, code: int, message: str | None = None) -> None:
        held = self.tally()
        held["asked"] += 1
        if code == 200:
            held["sent"] += 1
        elif code == 304:
            held["again"] += 1
        super().send_response(code, message)

    def send_header(self, keyword: str, value: str) -> None:
        if keyword == "Last-Modified":
            value = STAMP
        if keyword == "Content-Length":
            self.tally()["bytes"] += int(value)
        super().send_header(keyword, value)

    def end_headers(self) -> None:
        said = b"".join(getattr(self, "_headers_buffer", [])).lower()
        if b"cache-control:" not in said:
            name = self.path.split("?", 1)[0]
            forever = name.startswith("/assets/") and "." in name.rsplit("/", 1)[-1]
            super().send_header(
                "Cache-Control", "public, max-age=31536000, immutable" if forever else "no-cache"
            )
        for keyword, value in self.extra.items():
            super().send_header(keyword, value)
        super().end_headers()

    def reply(self, body: bytes | str, kind: str = "text/html; charset=utf-8", code: int = 200) -> bool:
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)
        return True

class _Loopback(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 256

    def handle_error(self, request: Any, client_address: Any) -> None:
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)

class _Loopback6(_Loopback):
    address_family = socket.AF_INET6

class Served:

    def __init__(
        self,
        folder: Path | None = None,
        answer: Answer | None = None,
        headers: Mapping[str, str] | None = None,
        handler: type[http.server.BaseHTTPRequestHandler] | None = None,
    ) -> None:
        if handler is None:
            handler = type(
                "Handler",
                (Files,),
                {
                    "folder": str(folder or DIST),
                    "answer": staticmethod(answer) if answer else None,
                    "extra": dict(headers or {}),
                },
            )
        self.handler = handler

        self.servers: list[http.server.ThreadingHTTPServer] = []
        for _ in range(20):
            first = _Loopback(("127.0.0.1", 0), handler)
            try:
                second: _Loopback | None = _Loopback6(("::1", first.server_address[1]), handler)
            except OSError as error:
                if error.errno in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", -1)):
                    first.server_close()
                    continue
                second = None
            self.servers = [first, *([second] if second else [])]
            break
        else:
            raise SystemExit("no free port on the loopback for the file server")

        self.port = self.servers[0].server_address[1]
        self.tally = {"asked": 0, "sent": 0, "again": 0, "bytes": 0}
        for one in self.servers:
            one.tally = self.tally  # type: ignore[attr-defined]
            threading.Thread(target=one.serve_forever, name=f"serve {self.port}", daemon=True).start()

    def origin(self, host: str = "127.0.0.1") -> str:
        return f"http://{host}:{self.port}"

    def close(self) -> None:
        for one in self.servers:
            one.shutdown()
            one.server_close()

def side(handler: type[http.server.BaseHTTPRequestHandler]) -> Served:
    return Served(handler=handler)

def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])

def spawn(command: Sequence[str], **options: Any) -> subprocess.Popen[bytes]:
    if os.name == "nt":
        options.setdefault("creationflags", subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        options.setdefault("start_new_session", True)
    process = subprocess.Popen(list(command), **options)
    SPAWNED.add(process)
    return process

SPAWNED: set[subprocess.Popen[Any]] = set()

def end(process: subprocess.Popen[Any] | None, grace: float = 10) -> None:
    SPAWNED.discard(process)  # type: ignore[arg-type]
    if process is None or process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False
        )
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
        process.kill()
        process.wait(timeout=grace)

def _driver(play: Any) -> int | None:
    with contextlib.suppress(AttributeError, TypeError):
        return int(play.stop.__self__._connection._transport._proc.pid)
    return None

def _kill(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, check=False)
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(pid, signal.SIGKILL)

class _Closing:

    def __init__(self, drive: Drive) -> None:
        self.drive = drive
        self.driver: int | None = None
        self.done = threading.Event()
        self.fired = False
        self.clean = True

    def start(self) -> None:
        self.clean = sys.exc_info()[1] is None
        threading.Thread(target=self._watch, name="closing watch", daemon=True).start()

    def _watch(self) -> None:
        if self.done.wait(TEARDOWN):
            return
        self.fired = True
        say(f"closing took longer than {TEARDOWN}s; ending the browser (every thread below)")
        faulthandler.dump_traceback(all_threads=True)
        if self.driver:
            _kill(self.driver)
        if self.done.wait(15):
            return
        for one in list(SPAWNED):
            end(one)
        code = self.drive.verdict() if self.clean else 1
        sys.stdout.flush()
        os._exit(code)

class Drive:

    def __init__(
        self,
        file: str,
        *,
        served: bool = True,
        folder: Path = DIST,
        shots: str | None = None,
        fresh: bool = True,
        dev: bool = False,
        known: Mapping[str, str] | None = None,
        chats: bool = False,
    ) -> None:
        self.name = Path(file).stem
        self.chats = chats
        self.dev = dev
        self.dev_port = free_port() if dev else 0
        self.shots = SHOTS / (shots or self.name)
        self.fresh = fresh
        self.known = dict(known or {})
        self._cleared = False
        self.failures: list[str] = []
        self.folder = folder
        self._stack = contextlib.ExitStack()
        self.borrowed = os.environ.get("ORDEN_ORIGIN", "").rstrip("/")
        self.served = served and not self.borrowed and not dev
        self.server = Served(folder) if self.served else None
        if self.borrowed:
            self.origin = self.borrowed
        elif dev:
            self.origin = f"http://{self.name}.localhost:{self.dev_port}"
        elif self.server:
            self.origin = self.server.origin("127.0.0.1" if WEBKIT else f"{self.name}.localhost")
        else:
            self.origin = ""

    def header(self, name: str, value: str) -> None:
        if self.server is not None:
            self.server.handler.extra[name] = value  # type: ignore[attr-defined]

    def answers(self, answer: Answer) -> Answer:
        if self.server is not None:
            self.server.handler.answer = staticmethod(answer)  # type: ignore[attr-defined]
        return answer

    def say(self, words: str) -> None:
        say(words)

    def wrong(self, what: str) -> None:
        say(f"FAILED: {what}")
        self.failures.append(what)

    def shot(self, page: Any, name: str, **options: Any) -> Path:
        path = self.shots / f"{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(path), **options)
        say(f"shot {name}.png")
        return path

    def steady(self, page: Any, name: str, **options: Any) -> Path:
        from settling import steady

        self.shots.mkdir(parents=True, exist_ok=True)
        path = self.shots / f"{name}.png"
        path.write_bytes(steady(page, lambda: page.screenshot(**options), say, name))
        say(f"shot {name}.png")
        return path

    def wait_for(self, page: Any, expression: str, what: str, patience: float = PATIENCE) -> Any:
        try:
            came = page.wait_for_function(expression, timeout=patience * 1000, polling=50)
        except Exception as error:
            if "Timeout" not in type(error).__name__ and "Timeout" not in str(error):
                raise
            raise SystemExit(f"gave up waiting for {what}") from None
        return came.json_value()

    def waited(self, page: Any, expression: str, what: str, patience: float = PATIENCE) -> bool:
        try:
            self.wait_for(page, expression, what, patience)
        except SystemExit:
            self.wrong(f"gave up waiting for {what}")
            return False
        return True

    def browser(self, play: Any, **options: Any) -> Any:
        if WEBKIT:
            options.pop("channel", None)
            options.pop("args", None)
            return answering(play.webkit.launch(**options))
        channel = os.environ.get("ORDEN_BROWSER", "chromium")
        options.setdefault("channel", channel)
        return answering(play.chromium.launch(**options))

    def context(self, browser: Any, **options: Any) -> Any:
        context = browser.new_context(**options)
        if self.chats:
            context.add_init_script(CHATS_ON)
        return context

    def persistent(self, play: Any, profile: Path, **options: Any) -> Any:
        if WEBKIT:
            options.pop("channel", None)
            options.pop("args", None)
            options.setdefault("service_workers", WEBKIT_WORKERS)
            context = play.webkit.launch_persistent_context(user_data_dir=str(profile), **options)
        else:
            options.setdefault("channel", os.environ.get("ORDEN_BROWSER", "chromium"))
            context = play.chromium.launch_persistent_context(user_data_dir=str(profile), **options)
        if WEBKIT:
            context.add_init_script(MAC_PLATFORM)
            context.add_init_script(WEBKIT_SOCKETS)
            context.add_init_script(MAC_SELECT_ALL)
        context.add_init_script(BUILT_IN)
        context.add_init_script(ANSWERED)
        return context

    def page(self, browser: Any, errors: bool = True, **options: Any) -> Any:
        page = self.context(browser, **options).new_page()
        if errors:
            page.on("pageerror", lambda error: self.wrong(f"page error: {error}"))
        return page

    def open(
        self, page: Any, path: str = "/", origin: str | None = None, patience: float = PATIENCE
    ) -> None:
        page.goto(f"{origin or self.origin}{path}", wait_until="domcontentloaded", timeout=patience * 1000)
        self.ready(page, patience)

    def ready(self, page: Any, patience: float = PATIENCE) -> None:
        self.wait_for(page, "window.ordenApp", "the app", patience)
        self.wait_for(page, "window.ordenApp.workspace.activeSpace", "a space", patience)
        self.wait_for(
            page,
            f"performance.getEntriesByName({json.dumps(LAUNCHED)}).length > 0",
            "the launch order to finish",
            patience,
        )

    def choosers(self, page: Any) -> None:
        page.on("filechooser", lambda _chooser: None)
        page.evaluate("0")

    def inject(self, page: Any, script: Path) -> None:
        page.evaluate(script.read_text(encoding="utf-8"))

    def preload(self, page: Any, folder: Path | None = None) -> int:
        assets = (folder or self.folder) / "assets"
        chunks = sorted(f"/assets/{one.name}" for one in assets.glob("*.js"))
        sheets = sorted(f"/assets/{one.name}" for one in assets.glob("*.css"))
        page.evaluate(
            """([chunks, sheets]) => Promise.all([
              ...chunks.map((href) => ['modulepreload', href]),
              ...sheets.map((href) => ['preload', href]),
            ].map(([rel, href]) => new Promise((done) => {
              const link = document.createElement('link')
              link.rel = rel
              if (rel === 'preload') link.as = 'style'
              link.href = href
              link.onload = link.onerror = () => done()
              document.head.append(link)
            })))""",
            [chunks, sheets],
        )
        return len(chunks) + len(sheets)

    def reading(self, page: Any, patience: float = PATIENCE) -> None:
        page.evaluate("() => window.ordenApp.workspace.toggleReading()")
        self.wait_for(
            page, "document.querySelector('article.orden-write')?.childElementCount", "the reading view", patience
        )
        self.settled(page)

    def settled(self, page: Any) -> None:
        page.evaluate(
            "() => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(() => go())))"
        )

    def seed(
        self, page: Any, *texts: str, folder: str | None = None, lists: bool = False
    ) -> list[str]:
        return page.evaluate(  # type: ignore[no-any-return]
            """
            async ([texts, folder, lists]) => {
              const ws = window.ordenApp.workspace
              const root = ws.activeSpace.root
              const into = folder ? `${root.replace(/\\/+$/, '')}/${folder}` : root
              const tasks = lists ? await window.ordenApp.tasks() : null
              for (const text of texts) {
                const path = await ws.noteFrom(text, into)
                if (path && tasks) tasks.makeList(path)
              }
              await ws.loadTree()
              return ws.notes.map((one) => one.name)
            }
            """,
            [list(texts), folder, lists],
        )

    def open_note(self, page: Any, starts: str, patience: float = PATIENCE) -> None:
        page.evaluate(
            """async (starts) => {
              const ws = window.ordenApp.workspace
              const note = ws.notes.find((one) => one.name.startsWith(starts))
              if (!note) throw new Error(`no note starts with ${starts}`)
              await ws.openEntry(note.path, { activate: true })
            }""",
            starts,
        )
        self.wait_for(
            page,
            f"window.ordenApp.workspace.active?.note?.name?.startsWith({json.dumps(starts)})"
            " && document.querySelector('.cm-content')",
            f"the {starts} note",
            patience,
        )
        self.settled(page)

    def side(self, handler: type[http.server.BaseHTTPRequestHandler]) -> str:
        server = side(handler)
        self._stack.callback(server.close)
        return server.origin()

    def later(self, callback: Callable[[], object]) -> None:
        self._stack.callback(callback)

    @contextlib.contextmanager
    def session(self, browser: bool = True, playwright: bool = False, **launch: Any) -> Iterator[Any]:
        from playwright.sync_api import sync_playwright

        self.clear()
        closing = _Closing(self)
        try:
            with self._stack:
                if self.borrowed:
                    say(f"driving {self.origin}, which somebody else is serving")
                if self.server:
                    self._stack.callback(self.server.close)
                    if self.folder == DIST and OWN_BUILD:
                        build()
                    elif not (self.folder / "index.html").exists():
                        raise SystemExit(f"nothing is built in {self.folder}")
                    say(f"serving {self.folder.name} on {self.origin}")
                if self.dev and not self.borrowed:
                    self._develop()
                if not browser and not playwright:
                    try:
                        yield None
                    finally:
                        closing.start()
                    return
                with sync_playwright() as play:
                    closing.driver = _driver(play)
                    if playwright:
                        try:
                            yield play
                        finally:
                            closing.start()
                        return
                    opened = self.browser(play, **launch)
                    try:
                        yield opened
                    finally:
                        closing.start()
                        opened.close()
        except SystemExit as walked:
            said = str(walked.code) if walked.code is not None else ""
            if not any(words in said for words in self.known):
                raise
            self.failures.append(said)
        except Exception:
            if not (closing.fired and closing.clean):
                raise
            say("closing was ended from outside; the drive's steps had all run")
        finally:
            closing.done.set()

    def _develop(self) -> None:
        say(f"serving the app from a dev server on {self.origin}")
        server = spawn(
            [
                "node",
                str(APP / "node_modules" / "vite" / "bin" / "vite.js"),
                "--port",
                str(self.dev_port),
                "--strictPort",
                "--host",
                "127.0.0.1",
            ],
            cwd=APP,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._stack.callback(end, server)
        until = time.monotonic() + 60
        while time.monotonic() < until:
            if server.poll() is not None:
                raise SystemExit("the dev server stopped before it answered")
            try:
                with socket.create_connection(("127.0.0.1", self.dev_port), timeout=1):
                    return
            except OSError:
                time.sleep(0.3)
        raise SystemExit("the dev server never answered")

    def clear(self) -> None:
        if not self._cleared:
            self._cleared = True
            if self.fresh:
                shutil.rmtree(self.shots, ignore_errors=True)
        self.shots.mkdir(parents=True, exist_ok=True)

    def verdict(self, passed: str = "") -> int:
        known = [one for one in self.failures if any(words in one for words in self.known)]
        new = [one for one in self.failures if one not in known]
        for words, owner in self.known.items():
            if any(words in one for one in known):
                print(f"KNOWN: {words} ({owner})", flush=True)
            else:
                print(f"KNOWN NO LONGER: {words} ({owner}) - take it off the drive", flush=True)
        if new:
            print(f"\nFAILED ({len(new)})", flush=True)
            for one in new:
                print(f"  - {one}", flush=True)
            return 1
        if passed:
            print(f"\n{passed}", flush=True)
        return 0

    def run(self, steps: Callable[[Any], object], passed: str = "", **launch: Any) -> int:
        with self.session(**launch) as browser:
            steps(browser)
        return self.verdict(passed)

@functools.cache
def worker_port() -> int:
    return free_port()

def worker_origin() -> str:
    return f"http://127.0.0.1:{worker_port()}"

class Worker:

    def __init__(self, drive: Drive, variables: Mapping[str, str] | None = None) -> None:
        self.drive = drive
        self.port = worker_port()
        self.origin = worker_origin()
        self.variables = dict(variables or {})
        self.process: subprocess.Popen[bytes] | None = None
        self.state: Path | None = None
        self.log = drive.shots / "worker.log"
        self._output: Any = None

    def wrangler(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [*tool(SERVICE, "wrangler"), *args],
            cwd=SERVICE,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=BUILD_PATIENCE,
            check=False,
        )

    def prepare(self) -> None:
        if self.state is not None:
            return
        build(WORKER_DIST, served_by_worker=True)
        self.state = Path(tempfile.mkdtemp(prefix=f"orden-{self.drive.name}-worker-"))
        self.drive.later(self.close)
        self.drive.clear()
        self.log.write_bytes(b"")
        say("applying the migrations to a database of this run's own")
        done = self.wrangler("d1", "migrations", "apply", "nib", "--local", "--persist-to", str(self.state))
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

    def start(self, upstream: str | None = None, assets: Path | None = None) -> None:
        self.prepare()

        say(f"starting the Worker on {self.origin}" + (f" as {upstream}" if upstream else ""))
        self._output = self.log.open("ab")
        command = [
            *tool(SERVICE, "wrangler"),
            "dev",
            "--local",
            "--port",
            str(self.port),
            "--ip",
            "127.0.0.1",
            "--persist-to",
            str(self.state),
            "--inspector-port",
            str(free_port()),
            "--assets",
            str(assets or WORKER_DIST),
            "--show-interactive-dev-session=false",
            "--enable-containers=false",
            *(["--local-upstream", upstream] if upstream else []),
        ]
        for key, value in self.variables.items():
            command += ["--var", f"{key}:{value}"]
        for last in (False, True):
            self.process = spawn(command, cwd=SERVICE, stdout=self._output, stderr=subprocess.STDOUT)
            until = time.monotonic() + WORKER_PATIENCE
            while time.monotonic() < until:
                if (code := self.process.poll()) is not None:
                    if last:
                        raise SystemExit(f"the Worker stopped ({code}) before it answered:\n{self.said()}")
                    say(f"the Worker stopped ({code}) before it answered; starting it again")
                    end(self.process)
                    break
                if self.answering():
                    say("the Worker is answering")
                    return
                time.sleep(0.5)
            else:
                raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def answering(self) -> bool:
        try:
            urllib.request.urlopen(f"{self.origin}/health", timeout=5).read()
            return True
        except urllib.error.HTTPError:
            return True
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            return False

    def stop(self) -> None:
        if self.process is not None:
            say("stopping the Worker")
            end(self.process)
            self.process = None
        if self._output is not None:
            self._output.close()
            self._output = None

    def close(self) -> None:
        self.stop()
        if self.state is not None:
            shutil.rmtree(self.state, ignore_errors=True)
            self.state = None

    def said(self, lines: int = 40) -> str:
        if not self.log.exists():
            return "(nothing)"
        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-lines:])

    def written(self) -> str:
        return self.log.read_text("utf-8", errors="replace") if self.log.exists() else ""

    def sql(self, statement: str) -> str:
        return self._execute(statement).stdout

    def query(self, statement: str) -> list[dict[str, Any]]:
        done = self._execute(statement, "--json")
        answer = json.loads(done.stdout)
        return list(answer[0].get("results", [])) if answer else []

    def _execute(self, statement: str, *how: str) -> subprocess.CompletedProcess[str]:
        self.prepare()
        for tries in range(10):
            done = self.wrangler(
                "d1",
                "execute",
                "nib",
                "--local",
                "--persist-to",
                str(self.state),
                *how,
                f"--command={statement}",
            )
            busy = "SQLITE_BUSY" in done.stdout + done.stderr
            if done.returncode == 0 or not busy:
                break
            time.sleep(0.2 * (tries + 1))
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")
        return done

    def request(
        self,
        path: str,
        token: str | None = None,
        body: Any = None,
        method: str | None = None,
        timeout: float = 20,
    ) -> Any:
        data = None if body is None else json.dumps(body).encode()
        headers = {"content-type": "application/json"} if data is not None else {}
        if token:
            headers["authorization"] = f"Bearer {token}"
        call = urllib.request.Request(
            f"{self.origin}{path}",
            data=data,
            headers=headers,
            method=method or ("GET" if data is None else "POST"),
        )
        with urllib.request.urlopen(call, timeout=timeout) as answer:
            return json.loads(answer.read() or b"null")

    def account(self, email: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(
            f"insert into users (id, email, created_at) values ('{user}', '{email}', {now});"
            "insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )
        return token

    def mail_to(self, address: str, after: int = 0) -> str:
        lines = self.written()[after:].splitlines()
        found = [at for at, line in enumerate(lines) if line.strip() == f"To: {address}"]
        if not found:
            return ""
        message = ""
        for line in lines[found[-1] : found[-1] + 6]:
            if line.startswith("Subject: "):
                message += line[len("Subject: ") :] + "\n"
            if line.startswith("Text: "):
                text = Path(line[len("Text: ") :].strip())
                if text.exists():
                    message += text.read_text("utf-8", errors="replace")
        return message

    def waits_for_mail(
        self, address: str, pattern: str, what: str, after: int = 0, patience: float = 40
    ) -> re.Match[str]:
        until = time.monotonic() + patience
        while time.monotonic() < until:
            found = re.search(pattern, self.mail_to(address, after))
            if found:
                return found
            time.sleep(0.3)
        raise SystemExit(
            f"gave up waiting for {what}. the last message to {address} was:\n"
            f"{self.mail_to(address, after)!r}"
        )

def identifier_of(exe: Path, given: str | None = None) -> str | None:
    said = given or os.environ.get("ORDEN_PROBE_IDENTIFIER")
    if said:
        return said
    beside = exe.parent / "orden-probe-identifier.json"
    with contextlib.suppress(OSError, ValueError, KeyError, TypeError):
        return str(json.loads(beside.read_text(encoding="utf-8"))["identifier"])
    return None

def refused(exe: Path, identifier: str | None) -> str:
    local = os.environ.get("LOCALAPPDATA")
    for installed in ("Nib", "nibeditor", "Orden"):
        if local and exe.resolve().is_relative_to((Path(local) / installed).resolve()):
            return f"{exe} is the installed nib"
    if not identifier:
        return f"{exe} names no identifier (ORDEN_PROBE_IDENTIFIER, or --identifier to the drive)"
    if identifier == RELEASE_IDENTIFIER or not identifier.startswith(RELEASE_IDENTIFIER + "."):
        return f"{exe} is built under {identifier}, not one of its own like {RELEASE_IDENTIFIER}.probe.<name>"
    return ""

class Native:

    def __init__(
        self, drive: Drive, exe: Path, env: Mapping[str, str] | None = None, identifier: str | None = None
    ) -> None:
        self.identifier = identifier_of(exe, identifier)
        if why := refused(exe, self.identifier):
            raise SystemExit(f"not launched: {why}")

        sys.path.insert(0, str(ROOT / "scripts"))
        import probe_app

        self.probe = probe_app
        self.drive = drive
        self.exe = exe
        self.spaces = probe_app.spaces_folder(drive.name)
        self.env = {**os.environ, **(env or {}), "ORDEN_SPACES_DIR": str(self.spaces)}
        self.app: subprocess.Popen[bytes] | None = None
        drive.later(self.stop)

    def start(self, args: Sequence[str] = (), quiet: bool = True) -> subprocess.Popen[bytes]:
        self.app = self.probe.run_probe(self.exe, env=self.env, quiet=quiet, args=args)
        return self.app

    def stop(self) -> None:
        if self.app is not None and self.app.poll() is None:
            if not self.probe.close_app(self.app):
                end(self.app)
        self.app = None
        shutil.rmtree(self.spaces, ignore_errors=True)

def needs_of(source: str) -> tuple[str, ...]:
    found = re.search(r"^NEEDS = \(([^)]*)\)", source, re.MULTILINE)
    said = tuple(one.strip().strip("\"'") for one in found.group(1).split(",") if one.strip()) if found else ()
    if "native" not in said and re.search(r"\bprobe_app\b|\bNative\(DRIVE\b|\"(?:orden|nib)\.exe\"", source):
        said = (*said, "native")
    chromium_only = (
        r"\bnew_cdp_session\b|\bconnect_over_cdp\b|use-fake-device-for-media-stream|new Touch\("
    )
    if "chromium" not in said and re.search(chromium_only, source):
        said = (*said, "chromium")
    return said

def missing(needs: Sequence[str]) -> str:
    for one in needs:
        if one == "native" and not (sys.platform == "win32" and os.environ.get("ORDEN_PROBE_EXE")):
            return f"needs {NEEDS['native']}"
        if one == "native":
            exe = Path(os.environ["ORDEN_PROBE_EXE"])
            if why := refused(exe, identifier_of(exe)):
                return f"refused: {why}"
        if one == "chromium" and WEBKIT:
            return f"needs {NEEDS['chromium']}"
        if one == "tab-stops" and WEBKIT and sys.platform == "darwin":
            return f"needs {NEEDS['tab-stops']}"
        if one not in NEEDS:
            return f"needs {one}, which the harness does not know"
    return ""
