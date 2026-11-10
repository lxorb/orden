from __future__ import annotations

import base64
import io
import os
import sys

from playwright.sync_api import Browser

from harness import ROOT, Drive

sys.path.insert(0, str(ROOT / "scripts"))
from heavy_paper import BENCH_BODY, REFERENCE, heavy_paper  # noqa: E402

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

WEBKIT = os.environ.get("ORDEN_ENGINE", "chromium") == "webkit"

OPEN_LIMIT = float(os.environ.get("ORDEN_OPEN_LIMIT") or 8000)

BLOCK_LIMIT = float(os.environ.get("ORDEN_BLOCK_LIMIT") or 200)

SEED = """
async ({ path, data }) => {
  const open = indexedDB.open('orden')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const made = Date.now()
  await new Promise((resolve, reject) => {
    const write = db.transaction(['assets', 'stats'], 'readwrite')
    write.objectStore('assets').put({ path, type: 'application/pdf', data, modified: made })
    write.objectStore('stats').put({ path, modified: made, created: made })
    write.oncomplete = () => resolve()
    write.onerror = () => reject(write.error)
  })
  await window.ordenApp.workspace.loadTree()
  return window.ordenApp.workspace.files.some((one) => one.path === path)
}
"""

WATCH = """
() => {
  const probe = { beats: [], frames: [], longest: 0, marks: {} }
  window.__steady = probe
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    probe.beats.push([now, now - last])
    last = now
  }, 16)
  const look = (at) => {
    const sheets = [...document.querySelectorAll('.pages .sheet')].filter((one) => {
      const box = one.getBoundingClientRect()
      return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth
    })
    const bare = sheets.filter((one) => {
      const canvas = one.querySelector('canvas:not(.close)')
      return canvas && (!canvas.classList.contains('there') || canvas.width <= 1)
    }).length
    probe.frames.push([at, sheets.length, bare])
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  return true
}
"""

SINCE = """
(from) => {
  const probe = window.__steady
  const beats = probe.beats.filter(([at]) => at >= from)
  const frames = probe.frames.filter(([at]) => at >= from)
  let gap = 0
  for (let i = 1; i < frames.length; i++) gap = Math.max(gap, frames[i][0] - frames[i - 1][0])
  return {
    blocked: Math.max(0, ...beats.map(([, between]) => between)),
    gap,
    frames: frames.length,
    bare: frames.filter(([, , bare]) => bare > 0).length,
  }
}
"""

DRAWN = """
() => {
  const sheets = [...document.querySelectorAll('.pages .sheet')]
  return sheets.length === 2 && sheets.every((one) => one.querySelector('canvas.there')?.width > 1)
}
"""


class Frames:
    def __init__(self, cdp) -> None:
        self.cdp = cdp
        self.kept: list[tuple[bytes, dict]] = []
        cdp.on("Page.screencastFrame", self.came)

    def came(self, frame: dict) -> None:
        self.kept.append((base64.b64decode(frame["data"]), frame.get("metadata", {})))
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": frame["sessionId"]})
        except Exception:
            pass

    def start(self) -> None:
        self.kept.clear()
        self.cdp.send("Page.startScreencast", {"format": "png", "everyNthFrame": 1})

    def stop(self) -> list[tuple[bytes, dict]]:
        self.cdp.send("Page.stopScreencast")
        return list(self.kept)


