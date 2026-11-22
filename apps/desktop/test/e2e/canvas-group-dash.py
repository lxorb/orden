import json
from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
BOARD = {
    "nodes": [
        {"id": "g", "type": "group", "label": "Group", "x": -300, "y": -200, "width": 600, "height": 400},
        {"id": "a", "type": "text", "text": "A card", "x": -200, "y": -80, "width": 240, "height": 80},
    ],
    "edges": [],
}
SEED = """
async (text) => {
  const ws = window.ordenApp.workspace
  const path = `${ws.activeSpace.root}/Dashed group.canvas`
  const open = indexedDB.open('orden')
  const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error) })
  const now = Date.now()
  await new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    change.objectStore('files').put({ path, content: text, modified: now, created: now })
    change.objectStore('stats').put({ path, modified: now, created: now })
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })
  db.close()
  await ws.loadTree()
  await ws.openEntry(path, { activate: true })
  return path
}
"""
LOOK = """
() => {
  const host = [...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length)
  const rect = host?.querySelector('.node.group .frame rect')
  const plane = host?.querySelector('.plane')
  if (!rect || !plane) return null
  const scale = Number(/scale\\(([-\\d.e]+)\\)/.exec(plane.style.transform)?.[1] ?? 1)
  const style = getComputedStyle(rect)
  const dashes = style.strokeDasharray.split(/[ ,]+/).map(parseFloat)
  return { scale, width: parseFloat(style.strokeWidth) * scale, dash: dashes[0] * scale, gap: dashes[1] * scale, border: getComputedStyle(rect.closest('.node')).borderTopStyle }
}
"""
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1200, "height": 800})
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    page.evaluate(SEED, json.dumps(BOARD))
    page.wait_for_timeout(1500)
    box = [one for one in page.locator(".canvas").all() if one.is_visible()][0].bounding_box()
    assert box
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    seen = []
    for name, notches in (("as opened", 0), ("zoomed out", 8), ("further out", 6), ("zoomed in", -24)):
        page.keyboard.down("Control")
        for _ in range(abs(notches)):
            page.mouse.wheel(0, 100 if notches > 0 else -100)
            page.wait_for_timeout(30)
        page.keyboard.up("Control")
        page.wait_for_timeout(500)
        look = page.evaluate(LOOK)
        say(f"{name}: {look}")
        if not look:
            wrong(f"{name}: the group has no dashed frame")
            continue
        seen.append(look["scale"])
        for what, want in (("line", (look["width"], 1)), ("dash", (look["dash"], 6)), ("gap", (look["gap"], 5))):
            if abs(want[0] - want[1]) > 0.05:
                wrong(f"{name} at scale {look['scale']:.2f}: the frame's {what} is {want[0]:.2f} screen px, not {want[1]}")
        if look["border"] != "solid":
            wrong(f"{name}: the group still draws a CSS {look['border']} border")
        page.screenshot(path=str(DRIVE.shots / f"{name.replace(' ', '-')}.png"))
    if len(seen) == 4 and not (min(seen) < 0.5 < 1.5 < max(seen)):
        wrong(f"the zooms tried did not span far enough: {seen}")
    page.context.close()
raise SystemExit(DRIVE.run(drive, "a group's dashed frame keeps the same dashes on screen at every zoom"))
