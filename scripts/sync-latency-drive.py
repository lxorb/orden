from __future__ import annotations
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zlib
from typing import Any
from fresh_app import ended, fresh
from native_app import App, config_of, endpoint

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "apps" / "desktop" / "test" / "e2e"))
import harness  # noqa: E402

DRIVE = harness.Drive(__file__, served=False)
say = DRIVE.say
EMAIL = "sync-latency-native@example.com"
SPACE = "Latency"
TARGET = 2.0
PATIENCE = 90.0
STARTED = time.monotonic()
REQUEST = re.compile(rb"^(GET|POST|PUT|PATCH|DELETE) (\S+) HTTP/1\.1\r\n", re.MULTILINE)
PATHS = (
    "const ws = window.ordenApp.workspace; const flat = (one) => one.replace(/\\\\/g, '/');"
    " const base = flat(ws.activeSpace.root).replace(/\\/+$/, '') + '/';"
    " return ws.notes.map((n) => flat(n.path).slice(base.length)).sort()"
)
events: list[tuple[float, str, str, str]] = []
table: list[tuple[str, float]] = []
wrong: list[str] = []
def note(who: str, kind: str, said: str) -> None:
    at = time.monotonic()
    events.append((at, who, kind, said))
    if kind != "http":
        print(f"    {at - STARTED:8.2f} {who:8} {kind:9} {said}", flush=True)
class Frames:
    def __init__(self, who: str, path: str, upgrade: bool) -> None:
        self.who, self.path, self.upgrade = who, path, upgrade
        self.head = not upgrade
        self.buffer = b""
        self.inflate = zlib.decompressobj(-15)
    def feed(self, data: bytes) -> None:
        self.buffer += data
        if not self.head:
            end = self.buffer.find(b"\r\n\r\n")
            if end < 0:
                return
            status = self.buffer[: self.buffer.find(b"\r\n")].decode("latin-1")
            note(self.who, "status", f"{self.path} {status}")
            self.buffer = self.buffer[end + 4 :]
            self.head = True
        while len(self.buffer) >= 2:
            first, second = self.buffer[0], self.buffer[1]
            masked, size, at = second & 0x80, second & 0x7F, 2
            if size == 126:
                if len(self.buffer) < 4:
                    return
                size, at = int.from_bytes(self.buffer[2:4], "big"), 4
            elif size == 127:
                if len(self.buffer) < 10:
                    return
                size, at = int.from_bytes(self.buffer[2:10], "big"), 10
            key = self.buffer[at : at + 4] if masked else b""
            at += 4 if masked else 0
            if len(self.buffer) < at + size:
                return
            body = self.buffer[at : at + size]
            if masked:
                body = bytes(one ^ key[index % 4] for index, one in enumerate(body))
            self.buffer = self.buffer[at + size :]
            if first & 0x40:
                try:
                    body = self.inflate.decompress(body + b"\x00\x00\xff\xff")
                except zlib.error:
                    body = b"?"
            self.frame(first & 0x0F, body)
    def frame(self, code: int, body: bytes) -> None:
        if code == 1:
            text = body.decode("utf-8", "replace")
            if not re.search(r'"t":"(beat|pong)"', text) and text not in ("beat", "ping", "pong"):
                note(self.who, "text", f"{self.path} {text[:160]}")
        elif code == 8:
            reason = int.from_bytes(body[:2], "big") if len(body) >= 2 else 0
            note(self.who, "close", f"{self.path} {reason} {body[2:].decode('utf-8', 'replace')[:80]}")
        elif code == 2 and "/rooms/" in self.path:
            note(self.who, "binary", f"{self.path} {len(body)}B {body[:2].hex()}")
