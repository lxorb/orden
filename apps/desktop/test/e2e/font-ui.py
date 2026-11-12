from __future__ import annotations

import io

from PIL import Image

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

SCALE = 2

LABELS = [
    ("a segmented button", ".sheet .orden-segmented button"),
    ("a pane in Settings", ".sheet nav button"),
]

def ink(png: bytes) -> tuple[int, int, int] | None:
    picture = Image.open(io.BytesIO(png)).convert("L")
    width, height = picture.size
    ground = picture.getpixel((1, 1))
    rows = [y for y in range(height) if any(abs(picture.getpixel((x, y)) - ground) > 70 for x in range(2, width - 2))]
    if not rows:
        return None
    return rows[0], rows[-1], height

def drawn_with(page, selector: str) -> str:
    session = page.context.new_cdp_session(page)
    session.send("DOM.enable")
    session.send("CSS.enable")
    root = session.send("DOM.getDocument")["root"]["nodeId"]
    node = session.send("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
    used = session.send("CSS.getPlatformFontsForNode", {"nodeId": node})["fonts"]
    session.detach()
    return max(used, key=lambda one: one["glyphCount"])["familyName"] if used else ""

LINES = """
([selector, face]) => {
  const one = document.querySelector(selector)
  const style = getComputedStyle(one)
  const pen = document.createElement('canvas').getContext('2d')
  const line = (font) => {
    pen.font = font
    const read = pen.measureText('Hxg')
    return [read.fontBoundingBoxAscent, read.fontBoundingBoxDescent]
  }
  const size = `${style.fontWeight} ${style.fontSize}`
  return { stack: line(`${size} ${style.fontFamily}`), own: line(`${size} "${face}"`) }
}
"""

def look(browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, device_scale_factor=SCALE)
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.settings.show('appearance')")
    quiet(page)
    page.wait_for_timeout(600)
    shot(page, "settings")

    for what, selector in LABELS:
        found = page.locator(selector)
        if not found.count():
            wrong(f"nothing to measure for {what}: {selector}")
            continue
        label = found.first.inner_text().strip()
        face = drawn_with(page, selector)
        lines = page.evaluate(LINES, [selector, face])
        stack, own = lines["stack"], lines["own"]
        say(f"{what} {label!r}: drawn with {face}, stands on {stack}, its own line {own}")
        if abs(stack[0] - own[0]) > 0.5 or abs(stack[1] - own[1]) > 0.5:
            wrong(f"{what} {label!r} stands on a line of {stack}, not its own face's {own}")
        read = ink(found.first.screenshot())
        if read is not None:
            top, bottom, height = read
            say(f"  ink {top / SCALE:.1f} px from the top, {(height - 1 - bottom) / SCALE:.1f} from the bottom")
        shot(page, what.replace(" ", "-"), clip=found.first.bounding_box())
    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        look(browser)
    return DRIVE.verdict("a label in Latin stands on its own face's line")

if __name__ == "__main__":
    raise SystemExit(main())
