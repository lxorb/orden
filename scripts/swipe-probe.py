from __future__ import annotations

import argparse
import atexit
import ctypes
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import socket
import sys
import tempfile
import threading
import time
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Swipe probe"

CORNER = (-27000, -13000)

SIZE = (2000, 1400)

WM_MOUSEHWHEEL = 0x020E
WM_MOUSEWHEEL = 0x020A

TURN = 12

STEP = 35

ENGINE_ARGS = (
    "--remote-debugging-port=0 --disable-features=CalculateNativeWinOcclusion "
    "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
)

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
gdi32 = ctypes.WinDLL("gdi32") if sys.platform == "win32" else None
if user32 is not None:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    user32.WindowFromPoint.restype = wintypes.HWND
    user32.WindowFromPoint.argtypes = [wintypes.POINT]
    user32.GetParent.restype = wintypes.HWND
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]

def borrowed(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

page_probe = borrowed("web-page-probe")
scroll_probe = borrowed("web-scroll-probe")
scroll_probe.CORNER = CORNER

PAGES = {
    "/one": b"<!doctype html><title>One</title><body style='font:20px system-ui'><h1>One</h1>",
    "/two": b"<!doctype html><title>Two</title><body style='font:20px system-ui'><h1>Two</h1>",
}

REPLAYS = json.loads(
    (HERE.parent / "apps" / "desktop" / "test" / "effects" / "swipe-replays.json").read_text(encoding="utf-8")
)["replays"]

PRESSES = """
if (!window.__pressing) {
  for (const [way, name] of [['goBack', 'back'], ['goForward', 'forward']]) {
    const real = ws[way].bind(ws)
    ws[way] = (...args) => {
      window.__pressed.push(name)
      return real(...args)
    }
  }
  window.__pressing = true
}
window.__pressed = []
window.__across ??= 0
if (!window.__measuring) {
  addEventListener('wheel', (event) => { window.__across += Math.abs(event.deltaX) }, { capture: true, passive: true })
  window.__measuring = true
}
return true
"""

def serve() -> tuple[http.server.ThreadingHTTPServer, int]:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            body = PAGES.get(path) or (
                f"<!doctype html><title>{path}</title><body style='font:20px system-ui'><h1>{path}</h1>".encode()
            )
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"")

        def log_message(self, *_args: object) -> None:
            return

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, port

def sweep(target: int, x: int, y: int, steps: int, turn: int) -> None:
    assert user32 is not None
    word = turn & 0xFFFF
    for _ in range(steps):
        user32.PostMessageW(
            wintypes.HWND(target), WM_MOUSEHWHEEL, word << 16, ((y & 0xFFFF) << 16) | (x & 0xFFFF)
        )
        time.sleep(0.012)

def wheel(target: int, x: int, y: int, message: int, turn: int) -> None:
    assert user32 is not None
    user32.PostMessageW(
        wintypes.HWND(target), message, (turn & 0xFFFF) << 16, ((y & 0xFFFF) << 16) | (x & 0xFFFF)
    )

def replay(app, target: int, x: int, y: int, ops: list[list[object]]) -> list[tuple[list[str], list[str]]]:
    seen: list[tuple[list[str], list[str]]] = []
    for op in ops:
        kind = op[0]
        if kind == "fingers":
            ask(app, f"await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{ event: 'orden://touchpad', payload: {{ fingers: {int(op[1])} }} }}); return true")
            time.sleep(0.05)
        elif kind == "sweep":
            for _ in range(int(op[1])):
                wheel(target, x, y, WM_MOUSEHWHEEL, int(op[2]) * TURN)
                time.sleep(0.012)
        elif kind == "down":
            for _ in range(int(op[1])):
                wheel(target, x, y, WM_MOUSEWHEEL, -TURN)
                time.sleep(0.012)
        elif kind == "coast":
            for step in range(int(op[1])):
                turn = max(1, round(TURN * 0.85 ** (step + 1)))
                wheel(target, x, y, WM_MOUSEHWHEEL, int(op[2]) * turn)
                time.sleep(0.012)
        elif kind == "hold":
            time.sleep(float(str(op[1])) / 1000)
        elif kind == "expect":
            time.sleep(0.4)
            got = ask(app, "return window.__pressed")
            seen.append(([str(one) for one in op[1]], [str(one) for one in got] if isinstance(got, list) else [repr(got)]))
    return seen