class Proxy:
    def __init__(self, port: int, upstream: int) -> None:
        self.upstream = upstream
        self.server = socket.create_server(("127.0.0.1", port), reuse_port=False)
        threading.Thread(target=self.serve, daemon=True).start()
    def serve(self) -> None:
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            threading.Thread(target=self.carry, args=(client,), daemon=True).start()
    def carry(self, client: socket.socket) -> None:
        try:
            server = socket.create_connection(("127.0.0.1", self.upstream))
        except OSError:
            client.close()
            return
        first = b""
        while b"\r\n\r\n" not in first:
            chunk = client.recv(65536)
            if not chunk:
                break
            first += chunk
        head = first.split(b"\r\n", 1)[0].decode("latin-1").split(" ")
        path = head[1].split("?")[0] if len(head) > 1 else "?"
        upgrade = b"upgrade: websocket" in first.lower()
        if upgrade:
            note("native", "open", path)
        server.sendall(first)
        downward = Frames("native", path, upgrade) if upgrade else None
        upward = Frames("native>", path, True) if upgrade else None
        if upward:
            upward.head = True
            upward.feed(first[first.find(b"\r\n\r\n") + 4 :])
        else:
            self.requests(first)
        def back() -> None:
            try:
                while chunk := server.recv(65536):
                    client.sendall(chunk)
                    if downward:
                        downward.feed(chunk)
            except OSError:
                pass
            finally:
                if upgrade:
                    note("native", "gone", path)
                for one in (client, server):
                    try:
                        one.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
        threading.Thread(target=back, daemon=True).start()
        try:
            while chunk := client.recv(65536):
                server.sendall(chunk)
                if upward:
                    upward.feed(chunk)
                else:
                    self.requests(chunk)
        except OSError:
            pass
        finally:
            try:
                server.shutdown(socket.SHUT_WR)
            except OSError:
                pass
    def requests(self, data: bytes) -> None:
        for found in REQUEST.finditer(data):
            path = found.group(2).decode("latin-1").split("?")[0]
            if path not in ("/v1/me", "/health") and not path.startswith("/i/"):
                note("native", "http", f"{found.group(1).decode()} {path}")
    def close(self) -> None:
        self.server.close()
class Native:
    def __init__(self, app: App) -> None:
        self.app = app
    def eval(self, code: str, seconds: float = 30) -> Any:
        said = self.app.answer(code, seconds)
        if said.get("ok", said.get("status") == "ok"):
            return said.get("value")
        raise SystemExit(f"the native app refused: {str(said)[:400]}")
    def until(self, code: str, what: str, patience: float = PATIENCE) -> Any:
        stop = time.monotonic() + patience
        while time.monotonic() < stop:
            said = self.app.answer(code, 10)
            value = said.get("value") if said.get("ok", said.get("status") == "ok") else None
            if value:
                return value
            time.sleep(0.1)
        raise SystemExit(f"gave up waiting for {what}")
def watch(native: Native, stop: threading.Event) -> None:
    last = None
    code = (
        "const s = window.ordenApp?.sync; const r = s?.engine;"
        " return [s?.version, s?.status, r?.status, !!r?.engine, r?.passing, document.hidden, document.hasFocus()].join(' ')"
    )
    while not stop.is_set():
        said = native.app.answer(code, 5)
        now = said.get("value") if said.get("ok") else "unanswered"
        if now != last:
            note("native", "runner", f"version status runner engine passing hidden focus: {now}")
            last = now
        stop.wait(0.25)
def second_token(worker: harness.Worker) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    user = worker.query(f"select id from users where email = '{EMAIL}'")[0]["id"]
    worker.sql(harness.session_row(hashlib.sha256(token.encode()).hexdigest(), user, int(time.time() * 1000)))
    return token
def web_page(browser: Any, token: str) -> Any:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[web] page error: {error}"))
    def opened(ws: Any) -> None:
        path = ws.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        note("web", "open", f"/{path}")
        ws.on("framereceived", lambda frame: note("web", "text", f"/{path} {frame}"[:160]) if isinstance(frame, str) else None)
        ws.on("close", lambda _: note("web", "gone", f"/{path}"))
    page.on("websocket", opened)
    page.goto(harness.worker_origin(), wait_until="domcontentloaded")
    web_until(page, "() => !!window.ordenApp?.account.user", "[web] the account")
    return page
def web_until(page: Any, script: str, what: str, arg: object = None, patience: float = PATIENCE) -> Any:
    stop = time.monotonic() + patience
    while time.monotonic() < stop:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")
def web_act(page: Any, script: str) -> None:
    page.evaluate(
        "async (script) => { const ws = window.ordenApp.workspace;"
        " const at = (rel) => ws.activeSpace.root.replace(/\\/+$/, '') + '/' + rel;"
        " await (new Function('ws', 'at', `return (async () => { ${script} })()`))(ws, at) }",
        script,
    )
