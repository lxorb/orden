from typing import Any
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
CARDS = "(() => { try { return JSON.parse(window.ordenApp.workspace.active.doc).orden.shapes.length } catch { return -1 } })()"
TAPS = """
(count) => {
  const host = document.querySelector('.canvas')
  const box = host.getBoundingClientRect()
  const at = { clientX: box.left + box.width - 40, clientY: box.top + box.height - 40, bubbles: true }
  for (let detail = 1; detail <= count; detail++) {
    host.dispatchEvent(new PointerEvent('click', { ...at, detail, pointerType: 'touch' }))
  }
}
"""
def shape(page: Any, x: float, y: float) -> None:
    page.keyboard.press("Escape")
    page.keyboard.press("r")
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 60, y + 40, steps=6)
    page.mouse.move(x + 120, y + 80, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 820})
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.createCanvas()")
    wait_for(page, "!!window.ordenApp.workspace.active?.path?.endsWith('.canvas')", "a canvas")
    page.wait_for_selector(".canvas", timeout=15000)
    box = page.locator(".canvas").first.bounding_box()
    page.mouse.click(box["x"] + 40, box["y"] + box["height"] / 2)
    shape(page, box["x"] + box["width"] / 3, box["y"] + box["height"] / 3)
    shape(page, box["x"] + 2 * box["width"] / 3, box["y"] + box["height"] / 3)
    wait_for(page, f"{CARDS} === 2", "two shapes written down", 20)
    page.evaluate(TAPS, 3)
    page.wait_for_timeout(2000)
    after = page.evaluate(CARDS)
    say(f"shapes after a triple tap: {after}")
    if after != 1:
        wrong(f"a triple tap undid nothing: {after} shapes, wanted the 1 one undo leaves")
raise SystemExit(DRIVE.run(drive))