def replays(app, target: int, x: int, y: int, fresh, where: str, said: dict[str, object], failed: list[str]) -> None:
    for number, one in enumerate(REPLAYS):
        if not one.get("native"):
            continue
        fresh(number)
        ask(app, PRESSES)
        seen = replay(app, target, x, y, one["do"])
        said[f"{where}: {one['name']}"] = seen
        print(f"{where}: {one['name']}: {seen}", file=sys.stderr, flush=True)
        for wanted, got in seen:
            if wanted != got:
                failed.append(f"{where}: {one['name']}: wanted {wanted}, got {got}")
        time.sleep(0.6)

def region_holes(hwnd: int) -> int | None:
    assert user32 is not None and gdi32 is not None
    region = gdi32.CreateRectRgn(0, 0, 0, 0)
    try:
        kind = user32.GetWindowRgn(wintypes.HWND(hwnd), region)
        if kind == 0:
            return None
        size = gdi32.GetRegionData(region, 0, None)
        return int(size)
    finally:
        gdi32.DeleteObject(region)

def webviews(window: int) -> list[int]:
    assert user32 is not None
    shown = [
        one
        for one in scroll_probe.children(window)
        if scroll_probe.class_of(one) == "WRY_WEBVIEW" and user32.IsWindowVisible(wintypes.HWND(one))
    ]

    def area(one: int) -> int:
        left, top, right, bottom = scroll_probe.rect(one)
        return (right - left) * (bottom - top)

    return sorted(shown, key=area, reverse=True)

def app_input(window: int) -> tuple[int, int]:
    assert user32 is not None
    app = webviews(window)[0]
    inputs = [one for one in scroll_probe.children(app) if scroll_probe.class_of(one) == "Chrome_RenderWidgetHostHWND"]
    if not inputs:
        raise SystemExit("the app's webview has no input window")
    return inputs[0], int(user32.GetParent(wintypes.HWND(inputs[0])) or 0)

PRELUDE = r"""
const ws = orden.workspace
const wait = async (ok, ms = 15000) => {
  const until = performance.now() + ms
  for (;;) {
    const got = await ok()
    if (got) return got
    if (performance.now() > until) return null
    await new Promise((go) => setTimeout(go, 100))
  }
}
"""

WATCH = """
window.__arrow = false
window.__watching?.disconnect()
window.__watching = new MutationObserver(() => {
  if (document.querySelector('.orden-swipe')) window.__arrow = true
})
window.__watching.observe(document.body, { childList: true, subtree: true })
return true
"""

