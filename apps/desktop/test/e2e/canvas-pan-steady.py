import json
import random
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
SIDES = ["top", "right", "bottom", "left"]
def board() -> dict:
    pick = random.Random(7)
    nodes, cards = [], []
    for group in range(3):
        gx, gy = group * 900, (group % 2) * 200
        nodes.append({"id": f"g{group}", "type": "group", "label": f"Group {group}", "x": gx - 40, "y": gy - 60, "width": 760, "height": 860})
        for at in range(7 if group < 2 else 6):
            one = f"c{group}-{at}"
            cards.append(one)
            nodes.append({"id": one, "type": "text", "text": f"**Card {group}.{at}** with a few words", "x": gx + (at % 2) * 360, "y": gy + (at // 2) * 200, "width": 300, "height": 90})
    edges = []
    for at in range(40):
        a, b = pick.sample(cards, 2)
        edges.append({"id": f"e{at}", "fromNode": a, "toNode": b, "fromSide": pick.choice(SIDES), "toSide": pick.choice(SIDES), "toEnd": "arrow"})
    return {"nodes": nodes, "edges": edges}
SEED = """
async (text) => {
  const ws = window.ordenApp.workspace
  const path = `${ws.activeSpace.root}/Steady board.canvas`
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
WATCH = """
() => {
  const host = [...document.querySelectorAll('.canvas')].find((one) => one.getClientRects().length)
  const probe = { frames: [], changed: 0, tasks: [] }
  window.__pan = probe
  new MutationObserver((list) => { probe.changed += list.length }).observe(host, { subtree: true, childList: true, attributes: true, characterData: true })
  new PerformanceObserver((list) => { for (const one of list.getEntries()) probe.tasks.push(one.duration) }).observe({ type: 'longtask' })
  const tick = (at) => { probe.frames.push([at, probe.changed]); probe.changed = 0; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return true
}
"""
SINCE = """
(from) => {
  const frames = window.__pan.frames.filter(([at]) => at >= from)
  let gap = 0
  for (let i = 1; i < frames.length; i++) gap = Math.max(gap, frames[i][0] - frames[i - 1][0])
  const changes = frames.map(([, changed]) => changed).sort((a, b) => a - b)
  return { frames: frames.length, gap, most: changes.at(-1) ?? 0, middle: changes[Math.floor(changes.length / 2)] ?? 0, longest: Math.max(0, ...window.__pan.tasks) }
}
"""
MOST_CHANGES = 16
MOST_PAINTS = 3
def paints(raw: bytes) -> dict:
    data = json.loads(raw)
    events = data["traceEvents"] if isinstance(data, dict) else data
    main = {(e["pid"], e["tid"]) for e in events if e.get("ph") == "M" and e.get("name") == "thread_name" and e["args"].get("name") == "CrRendererMain"}
    mine = [e for e in events if (e.get("pid"), e.get("tid")) in main and e.get("ph") == "X"]
    paint = [e for e in mine if e.get("name") == "Paint"]
    layout = [e for e in mine if e.get("name") == "Layout"]
    return {"paints": len(paint), "paint": round(sum(e.get("dur", 0) for e in paint) / 1000, 1), "layouts": len(layout), "layout": round(sum(e.get("dur", 0) for e in layout) / 1000, 1)}
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 900})
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    page.evaluate(SEED, json.dumps(board()))
    page.wait_for_timeout(1500)
    host = [one for one in page.locator(".canvas").all() if one.is_visible()][0]
    box = host.bounding_box()
    assert box
    page.keyboard.press("Escape")
    page.mouse.click(box["x"] + 20, box["y"] + box["height"] - 20)
    page.keyboard.press("h")
    page.evaluate(WATCH)
    page.wait_for_timeout(300)
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(100)
    browser.start_tracing(page=page, categories=["devtools.timeline", "disabled-by-default-devtools.timeline"])
    started = page.evaluate("() => performance.now()")
    for step in range(60):
        page.mouse.move(x - step * 12, y - step * 4)
        page.wait_for_timeout(16)
    seen = page.evaluate(SINCE, started)
    painted = paints(browser.stop_tracing())
    page.mouse.up()
    page.wait_for_timeout(800)
    say(f"panning {len(board()['nodes'])} nodes and 40 arrows: {seen}; {painted}")
    if painted["paints"] > MOST_PAINTS * max(1, seen["frames"]):
        wrong(f"panning painted {painted['paints']} times over {seen['frames']} frames; the plane should move as it is and be painted once it stops")
    if seen["most"] > MOST_CHANGES:
        wrong(f"panning changed {seen['most']} things in one frame; a pan should only move the plane")
    if seen["gap"] > 50:
        wrong(f"panning left a {seen['gap']:.0f} ms gap between frames")
    if seen["longest"] > 100:
        wrong(f"panning held the main thread {seen['longest']:.0f} ms")
    page.screenshot(path=str(DRIVE.shots / "panned.png"))
    page.context.close()
raise SystemExit(DRIVE.run(drive, "panning a board of twenty cards, forty arrows and three groups changes nothing but the plane's place each frame"))
