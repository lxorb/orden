from __future__ import annotations

import argparse
import base64
import http.server
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

CANNOT: dict[str, set[str]] = {
    "webview2": set(),
    "chromium": set(),
    "wkwebview": {
        "browser_drag",
        "browser_upload",
        "browser_console",
        "browser_network",
    },
}

KNOWN: dict[str, dict[str, str]] = {}

UNSUPPORTED = "unsupported_on_this_engine"

STYLE = "<style>body{font:16px system-ui;margin:2rem;max-width:40rem}label{display:block;margin:.5rem 0}</style>"

def page(title: str, body: str, script: str = "") -> bytes:
    return (
        f"<!doctype html><meta charset=utf-8><title>{title}</title>{STYLE}<h1>{title}</h1>{body}<script>{script}</script>"
    ).encode()

FORM = page(
    "Parity form",
    """<p>alpha words</p>
<label>Name <input id=name></label>
<label><input type=checkbox id=gift> Gift wrap</label>
<label>Size <select id=size><option>Small</option><option>Large</option></select></label>
<button id=go>Press me</button>
<div id=out></div>
<div id=keys></div>
<div id=hover style="padding:1rem;background:#eee">hover here</div>
<label>Attachment <input type=file id=file></label>
<div id=drag draggable=true style="padding:1rem;background:#ddf">drag me</div>
<div id=drop style="padding:1rem;background:#dfd">drop here</div>
<a href="/b">to the second page</a>
<div style="height:3000px"></div><p id=far>far down</p>""",
    """
const out = (words) => { const line = document.createElement('p'); line.textContent = words; document.getElementById('out').append(line) }
document.getElementById('go').addEventListener('click', () => out('pressed ' + document.getElementById('name').value))
document.getElementById('gift').addEventListener('change', (event) => out('gift ' + event.target.checked))
document.getElementById('size').addEventListener('change', (event) => out('size ' + event.target.value))
document.getElementById('hover').addEventListener('mouseover', () => out('hovered'))
document.getElementById('file').addEventListener('change', (event) => out('file ' + [...event.target.files].map((one) => one.name).join(',')))
document.getElementById('drop').addEventListener('drop', (event) => { event.preventDefault(); out('dropped') })
document.getElementById('drop').addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('keydown', (event) => { document.getElementById('keys').textContent = 'key ' + event.key })
console.log('parity console')
fetch('/ping')
localStorage.setItem('parity', 'yes')
document.cookie = 'parity=1; path=/'
""",
)

PAGES: dict[str, bytes] = {
    "/a": FORM,
    "/b": page("Parity B", "<p>beta words</p>"),
    "/alert": page("Parity alert", "<p id=said>waiting</p>", "setTimeout(() => { alert('parity alert'); document.getElementById('said').textContent = 'alerted' }, 300)"),
    "/confirm": page("Parity confirm", "<p id=said>waiting</p>", "setTimeout(() => { document.getElementById('said').textContent = 'confirmed ' + confirm('go on?') }, 300)"),
    "/prompt": page("Parity prompt", "<p id=said>waiting</p>", "setTimeout(() => { document.getElementById('said').textContent = 'prompted ' + prompt('your name?', 'nobody') }, 300)"),
    "/ping": b"pong",
}

USER, PASSWORD = "parity", "s3cret-parity"