def native_act(native: Native, script: str) -> None:
    native.eval(
        "const ws = window.ordenApp.workspace;"
        " const at = (rel) => ws.activeSpace.root.replace(/\\/+$/, '') + '/' + rel;"
        f" {script}; return true"
    )
def record(what: str, seconds: float) -> None:
    table.append((what, seconds))
    note("drive", "measured", f"{what}: {seconds:.2f} s")
    say(f"{what}: {seconds:.2f} s")
    if seconds > TARGET and "--measure" not in sys.argv:
        wrong.append(f"{what} took {seconds:.2f} s, more than {TARGET} s")
def on_web(page: Any, what: str, check: str, started: float) -> None:
    try:
        web_until(page, f"() => {{ const p = (() => {{ {PATHS} }})(); return {check} }}", what)
        record(what, time.monotonic() - started)
    except SystemExit:
        record(what, PATIENCE)
def on_native(native: Native, what: str, check: str, started: float) -> None:
    try:
        native.until(f"const p = (() => {{ {PATHS} }})(); return {check}", what)
        record(what, time.monotonic() - started)
    except SystemExit:
        record(what, PATIENCE)
def ops(what: str, act: Any, seen: Any) -> None:
    note("drive", "step", f"{what}: create")
    started = time.monotonic()
    act(f"await ws.noteFrom('# Made {what}\\n\\nmade\\n', ws.activeSpace.root)")
    seen(f"{what} create", f"p.includes('Made {what}.md')", started)
    note("drive", "step", f"{what}: rename")
    started = time.monotonic()
    act(f"await ws.rename(at('Made {what}.md'), 'Named {what}.md')")
    seen(f"{what} rename", f"p.includes('Named {what}.md') && !p.includes('Made {what}.md')", started)
    started = time.monotonic()
    act(f"await ws.noteFrom('# keep\\n', at('F {what}'))")
    seen(f"{what} create in a new folder", f"p.some((one) => one.startsWith('F {what}/'))", started)
    time.sleep(3)
    note("drive", "step", f"{what}: move")
    started = time.monotonic()
    act(f"await ws.moveMany([at('Named {what}.md')], at('F {what}'))")
    seen(f"{what} move", f"p.includes('F {what}/Named {what}.md') && !p.includes('Named {what}.md')", started)
    note("drive", "step", f"{what}: delete")
    started = time.monotonic()
    act(f"await ws.remove(at('F {what}/Named {what}.md'), false)")
    seen(f"{what} delete", f"!p.includes('F {what}/Named {what}.md')", started)
OPEN = (
    "const ws = window.ordenApp.workspace; const path = ws.activeSpace.root.replace(/\\/+$/, '') + '/' + %s;"
    " await ws.openEntry(path, { activate: true }); return true"
)
OPENED = (
    "const tab = window.ordenApp.workspace.active;"
    " return !!tab && !tab.coming && !!window.orden && window.orden.state.doc.length > 0"
)
MERGED = (
    "const app = window.ordenApp; const asked = app.prompt;"
    " if (asked.open && asked.mode === 'choose' && asked.options.some((one) => one.id === 'merge')) asked.pick('merge');"
    " return app.sync.version === 2 && !!app.sync.engine?.engine"
)
STATE = (
    "const app = window.ordenApp; const r = app?.sync?.engine;"
    " return { signed: app?.account.signedIn, settling: app?.account.settling, syncable: app?.account.syncable,"
    " version: app?.account.user?.syncVersion, sync: app?.sync.version, status: app?.sync.status, runner: r?.status,"
    " engine: !!r?.engine, prompt: app?.prompt.open ? app.prompt.title : null, spaces: app?.workspace.spaces.map((one) => one.name) }"
)
TYPE = "const view = window.orden; view.dispatch({ changes: { from: view.state.doc.length, insert: %s } }); return true"
TEXT = "return window.orden ? window.orden.state.doc.toString() : ''"
def live(what: str, write: Any, text: Any, started: float) -> None:
    sent: list[tuple[str, float]] = []
    stop = time.monotonic() + PATIENCE
    while time.monotonic() < stop:
        words = f"{what.split()[0]}{len(sent)}x"
        write(f" {words}")
        sent.append((words, time.monotonic()))
        time.sleep(0.15)
        held = text() or ""
        for one, at in sent:
            if one in held and time.monotonic() - at < 1.0:
                record(what, at - started)
                return
    record(what, PATIENCE)