def ask(app, body: str) -> object:
    return app.ask(f"(async () => {{ {PRELUDE}\n{body} }})()")

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    page_probe.wipe(args.identifier)
    server, port = serve()
    root = pathlib.Path(tempfile.mkdtemp(prefix="orden-swipe-probe-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    space = root / SPACE
    space.mkdir(parents=True)
    (space / "Alpha.md").write_text("# Alpha\n\nThe first note.\n", encoding="utf-8")
    (space / "Beta.md").write_text("# Beta\n\nThe second note.\n", encoding="utf-8")
    (space / "Site.url").write_text(page_probe.shortcut(f"http://127.0.0.1:{port}/one", "Site"), encoding="utf-8")
    env = {**os.environ, "ORDEN_SPACES_DIR": str(root), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": ENGINE_ARGS}

    said: dict[str, object] = {}
    failed: list[str] = []

    running = run_probe(args.exe, env=env, quiet=True)
    first, _, _ = page_probe.endpoint(args.identifier)
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not main_window(running.pid):
        time.sleep(0.2)
    time.sleep(1.5)
    close_app(running)
    page_probe.allow_eval(args.identifier)
    time.sleep(1)

    running = run_probe(args.exe, env=env, quiet=True)
    try:
        endpoint, secret, pid = page_probe.endpoint(args.identifier, unlike=first)
        if pid and pid != running.pid:
            raise SystemExit(f"another Orden (pid {pid}) is listening under {args.identifier}")
        app = page_probe.App(endpoint, secret)
        window = 0
        until = time.perf_counter() + 90
        while not window and time.perf_counter() < until:
            window = main_window(running.pid)
            time.sleep(0.2)
        if not window:
            raise SystemExit("the app never showed its window")
        sized(window, *SIZE)
        scroll_probe.to_corner(window)
        time.sleep(2)

        said["trail"] = ask(
            app,
            """
            await wait(() => ws.notes.length >= 2 &&
              performance.getEntriesByName('nib: launch order finished').length > 0, 40000)
            const path = (starts) => ws.notes.find((one) => one.name.startsWith(starts)).path
            // Whatever the launch opened goes, so both notes pass through one tab.
            for (const one of [...ws.tabs]) ws.close(one.id)
            await ws.open(path('Alpha'), { preview: true })
            await ws.open(path('Beta'), { preview: true })
            await wait(() => document.querySelector('.cm-content'))
            await new Promise((go) => setTimeout(go, 500))
            return {
              back: ws.active?.canGoBack,
              note: ws.active?.note?.name,
              tabs: ws.tabs.map((one) => [one.kind, one.trail?.length, one.id === ws.previewTabId]),
            }
            """,
        )
        _, page = app_input(window)
        box = scroll_probe.rect(page)
        x, y = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        ask(app, WATCH)
        sweep(page, x, y, 40, -STEP)
        time.sleep(0.8)
        back = ask(app, "return { note: ws.active?.note?.name, arrow: window.__arrow }")
        said["note, swept back"] = back
        if not (isinstance(back, dict) and str(back.get("note", "")).startswith("Alpha") and back.get("arrow")):
            failed.append(f"a sweep over a note did not go back with the arrow: {back}")

        ask(app, WATCH)
        sweep(page, x, y, 40, STEP)
        time.sleep(0.8)
        forward = ask(app, "return { note: ws.active?.note?.name, arrow: window.__arrow }")
        said["note, swept forward"] = forward
        if not (isinstance(forward, dict) and str(forward.get("note", "")).startswith("Beta")):
            failed.append(f"a sweep over a note did not go forward: {forward}")

        ask(app, WATCH)
        sweep(page, x, y, 6, -STEP)
        time.sleep(0.8)
        short = ask(app, "return { note: ws.active?.note?.name, arrow: window.__arrow }")
        said["note, a short sweep"] = short
        if not (isinstance(short, dict) and str(short.get("note", "")).startswith("Beta")):
            failed.append(f"a short sweep went somewhere: {short}")

        app.act("open", {"path": "Site.url", "space": SPACE})
        url = None
        until = time.perf_counter() + 40
        while url is None and time.perf_counter() < until:
            url = page_probe.page_socket(args.identifier, "/one")
            time.sleep(0.5)
        if url is None:
            raise SystemExit("the site's page never answered")
        tools = page_probe.Devtools(url)
        try:
            tools.value("location.href = '/two'")
        finally:
            tools.close()
        said["web tab"] = ask(
            app,
            """
            const tab = await wait(() => ws.tabs.find((one) => one.kind === 'web'))
            await wait(() => String(orden.pages?.of?.(tab.id)?.url ?? tab.address ?? '').endsWith('/two'), 8000)
            await new Promise((go) => setTimeout(go, 800))
            return { address: tab.address, active: ws.active?.id === tab.id }
            """,
        )
        _, site_page = scroll_probe.page_windows(window)
        site = webviews(window)[-1]
        box = scroll_probe.rect(site_page)
        x, y = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        ask(app, WATCH)
        holes: list[int | None] = []
        sweep(site_page, x, y, 30, -STEP)
        holes.append(region_holes(site))
        sweep(site_page, x, y, 10, -STEP)
        holes.append(region_holes(site))
        time.sleep(1.2)
        holes.append(region_holes(site))
        said["page's region while swiping, and after"] = holes
        tools = None
        url = None
        until = time.perf_counter() + 10
        while url is None and time.perf_counter() < until:
            url = page_probe.page_socket(args.identifier, "/one")
            time.sleep(0.3)
        went = ask(app, "return { arrow: window.__arrow }")
        said["page, swept back"] = {"on one": url is not None, **(went if isinstance(went, dict) else {})}
        if url is None:
            failed.append("a sweep over a page did not take its tab back")
        if not (isinstance(went, dict) and went.get("arrow")):
            failed.append("no arrow came in over the page")
        if not any(one is not None for one in holes[:2]):
            failed.append(f"the arrow was not cut out of the page: {holes}")
        if holes[2] is not None:
            failed.append(f"the page was not whole again after the arrow: {holes}")

        def fresh_note(_number: int) -> None:
            ask(
                app,
                """
                const path = (starts) => ws.notes.find((one) => one.name.startsWith(starts)).path
                await ws.open(path('Alpha'), { preview: true })
                await ws.open(path('Beta'), { preview: true })
                await wait(() => ws.active?.note?.name?.startsWith('Beta') && ws.active?.canGoBack)
                await new Promise((go) => setTimeout(go, 300))
                return true
                """,
            )

        fresh_note(0)
        _, page = app_input(window)
        box = scroll_probe.rect(page)
        replays(app, page, (box[0] + box[2]) // 2, (box[1] + box[3]) // 2, fresh_note, "note", said, failed)
        said["note: pixels a replay's step scrolled, on average"] = ask(app, "return window.__across")

        visited = ["/one", "/two"]

        def fresh_page(number: int) -> None:
            address = f"/replay{number}"
            for _ in range(40):
                url = next((one for one in (page_probe.page_socket(args.identifier, path) for path in visited) if one), None)
                if url:
                    break
                time.sleep(0.25)
            else:
                raise SystemExit("the site's page never answered for a replay")
            tools = page_probe.Devtools(url)
            try:
                tools.value(f"location.href = '{address}'")
            finally:
                tools.close()
            visited.insert(0, address)
            ask(
                app,
                f"""
                const tab = await wait(() => ws.tabs.find((one) => one.kind === 'web'))
                ws.activate(tab.id)
                await wait(() => String(orden.pages?.of?.(tab.id)?.url ?? tab.address ?? '').endsWith('{address}'), 8000)
                await wait(() => orden.pages?.of?.(tab.id)?.back, 4000)
                await new Promise((go) => setTimeout(go, 500))
                return true
                """,
            )

        fresh_page(0)
        until = time.perf_counter() + 20
        while len(webviews(window)) < 2 and time.perf_counter() < until:
            time.sleep(0.25)
        if len(webviews(window)) < 2:
            said["web tab for the replays"] = ask(app, "return { active: ws.active?.kind, tabs: ws.tabs.map((one) => [one.kind, one.paneId, one.address]) }")
            print(json.dumps(said, indent=2, default=str))
        _, site_page = scroll_probe.page_windows(window)
        box = scroll_probe.rect(site_page)
        replays(app, site_page, (box[0] + box[2]) // 2, (box[1] + box[3]) // 2, fresh_page, "page", said, failed)
    finally:
        if not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2, default=str))
    for one in failed:
        print(f"FAIL: {one}")
    if not failed:
        print("swipes go back and forward over a note and a page")
    return 1 if failed else 0

if __name__ == "__main__":
    raise SystemExit(main())
