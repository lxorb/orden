from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import shutil
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "target" / "web-overlays"

PAGE_COLOUR = (0xFF, 0x00, 0x80)
NEAR = 40

ENOUGH = 0.6

def borrowed():

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

PAGES = {
    "/flat": b"""<!doctype html>
<title>A flat page</title>
<body style="margin:0;background:#ff0080;height:100vh"></body>
""",
    "/asks": b"""<!doctype html>
<title>A page that asks</title>
<body style="margin:0;background:#0080ff;height:100vh">
<script>
  // The engine raises its own permission request for this, which is the whole point:
  // nothing in the app asked for it and nothing in the app could have. Where you are
  // rather than the camera, because a machine with no camera answers that one itself
  // before there is anything to ask about.
  //
  // The page says in its own title what the engine told it, which is how the drive sees
  // the far end of the answer: code 1 is PERMISSION_DENIED - the reader said no, or
  // nobody ever answered - and anything else means the request was allowed and the
  // machine simply has no location to give.
  navigator.geolocation.getCurrentPosition(
    function () {
      document.title = 'allowed'
    },
    function (wrong) {
      document.title = 'refused ' + wrong.code
    },
  )
</script>
</body>
""",
}

def shoot(hwnd: int, name: str) -> pathlib.Path:

    import ctypes
    from ctypes import wintypes

    from PIL import Image

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    width = box.right - box.left
    height = box.bottom - box.top

    window = user32.GetWindowDC(wintypes.HWND(hwnd))
    made = gdi32.CreateCompatibleDC(window)
    bitmap = gdi32.CreateCompatibleBitmap(window, width, height)
    gdi32.SelectObject(made, bitmap)

    user32.PrintWindow(wintypes.HWND(hwnd), made, 0x0000_0002)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD),
            ("biWidth", ctypes.c_long),
            ("biHeight", ctypes.c_long),
            ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", ctypes.c_long),
            ("biYPelsPerMeter", ctypes.c_long),
            ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    header = BITMAPINFOHEADER()
    header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    header.biWidth = width
    header.biHeight = -height
    header.biPlanes = 1
    header.biBitCount = 32
    header.biCompression = 0

    bits = ctypes.create_string_buffer(width * height * 4)
    gdi32.GetDIBits(made, bitmap, 0, height, bits, ctypes.byref(header), 0)

    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(made)
    user32.ReleaseDC(wintypes.HWND(hwnd), window)

    out = OUT / f"{name}.png"
    picture = Image.frombuffer("RGBA", (width, height), bits, "raw", "BGRA", 0, 1)
    picture.convert("RGB").save(out)
    return out

