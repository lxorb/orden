from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
STREAM = (
    [(0, 16.666666666666668), (0, 16.666666666666668), (0.83, 33.333333333333336), (0, 50), (0, 33.333333333333336)]
    + [(0, 100), (0, 66.66666666666667), (0, 100), (0.83, 83.33333333333333), (0, 100), (0, 100), (0, 116.66666666666667)]
    + [(0, 100), (0, 83.33333333333333), (0, 66.66666666666667), (0, 50), (0, 50), (0, 33.333333333333336)]
    + [(0, 33.333333333333336), (0, 16.666666666666668), (0, 16.666666666666668), (0, 8.333333333333334)]
)
REPLAY = """
async ({ x, y, stream }) => {
  const at = document.elementFromPoint(x, y)
  const camera = () => { const c = window.ordenApp.workspace.active.camera ?? { x: 0, y: 0, scale: 1 }; return [c.y, c.scale] }
  const seen = [camera()]
  for (const [dx, dy] of stream) {
    at.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0 }))
    await new Promise((done) => requestAnimationFrame(() => done()))
    seen.push(camera())
  }
  return seen
}
"""
WILL = "() => getComputedStyle([...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length).querySelector('.plane')).willChange"
def opened(page: Page) -> dict:
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate("() => window.ordenApp.workspace.active?.kind === 'canvas'"):
            break
    page.wait_for_selector(".canvas", timeout=15000)
    page.wait_for_timeout(500)
    box = [one for one in page.locator(".canvas").all() if one.is_visible()][0].bounding_box()
    assert box
    return box
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1200, "height": 800})
    DRIVE.open(page)
    box = opened(page)
    page.keyboard.press("Escape")
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    for round, stream in enumerate((STREAM, [(0, 100)] + STREAM)):
        seen = page.evaluate(REPLAY, {"x": x, "y": y, "stream": stream})
        scales = [round_to(one[1]) for one in seen]
        steps = [b[0] - a[0] for a, b in zip(seen, seen[1:])]
        say(f"replay {round + 1}: scales {sorted(set(scales))}, moved {seen[-1][0] - seen[0][0]:.0f}, steps {[round_to(one) for one in steps]}")
        off = sum(1 for one in scales if one != scales[0])
        if scales[-1] != scales[0] or off > round:
            wrong(f"replay {round + 1}: a touchpad's two finger scroll zoomed the canvas for {off} frames")
        if any(one < -0.01 for one in steps[round:]):
            wrong(f"replay {round + 1}: the canvas went back while the fingers went one way")
        page.wait_for_timeout(600)
        will = page.evaluate(WILL)
        if will != "transform":
            wrong(f"replay {round + 1}: the plane was painted again after the scroll stopped (will-change {will}), which flashes")
    page.context.close()
def round_to(value: float) -> float:
    return round(value, 3)
raise SystemExit(DRIVE.run(drive, "a Windows touchpad's scroll, fine steps mixed with whole wheel steps and a glide, only ever pans a canvas, and nothing is painted again when it stops"))
