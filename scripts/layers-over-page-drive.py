from __future__ import annotations
import argparse
import http.server
import importlib
import json
import os
import pathlib
import plistlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

pk = importlib.import_module("parity-keys-drive")
PLATFORM, MAC = pk.PLATFORM, pk.MAC
BLINK = b"<div id=blink style='position:fixed;right:24px;bottom:24px;width:60px;height:60px;background:#000'></div><script>let on=false;setInterval(()=>{on=!on;document.getElementById('blink').style.background=on?'#fff':'#000'},150)</script>"
PAGE = pk.PAGE.replace(b"</script>", b"</script>" + BLINK, 1)
class Handler(pk.Handler):
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        if self.path.startswith("/saved"):
            super().do_GET()
            return
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)
BOX = "((s) => { const all = [...document.querySelectorAll(s)].filter((one) => { const b = one.getBoundingClientRect(); return b.width > 0 && b.height > 0 }); const one = all.at(-1); if (!one) return null; const b = one.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, typing: !!one.querySelector('input, textarea, [contenteditable=true]'), holds: one.contains(document.activeElement), focus: document.hasFocus() } })"
TYPED = "((s) => { const one = [...document.querySelectorAll(s)].at(-1); const field = one && one.querySelector('input, textarea'); return field ? field.value : null })"
PLACED = "(() => { const all = orden.pages.each().filter(([, one]) => one.sent); return all.map(([id, one]) => ({ id, visible: !!one.sent.visible, away: !!one.sent.away, all: !!(one.sent.cut && one.sent.cut.all), hollows: one.sent.cut ? (one.sent.cut.hollows || []).length : 0, pictured: !!one.shot })) })()"
PANE = "(() => { const all = orden.pages.each().filter(([, one]) => one.sent && one.sent.visible && !one.sent.away); return all[0] ? all[0][1].sent.pane : null })()"
rows: list[dict[str, Any]] = []
def row(name: str, check: str, said: Any, ok: bool | None, why: str = "") -> None:
    one = {"overlay": name, "check": check, "platform": PLATFORM, "said": said, "ok": ok}
    if why:
        one["why"] = why
    rows.append(one)
    print(f"[{name}] {check}: ok {ok}; {json.dumps(said)[:400]}{'; ' + why if why else ''}", flush=True)