def how_much(shot: pathlib.Path, box: tuple[int, int, int, int] | None = None) -> float:

    from PIL import Image

    with Image.open(shot) as picture:
        page = picture.convert("RGB")
        width, height = page.size
        cut = box if box else (width // 3, height // 4, width - 8, height - 8)
        inside = page.crop(cut)
        counted = 0
        total = 0
        for seen in inside.getdata():
            total += 1
            if all(abs(one - other) <= NEAR for one, other in zip(seen, PAGE_COLOUR)):
                counted += 1

    return counted / max(1, total)

OVERLAYS = [
    (
        "the dots",
        "document.querySelector('.webbar button[aria-label=\"More\"]').click()",
        ".menu, [role=menu]",
    ),
    (
        "the site",
        "document.querySelector('.webbar button[aria-label=\"Site information\"]').click()",
        ".site[role=dialog]",
    ),
    (
        "the palette",
        "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))",
        ".palette, [role=dialog]",
    ),
]

WHERE = """(() => {
  const one = document.querySelector('%s')
  if (!one) return JSON.stringify(null)
  const box = one.getBoundingClientRect()
  return JSON.stringify([
    Math.round(box.x), Math.round(box.y), Math.round(box.right), Math.round(box.bottom),
  ])
})()"""

def main() -> int:
    if sys.platform != "win32":
        print("this drive photographs a Windows window")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch = borrowed()
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    switch.wipe(args.identifier)
    port = switch.free_port()

    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = PAGES.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "A flat page.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/flat", "A flat page"), encoding="utf-8"
    )
    (space / "A page that asks.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/asks", "A page that asks"), encoding="utf-8"
    )

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, hwnd = switch.launch(args.exe, args.identifier, unlike=app.port)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A flat page.url")
        time.sleep(6)

        bare = shoot(hwnd, "page-alone")
        said["the page alone"] = round(how_much(bare), 3)

        for name, opens, drawn in OVERLAYS:
            app.ask(opens)
            time.sleep(1.2)

            shot = shoot(hwnd, name.replace(" ", "-"))
            where = app.ask(WHERE % drawn)
            if not isinstance(where, list) or len(where) != 4:
                said[name] = "the overlay never opened"
                continue

            said[name] = round(how_much(shot, tuple(int(one) for one in where)), 3)
            said[f"{name}: the picture under it"] = app.ask(
                "JSON.stringify((document.querySelector('.hole')?.style?.backgroundImage ?? '')"
                ".slice(0, 30))"
            )
            app.ask("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
            time.sleep(0.8)

        app.open("A page that asks.url")
        asked = ""
        until = time.perf_counter() + 30
        while not asked and time.perf_counter() < until:
            said_text = app.ask(
                "JSON.stringify(document.querySelector('.ask[role=dialog]')?.textContent?.trim()"
                " ?? '')"
            )
            asked = said_text if isinstance(said_text, str) else ""
            if not asked:
                time.sleep(1)

        said["a site asks"] = asked
        time.sleep(0.5)
        shoot(hwnd, "a-site-asks")
        if not asked:
            print("FAIL: a site asked for where you are and no bubble went up")

        said["the answers can be pressed"] = app.ask(
            "JSON.stringify([...document.querySelectorAll('.ask .nib-button')].map((one) => {"
            " const box = one.getBoundingClientRect();"
            " const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);"
            " return hit !== null && one.contains(hit) }))"
        )
        if said["the answers can be pressed"] != [True, True]:
            print("FAIL: a pointer over the bubble's answers lands on something else")
        app.ask("document.querySelectorAll('.ask .nib-button')[0].click()")

        told = ""
        until = time.perf_counter() + 20
        while "refused" not in told and time.perf_counter() < until:
            answer = app.ask(
                "JSON.stringify(document.querySelector('.webbar input.address')?.value ?? '')"
            )
            told = answer if isinstance(answer, str) else ""
            if "refused" not in told:
                time.sleep(1)

        said["the bubble is gone"] = app.ask(
            "JSON.stringify(document.querySelector('.ask[role=dialog]') === null)"
        )
        said["what the engine told the page"] = told
        said["what the site is allowed now"] = app.ask(
            "JSON.stringify(JSON.parse(localStorage.getItem('orden:web-grants') ?? '{}'))"
        )
        shoot(hwnd, "a-site-answered")
        if "refused 1" not in told:
            print(f"FAIL: the page was told {told!r} rather than that it was refused")

        app.ask(
            "window.__TAURI_INTERNALS__.invoke('web_step', { tab: '"
            + (switch.tab_of(app, "A page that asks") or "")
            + "', step: 'reload' })"
        )
        time.sleep(6)
        said["asked again"] = app.ask(
            "JSON.stringify([document.querySelector('.ask[role=dialog]') === null,"
            " document.querySelector('.webbar input.address')?.value ?? ''])"
        )
    finally:
        if running is not None:
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    print(f"\nthe photographs are in {OUT}")

    over = [name for name, value in said.items() if isinstance(value, float) and value > ENOUGH]
    for name in over:
        if name != "the page alone":
            print(f"FAIL: {name} left {said[name]} of the pane as the page: it is behind it")

    return 1 if [one for one in over if one != "the page alone"] else 0

if __name__ == "__main__":
    raise SystemExit(main())
