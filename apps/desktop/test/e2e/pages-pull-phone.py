import io
from typing import Any, Callable
from PIL import Image, ImageDraw
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
PREPARE = """
window.__TAURI_OS_PLUGIN_INTERNALS__ = {
  platform: 'android', family: 'unix', os_type: 'android', version: '15.0.0', arch: 'aarch64', exe_extension: '', eol: '\\n',
};
localStorage.setItem('orden:pen-seen', 'yes');
"""
COUNT = "() => window.ordenApp.pages.current?.store.pages.length ?? 0"
SLOT = """
() => {
  const slot = [...document.querySelectorAll('.pages .slot')].find((one) => one.getClientRects().length > 0)
  if (!slot) return null
  const box = slot.getBoundingClientRect()
  return { top: box.top, part: Number(slot.style.getPropertyValue('--part') || 0), ready: slot.classList.contains('ready') }
}
"""
W, H = 412, 900
def opened(page: Page) -> None:
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate("() => !!window.ordenApp.workspace.active?.path?.endsWith('.pages')"):
            break
    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(500)
def to_end(page: Page) -> None:
    page.evaluate("() => { const store = window.ordenApp.pages.current.store; store.camera = store.held({ ...store.camera, y: 1e9 }) }")
    page.wait_for_timeout(800)
def grab(page: Page) -> Image.Image:
    return Image.open(io.BytesIO(page.screenshot(clip={"x": 0, "y": H * 0.45, "width": W, "height": H * 0.55}))).convert("RGB")
def sheet(frames: list[tuple[str, Image.Image]], name: str) -> None:
    wide = 220
    cells = [(label, one.resize((wide, int(one.height * wide / one.width)))) for label, one in frames]
    out = Image.new("RGB", (wide * len(cells) + 8 * (len(cells) - 1), max(one.height for _, one in cells) + 28), "white")
    pen = ImageDraw.Draw(out)
    for at, (label, one) in enumerate(cells):
        out.paste(one, (at * (wide + 8), 28))
        pen.text((at * (wide + 8) + 4, 6), label, fill="black")
    out.save(DRIVE.shots / f"{name}.png")
def by_touch(cdp: Any) -> Callable[[str, float, float], None]:
    kinds = {"down": "touchStart", "move": "touchMove", "up": "touchEnd"}
    def send(kind: str, x: float, y: float) -> None:
        cdp.send("Input.dispatchTouchEvent", {"type": kinds[kind], "touchPoints": [] if kind == "up" else [{"x": x, "y": y, "id": 1}]})
    return send
def by_pen(cdp: Any) -> Callable[[str, float, float], None]:
    kinds = {"down": "mousePressed", "move": "mouseMoved", "up": "mouseReleased"}
    def send(kind: str, x: float, y: float) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {"type": kinds[kind], "x": x, "y": y, "button": "left", "buttons": 0 if kind == "up" else 1, "clickCount": 1, "pointerType": "pen", "force": 0 if kind == "up" else 0.5},
        )
    return send
def pull(page: Page, send: Callable[[str, float, float], None], label: str, far: float, scheme: str, hand: str) -> None:
    to_end(page)
    slot = page.evaluate(SLOT)
    if not slot:
        wrong(f"[{label}] no slot under the last page at the end of the note")
        return
    x, y = (W / 2 if hand == "finger" else 8), H * 0.6
    before = page.evaluate(COUNT)
    frames = [("at the end", grab(page))]
    send("down", x, y)
    gone = 0.0
    for mark in (far / 3, 2 * far / 3, far):
        while gone < mark:
            gone = min(mark, gone + 8)
            send("move", x, y - gone)
            page.wait_for_timeout(16)
        frames.append((f"{hand} up {round(gone)} px", grab(page)))
    page.wait_for_timeout(700)
    held = page.evaluate(SLOT) or {}
    frames.append(("held 700 ms", grab(page)))
    if not held.get("part") or held["part"] < min(1.0, far / 200) * 0.5:
        wrong(f"[{label}] the slot did not stay filled while the {hand} was held: {held}")
    if page.evaluate(COUNT) != before:
        wrong(f"[{label}] a page came while the {hand} was still down")
    send("up", x, y - gone)
    waited = 0
    for after in (80, 160, 300):
        page.wait_for_timeout(after - waited)
        waited = after
        frames.append((f"let go +{after} ms", grab(page)))
    page.wait_for_timeout(500)
    now = page.evaluate(COUNT)
    full = held.get("ready", False)
    say(f"[{label}] pulled {far} px, held part {held.get('part')}, ready {full}, pages {before} -> {now}")
    if full and now != before + 1:
        wrong(f"[{label}] a full pull let go added {now - before} pages, not one")
    if not full and now != before:
        wrong(f"[{label}] a short pull let go added a page")
    after = page.evaluate(SLOT) or {}
    if not full and after.get("part", 0) > 0.01:
        wrong(f"[{label}] a short pull let go did not spring back: {after}")
    sheet(frames, f"phone-{hand}-{'full' if far >= 200 else 'short'}-{scheme}")
def scenario(browser: Browser, scheme: str) -> None:
    context = browser.new_context(viewport={"width": W, "height": H}, user_agent=PHONE, color_scheme=scheme, has_touch=True, is_mobile=True, device_scale_factor=2)
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    cdp = context.new_cdp_session(page)
    DRIVE.open(page)
    opened(page)
    for hand, send in (("finger", by_touch(cdp)), ("pen", by_pen(cdp))):
        pull(page, send, f"{scheme} {hand} full", 240, scheme, hand)
        page.wait_for_timeout(600)
        pull(page, send, f"{scheme} {hand} short", 60, scheme, hand)
        page.wait_for_timeout(600)
    context.close()
def drive(browser: Browser) -> None:
    DRIVE.shots.mkdir(parents=True, exist_ok=True)
    for scheme in ("light", "dark"):
        scenario(browser, scheme)
raise SystemExit(DRIVE.run(drive, "on a phone a finger or a pen pulled past the last page fills the slot, holds it while down, adds one page when let go full and springs back when let go short"))
