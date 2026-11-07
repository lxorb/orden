from __future__ import annotations

import http.server
import importlib.util
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from harness import ROOT, Drive, Native, end, identifier_of

NEEDS = ("native",)

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong

SPACE = "Essential web data"
OWN = "3f9a0c17e2b4d685"

def borrowed(name: str, file: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Site(http.server.BaseHTTPRequestHandler):

    def do_GET(self) -> None:  # noqa: N802 - the name http.server wants
        asked = parse_qs(urlparse(self.path).query)
        seen = self.headers.get("Cookie") or "none"
        body = f"<!doctype html><title>cookie:{seen}|{self.path}</title>page".encode()
        self.send_response(200)
        if who := asked.get("set", [""])[0]:
            self.send_header("Set-Cookie", f"who={who}; Path=/; Max-Age=86400; HttpOnly")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass

PRELUDE = """
const ws = orden.workspace
const wait = async (ok, ms = 30000) => {
  const until = performance.now() + ms
  for (;;) {
    const got = await ok()
    if (got) return got
    if (performance.now() > until) return null
    await new Promise((go) => setTimeout(go, 100))
  }
}
const named = (name) => ws.tabs.find((one) => one.kind === 'web' && one.path?.endsWith(`/${name}.url`))
"""

def ask(app: Any, body: str, seconds: float = 90) -> Any:
    return app.ask(f"(async () => {{ {PRELUDE}\n{body} }})()", seconds)

def tab_of(app: Any, name: str) -> dict[str, Any]:
    said = ask(
        app,
        f"""
        const tab = await wait(() => named({json.dumps(name)}))
        if (!tab) return null
        await wait(() => orden.pages.of(tab.id).live)
        const page = orden.pages.of(tab.id)
        return {{ id: tab.id, store: page.store ?? null, essential: tab.essential, live: page.live,
                 inStrip: ws.tabsIn(tab.paneId).includes(tab) }}
        """,
    )
    if not isinstance(said, dict):
        raise SystemExit(f"{name} never came up: {said}")
    return said

def origin_of(address: str) -> str:
    parsed = urlparse(address)
    return f"{parsed.scheme}://{parsed.netloc}"

def seen(app: Any, tab: str, address: str) -> str:
    said = ask(
        app,
        f"""
        const id = {json.dumps(tab)}
        await orden.pages.go(id, {json.dumps(address)})
        const page = await wait(() => {{
          const one = orden.pages.of(id)
          return one.title.endsWith({json.dumps("|" + address.removeprefix(origin_of(address)))}) ? one : null
        }})
        return page ? page.title.split('|')[0] : `never got there: ${{orden.pages.of(id).url}} ${{orden.pages.of(id).title}}`
        """,
    )
    return str(said)

def press_tile(app: Any, name: str) -> Any:
    return ask(
        app,
        f"""
        const tile = await wait(() => document.querySelector('.orden-tile[aria-label={json.dumps(name)}]'))
        if (!tile) return 'no tile'
        tile.click()
        return true
        """,
    )

def keep(app: Any, name: str) -> Any:
    return ask(
        app,
        f"""
        const path = `${{ws.activeSpace.root}}/{name}.url`
        ws.bookmarks.toggle(ws.bookmarks.forEntry({{ path, is_dir: false }}))
        return ws.bookmarks.list.map((one) => one.path)
        """,
    )

def drive(_browser: object) -> None:
    if sys.platform != "win32":
        raise SystemExit("this probe drives a Windows build")

    exe = Path(os.environ["ORDEN_PROBE_EXE"])
    identifier = identifier_of(exe)
    native = Native(DRIVE, exe)
    switch = borrowed("switch", "web-switch-probe.py")

    origin = DRIVE.side(Site)
    home = f"{origin}/page"
    switch.wipe(identifier)
    space = native.spaces / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Apart.url").write_text(switch.shortcut(home, "Apart") + f"Orden-Data={OWN}\r\n", encoding="utf-8")
    (space / "Shared.url").write_text(switch.shortcut(home, "Shared"), encoding="utf-8")

    app = native.start()
    port, _ = switch.endpoint(identifier, 90)
    time.sleep(3)
    if not native.probe.close_app(app):
        end(app)
    switch.allow_eval(identifier)
    native.start()
    port, secret = switch.endpoint(identifier, 90, unlike=port)
    asked = switch.App(port, secret)
    ask(asked, "await wait(() => performance.getEntriesByName('nib: launch order finished').length > 0, 60000); return true")

    asked.open("Shared.url", SPACE)
    shared = tab_of(asked, "Shared")
    say(f"kept: {keep(asked, 'Apart')}")
    say(f"pressed: {press_tile(asked, 'Apart')}")
    apart = tab_of(asked, "Apart")
    say(f"apart {apart}, shared {shared}")
    if apart["essential"] is None or apart["inStrip"]:
        wrong(f"Apart's tile did not open it as an essential: {apart}")
    if apart["store"] != f"note_{OWN}":
        wrong(f"the essential is on the store {apart['store']}, not the note's own")
    if shared["store"] is not None:
        wrong(f"the shared note is on the store {shared['store']}")

    seen(asked, apart["id"], f"{home}?set=apart")
    seen(asked, shared["id"], f"{home}?set=shared")
    one = seen(asked, apart["id"], f"{home}?read=1")
    other = seen(asked, shared["id"], f"{home}?read=2")
    say(f"apart saw {one}, shared saw {other}")
    if one != "cookie:who=apart":
        wrong(f"the essential's page saw {one}, not its own sign-in")
    if other != "cookie:who=shared":
        wrong(f"a normal web tab saw {other}, not the shared sign-in")

    ask(asked, "ws.close(named('Apart').id); return true")
    asked.open("Apart.url", SPACE)
    strip = tab_of(asked, "Apart")
    press_tile(asked, "Apart")
    time.sleep(1)
    moved = tab_of(asked, "Apart")
    say(f"in the strip {strip}, after its tile {moved}")
    if moved["id"] != strip["id"] or moved["essential"] is None or moved["inStrip"]:
        wrong(f"the strip's tab did not become the essential: {strip} then {moved}")
    if moved["store"] != f"note_{OWN}":
        wrong(f"the strip's tab, as an essential, is on the store {moved['store']}")
    again = seen(asked, moved["id"], f"{home}?read=3")
    if again != "cookie:who=apart":
        wrong(f"the strip's tab, as an essential, saw {again}")

    keep(asked, "Apart")
    time.sleep(1)
    back = tab_of(asked, "Apart")
    say(f"out again {back}")
    if back["id"] != moved["id"] or back["essential"] is not None or not back["inStrip"]:
        wrong(f"taken out of the Essentials, the tab is not back in the strip: {back}")
    if back["store"] != f"note_{OWN}":
        wrong(f"taken out of the Essentials, the tab is on the store {back['store']}")
    last = seen(asked, back["id"], f"{home}?read=4")
    if last != "cookie:who=apart":
        wrong(f"taken out of the Essentials, the tab saw {last}")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a web note keeps its own web data in the Essentials", browser=False))