def dark_share(png: bytes, box: dict, scale: float) -> float:
    from PIL import Image

    picture = Image.open(io.BytesIO(png)).convert("RGB")
    left = max(0, int(box["x"] * scale) + 4)
    top = max(0, int(box["y"] * scale) + 4)
    right = min(picture.width, int((box["x"] + box["width"]) * scale) - 4)
    bottom = min(picture.height, int((box["y"] + box["height"]) * scale) - 4)
    if right - left < 8 or bottom - top < 8:
        return 0.0
    part = picture.crop((left, top, right, bottom)).resize((max(1, (right - left) // 4), max(1, (bottom - top) // 4)))
    pixels = list(part.get_flattened_data() if hasattr(part, "get_flattened_data") else part.getdata())
    dark = sum(1 for r, g, b in pixels if r < 24 and g < 24 and b < 24)
    return dark / max(1, len(pixels))


def blackness(page, frames: list[tuple[bytes, dict]], label: str) -> None:
    box = page.locator(".pages").first.bounding_box()
    if not box:
        wrong(f"{label}: no page note to look at")
        return
    css = page.evaluate("() => innerWidth")
    worst = 0.0
    black = 0
    for at, (png, meta) in enumerate(frames):
        wide = meta.get("deviceWidth") or css
        from PIL import Image

        scale = Image.open(io.BytesIO(png)).width / wide
        share = dark_share(png, box, scale)
        worst = max(worst, share)
        if share > 0.25:
            black += 1
            if black <= 3:
                (DRIVE.shots / f"black-{label}-{at}.png").write_bytes(png)
    say(f"{label}: {len(frames)} frames recorded, {black} with the page note mostly black (worst {worst:.0%})")
    if not frames:
        wrong(f"{label}: no frames were recorded")
    if black:
        wrong(f"{label}: {black} of {len(frames)} frames showed the page note black")


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 860}, device_scale_factor=1.5)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    pdf = f"{root}/Heavy.pdf"
    made = heavy_paper()
    say(f"a 2-page PDF of {len(made) // 1024} KB: a 300 dpi scan and a page of 24000 strokes")
    if not page.evaluate(SEED, {"path": pdf, "data": base64.b64encode(made).decode("ascii")}):
        wrong("the PDF never reached the space")
        return
    bench = min(page.evaluate(f"() => {{{BENCH_BODY}}}") for _ in range(5))
    slower = max(1, bench / REFERENCE)
    open_limit, block_limit = OPEN_LIMIT * slower, BLOCK_LIMIT * slower
    say(f"the fixed work took {bench:.1f} ms against {REFERENCE:.1f}: opening may take {open_limit:.0f} ms, the main thread may be held {block_limit:.0f} ms")
    page.evaluate(WATCH)
    page.wait_for_timeout(300)

    started = page.evaluate("() => performance.now()")
    page.evaluate("(path) => { void window.ordenApp.workspace.openPdf(path, 1) }", pdf)
    wait_for(page, "window.ordenApp.pages.current?.store.count === 2", "the page note", 60)
    wait_for(page, f"({DRAWN.strip()})()", "both pages drawn", 120)
    drawn = page.evaluate("() => performance.now()")
    page.wait_for_timeout(1500)
    opening = page.evaluate(SINCE, started)
    say(f"open: both pages drawn after {drawn - started:.0f} ms; the main thread was held at most {opening['blocked']:.0f} ms, the longest frame gap {opening['gap']:.0f} ms")
    if drawn - started > open_limit:
        wrong(f"opening the page note took {drawn - started:.0f} ms to draw its pages")
    if opening["blocked"] > block_limit:
        wrong(f"opening the page note held the main thread {opening['blocked']:.0f} ms")
    shot(page, "opened")

    cdp = None if WEBKIT else context.new_cdp_session(page)
    frames = Frames(cdp) if cdp else None
    box = page.locator(".pages").first.bounding_box()
    assert box
    page.keyboard.press("Escape")
    page.mouse.click(box["x"] + 30, box["y"] + 30)
    page.keyboard.press("d")
    page.wait_for_timeout(200)

    def pen(what: str, x: float, y: float, held: int) -> None:
        if cdp is None:
            page.mouse.move(x, y)
            if what == "mousePressed":
                page.mouse.down()
            elif what == "mouseReleased":
                page.mouse.up()
            return
        cdp.send(
            "Input.dispatchMouseEvent",
            {"type": what, "x": x, "y": y, "button": "left", "buttons": held, "clickCount": 1, "pointerType": "pen", "force": 0.6},
        )

    sheet = page.locator(".pages .sheet").first.bounding_box()
    assert sheet
    before = page.evaluate("() => window.ordenApp.pages.current.store.canvas.ink.length")
    from_edit = page.evaluate("() => performance.now()")
    if frames:
        frames.start()
    for n in range(12):
        x0 = sheet["x"] + 60 + (n % 4) * 60
        y0 = max(box["y"] + 80, sheet["y"] + 80) + (n // 4) * 50
        pen("mousePressed", x0, y0, 1)
        for step in range(1, 16):
            pen("mouseMoved", x0 + step * 8, y0 + (step % 5) * 4, 1)
            page.wait_for_timeout(8)
        pen("mouseReleased", x0 + 120, y0 + 8, 0)
        page.wait_for_timeout(350)
    page.wait_for_timeout(1200)
    edited = frames.stop() if frames else None
    after = page.evaluate("() => window.ordenApp.pages.current.store.canvas.ink.length")
    editing = page.evaluate(SINCE, from_edit)
    say(f"edit: {after - before} strokes; held at most {editing['blocked']:.0f} ms, longest frame gap {editing['gap']:.0f} ms, {editing['bare']} of {editing['frames']} frames with a page undrawn")
    if after - before != 12:
        wrong(f"12 pen strokes left {after - before}")
    if editing["bare"]:
        wrong(f"while editing, {editing['bare']} frames showed a page without its paper")
    if editing["blocked"] > block_limit:
        wrong(f"editing held the main thread {editing['blocked']:.0f} ms")
    if edited is not None:
        blackness(page, edited, "edit")

    page.keyboard.press("Escape")
    page.keyboard.press("v")
    from_zoom = page.evaluate("() => performance.now()")
    if frames:
        frames.start()
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.move(*middle)
    for step in range(24):
        page.keyboard.down("Control")
        page.mouse.wheel(0, -120 if step < 16 else 120)
        page.keyboard.up("Control")
        page.wait_for_timeout(60)
    page.wait_for_timeout(1500)
    zoomed = frames.stop() if frames else None
    zooming = page.evaluate(SINCE, from_zoom)
    scale = page.evaluate("() => window.ordenApp.pages.current.store.camera.scale")
    say(f"zoom: now {scale * 100:.0f}%; held at most {zooming['blocked']:.0f} ms, longest frame gap {zooming['gap']:.0f} ms, {zooming['bare']} of {zooming['frames']} frames with a page undrawn")
    if zooming["bare"]:
        wrong(f"while zooming, {zooming['bare']} frames showed a page without its paper")
    if zooming["blocked"] > block_limit:
        wrong(f"zooming held the main thread {zooming['blocked']:.0f} ms")
    if zoomed is not None:
        blackness(page, zoomed, "zoom")
    shot(page, "zoomed")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a page note with a heavy PDF opens, edits and zooms without holding the app or showing black"))
