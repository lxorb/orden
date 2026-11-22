from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
CAMERA = "() => { const c = window.ordenApp.workspace.active.camera ?? { x: 0, y: 0, scale: 1 }; return { x: c.x, y: c.y, scale: c.scale } }"
PAD = """
async ({ x, y, steps }) => {
  const at = document.elementFromPoint(x, y)
  for (const [dx, dy] of steps) {
    at.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0 }))
    await new Promise((done) => setTimeout(done, 16))
  }
}
"""
def opened(page: Page) -> dict:
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate("() => window.ordenApp.workspace.active?.kind === 'canvas'"):
            break
    page.wait_for_selector(".canvas:visible", timeout=15000)
    page.wait_for_timeout(500)
    box = [one for one in page.locator(".canvas:visible").all() if one.is_visible()][0].bounding_box()
    assert box
    return box
def camera(page: Page) -> dict:
    page.wait_for_timeout(500)
    return page.evaluate(CAMERA)
def under(cam: dict, box: dict, x: float, y: float) -> tuple[float, float]:
    return (
        (x - box["x"] - box["width"] / 2) / cam["scale"] + cam["x"],
        (y - box["y"] - box["height"] / 2) / cam["scale"] + cam["y"],
    )
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1200, "height": 800})
    DRIVE.open(page)
    box = opened(page)
    page.keyboard.press("Escape")
    x, y = box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.7
    page.mouse.move(x, y)
    before = camera(page)
    page.mouse.wheel(0, -100)
    page.wait_for_timeout(120)
    page.mouse.wheel(0, -100)
    after = camera(page)
    was, now = under(before, box, x, y), under(after, box, x, y)
    say(f"two wheel notches: scale {before['scale']:.3f} -> {after['scale']:.3f}; the point under the pointer {was[0]:.1f},{was[1]:.1f} -> {now[0]:.1f},{now[1]:.1f}")
    if not after["scale"] > before["scale"] * 1.3:
        wrong("a mouse wheel turned up did not zoom the canvas in")
    if abs(was[0] - now[0]) > 2 or abs(was[1] - now[1]) > 2:
        wrong("the wheel's zoom did not stay centred on the pointer")
    page.wait_for_timeout(500)
    page.mouse.wheel(0, 100)
    page.wait_for_timeout(120)
    page.mouse.wheel(0, 100)
    out = camera(page)
    if not out["scale"] < after["scale"] / 1.3:
        wrong("a mouse wheel turned down did not zoom the canvas out")
    page.wait_for_timeout(500)
    pad_before = camera(page)
    page.evaluate(PAD, {"x": x, "y": y, "steps": [[0.5, 4.25 + one * 0.5] for one in range(30)]})
    pad_after = camera(page)
    say(f"a touchpad's fine scroll: scale {pad_before['scale']:.3f} -> {pad_after['scale']:.3f}, y {pad_before['y']:.1f} -> {pad_after['y']:.1f}")
    if abs(pad_after["scale"] - pad_before["scale"]) > 1e-6:
        wrong("a touchpad's two finger scroll zoomed the canvas")
    if not pad_after["y"] > pad_before["y"] + 20:
        wrong("a touchpad's two finger scroll did not pan the canvas")
    page.wait_for_timeout(500)
    sideways = camera(page)
    page.mouse.wheel(120, 0)
    turned = camera(page)
    if abs(turned["scale"] - sideways["scale"]) > 1e-6 or not turned["x"] > sideways["x"]:
        wrong("a sideways wheel did not pan the canvas sideways")
    page.context.close()
raise SystemExit(DRIVE.run(drive, "a mouse wheel zooms a canvas about the pointer, while a touchpad's scroll and a sideways wheel pan it"))