class Site(http.server.ThreadingHTTPServer):
    daemon_threads = True

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        path = self.path.split("?")[0]
        if path == "/file":
            body = b"parity file\n"
            self.send_response(200)
            self.send_header("content-type", "application/octet-stream")
            self.send_header("content-disposition", 'attachment; filename="parity.txt"')
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/auth":
            wanted = "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
            if self.headers.get("authorization") != wanted:
                body = b"<!doctype html><title>no</title>not signed in"
                self.send_response(401)
                self.send_header("www-authenticate", 'Basic realm="parity"')
            else:
                body = page("Parity signed in", "<p>signed in</p>")
                self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        body = PAGES.get(path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8" if path != "/ping" else "text/plain")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def config_dir(identifier: str) -> pathlib.Path:
    if sys.platform == "win32":
        return pathlib.Path(os.environ["APPDATA"]) / identifier
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier

def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    shutil.rmtree(config_dir(identifier), ignore_errors=True)

class Endpoint:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def call(self, verb: str, args: dict[str, Any], seconds: float = 60) -> dict[str, Any]:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=seconds) as said:
                return json.loads(said.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            return {"status": "error", "code": f"http {refused.code}", "message": refused.read().decode("utf-8", "replace")}
        except Exception as error:  # noqa: BLE001 - a wedged app fails in its own ways
            return {"status": "error", "code": "no answer", "message": str(error)}

def endpoint(identifier: str, pid: int, seconds: float = 120) -> Endpoint:
    path = config_dir(identifier) / "automation.json"
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return Endpoint(int(said["port"]), str(said["secret"]))
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

class Run:

    def __init__(self, engine: str, api: Endpoint, base: str, upload: pathlib.Path) -> None:
        self.engine, self.api, self.base, self.upload = engine, api, base, upload
        self.results: list[dict[str, Any]] = []
        self.tab = ""
        self.refs: dict[str, str] = {}

    def check(self, name: str, verb: str, args: dict[str, Any], judge: Callable[[dict[str, Any]], str | None] | None = None) -> dict[str, Any]:

        said = self.api.call(verb, args)
        cannot = verb in CANNOT[self.engine]
        code = said.get("code")
        if cannot:
            problem = None if code == UNSUPPORTED else f"{verb} should answer {UNSUPPORTED} on {self.engine}, and answered {said.get('status')} {code or ''}: has the table moved?"
        elif code == UNSUPPORTED:
            problem = f"{verb} is not done on {self.engine}: {said.get('message')}"
        elif judge is not None:
            problem = judge(said)
        else:
            problem = None if said.get("status") == "ok" else f"{verb} answered {said.get('status')} {code or ''}: {said.get('message', '')}"
        self.note(name, verb, cannot, problem, brief(said))
        return said

    def note(self, name: str, verb: str, cannot: bool, problem: str | None, said: Any) -> None:

        known = KNOWN.get(self.engine, {}).get(name)
        if known and problem:
            problem, mark = None, f"(known: {known})"
        elif known:
            problem, mark = f"this works now: take it out of KNOWN ({known})", ""
        else:
            mark = "(cannot here)" if cannot else ""
        self.results.append({"check": name, "verb": verb, "cannot": cannot, "known": known, "problem": problem, "said": said})
        print(f"{'ok  ' if problem is None else 'FAIL'} {name:<34} {verb:<20} {mark} {problem or ''}", flush=True)

    def wait_for(self, name: str, words: str, seconds: int = 10) -> None:
        self.check(name, "browser_wait", {"tab": self.tab, "for": {"text": words}, "timeout_ms": seconds * 1000})

    def done(self, verb: str) -> bool:
        return verb not in CANNOT[self.engine]

    def script(self) -> None:
        base = self.base
        until = time.monotonic() + 120
        while time.monotonic() < until:
            tried = self.api.call("browser_open", {"url": "about:blank", "store": "agent"})
            if tried.get("status") == "ok":
                self.api.call("browser_close", {"tab": tried["result"]["tab"]})
            if "no window" not in str(tried.get("message", "")):
                break
            time.sleep(1)
        opened = self.check("open a tab of its own", "browser_open", {"url": f"{base}/a", "store": "agent"})
        self.tab = (opened.get("result") or {}).get("tab", "")
        if not self.tab:
            raise SystemExit("no tab: nothing else can be checked")
        self.check("wait for its load", "browser_wait", {"tab": self.tab, "for": "load"})
        self.check(
            "it is listed",
            "browser_tabs",
            {},
            lambda said: None if any(one.get("id") == self.tab for one in said.get("result", {}).get("agent", [])) else f"{self.tab} is not in {said}",
        )
        self.wait_for("the page's words", "alpha words")

        snap = self.check(
            "the snapshot",
            "browser_snapshot",
            {"tab": self.tab},
            lambda said: missing(said.get("result", {}).get("text", ""), ['heading "Parity form"', 'button "Press me"', 'textbox "Name"', 'checkbox "Gift wrap"']),
        )
        text = (snap.get("result") or {}).get("text", "")
        for role, name in [("button", "Press me"), ("textbox", "Name"), ("checkbox", "Gift wrap"), ("combobox", "Size"), ("hover", "hover here"), ("file", "Attachment"), ("drag", "drag me"), ("drop", "drop here")]:
            self.refs[role] = ref_of(text, name) or "e1"
        again = self.check("the snapshot again keeps its refs", "browser_snapshot", {"tab": self.tab}, lambda said: None if ref_of(said.get("result", {}).get("text", ""), "Press me") == self.refs["button"] else "the button's ref changed between two snapshots")
        del again
        self.check(
            "find by role and name",
            "browser_find",
            {"tab": self.tab, "role": "button", "name": "press me"},
            lambda said: None if any(one.get("ref") == self.refs["button"] for one in said.get("result", {}).get("matches", [])) else f"no {self.refs['button']} in {said.get('result')}",
        )
        self.check("read as text", "browser_read", {"tab": self.tab, "as": "text"}, lambda said: missing(said.get("result", {}).get("text", ""), ["alpha words"]))
        self.check("read as markdown", "browser_read", {"tab": self.tab, "as": "markdown"}, lambda said: missing(said.get("result", {}).get("text", ""), ["Parity form"]))
        self.check("evaluate in Orden's world", "browser_evaluate", {"tab": self.tab, "expression": "1 + 2"}, lambda said: None if said.get("result", {}).get("value") == 3 else f"1 + 2 was {said.get('result')}")
        self.check("evaluate in the page's world", "browser_evaluate", {"tab": self.tab, "expression": "document.title", "world": "page"}, lambda said: None if said.get("result", {}).get("value") == "Parity form" else f"the title was {said.get('result')}")
        self.check("a screenshot", "browser_screenshot", {"tab": self.tab}, png_judge)

        self.check("type into a field", "browser_type", {"tab": self.tab, "ref": self.refs["textbox"], "text": "Ada"})
        self.check("click a button", "browser_click", {"tab": self.tab, "ref": self.refs["button"]})
        if self.done("browser_click"):
            self.wait_for("the press landed", "pressed Ada")
        self.check("press a key", "browser_press", {"tab": self.tab, "keys": "Escape"})
        if self.done("browser_press"):
            self.wait_for("the key landed", "key Escape")
        self.check("select an option", "browser_select", {"tab": self.tab, "ref": self.refs["combobox"], "values": ["Large"]})
        if self.done("browser_select"):
            self.wait_for("the option is chosen", "size Large")
        self.check("fill a form", "browser_fill_form", {"tab": self.tab, "fields": [{"ref": self.refs["checkbox"], "value": True}]})
        if self.done("browser_fill_form"):
            self.wait_for("the box is ticked", "gift true")
        self.check("hover", "browser_hover", {"tab": self.tab, "ref": self.refs["hover"]})
        if self.done("browser_hover"):
            self.wait_for("the pointer is over it", "hovered")
        self.check("scroll", "browser_scroll", {"tab": self.tab, "dy": 2000})
        self.check("upload a file", "browser_upload", {"tab": self.tab, "ref": self.refs["file"], "files": [str(self.upload)]})
        if self.done("browser_upload"):
            self.wait_for("the file is in the field", f"file {self.upload.name}")
        self.check("drag", "browser_drag", {"tab": self.tab, "from": self.refs["drag"], "to": self.refs["drop"]})

        self.check("its console", "browser_console", {"tab": self.tab}, lambda said: None if any("parity console" in str(one.get("text", "")) for one in said.get("result", {}).get("lines", [])) else f"no line of the page's in {said.get('result')}")
        self.check("its cookies", "browser_storage", {"tab": self.tab, "op": "cookies"}, lambda said: None if any(one.get("name") == "parity" for one in said.get("result", {}).get("cookies") or []) else f"no parity cookie in {said.get('result')}")
        self.check("its local storage", "browser_storage", {"tab": self.tab, "op": "local"}, lambda said: None if (said.get("result", {}).get("local") or {}).get("parity") == "yes" else f"no parity in {said.get('result')}")
        self.check("a cookie set", "browser_storage", {"tab": self.tab, "op": "set_cookie", "cookie": {"name": "set", "value": "by-agent", "domain": "127.0.0.1", "path": "/"}})
        self.check("its storage cleared", "browser_storage", {"tab": self.tab, "op": "clear"})

        self.check("navigate", "browser_navigate", {"tab": self.tab, "url": f"{base}/b"}, lambda said: None if str(said.get("result", {}).get("url", "")).endswith("/b") else f"it is at {said.get('result')}")
        self.check("wait for an address", "browser_wait", {"tab": self.tab, "for": {"url": "/b"}})
        self.wait_for("the second page's words", "beta words")
        self.check("back", "browser_navigate", {"tab": self.tab, "back": True}, lambda said: None if str(said.get("result", {}).get("url", "")).endswith("/a") else f"back went to {said.get('result')}")
        self.check("forward", "browser_navigate", {"tab": self.tab, "forward": True}, lambda said: None if str(said.get("result", {}).get("url", "")).endswith("/b") else f"forward went to {said.get('result')}")
        self.check("reload", "browser_navigate", {"tab": self.tab, "reload": True})
        self.check("wait for the network to be idle", "browser_wait", {"tab": self.tab, "for": "network_idle"})
        self.check("navigate back to the form", "browser_navigate", {"tab": self.tab, "url": f"{base}/a"})
        self.check("its requests", "browser_network", {"tab": self.tab}, lambda said: None if any("/ping" in str(one.get("url", "")) for one in said.get("result", {}).get("requests", [])) else f"no /ping in {said.get('result')}")

        self.dialog("alert", "/alert", {"accept": True}, "alerted")
        self.dialog("confirm", "/confirm", {"accept": True}, "confirmed true")
        self.dialog("prompt", "/prompt", {"accept": True, "text": "parity"}, "prompted parity")
        self.dialog("sign_in", "/auth", {"accept": True, "username": USER, "password": PASSWORD}, "signed in")

        self.api.call("browser_navigate", {"tab": self.tab, "url": f"{base}/file"})
        self.check("its download", "browser_downloads", {"tab": self.tab}, self.downloaded)

        self.check("show it", "browser_show", {"tab": self.tab})
        self.check(
            "close it",
            "browser_close",
            {"tab": self.tab},
        )
        self.check("it is gone", "browser_tabs", {}, lambda said: None if not any(one.get("id") == self.tab for one in said.get("result", {}).get("agent", [])) else f"{self.tab} is still listed")

    def dialog(self, kind: str, path: str, answer: dict[str, Any], words: str) -> None:

        self.api.call("browser_navigate", {"tab": self.tab, "url": f"{self.base}{path}"})
        until = time.monotonic() + 15
        held = None
        while time.monotonic() < until and held is None:
            said = self.api.call("browser_wait", {"tab": self.tab, "for": {"text": "never there"}, "timeout_ms": 500})
            held = said.get("dialog")
        problem = None if held and held.get("kind") == kind else f"no {kind} came with the answers: {held}"
        self.note(f"a {kind} is held", "browser_wait", False, problem, held)
        self.check(f"answer the {kind}", "browser_dialog", {"tab": self.tab, **answer}, lambda said: None if said.get("status") == "ok" and not said.get("dialog") else f"answered {brief(said)}")
        self.wait_for(f"the page heard the {kind}'s answer", words)

    def downloaded(self, said: dict[str, Any]) -> str | None:
        until = time.monotonic() + 20
        while True:
            files = said.get("result", {}).get("downloads", [])
            if any(one.get("state") == "done" and one.get("path", "").endswith(".txt") for one in files):
                return None
            if time.monotonic() >= until:
                return f"nothing downloaded: {said.get('result')}"
            time.sleep(0.5)
            said = self.api.call("browser_downloads", {"tab": self.tab})

def missing(text: str, wanted: list[str]) -> str | None:
    gone = [one for one in wanted if one not in text]
    return None if not gone else f"{gone} not in {text[:600]!r}"

def ref_of(text: str, name: str) -> str | None:
    for line in text.splitlines():
        if f'"{name}' in line:
            found = re.search(r"\[ref=([^\]]+)\]", line)
            if found:
                return found.group(1)
    return None

def png_judge(said: dict[str, Any]) -> str | None:
    picture = said.get("result", {}).get("png", "")
    try:
        raw = base64.b64decode(picture)
    except ValueError:
        return "the picture is not base64"
    if not raw.startswith(b"\x89PNG"):
        return "the picture is not a PNG"
    width, height = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    return None if width > 100 and height > 100 else f"the picture is {width} by {height}"

def brief(said: Any) -> Any:
    text = json.dumps(said)
    return said if len(text) < 2000 else text[:2000]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--engine", required=True, choices=sorted(CANNOT))
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()

    site = Site(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{site.server_address[1]}"

    wipe(args.identifier)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-agent-parity-"))
    upload = spaces / "parity-upload.txt"
    upload.write_text("an agent's upload\n", encoding="utf-8")
    app = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces), "ORDEN_AGENT_PAGES": "1"})
    try:
        api = endpoint(args.identifier, app.pid)
        until = time.monotonic() + 60
        while time.monotonic() < until and api.call("browser_tabs", {}, 10).get("status") != "ok":
            time.sleep(1)
        run = Run(args.engine, api, base, upload)
        run.script()
    finally:
        app.terminate()
        try:
            app.wait(20)
        except subprocess.TimeoutExpired:
            app.kill()
        site.shutdown()

    failed = [one for one in run.results if one["problem"]]
    if args.out:
        args.out.write_text(json.dumps({"engine": args.engine, "results": run.results}, indent=2), encoding="utf-8")
    print(f"\n{len(run.results) - len(failed)} of {len(run.results)} as this engine's table says on {args.engine}")
    return 1 if failed else 0

if __name__ == "__main__":
    raise SystemExit(main())