def together(page: Any, native: Native, rel: str, native_first: bool) -> None:
    def web_open() -> None:
        page.evaluate(f"async () => {{ {OPEN % json.dumps(rel)} }}")
        web_until(page, f"() => {{ {OPENED} }}", "[web] the note open")
    def native_open() -> None:
        native.eval(OPEN % json.dumps(rel))
        native.until(OPENED, "[native] the note open", 20)
    first, second = (native_open, web_open) if native_first else (web_open, native_open)
    order = "native first" if native_first else "web first"
    note("drive", "step", f"live {rel}: {order}")
    first()
    time.sleep(1.5)
    started = time.monotonic()
    second()
    live(
        f"web typing reaches native ({order})",
        lambda words: page.evaluate(f"() => {{ {TYPE % json.dumps(words)} }}"),
        lambda: native.eval(TEXT, 10),
        started,
    )
    live(
        f"native typing reaches web ({order})",
        lambda words: native.eval(TYPE % json.dumps(words), 10),
        lambda: page.evaluate(f"() => {{ {TEXT} }}"),
        started,
    )
def window(native: Native, verb: str) -> None:
    said = native.app.answer(f"await window.__TAURI_INTERNALS__.invoke('plugin:window|{verb}', {{ label: 'main' }}); return true", 10)
    note("drive", "step", f"window {verb}: {said.get('value', said.get('error'))}")
def away(page: Any, native: Native, seconds: float) -> None:
    native.eval(OPEN % json.dumps("Third.md"))
    native.until(OPENED, "[native] the note open", 20)
    window(native, "minimize")
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        said = native.app.answer("return [document.visibilityState, document.hasFocus()].join(' ')", 5)
        note("native", "hidden", str(said.get("value") if said.get("ok") else said.get("error", said)))
        time.sleep(min(10.0, max(0.0, stop - time.monotonic())))
    ops(
        "hidden",
        lambda script: web_act(page, script),
        lambda what, check, started: on_native(native, f"{what} on native, hidden {seconds:.0f} s", check, started),
    )
    note("drive", "step", "live Third.md: native first, native hidden")
    started = time.monotonic()
    page.evaluate(f"async () => {{ {OPEN % json.dumps('Third.md')} }}")
    web_until(page, f"() => {{ {OPENED} }}", "[web] the note open")
    live(
        "web typing reaches hidden native",
        lambda words: page.evaluate(f"() => {{ {TYPE % json.dumps(words)} }}"),
        lambda: native.eval(TEXT, 10),
        started,
    )
    live(
        "hidden native typing reaches web",
        lambda words: native.eval(TYPE % json.dumps(words), 10),
        lambda: page.evaluate(f"() => {{ {TEXT} }}"),
        started,
    )
    window(native, "unminimize")
    window(native, "set_focus")
