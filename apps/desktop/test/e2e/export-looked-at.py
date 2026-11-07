
from __future__ import annotations

import base64

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DOC = "# Plain\n\nJust some plain words here, **bold** too.\n"
CHARTED = (
    "# Charted\n\nwords\n\n```mermaid\ngraph TD\nA-->B\n```\n\n"
    "```chart\ntype: bar\nlabels: [a,b]\nseries:\n  - name: x\n    data: [1,2]\n```\n\nlast words\n"
)

READ = """
async (encoded) => {
  const bytes = Uint8Array.from(atob(encoded), (one) => one.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes]))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  const corner = [...data.slice(0, 3)]
  let dark = 0
  let last = 0
  for (let at = 0; at < data.length; at += 4) {
    const luma = (data[at] + data[at + 1] + data[at + 2]) / 3
    if (luma < 110) dark += 1
    const far = Math.abs(data[at] - corner[0]) + Math.abs(data[at + 1] - corner[1]) + Math.abs(data[at + 2] - corner[2])
    if (far > 30) last = Math.floor(at / 4 / bitmap.width)
  }
  return { width: bitmap.width, height: bitmap.height, corner, dark, last }
}
"""

def exported(page: Page, row: str) -> tuple[bytes, str]:
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type(row, delay=1)
    page.wait_for_function(
        "(row) => [...document.querySelectorAll('[role=option]')].some((one) => one.innerText.startsWith(row))",
        arg=row,
    )
    with page.expect_download(timeout=30000) as asked:
        page.keyboard.press("Enter")
    path = asked.value.path()
    return path.read_bytes(), asked.value.suggested_filename

def looked_at(page: Page, row: str) -> dict:
    bytes_, _name = exported(page, row)
    return page.evaluate(READ, base64.b64encode(bytes_).decode())

def light(rgb: list[int]) -> bool:
    return min(rgb) > 230

def dark(rgb: list[int]) -> bool:
    return max(rgb) < 60

def note_pictures(browser: Browser) -> None:
    say("a note's PNG and JPG are light paper with dark words, in a light app and a dark one")
    for scheme in ("light", "dark"):
        context = DRIVE.context(browser, color_scheme=scheme, viewport={"width": 1000, "height": 700})
        page = context.new_page()
        DRIVE.open(page)
        DRIVE.seed(page, DOC, CHARTED)
        DRIVE.open_note(page, "Plain")
        for row in ("Export as PNG", "Export as JPG"):
            seen = looked_at(page, row)
            say(f"  {scheme} app, {row}: {seen}")
            if not light(seen["corner"]):
                wrong(f"{row} from a {scheme} app has paper of {seen['corner']}")
            if seen["dark"] < 200:
                wrong(f"{row} from a {scheme} app has no dark words on it: {seen['dark']} pixels")

        say("  the paper stops where the note does, a chart and a diagram included")
        DRIVE.open_note(page, "Charted")
        seen = looked_at(page, "Export as PNG")
        say(f"  charted: {seen}")
        if seen["height"] - seen["last"] > 300:
            wrong(f"empty paper under the note: {seen['height']} tall, the last mark at {seen['last']}")

        say("  Appearance dark is dark paper with light words")
        page.evaluate("() => { window.ordenApp.settings.exportAppearance = 'dark' }")
        seen = looked_at(page, "Export as PNG")
        if not dark(seen["corner"]):
            wrong(f"a dark export has paper of {seen['corner']}")
        context.close()

def canvas_pictures(browser: Browser) -> None:
    say("a canvas from a dark app follows Appearance: light, then as the app is")
    context = DRIVE.context(browser, color_scheme="dark", viewport={"width": 1280, "height": 860})
    page = context.new_page()
    DRIVE.open(page)
    page.evaluate(
        "async () => { const ws = window.ordenApp.workspace; await ws.createCanvas(ws.activeSpace.root, 'Plane.canvas') }"
    )
    page.wait_for_selector(".canvas")
    box = page.locator(".canvas").bounding_box()
    x, y = box["x"] + 300, box["y"] + 200
    page.keyboard.press("d")
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 200, y + 60, steps=12)
    page.mouse.up()
    page.keyboard.press("v")

    seen = looked_at(page, "Export as PNG")
    say(f"  Appearance light: {seen}")
    if not light(seen["corner"]):
        wrong(f"a canvas's PNG under Appearance light has paper of {seen['corner']}")
    if seen["dark"] < 50:
        wrong(f"a canvas's PNG under Appearance light has no dark ink: {seen['dark']} pixels")

    page.evaluate("() => { window.ordenApp.settings.exportAppearance = 'app' }")
    seen = looked_at(page, "Export as PNG")
    say(f"  Appearance as the app is: {seen}")
    if not dark(seen["corner"]):
        wrong(f"a canvas's PNG as the dark app is has paper of {seen['corner']}")

    say("  the printed sheet is light whatever the setting")
    page.evaluate(
        """() => {
          window.__sheets = []
          new MutationObserver((changes) => {
            for (const change of changes) for (const node of change.addedNodes)
              if (node.tagName === 'IFRAME') window.__sheets.push(node.srcdoc)
          }).observe(document.documentElement, { childList: true, subtree: true })
          window.print = () => undefined
        }"""
    )
    page.keyboard.press("Control+p")
    DRIVE.wait_for(page, "() => window.__sheets?.some((one) => one.includes('<svg'))", "the printed sheet")
    sheet = page.evaluate("() => window.__sheets.find((one) => one.includes('<svg'))")
    fill = page.evaluate(
        """(sheet) => {
          const paper = new DOMParser().parseFromString(sheet, 'text/html').querySelector('svg > rect')
          return paper?.getAttribute('fill')
        }""",
        sheet,
    )
    say(f"  sheet paper: {fill}")
    if not fill or fill.lower() not in ("#fbfcfd", "#fbfbfd", "#ffffff", "#fff"):
        wrong(f"the printed sheet has paper of {fill}")

    context.close()

def page_note_at_once(browser: Browser) -> None:
    say("a page note exported straight after a stroke has the stroke")
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    page.evaluate("async () => { const ws = window.ordenApp.workspace; await ws.createPages(ws.activeSpace.root) }")
    page.wait_for_selector(".pages, .canvas")
    box = page.locator(".pages, .canvas").first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + 250
    page.keyboard.press("d")
    page.mouse.move(x - 150, y)
    page.mouse.down()
    page.mouse.move(x + 150, y + 60, steps=30)
    page.mouse.up()
    page.keyboard.press("v")
    drawn, _ = exported(page, "Export as PDF")
    say(f"  with a stroke {len(drawn)} bytes")
    if len(drawn) < 800:
        wrong(f"the PDF is from before the stroke: {len(drawn)} bytes")

def drive(browser: Browser) -> None:
    note_pictures(browser)
    canvas_pictures(browser)
    page_note_at_once(browser)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
