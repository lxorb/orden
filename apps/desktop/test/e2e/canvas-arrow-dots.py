import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
BOARD = {
    "nodes": [
        {"id": "a", "type": "text", "text": "From here", "x": -260, "y": -50, "width": 200, "height": 100},
        {"id": "b", "type": "text", "text": "To there", "x": 160, "y": -50, "width": 200, "height": 100},
    ],
    "edges": [],
}
CARD = """
(words) => {
  const host = [...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length > 0)
  const card = [...host.querySelectorAll('.node')].find((one) => one.textContent.includes(words))
  const box = card.getBoundingClientRect()
  return { x: box.left, y: box.top, width: box.width, height: box.height }
}
"""
EDGES = "() => { try { return JSON.parse(window.ordenApp.workspace.active.doc).edges.length } catch { return -1 } }"
WHERE_A = "() => { try { return JSON.parse(window.ordenApp.workspace.active.doc).nodes.find((one) => one.id === 'a').x } catch { return null } }"
NEAR = "() => [...document.querySelectorAll('.canvas .port.near')].filter((one) => one.getClientRects().length > 0).length"
def middle(box: dict, side: str, out: float) -> tuple[float, float]:
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    return {
        "top": (cx, box["y"] - out),
        "right": (box["x"] + box["width"] + out, cy),
        "bottom": (cx, box["y"] + box["height"] + out),
        "left": (box["x"] - out, cy),
    }[side]
def zoomed(page: Page, scale: float) -> None:
    page.evaluate("(scale) => { const tab = window.ordenApp.workspace.active; tab.camera = { ...tab.camera, x: 50, y: 0, scale } }", scale)
    page.wait_for_timeout(500)
def drag(page: Page, start: tuple[float, float], end: tuple[float, float]) -> None:
    page.mouse.down()
    for step in range(1, 11):
        page.mouse.move(start[0] + (end[0] - start[0]) * step / 10, start[1] + (end[1] - start[1]) * step / 10)
    page.mouse.up()
    page.wait_for_timeout(700)
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1300, "height": 820})
    DRIVE.open(page)
    wait_for(page, "typeof window.ordenApp.tasks === 'function'", "the app's handles")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root.replace(/\\/+$/, '')")
    page.evaluate(
        "async ([path, text]) => { const ws = window.ordenApp.workspace;"
        " await window.ordenApp.tasks().then((t) => t.writeFile(path, text));"
        " await ws.loadTree(); await ws.openEntry(path, { activate: true }) }",
        [f"{root}/Arrows.canvas", json.dumps(BOARD)],
    )
    wait_for(page, "[...document.querySelectorAll('.canvas .node')].filter((one) => one.getClientRects().length > 0).length === 2", "the two cards")
    page.wait_for_timeout(600)
    made = page.evaluate(EDGES)
    for scale, side, out in ((0.6, "left", 10), (1, "top", 10), (2, "bottom", 10), (1, "right", 9)):
        zoomed(page, scale)
        a, b = page.evaluate(CARD, "From here"), page.evaluate(CARD, "To there")
        start = middle(a, side, out)
        page.mouse.move(start[0] - 120, start[1] - 120)
        page.mouse.move(start[0], start[1], steps=4)
        page.wait_for_timeout(200)
        if page.evaluate(NEAR) != 1:
            wrong(f"[{scale}x {side}] the dot did not grow with the pointer {out} px off it")
        drag(page, start, (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2))
        wait_for(page, f"({EDGES})() === {made + 1}", f"[{scale}x {side}] an arrow from {out} px off the dot", 10)
        made += 1
        say(f"ok   [{scale}x {side}] pressed {out} px off the dot and drew an arrow")
    zoomed(page, 1)
    a = page.evaluate(CARD, "From here")
    was = page.evaluate(WHERE_A)
    start = (a["x"] + 8, a["y"] + a["height"] / 2)
    page.mouse.move(start[0], start[1], steps=3)
    drag(page, start, (start[0] - 80, start[1] + 40))
    wait_for(page, f"({WHERE_A})() !== {was}", "the card dragged by a press just inside its edge", 10)
    if page.evaluate(EDGES) != made:
        wrong("a press just inside the card drew an arrow instead of moving the card")
    else:
        say("ok   a press 8 px inside the card's edge moved the card")
    page.context.close()
raise SystemExit(DRIVE.run(drive, "a press anywhere close to a card's edge middle draws an arrow at every zoom, and a press on the card still moves it"))
