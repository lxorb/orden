"""#349: a finger held on the bare plane, then moved, lassos - on a canvas and a page note."""
import json, re, sys
from playwright.sync_api import sync_playwright
results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail) if detail else ""), flush=True)

CANVAS = """async () => {
  const f = await import('/src/lib/canvas/format.ts')
  const nodes = []
  for (let i = 0; i < 12; i++) nodes.push({ id: 'n' + i, type: 'text', text: 'card ' + i, x: (i % 4) * 200, y: Math.floor(i / 4) * 120, width: 150, height: 60 })
  const { workspace } = await import('/src/lib/workspace.svelte.ts')
  workspace.openUnsaved('canvas', f.writeCanvas({ ...f.readCanvas('{}'), nodes, edges: [] }))
}"""
PAGES = """async () => {
  const m = await import('/@fs""" + sys.argv[1] + """/packages/markdown/src/pages.ts')
  const file = JSON.parse(m.blankPages('a4'))
  const page = file.nodes[0]
  for (let i = 0; i < 6; i++) file.nodes.push({ id: 'w' + i, type: 'text', text: 'words ' + i, x: page.x + 40 + (i % 3) * 120, y: page.y + 60 + Math.floor(i / 3) * 80, width: 100, height: 40 })
  const { workspace } = await import('/src/lib/workspace.svelte.ts')
  workspace.openUnsaved('pages', JSON.stringify(file))
}"""
FILE = """async () => { const { workspace } = await import('/src/lib/workspace.svelte.ts'); const tab = workspace.tabs.find((one) => one.id === workspace.activeTabId); return JSON.parse(tab.note.text) }"""

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1200, "height": 900}, has_touch=True, is_mobile=False)
    page = context.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300], flush=True))
    cdp = context.new_cdp_session(page)
    def touch(kind, x=0, y=0):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": x, "y": y, "id": 1}]})
    def loop(sx, sy, points, hold=800):
        touch("touchStart", sx, sy); page.wait_for_timeout(hold)
        menu_up = page.locator(".menu, [role=menu]").count() > 0
        for (x, y) in points:
            touch("touchMove", x, y); page.wait_for_timeout(30)
        menu_after = page.locator(".menu, [role=menu]").count() > 0
        touch("touchEnd"); page.wait_for_timeout(800)
        return menu_up, menu_after
    def ring(cx, cy, rx, ry, n=24):
        import math
        # From its leftmost point, which is bare plane left of the first card.
        return [(cx - rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]

    for name, make, plane_sel, item in [("canvas", CANVAS, ".canvas .plane", "n"), ("page note", PAGES, ".pages, .canvas", "w")]:
        page.goto("http://127.0.0.1:5535/", wait_until="load"); page.wait_for_timeout(5000)
        page.evaluate(make); page.wait_for_timeout(3000)
        f = page.evaluate(FILE)
        items = [n for n in f["nodes"] if n["id"].startswith(item)]
        # Where those items are on screen, from their elements.
        def box(id):
            return page.locator(f"[data-id='{id}']").first.bounding_box()
        boxes = {n["id"]: box(n["id"]) for n in items}
        if not all(boxes.values()):
            check(f"{name}: its cards are drawn", False, {k: v is not None for k, v in boxes.items()}); continue
        first, second = items[0]["id"], items[1]["id"]
        a, b = boxes[first], boxes[second]
        # A loop round the first two, from bare plane just left of the first.
        left, top = a["x"] - 25, a["y"] - 25
        right, bottom = b["x"] + b["width"] + 25, max(a["y"] + a["height"], b["y"] + b["height"]) + 25
        cx, cy = (left + right) / 2, (top + bottom) / 2
        pts = ring(cx, cy, (right - left) / 2 + 10, (bottom - top) / 2 + 10)
        start = pts[0]
        up, after = loop(start[0], start[1], pts)
        check(f"{name}: held, the menu comes up", up)
        check(f"{name}: moved on, the menu goes", not after)
        picked = page.evaluate("[...document.querySelectorAll('[data-id].picked, [data-id][class*=picked]')].map((one) => one.dataset.id)")
        check(f"{name}: the loop picked the two cards it went round", sorted(set(picked)) == sorted([first, second]), picked)
        # Held and let go: the menu stays, nothing picked anew.
        page.keyboard.press("Escape"); page.wait_for_timeout(300)
        up2, _ = loop(start[0], start[1], [], hold=800)
        check(f"{name}: held and let go, the menu stays", page.locator(".menu, [role=menu]").count() > 0)
        page.keyboard.press("Escape"); page.wait_for_timeout(300)
        # A finger moved at once moves the plane rather than lassoing.
        before = page.locator(f"[data-id='{first}']").first.bounding_box()
        touch("touchStart", start[0], start[1]); 
        for i in range(1, 8): touch("touchMove", start[0] + 10 * i, start[1] + 10 * i); page.wait_for_timeout(20)
        touch("touchEnd"); page.wait_for_timeout(600)
        after_box = page.locator(f"[data-id='{first}']").first.bounding_box()
        picked = page.evaluate("[...document.querySelectorAll('[data-id].picked')].map((one) => one.dataset.id)")
        if name == "canvas":
            check(f"{name}: a finger moved at once still moves the plane, and picks nothing", abs(after_box["x"] - before["x"]) > 20 and not picked, (before["x"], after_box["x"], picked))
        else:
            check(f"{name}: a finger moved at once lassoes nothing", not picked and page.locator(".menu, [role=menu]").count() == 0, picked)
    print(json.dumps({"passed": sum(results), "of": len(results)}))
    browser.close()
