import io
from PIL import Image
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
KINDS = {"pages": (".pages", "createPages"), "canvas": (".canvas", "createCanvas")}
MOST_BLACK = 0.1
def opened(page: Page, kind: str) -> dict:
    selector, make = KINDS[kind]
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate(f"() => window.ordenApp.workspace.{make}()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!window.ordenApp.workspace.active?.path?.endsWith('.{kind}')"):
            break
    page.wait_for_selector(selector, timeout=15000)
    page.wait_for_timeout(600)
    box = page.locator(selector).first.bounding_box()
    assert box
    return box
def blacks(png: bytes) -> list[bool]:
    picture = Image.open(io.BytesIO(png)).convert("RGB")
    picture = picture.resize((max(1, picture.width // 4), max(1, picture.height // 4)))
    data = picture.tobytes()
    return [data[at] < 20 and data[at + 1] < 20 and data[at + 2] < 20 for at in range(0, len(data), 3)]
def turned(before: bytes, after: bytes) -> float:
    was, now = blacks(before), blacks(after)
    return sum(1 for one, other in zip(was, now) if other and not one) / max(1, len(now))
def pen(cdp, what: str, x: float, y: float, held: int) -> None:
    cdp.send(
        "Input.dispatchMouseEvent",
        {"type": what, "x": x, "y": y, "button": "left", "buttons": held, "clickCount": 1, "pointerType": "pen", "force": 0.6},
    )
def drawn(browser: Browser, scheme: str, kind: str) -> None:
    label = f"{kind} {scheme}"
    page = DRIVE.page(browser, viewport={"width": 1200, "height": 800}, color_scheme=scheme)
    DRIVE.open(page)
    box = opened(page, kind)
    clip = {"x": box["x"] + 8, "y": box["y"] + 60, "width": min(700, box["width"] - 16), "height": min(500, box["height"] - 80)}
    page.keyboard.press("Escape")
    page.mouse.click(clip["x"] + 20, clip["y"] + 20)
    page.keyboard.press("d")
    page.wait_for_timeout(200)
    before = page.screenshot(clip=clip)
    cdp = page.context.new_cdp_session(page)
    x0, y0 = clip["x"] + 120, clip["y"] + 120
    pen(cdp, "mousePressed", x0, y0, 1)
    for step in range(1, 30):
        pen(cdp, "mouseMoved", x0 + step * 8, y0 + (step % 6) * 5, 1)
        page.wait_for_timeout(10)
    during = page.screenshot(clip=clip)
    pen(cdp, "mouseReleased", x0 + 240, y0 + 10, 0)
    page.wait_for_timeout(900)
    after = page.screenshot(clip=clip)
    held, left = turned(before, during), turned(before, after)
    say(f"{label}: black while drawing {held:.1%}, after {left:.1%}")
    if held > MOST_BLACK or left > MOST_BLACK:
        (DRIVE.shots / f"black-{kind}-{scheme}-during.png").write_bytes(during)
        (DRIVE.shots / f"black-{kind}-{scheme}-after.png").write_bytes(after)
        wrong(f"{label}: drawing one stroke turned {max(held, left):.0%} of the surface black")
    page.context.close()
def drive(browser: Browser) -> None:
    DRIVE.shots.mkdir(parents=True, exist_ok=True)
    for scheme in ("light", "dark"):
        for kind in KINDS:
            drawn(browser, scheme, kind)
raise SystemExit(DRIVE.run(drive, "one stroke on a page note or a canvas, light or dark, leaves the surface its own colour"))
