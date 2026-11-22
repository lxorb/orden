from __future__ import annotations
import argparse
import ctypes
import importlib
import io
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
from typing import Any, Callable
import http.server
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
keys = importlib.import_module("parity-keys-drive")
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint, forward  # noqa: E402

PLATFORM = keys.PLATFORM
keys.SPECIAL_WIN.update({"Menu": 0x5D, "F10": 0x79})
keys.EXTENDED_WIN.add(0x5D)
keys.SPECIAL_X.update({"Menu": "Menu", "F10": "F10"})
BLUE = (0, 160, 255)
SIZE = (120, 80)
WORDS = "Selectable words"
PAGE = b"""<!doctype html><title>menu</title>
<style>
html,body{margin:0;background:#ff00ff;height:100%;overflow:hidden;font:14px sans-serif}
#field{position:fixed;left:24px;top:24px;width:260px;height:44px;font-size:18px}
#pic{position:fixed;left:24px;top:90px;width:120px;height:80px}
#link{position:fixed;left:24px;top:190px;width:150px;height:40px;background:#fff;color:#000;line-height:40px;text-align:center}
#words{position:fixed;left:24px;top:250px;margin:0;padding:8px;background:#fff;color:#000}
</style>
<input id=field aria-label="the field">
<img id=pic src="/pic.png" alt="">
<a id=link href="/linked">the link</a>
<p id=words>Selectable words</p>
<script>
const field = document.getElementById('field')
const said = { who: 'main', log: [] }
let sent = 0
const tell = () => {
  said.focus = document.hasFocus()
  said.active = document.activeElement ? document.activeElement.id : ''
  said.value = field.value
  said.n = ++sent
  fetch('/heard', { method: 'POST', body: JSON.stringify(said) }).catch(() => {})
}
addEventListener('contextmenu', (e) => {
  if (e.target.id === 'words') getSelection().selectAllChildren(e.target)
  if (e.target === field && field.value) field.select()
  said.log.push(['contextmenu', e.target.id, e.button])
  said.menus = (said.menus || 0) + 1
  said.menuOn = e.target.id
  tell()
}, true)
addEventListener('mousemove', (e) => { said.mouse = [e.clientX, e.clientY] }, true)
addEventListener('focus', tell, true)
field.addEventListener('input', tell)
setInterval(tell, 300)
</script>"""
def picture() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", SIZE, BLUE).save(out, "PNG")
    return out.getvalue()
PICTURE = picture()
class Handler(keys.Handler):
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        path = self.path.split("?")[0]
        if path == "/pic.png":
            body, kind = PICTURE, "image/png"
        elif path == "/linked":
            body, kind = b"<!doctype html><title>linked</title>linked", "text/html; charset=utf-8"
        else:
            body, kind = PAGE, "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
