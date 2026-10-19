"""The interface's words sit in the middle of what they are written on (#418).

`--font-ui` names a face for the Arabic scripts straight after Geist, which ships with
no build, so a machine without Geist reaches the Arabic face first. Where that face is
installed - Noto Naskh Arabic, on an Ubuntu with the Noto fonts - its tall ascent and
descent became the line's, and every word in Latin was drawn high in its button. The
Arabic faces are now a family of the app's own that only the Arabic letters reach.

The drive asks the browser which face drew a label, and holds the line the label stands
on - the first face of its stack, as the browser measures it - to that face's own. In
Arabic it asks that the label is drawn with an Arabic face still. Each label's ink is
read off a screenshot as well, to say how far it sits from its box's edges. Run it on a machine that has the Arabic face, or in the image the
issue was seen on:

    docker run --rm --network host --user $(id -u):$(id -g) -e HOME=/tmp \\
      -v "$PWD":/repo -w /repo orden-fonts418 \\
      env NIB_SKIP_BUILD=1 python3 apps/desktop/test/e2e/font-ui.py

where the image is mcr.microsoft.com/playwright/python on Ubuntu 24.04 with
fonts-noto-core added. Screenshots go beside this file under `shots/font-ui/`.
"""

from __future__ import annotations

import io

from PIL import Image

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

SCALE = 2

#: The faces an Arabic label may be drawn with: the family's own sources.
ARABIC = {"Noto Naskh Arabic", "Noto Naskh Arabic UI", "Geeza Pro", "Segoe UI", "Noto Sans Arabic", "Tahoma"}

#: The labels measured: a segmented control's, the list of panes', and a tab's.
LABELS = [
    ("a segmented button", ".sheet .nib-segmented button"),
    ("a pane in Settings", ".sheet nav button"),
]


def ink(png: bytes) -> tuple[int, int, int] | None:
    """The first and last row with ink in a picture of one label, and its height, read
    against the colour in its corner."""
    picture = Image.open(io.BytesIO(png)).convert("L")
    width, height = picture.size
    ground = picture.getpixel((1, 1))
    rows = [y for y in range(height) if any(abs(picture.getpixel((x, y)) - ground) > 70 for x in range(2, width - 2))]
    if not rows:
        return None
    return rows[0], rows[-1], height


def drawn_with(page, selector: str) -> str:
    """The face that drew most of one label, by the browser's own account."""
    session = page.context.new_cdp_session(page)
    session.send("DOM.enable")
    session.send("CSS.enable")
    root = session.send("DOM.getDocument")["root"]["nodeId"]
    node = session.send("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
    used = session.send("CSS.getPlatformFontsForNode", {"nodeId": node})["fonts"]
    session.detach()
    return max(used, key=lambda one: one["glyphCount"])["familyName"] if used else ""


#: The line a label stands on - the first face its stack has, as the browser measures
#: it - beside the line of the face that drew it.
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


def look(browser, language: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, device_scale_factor=SCALE)
    page.context.add_init_script(f"localStorage.setItem('nib:language', {language!r})")
    DRIVE.open(page)
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    quiet(page)
    page.wait_for_timeout(600)
    shot(page, f"{language}-settings")

    for what, selector in LABELS:
        found = page.locator(selector)
        if not found.count():
            wrong(f"[{language}] nothing to measure for {what}: {selector}")
            continue
        label = found.first.inner_text().strip()
        face = drawn_with(page, selector)
        lines = page.evaluate(LINES, [selector, face])
        stack, own = lines["stack"], lines["own"]
        say(f"[{language}] {what} {label!r}: drawn with {face}, stands on {stack}, its own line {own}")
        if language == "ar" and face not in ARABIC:
            wrong(f"[ar] {what} {label!r} is drawn with {face}, not one of the Arabic faces")
        if language == "en" and (abs(stack[0] - own[0]) > 0.5 or abs(stack[1] - own[1]) > 0.5):
            wrong(f"[en] {what} {label!r} stands on a line of {stack}, not its own face's {own}")
        read = ink(found.first.screenshot())
        if read is not None:
            top, bottom, height = read
            say(
                f"[{language}]   ink {top / SCALE:.1f} px from the top, {(height - 1 - bottom) / SCALE:.1f} from the bottom"
            )
        shot(page, f"{language}-{what.replace(' ', '-')}", clip=found.first.bounding_box())
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for language in ("en", "ar"):
            look(browser, language)
    return DRIVE.verdict("a label in Latin stands on its own face's line, and Arabic finds its face")


if __name__ == "__main__":
    raise SystemExit(main())
