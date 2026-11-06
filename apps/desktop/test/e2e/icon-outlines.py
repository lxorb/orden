from __future__ import annotations

import io
import math
import sys

from PIL import Image
from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
failures = DRIVE.failures
SHOTS = DRIVE.shots

PATIENCE = 40
SCALE = 2

INK = 48
CHROMA = 60
COLOURED = 0.02
RIM = 0.5

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await ws.noteFrom('# Marked\\n\\nnothing yet\\n', root)
  await ws.loadTree()
  const note = ws.files.find((one) => one.name.startsWith('Marked'))
  window.nibApp.iconChoice.file(note.path)
  return note.path
}
"""

CELLS = """
(grid) => {
  const at = grid.getBoundingClientRect()
  return [...grid.querySelectorAll('button.cell')].flatMap((cell) => {
    const glyph = cell.querySelector('.glyph')
    const box = glyph.getBoundingClientRect()
    if (box.top < at.top || box.bottom > at.top + grid.clientHeight) return []
    const drawn = cell.querySelector('svg')
    return [{
      // The emoji's outlines are drawn in a box 32 units wide, a line and a logo in 24.
      outline: drawn?.getAttribute('viewBox')?.startsWith('0 0 32 ') ?? false,
      label: cell.getAttribute('aria-label'),
      kind: cell.querySelector('.emoji') ? 'emoji' : cell.querySelector('img') ? 'picture' : drawn ? 'drawn' : 'none',
      x: box.left - at.left, y: box.top - at.top, w: box.width, h: box.height,
    }]
  })
}
"""

def check(fine: bool, what: str) -> None:
    say(("ok   " if fine else "FAIL ") + what)
    if not fine:
        failures.append(what)

def looked_at(shot: Image.Image, cell: dict) -> list[str]:
    left, top = math.ceil(cell["x"] * SCALE), math.ceil(cell["y"] * SCALE)
    wide = math.floor((cell["x"] + cell["w"]) * SCALE) - left
    tall = math.floor((cell["y"] + cell["h"]) * SCALE) - top
    glyph = shot.crop((left, top, left + wide, top + tall)).convert("RGB")
    ground = shot.convert("RGB").getpixel((max(0, left - 3), max(0, top - 3)))
    pixels = glyph.load()

    def inked(x: int, y: int) -> bool:
        return sum(abs(a - b) for a, b in zip(pixels[x, y], ground)) > INK

    ink = coloured = 0
    for y in range(tall):
        for x in range(wide):
            if not inked(x, y):
                continue
            ink += 1
            if max(pixels[x, y]) - min(pixels[x, y]) > CHROMA:
                coloured += 1

    wrong = []
    if cell["kind"] != "drawn":
        wrong.append(f"drawn as {cell['kind']}")
    if ink == 0:
        wrong.append("blank")
        return wrong
    if coloured / ink > COLOURED:
        wrong.append(f"in colour ({coloured} of {ink})")
    sides = [
        sum(inked(x, 0) for x in range(wide)) / wide,
        sum(inked(x, tall - 1) for x in range(wide)) / wide,
        sum(inked(0, y) for y in range(tall)) / tall,
        sum(inked(wide - 1, y) for y in range(tall)) / tall,
    ]
    corners = all(inked(x, y) for x in (0, wide - 1) for y in (0, tall - 1))
    if cell["outline"] and min(sides) > RIM and corners:
        wrong.append("fills its box")
    return wrong

def walk(page: Page) -> None:
    say(f"choosing for {page.evaluate(SEED)}")
    sheet = page.locator(".sheet")
    sheet.wait_for(state="visible", timeout=PATIENCE * 1000)
    sheet.locator(".variant button").nth(1).click()
    sheet.locator("button.cell:has(svg.drawn)").first.wait_for(timeout=PATIENCE * 1000)
    page.wait_for_timeout(500)

    grid = sheet.locator(".grid")
    step = grid.evaluate("(grid) => grid.clientHeight")
    seen: dict[str, list[str]] = {}
    screen = 0
    at = 0
    while True:
        grid.evaluate(f"(grid) => {{ grid.scrollTop = {at} }}")
        page.wait_for_timeout(150)
        shot = Image.open(io.BytesIO(grid.screenshot(path=str(SHOTS / f"grid-{screen:02}.png"))))
        for cell in grid.evaluate(CELLS):
            if cell["label"] not in seen:
                seen[cell["label"]] = looked_at(shot, cell)
        screen += 1
        if at + step >= grid.evaluate("(grid) => grid.scrollHeight"):
            page.wait_for_timeout(2500)
            if at + step >= grid.evaluate("(grid) => grid.scrollHeight"):
                break
        at += step - 60

    say(f"{len(seen)} cells over {screen} screens")
    wrong = {label: what for label, what in seen.items() if what}
    for label, what in list(wrong.items())[:40]:
        say(f"  {label}: {', '.join(what)}")
    check(len(seen) > 1900, f"the walk saw every emoji's cell ({len(seen)})")
    check(not wrong, f"every cell is drawn in one colour, inside its box ({len(wrong)} not)")
    for label in ("face with bags under eyes", "face in clouds", "flag switzerland", "family"):
        check(label in seen and not seen[label], f"`{label}` is an outline")

def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 1180, "height": 900}, color_scheme="dark", device_scale_factor=SCALE
        )
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"page error: {error}"))
        DRIVE.open(page)
        try:
            walk(page)
        finally:
            context.close()

    return DRIVE.verdict("every cell of the picker in One colour drawn in one colour, inside its box")

if __name__ == "__main__":
    sys.exit(main())