class Clipboard:
    def __init__(self) -> None:
        if PLATFORM == "windows":
            from ctypes import wintypes
            self.user32 = ctypes.WinDLL("user32", use_last_error=True)
            self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            self.user32.GetClipboardData.restype = wintypes.HANDLE
            self.user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
            self.user32.SetClipboardData.restype = wintypes.HANDLE
            self.kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
            self.kernel32.GlobalLock.restype = ctypes.c_void_p
            self.kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
            self.kernel32.GlobalSize.argtypes = [wintypes.HGLOBAL]
            self.kernel32.GlobalSize.restype = ctypes.c_size_t
            self.kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
            self.kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        elif PLATFORM == "macos":
            import AppKit
            self.board = AppKit.NSPasteboard.generalPasteboard()
            self.AppKit = AppKit
    def opened(self) -> bool:
        for _ in range(40):
            if self.user32.OpenClipboard(None):
                return True
            time.sleep(0.05)
        return False
    def held(self, kind: int) -> bytes | None:
        handle = self.user32.GetClipboardData(kind)
        if not handle:
            return None
        at = self.kernel32.GlobalLock(handle)
        try:
            return ctypes.string_at(at, self.kernel32.GlobalSize(handle))
        finally:
            self.kernel32.GlobalUnlock(handle)
    def put(self, text: str) -> None:
        if PLATFORM == "windows":
            if not self.opened():
                return
            try:
                self.user32.EmptyClipboard()
                data = (text + "\0").encode("utf-16-le")
                handle = self.kernel32.GlobalAlloc(0x0002, len(data))
                ctypes.memmove(self.kernel32.GlobalLock(handle), data, len(data))
                self.kernel32.GlobalUnlock(handle)
                self.user32.SetClipboardData(13, handle)
            finally:
                self.user32.CloseClipboard()
        elif PLATFORM == "macos":
            self.board.clearContents()
            self.board.setString_forType_(text, self.AppKit.NSPasteboardTypeString)
        else:
            subprocess.run(["xclip", "-selection", "clipboard", "-i"], input=text.encode(), check=False, timeout=10)
        time.sleep(0.4)
    def now(self) -> dict[str, Any]:
        if PLATFORM == "windows":
            return self.now_windows()
        if PLATFORM == "macos":
            types = [str(one) for one in self.board.types() or []]
            text = self.board.stringForType_(self.AppKit.NSPasteboardTypeString)
            data = self.board.dataForType_("public.png") or self.board.dataForType_("public.tiff")
            return {"types": types, "text": None if text is None else str(text), "image": self.pictured(bytes(data) if data else None)}
        run = lambda *kind: subprocess.run(["xclip", "-selection", "clipboard", "-o", *kind], capture_output=True, timeout=10, check=False)  # noqa: E731
        types = run("-t", "TARGETS").stdout.decode(errors="replace").split()
        text = run("-t", "UTF8_STRING").stdout.decode(errors="replace") if "UTF8_STRING" in types else None
        image = next((one for one in ("image/png", "image/bmp") if one in types), None)
        return {"types": types, "text": text, "image": self.pictured(run("-t", image).stdout if image else None)}
    def now_windows(self) -> dict[str, Any]:
        if not self.opened():
            return {"types": ["the clipboard could not be opened"], "text": None, "image": None}
        try:
            kinds, kind = [], 0
            while True:
                kind = self.user32.EnumClipboardFormats(kind)
                if not kind:
                    break
                name = ctypes.create_unicode_buffer(128)
                kinds.append(name.value if self.user32.GetClipboardFormatNameW(kind, name, 128) else str(kind))
            text = self.held(13)
            dib = self.held(8)
            png = self.held(self.user32.RegisterClipboardFormatW("PNG")) if "PNG" in kinds else None
        finally:
            self.user32.CloseClipboard()
        image = self.pictured(png) if png else self.dib(dib)
        return {"types": kinds, "text": text.decode("utf-16-le").split("\0")[0] if text else None, "image": image}
    def dib(self, data: bytes | None) -> dict[str, Any] | None:
        if not data or len(data) < 40:
            return None
        header = int.from_bytes(data[0:4], "little")
        width = int.from_bytes(data[4:8], "little", signed=True)
        height = int.from_bytes(data[8:12], "little", signed=True)
        bits = int.from_bytes(data[14:16], "little")
        compression = int.from_bytes(data[16:20], "little")
        offset = header + (12 if compression == 3 and header == 40 else 0)
        row = ((width * bits + 31) // 32) * 4
        middle = offset + (abs(height) // 2) * row + (width // 2) * (bits // 8)
        colour = None
        if bits in (24, 32) and middle + 3 <= len(data):
            b, g, r = data[middle], data[middle + 1], data[middle + 2]
            colour = (r, g, b)
        return {"size": [width, abs(height)], "colour": colour}
    def pictured(self, data: bytes | None) -> dict[str, Any] | None:
        if not data:
            return None
        try:
            image = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:  # noqa: BLE001 - anything not a picture is no picture
            return None
        return {"size": list(image.size), "colour": image.getpixel((image.width // 2, image.height // 2))}
PICK = """((label) => {
  const menu = [...document.querySelectorAll('[role=menu]')].find((one) => one.getClientRects().length)
  if (!menu) return 'no menu'
  const rows = [...menu.querySelectorAll('[role=menuitem]')]
  const row = rows.find((one) => one.textContent.trim().toLowerCase().replace(/[.…]+$/, '') === label.toLowerCase())
  if (!row) return 'no row ' + label + ' in ' + JSON.stringify(rows.map((one) => one.textContent.trim()))
  if (row.disabled) return 'row ' + label + ' is off'
  row.click()
  return 'picked'
})"""
PIC, LINK, WORDS_AT, FIELD = (84, 130), (99, 210), (84, 264), (150, 46)
TARGETS = {PIC: "pic", LINK: "link", WORDS_AT: "words", FIELD: "field"}
FIRST_ON = """(() => {
  const menu = [...document.querySelectorAll('[role=menu]')].find((one) => one.getClientRects().length)
  const row = menu && [...menu.querySelectorAll('[role=menuitem]')].find((one) => !one.disabled && one.getAttribute('aria-disabled') !== 'true')
  return row ? row.textContent.trim() : null
})()"""
class Menus(keys.Drive):
    def __init__(self, *args: Any) -> None:
        super().__init__(*args)
        self.clipboard = Clipboard()
        self.base = self.url.rsplit("/", 1)[0]
        self.missed = ""
        self.menus = 0
    def spot(self, x: float, y: float) -> tuple[float, float]:
        at = self.in_page(x, y)
        scale = (self.in_page(x + 100, y)[0] - at[0]) / 100 or 1.0
        for _ in range(4):
            self.keys.move(*at)
            time.sleep(0.2)
            mouse = keys.page_said("main", time.monotonic()).get("mouse")
            if not isinstance(mouse, list) or len(mouse) != 2:
                return at
            dx, dy = x - mouse[0], y - mouse[1]
            if abs(dx) <= 2 and abs(dy) <= 2:
                return at
            at = (at[0] + dx * scale, at[1] + dy * scale)
        return at
    def opened(self, at: tuple[float, float]) -> dict[str, Any]:
        for _ in range(2):
            self.keys.chord("Escape")
        self.menus = keys.page_said("main", time.monotonic()).get("menus") or 0
        self.keys.click(*self.spot(*at), right=True)
        time.sleep(1.2)
        return self.menu_now()
    def landed(self, at: tuple[float, float]) -> None:
        want = TARGETS.get(at)
        said = keys.page_said("main", time.monotonic())
        got = said.get("menuOn") if (said.get("menus") or 0) > self.menus else None
        self.missed = "" if want is None or got == want else f"the right click reached {got!r} in the page, not #{want}, so the drive aimed wrong"
    def measured(self, item: int, check: str, web: Any, ok: bool) -> None:
        self.row(item, check, web, None, None if self.missed else ok, self.missed)
    def picked(self, at: tuple[float, float], label: str) -> str:
        shown = self.opened(at)
        self.landed(at)
        if not shown["items"]:
            return "no menu opened"
        said = self.js(f"return {PICK}({json.dumps(label)})")
        time.sleep(1.5)
        return str(said)
    def copied(self, check: str, at: tuple[float, float], label: str, judge: Callable[[dict[str, Any]], bool]) -> None:
        self.clipboard.put("before " + label)
        said = self.picked(at, label)
        now = self.clipboard.now()
        until = time.monotonic() + 4
        while not judge(now) and time.monotonic() < until:
            time.sleep(0.4)
            now = self.clipboard.now()
        self.measured(1, check, {"pick": said, "clipboard": now}, said == "picked" and judge(now))
    def opens(self, check: str, at: tuple[float, float], label: str, path: str) -> None:
        url = self.base + path
        said = self.picked(at, label)
        found = self.app.until(f"orden.pages.each().some(([, one]) => (one.url || '').startsWith({json.dumps(url)})) || null", 8)
        tabs = self.js("orden.pages.each().map(([, one]) => one.url)")
        self.measured(2, check, {"pick": said, "tabs": tabs}, said == "picked" and found is True)
        self.reset()
        self.show(self.ids["web"])
    def saved(self, check: str, at: tuple[float, float], label: str) -> None:
        count = "orden.invoke('web_downloads').then((all) => all.length, () => -1)"
        before = self.js(count)
        said = self.picked(at, label)
        after = before
        until = time.monotonic() + 8
        while time.monotonic() < until and after == before:
            time.sleep(0.4)
            after = self.js(count)
        windows = self.windows.now()
        self.measured(3, check, {"pick": said, "downloads": [before, after], "windows": len(windows)}, said == "picked" and isinstance(after, int) and isinstance(before, int) and after > before)
    def pasted(self) -> None:
        if not self.focus_page():
            self.row(4, "Paste puts the clipboard's text into the field", None, None, None, "the page could not be given the keyboard by a click")
            return
        self.js("return true")
        typed = "pasted " + secrets.token_hex(3)
        self.clipboard.put(typed)
        said = self.picked(FIELD, "Paste")
        value = keys.page_said("main", time.monotonic() + 0.3).get("value")
        self.measured(4, "Paste puts the clipboard's text into the field", {"pick": said, "field": value}, said == "picked" and value == typed)
        self.clipboard.put("before cut")
        said = self.picked(FIELD, "Cut")
        value = keys.page_said("main", time.monotonic() + 0.3).get("value")
        now = self.clipboard.now()
        self.measured(4, "Cut moves the field's selected text to the clipboard", {"pick": said, "field": value, "clipboard": now}, said == "picked" and value == "" and now.get("text") == typed)
    def lit(self, side: str, opening: Callable[[], None], away: Callable[[], None]) -> dict[str, Any]:
        away()
        opening()
        time.sleep(1.2)
        first = self.menu_now()
        usable = self.js(FIRST_ON)
        self.screen.shot().save(self.out / f"lit-{side}-{len(self.rows)}.png")
        self.keys.chord("ArrowDown")
        time.sleep(0.4)
        moved = self.menu_now()
        for _ in range(2):
            self.keys.chord("Escape")
            time.sleep(0.4)
        return {"items": first["items"][:3], "lit when shown": first["active"], "after ArrowDown": moved["active"], "first": usable}
    def highlight(self) -> None:
        self.reset()
        self.show(self.ids["two"])
        note_at = self.word_at("Lodestar")
        page_at = self.in_page(24 + 60, 250 + 14)
        for side, at in (("page", page_at), ("note", note_at)):
            if at is None:
                self.row(5, f"a {side}'s menu opened by a right click lights no row, and ArrowDown lights its first", None, None, None, "the note's words were not found")
                continue
            def prepare(side: str = side) -> None:
                self.reset()
                self.show(self.ids["web"] if side == "page" else self.ids["two"])
                if side == "page":
                    self.focus_page()
                else:
                    self.focus_note("Keyline")
            spot = (lambda: self.keys.click(*self.spot(24 + 60, 250 + 14), right=True)) if side == "page" else (lambda at=at: self.keys.click(*at, right=True))
            found = self.lit(side, spot, prepare)
            self.row(5, f"a {side}'s menu opened by a right click lights no row, and ArrowDown lights its first", found, None, found["first"] is not None and found["lit when shown"] is None and found["after ArrowDown"] == found["first"])
            if PLATFORM == "macos":
                continue
            for combo in ("Menu", "Shift-F10"):
                found = self.lit(side, lambda combo=combo: self.keys.chord(combo), prepare)
                self.row(5, f"a {side}'s menu opened by {combo} lights its first row at once", found, None, found["first"] is not None and found["lit when shown"] == found["first"])
    def run(self) -> None:
        self.reset()
        self.show(self.ids["web"])
        pic, link, words = PIC, LINK, WORDS_AT
        self.copied("Copy image puts the picture itself on the clipboard", pic, "Copy image", lambda now: bool(now.get("image")) and now["image"]["size"] == list(SIZE) and keys.near(tuple(now["image"]["colour"] or (0, 0, 0)), BLUE))
        self.copied("Copy image address puts the picture's address on the clipboard", pic, "Copy image address", lambda now: now.get("text") == self.base + "/pic.png")
        self.copied("Copy link address puts the link's address on the clipboard", link, "Copy link address", lambda now: now.get("text") == self.base + "/linked")
        self.copied("Copy puts the selected words on the clipboard", words, "Copy", lambda now: (now.get("text") or "").strip() == WORDS)
        self.pasted()
        self.reset()
        self.show(self.ids["web"])
        self.opens("Open image in new tab opens the picture in an Orden tab", pic, "Open image in new tab", "/pic.png")
        self.opens("Open link in new tab opens the link in an Orden tab", link, "Open link in new tab", "/linked")
        self.saved("Save image as saves the picture into Orden's downloads", pic, "Save image as")
        self.reset()
        self.show(self.ids["web"])
        self.saved("Save link as saves the linked page into Orden's downloads", link, "Save link as")
        self.highlight()
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if PLATFORM == "windows":
        from probe_app import refuse_updating
        refuse_updating(args.exe)
    if PLATFORM == "linux" and not shutil.which("xclip"):
        raise SystemExit("the drive reads the clipboard with xclip")
    args.out.mkdir(parents=True, exist_ok=True)
    wrote_rc = keys.prepared_linux()
    site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{site.server_address[1]}/menu"
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-menu-spaces-"))
    log = open(args.out / "app.log", "wb")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent), stdout=log, stderr=subprocess.STDOUT)
    rows: list[dict[str, Any]] = []
    try:
        app = endpoint(config, process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!orden.workspace") is not True:
            time.sleep(1)
        if PLATFORM == "windows":
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
        drive = Menus(app, process.pid, url, args.out)
        drive.build()
        forward(app, process.pid)
        drive.run()
        rows = drive.rows
        drive.screen.shot().save(args.out / "end.png")
    finally:
        ended(process, gentle=True)
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
        if wrote_rc:
            keys.openbox_rc().unlink(missing_ok=True)
            subprocess.run(["openbox", "--reconfigure"], capture_output=True, check=False)
    (args.out / "results.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(keys.table(rows), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"\n### Page menu, {PLATFORM}\n\n{keys.table(rows)}\n")
    wrong = [one for one in rows if one["ok"] is False]
    for one in wrong:
        print(f"::error::[{one['item']}] {one['check']}", flush=True)
    print(f"{len(wrong)} not ok, {sum(1 for one in rows if one['ok'] is None)} not measured, {len(rows)} checks", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