def timeline(out: pathlib.Path) -> None:
    lines = [f"{at - STARTED:8.2f} {who:8} {kind:9} {said}" for at, who, kind, said in sorted(events)]
    (out / "timeline.log").write_text("\n".join(lines) + "\n", encoding="utf-8")
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--port", type=int, default=47280)
    parser.add_argument("--out", type=pathlib.Path, default=harness.SHOTS / "sync-latency-drive")
    parser.add_argument("--measure", action="store_true", help="report the times without failing over 2 s")
    parser.add_argument("--shared", action="store_true", help="the web page signs in with the native app's own session")
    parser.add_argument("--hidden", type=float, default=0, help="also measure with the native window minimized this long")
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    args.out.mkdir(parents=True, exist_ok=True)
    home = pathlib.Path(tempfile.mkdtemp(prefix="orden-sync-latency-"))
    os.environ["XDG_CONFIG_HOME"] = str(home / "config")
    config = config_of(args.identifier)
    fresh(config)
    spaces = home / "spaces"
    spaces.mkdir()
    worker = harness.Worker(DRIVE)
    process: subprocess.Popen[bytes] | None = None
    stop = threading.Event()
    with DRIVE.session() as browser:
        worker.start()
        proxy = Proxy(args.port, worker.port)
        DRIVE.later(proxy.close)
        token = worker.account(EMAIL)
        worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")
        space = worker.request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        for name in ("Seed.md", "Second.md", "Third.md"):
            worker.request(f"/v1/spaces/{space['id']}/notes", token=token, body={"path": name, "content": f"# {name}\n\nthe seed\n"})
        who = worker.request("/v1/me", token=token)
        secret = secrets.token_hex(32)
        (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
        log = (args.out / "app.log").open("wb")
        environment = {
            **os.environ,
            "ORDEN_SPACES_DIR": str(spaces),
            "APPIMAGE": "/nonexistent/x.AppImage",
            "XDG_DATA_HOME": str(home / "data"),
            "XDG_CACHE_HOME": str(home / "cache"),
        }
        process = subprocess.Popen([str(args.exe)], env=environment, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
        native: Native | None = None
        try:
            native = Native(endpoint(config, process.pid, secret, 30))
            native.until(f"return performance.getEntriesByName({json.dumps(harness.LAUNCHED)}).length > 0 && !!window.ordenApp", "[native] the launch")
            note("drive", "step", "native signs in")
            native.eval(
                f"const account = window.ordenApp.account; await account.arrive({json.dumps(token)}, {json.dumps(who)});"
                " account.settled(); return true"
            )
            native.until(MERGED, "[native] the v2 runner")
            threading.Thread(target=watch, args=(native, stop), daemon=True).start()
            native.until(f"return window.ordenApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})", "[native] the space")
            native.eval(
                f"const ws = window.ordenApp.workspace; await ws.selectSpace(ws.spaces.find((one) => one.name === {json.dumps(SPACE)}).id);"
                " await ws.loadTree(); return true"
            )
            native.until(f"const p = (() => {{ {PATHS} }})(); return p.includes('Seed.md') && p.includes('Second.md')", "[native] the seeds")
            page = web_page(browser, token if args.shared else second_token(worker))
            web_until(page, "(n) => window.ordenApp.workspace.spaces.some((one) => one.name === n)", "[web] the space", SPACE)
            page.evaluate(
                "async (name) => { const ws = window.ordenApp.workspace;"
                " await ws.selectSpace(ws.spaces.find((one) => one.name === name).id); await ws.loadTree() }",
                SPACE,
            )
            web_until(page, f"() => {{ const p = (() => {{ {PATHS} }})(); return p.includes('Seed.md') }}", "[web] the seeds")
            time.sleep(8)
            ops(
                "native",
                lambda script: native_act(native, script),
                lambda what, check, started: on_web(page, f"{what} on web", check, started),
            )
            time.sleep(3)
            ops(
                "web",
                lambda script: web_act(page, script),
                lambda what, check, started: on_native(native, f"{what} on native", check, started),
            )
            time.sleep(3)
            together(page, native, "Seed.md", native_first=False)
            time.sleep(3)
            together(page, native, "Second.md", native_first=True)
            time.sleep(2)
            if args.hidden:
                away(page, native, args.hidden)
        except SystemExit as gave_up:
            wrong.append(f"gave up: {gave_up}")
            said = native.app.answer(STATE, 10) if native else {}
            say(f"native state: {str(said)[:600]}")
        finally:
            stop.set()
            for row in worker.query("select d.id, d.platform, d.app, s.token_hash from devices d join sessions s on s.id = d.session_id order by d.created_at"):
                say(f"device {row['id']} on {row['platform']} ({row['app']}), session {row['token_hash'][:12]}")
            mine = hashlib.sha256(token.encode()).hexdigest()
            picked = worker.query(
                "select d.id from devices d join sessions s on s.id = d.session_id"
                f" where s.token_hash = '{mine}' and d.revoked_at is null limit 1"
            )
            say(f"the session the native app signed in with ({mine[:12]}) is read by the server as device {picked[0]['id'] if picked else None}")
            ended(process, gentle=True)
            log.close()
    timeline(args.out)
    said = (args.out / "app.log").read_text("utf-8", errors="replace").splitlines()
    for line in [one for one in said if re.search(r"sync|hub|room", one, re.IGNORECASE)][-60:]:
        print(f"  app: {line[:240]}", flush=True)
    print("\n| what | seconds |\n|---|---|", flush=True)
    for what, seconds in table:
        print(f"| {what} | {seconds:.2f} |", flush=True)
    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\nmeasured only" if args.measure else f"\nevery change showed within {TARGET} s", flush=True)
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