class Layers:
    def __init__(self, drive: Any) -> None:
        self.drive = drive
    def js(self, code: str) -> Any:
        return self.drive.js(code)
    def box(self, selector: str) -> dict[str, Any] | None:
        said = self.js(f"{BOX}({json.dumps(selector)})")
        return said if isinstance(said, dict) else None
    def blink_at(self) -> tuple[float, float] | None:
        pane = self.js(PANE)
        if not isinstance(pane, dict):
            return None
        return pane["x"] + pane["width"] - 54, pane["y"] + pane["height"] - 54
    def live(self, at: tuple[float, float] | None) -> bool | None:
        if at is None:
            return None
        spot = self.drive.screen.at(*at)
        seen = set()
        for _ in range(6):
            seen.add(self.drive.screen.colour(self.drive.screen.shot(), *spot))
            time.sleep(0.08)
        return len({one for one in seen if not pk.near(one, pk.MAGENTA)}) > 1
    def drawn(self, box: dict[str, Any]) -> list[Any]:
        image = self.drive.screen.shot()
        inset = min(10.0, box["width"] / 4, box["height"] / 4)
        points = [(box["x"] + inset, box["y"] + inset), (box["x"] + box["width"] - inset, box["y"] + inset), (box["x"] + inset, box["y"] + box["height"] - inset), (box["x"] + box["width"] - inset, box["y"] + box["height"] - inset), (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)]
        return [self.drive.screen.colour(image, *self.drive.screen.at(*one)) for one in points]
    @staticmethod
    def inside(at: tuple[float, float] | None, box: dict[str, Any]) -> bool:
        return at is not None and box["x"] - 40 <= at[0] <= box["x"] + box["width"] + 40 and box["y"] - 40 <= at[1] <= box["y"] + box["height"] + 40
    def staged(self) -> bool:
        self.drive.reset()
        self.drive.show(self.drive.ids["web"])
        return self.drive.focus_page()
    def case(self, name: str, selector: str, opening: Callable[[], None], closing: Callable[[], None], takes: str = "auto") -> None:
        if not self.staged():
            row(name, "staged over a live web tab", None, None, "the page did not take the keyboard from a click")
            return
        at = self.blink_at()
        before = self.live(at)
        opening()
        box = None
        until = time.monotonic() + 4
        while box is None and time.monotonic() < until:
            box = self.box(selector)
            if box is None:
                time.sleep(0.2)
        if box is None:
            row(name, "opens over the web tab", None, False)
            closing()
            return
        time.sleep(0.6)
        colours = self.drawn(box)
        hidden = [one for one in colours if pk.near(one, pk.MAGENTA, 30)]
        row(name, "is fully drawn above the page", {"box": box, "colours": colours}, not hidden)
        under = None if self.inside(at, box) else self.live(at)
        placed = [one for one in (self.js(PLACED) or []) if isinstance(one, dict) and one.get("id") == self.drive.ids["web"]]
        one = placed[0] if placed else {}
        row(name, "cuts round itself and leaves the page placed, as the tab menu does", one, bool(one) and one.get("visible") is True and not one.get("away") and not one.get("all"))
        row(name, "leaves the page live around it", {"live before": before, "live while open": under}, under if before else None, "" if before else "the page was not seen live before it opened")
        if takes == "auto":
            takes = "text" if box.get("typing") else "keys"
        if takes == "text":
            self.drive.keys.typed("qz")
            typed = self.js(f"{TYPED}({json.dumps(selector)})")
            row(name, "takes typing", {"typed": typed}, isinstance(typed, str) and "qz" in typed)
        elif takes == "keys":
            again = self.box(selector) or {}
            row(name, "holds the keyboard", {"focus": again.get("focus"), "holds": again.get("holds")}, bool(again.get("focus") and again.get("holds")))
        closing()
        time.sleep(0.8)
        gone = self.box(selector) is None
        row(name, "closes", {"gone": gone}, gone)
        token = self.drive.token()
        taken = self.drive.focus_page()
        self.drive.keys.typed(token)
        time.sleep(0.5)
        landed = self.drive.landed("web", token)
        after = self.live(self.blink_at())
        row(name, "leaves the page live and taking typing", {"took a click": taken, "typed": landed, "live": after}, bool(taken and landed and after is not False))
    def run(self) -> None:
        keys = self.drive.keys
        escape = lambda: keys.chord("Escape")  # noqa: E731
        web = self.drive.ids["web"]
        def right_click_tab() -> None:
            tab = self.box(f'[data-tab="{web}"]')
            if tab:
                keys.click(*self.drive.screen.at(tab["x"] + tab["width"] / 2, tab["y"] + tab["height"] / 2), right=True)
                time.sleep(0.8)
                if self.box(".orden-layer.menu") is None:
                    print("::warning::a real right click on the tab opened no menu; the drive asks the tab for it", flush=True)
                    self.js(f"(() => {{ const one = document.querySelector('[data-tab=\"{web}\"]'); const b = one.getBoundingClientRect(); one.dispatchEvent(new MouseEvent('contextmenu', {{ bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, button: 2 }})); return true }})()")
        def click(selector: str) -> Callable[[], None]:
            def go() -> None:
                one = self.box(selector)
                if one:
                    keys.click(*self.drive.screen.at(one["x"] + one["width"] / 2, one["y"] + one["height"] / 2))
            return go
        def hover(selector: str) -> Callable[[], None]:
            def go() -> None:
                one = self.box(selector)
                if one:
                    keys.move(*self.drive.screen.at(one["x"] + one["width"] / 2, one["y"] + one["height"] / 2))
                    time.sleep(1.5)
            return go
        def away() -> None:
            pane = self.js(PANE)
            if isinstance(pane, dict):
                keys.move(*self.drive.screen.at(pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2))
        self.case("tab menu", ".orden-layer.menu", right_click_tab, escape)
        self.case("command palette", ".orden-screen.palette", lambda: keys.chord("Mod-Shift-p"), escape)
        self.case("space picker", ".orden-screen.picker", lambda: keys.chord("Ctrl-Shift-Space" if MAC else "Mod-Space"), escape)
        def new_space() -> None:
            keys.chord("Mod-Shift-p")
            time.sleep(0.8)
            keys.typed("newspac")
            time.sleep(0.6)
            keys.chord("Return")
        self.case("prompt sheet", ".orden-screen.sheet", new_space, escape)
        self.case("site bubble in the web bar", ".site.orden-bubble", click('[data-opens="site"]'), escape, takes="none")
        three = self.drive.ids["three"]
        self.case("tab hover card", ".card.orden-bubble", hover(f'[data-tab="{three}"]'), away, takes="none")
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if MAC:
        info = plistlib.loads((args.exe.parent.parent / "Info.plist").read_bytes())
        if info.get("CFBundleShortVersionString") != "99.0.0":
            raise SystemExit(f"{args.exe} is not a probe build")
    elif PLATFORM == "windows":
        from probe_app import refuse_updating
        refuse_updating(args.exe)
    args.out.mkdir(parents=True, exist_ok=True)
    wrote_rc = pk.prepared_linux()
    refuser = importlib.import_module("web-under-mac-drive").Refuser() if MAC else None
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/keys"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-layers-spaces-"))
    said = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=said, stderr=subprocess.STDOUT)
    try:
        app = endpoint(config, process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        if PLATFORM == "windows":
            import ctypes
            from ctypes import wintypes
            from probe_app import main_window
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            hwnd = main_window(process.pid)
            desk = wintypes.RECT()
            user32.SystemParametersInfoW(0x30, 0, ctypes.byref(desk), 0)
            user32.ShowWindow(hwnd, 9)
            user32.SetWindowPos(hwnd, None, desk.left, desk.top, min(1280, desk.right - desk.left), min(800, desk.bottom - desk.top), 0x0004)
        forward(app, process.pid)
        time.sleep(22)
        app.eval("document.querySelector('.orden-screen.sheet[role=\"dialog\"] button[data-lands]')?.click(); return true")
        drive = pk.Drive(app, process.pid, url, args.out)
        drive.build()
        forward(app, process.pid)
        Layers(drive).run()
        drive.screen.shot().save(args.out / "end.png")
    finally:
        if refuser is not None:
            refuser.stop()
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        if wrote_rc:
            pk.openbox_rc().unlink(missing_ok=True)
            subprocess.run(["openbox", "--reconfigure"], capture_output=True, check=False)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    lines = ["| overlay | check | platform | ok | said |", "|---|---|---|---|---|"]
    lines += [f"| {one['overlay']} | {one['check']} | {one['platform']} | {'n/a' if one['ok'] is None else 'yes' if one['ok'] else 'NO'} | {json.dumps(one['said'], ensure_ascii=False)[:300]} |" for one in rows]
    print("\n".join(lines), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"\n### Layers over a web tab, {PLATFORM}\n\n" + "\n".join(lines) + "\n")
    wrong = [one for one in rows if one["ok"] is False]
    for one in wrong:
        print(f"::error::[{one['overlay']}] {one['check']}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
