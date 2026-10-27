"""#535: what a hand does to a large plane, far and near, in Chromium.

A plane of N cards in a square grid, joined each to the next, and three cards below
it with a long connector between two of them. Far (framed whole, drawn as boxes on
one canvas) and near (a card found and framed, drawn as cards): one card dragged, a
selection dragged by one of its cards, a connector's end dragged onto another card;
a card found with Ctrl+F and framed as a card; the zoom taken across the line between
the two both ways with a card picked, every frame sampled for one that drew nothing;
then the plane exported as SVG and PNG, printed, and made a PDF, from far away. Each
check says PASS or FAIL, and the last line counts them.

Run against the web build under Vite's dev server, which serves the app's own modules
by path so the drive can make a plane through them:

    pnpm --filter @nib/desktop exec vite --port 5535 --strictPort --host 127.0.0.1
    python3 scripts/canvas-large-probe.py [cards]

with Playwright's Chromium (the drives ran it headless in Playwright's own image, on
the host's network). A Vite that has reloaded a module since the page last loaded hands
it out under another address, and the drive then makes its plane in a second copy of
the workspace nobody sees: start the server again after an edit.
"""
import json, re, sys
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail) if detail else ""), flush=True)

MAKE = """async (n) => {
  const f = await import('/src/lib/canvas/format.ts')
  const nodes = [], edges = []
  const side = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    nodes.push({ id: 'n' + i, type: 'text', text: 'card ' + i, x: (i % side) * 300, y: Math.floor(i / side) * 120, width: 250, height: 60 })
    if (i > 0) edges.push({ id: 'e' + i, fromNode: 'n' + (i - 1), toNode: 'n' + i })
  }
  const below = Math.ceil(n / side) * 120 + 2000
  nodes.push({ id: 'iso1', type: 'text', text: 'one', x: 1000, y: below, width: 250, height: 60 })
  nodes.push({ id: 'iso2', type: 'text', text: 'two', x: side * 300 - 1250, y: below, width: 250, height: 60 })
  nodes.push({ id: 'iso3', type: 'text', text: 'three', x: side * 150 - 125, y: below + 3000, width: 250, height: 60 })
  edges.push({ id: 'long', fromNode: 'iso1', toNode: 'iso2' })
  const text = f.writeCanvas({ ...f.readCanvas('{}'), nodes, edges })
  const { workspace } = await import('/src/lib/workspace.svelte.ts')
  workspace.openUnsaved('canvas', text)
  return { side, below }
}"""
FILE = """async () => { const { workspace } = await import('/src/lib/workspace.svelte.ts'); const tab = workspace.tabs.find((one) => one.id === workspace.activeTabId); return JSON.parse(tab.note.text) }"""

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300], flush=True))
    page.goto("http://127.0.0.1:5535/", wait_until="load"); page.wait_for_timeout(6000)
    made = page.evaluate(MAKE, N); page.wait_for_timeout(4000)
    turned = page.locator(".canvas .turned").first

    def view():
        t = page.locator(".canvas .plane").first.evaluate("(el) => el.style.transform")
        ox, oy, s = [float(v) for v in re.findall(r"-?[0-9]+(?:\.[0-9]+)?(?:e-?[0-9]+)?", t)[:3]]
        box = turned.bounding_box()
        return box["x"] + ox, box["y"] + oy, s
    def screen(x, y):
        ox, oy, s = view(); return ox + x * s, oy + y * s
    def node(file, id): return next(n for n in file["nodes"] if n["id"] == id)
    def edge(file, id): return next(e for e in file["edges"] if e["id"] == id)
    def far(): return page.locator("canvas[data-far]").count() == 1
    def drag(fx, fy, tx, ty, steps=30):
        page.mouse.move(fx, fy); page.mouse.down()
        for i in range(1, steps + 1):
            page.mouse.move(fx + (tx - fx) * i / steps, fy + (ty - fy) * i / steps); page.wait_for_timeout(16)
        page.mouse.up(); page.wait_for_timeout(1200)
    def escape_all():
        page.keyboard.press("Escape"); page.wait_for_timeout(200)
    def empty():
        """A press on bare plane, inside the pane: the band between the grid and the three
        cards below it, or near, just under the grid's first row."""
        if far():
            x, y = screen(1500, made["below"] - 1000)
        else:
            x, y = screen(600, 95)
        page.mouse.click(x, y); page.wait_for_timeout(300)

    def hands(mode):
        f0 = page.evaluate(FILE); s = view()[2]
        check(f"{mode}: drawn {'far' if far() else 'near'} at scale {s:.3f}", far() == (mode == "far"))
        # One card, by its middle.
        n0 = node(f0, "n0"); x, y = screen(n0["x"] + 125, n0["y"] + 30)
        drag(x, y, x + 60, y)
        f1 = page.evaluate(FILE); moved = node(f1, "n0")["x"] - n0["x"]
        want = 60 / s
        check(f"{mode}: drag one card", abs(moved - want) <= max(12, 0.2 * want) and node(f1, "n1")["x"] == node(f0, "n1")["x"], f"moved {moved:.0f}, wanted about {want:.0f} (snapped)")
        page.keyboard.press("Control+z"); page.wait_for_timeout(500)
        # Everything picked, by one of them.
        page.keyboard.press("Control+a"); page.wait_for_timeout(300)
        f1 = page.evaluate(FILE); n0 = node(f1, "n0"); n1 = node(f1, "n1"); x, y = screen(n0["x"] + 125, n0["y"] + 30)
        drag(x, y, x, y + 40)
        f2 = page.evaluate(FILE)
        d0 = node(f2, "n0")["y"] - n0["y"]; d1 = node(f2, "n1")["y"] - n1["y"]
        check(f"{mode}: drag a selection", d0 > 0 and d0 == d1, f"n0 {d0:.0f}, n1 {d1:.0f}")
        page.keyboard.press("Control+z"); page.wait_for_timeout(800); escape_all(); empty()
        f2 = page.evaluate(FILE)
        # An edge's end, onto another card: the long one far, a short one near.
        if mode == "far":
            a, b, c = node(f2, "iso1"), node(f2, "iso2"), node(f2, "iso3"); eid = "long"
        else:
            a, b, c = node(f2, "n0"), node(f2, "n1"), node(f2, f"n{made['side']}"); eid = "e1"
        mx, my = (a["x"] + 250 + b["x"]) / 2, a["y"] + 30
        page.mouse.click(*screen(mx, my)); page.wait_for_timeout(400)
        ex, ey = screen(b["x"], b["y"] + 30); tx, ty = screen(c["x"] + 125, c["y"] + 30)
        drag(ex, ey, tx, ty)
        f3 = page.evaluate(FILE)
        check(f"{mode}: drag an edge's end onto another card", edge(f3, eid)["toNode"] == c["id"], edge(f3, eid))
        page.keyboard.press("Control+z"); page.wait_for_timeout(800); escape_all(); empty()

    # ---- far
    hands("far")
    # Find, and jump to it.
    empty()
    page.keyboard.press("Control+f"); page.wait_for_timeout(400)
    page.keyboard.type(f"card {N - 7}"); page.wait_for_timeout(400); page.keyboard.press("Enter"); page.wait_for_timeout(1500)
    target = page.locator(f".canvas .node[data-id='n{N - 7}']")
    pane = page.locator(".canvas").first.bounding_box()
    seen = target.count() == 1 and target.bounding_box() is not None
    inside = seen and (lambda b: b["x"] >= pane["x"] and b["y"] >= pane["y"] and b["x"] + b["width"] <= pane["x"] + pane["width"] and b["y"] + b["height"] <= pane["y"] + pane["height"])(target.bounding_box())
    check("find: the card found is on screen as a card, picked", inside and "picked" in (target.get_attribute("class") or ""), f"scale {view()[2]:.2f}")
    page.keyboard.press("Escape"); page.wait_for_timeout(300)

    # ---- near: n0 found and framed, which is reading size.
    page.keyboard.press("Control+f"); page.wait_for_timeout(400)
    page.keyboard.type("card 0"); page.wait_for_timeout(400); page.keyboard.press("Enter"); page.wait_for_timeout(1500)
    page.keyboard.press("Escape"); page.wait_for_timeout(500)
    empty()
    hands("near")

    # ---- crossing 0.35 both ways, n0 picked, every frame sampled.
    f = page.evaluate(FILE); n0 = node(f, "n0")
    page.mouse.click(*screen(n0["x"] + 125, n0["y"] + 30)); page.wait_for_timeout(400)
    page.evaluate("""() => {
      window.__blank = []; window.__frames = 0
      const tick = () => {
        window.__frames++
        const cards = document.querySelectorAll('.canvas .node').length
        const far = document.querySelector('canvas[data-far]')
        let painted = false
        if (far && far.width > 1) {
          const c = far.getContext('2d'); const w = far.width, h = far.height
          for (let i = 1; i < 12 && !painted; i++) for (let j = 1; j < 12 && !painted; j++) {
            if (c.getImageData(Math.floor(w * i / 12), Math.floor(h * j / 12), 1, 1).data[3] > 0) painted = true
          }
        }
        if (!cards && !painted) window.__blank.push({ frame: window.__frames, far: !!far })
        if (window.__watching) requestAnimationFrame(tick)
      }
      window.__watching = true; requestAnimationFrame(tick)
    }""")
    x, y = screen(n0["x"] + 125, n0["y"] + 30); page.mouse.move(x, y)
    crossed = []
    for direction, until in [(120, lambda s: s < 0.15), (-120, lambda s: s >= 1)]:
        page.keyboard.down("Control")
        for _ in range(300):
            s = view()[2]
            if until(s): break
            page.mouse.wheel(0, direction); page.wait_for_timeout(30)
            crossed.append((round(view()[2], 3), far(), page.locator(".canvas .frame").count()))
        page.keyboard.up("Control"); page.wait_for_timeout(600)
    page.evaluate("() => { window.__watching = false }")
    blank = page.evaluate("window.__blank"); frames = page.evaluate("window.__frames")
    modes = sorted(set((c[1]) for c in crossed))
    check("crossing 0.35: both ways drawn as boxes and as cards", modes == [False, True], crossed[::10])
    check("crossing 0.35: no frame with nothing drawn", not blank, f"{len(blank)} of {frames} frames blank {blank[:5]}")
    check("crossing 0.35: the pick kept the whole way", all(c[2] == 1 for c in crossed), [c for c in crossed if c[2] != 1][:5])
    page.keyboard.press("Delete"); page.wait_for_timeout(1500)
    f = page.evaluate(FILE)
    check("crossing 0.35: it is still that card that is picked", not any(n["id"] == "n0" for n in f["nodes"]) and len(f["nodes"]) == N + 2, len(f["nodes"]))
    # Export and print last, far away again: a print's frame keeps the keyboard in a
    # browser with no dialog to close.
    page.mouse.move(800, 500); page.keyboard.down("Control")
    for _ in range(300):
        if far(): break
        page.mouse.wheel(0, 120); page.wait_for_timeout(25)
    page.keyboard.up("Control"); page.wait_for_timeout(1000)
    check("export: from far away", far())
    # Export and print, from far away.
    page.evaluate("() => { window.__frames = []; new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.tagName === 'IFRAME') window.__frames.push(n) }).observe(document.body, { childList: true, subtree: true }) }")
    for kind, call in [("svg", "exportCanvasSvg"), ("png", "exportCanvasPng")]:
        with page.expect_download(timeout=60000) as got:
            page.evaluate(f"""async () => {{ const {{ workspace }} = await import('/src/lib/workspace.svelte.ts'); const tab = workspace.tabs.find((one) => one.id === workspace.activeTabId); const d = await import('/src/lib/export/drawing.ts'); const p = await import('/src/lib/canvas/picture.ts'); await p.{call}(d.drawingOf({{ text: tab.note.text, name: 'Board', path: null, root: null }})) }}""")
        path = got.value.path(); data = open(path, "rb").read()
        if kind == "svg":
            text = data.decode("utf8", "replace")
            check("export SVG: every card in it", text.count("card ") >= N - 1 and f"card {N-1}" in text, f"{len(data)} bytes")
        else:
            check("export PNG: a picture", data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 10000, f"{len(data)} bytes")
    for kind, call in [("print", "printCanvas"), ("pdf", "exportCanvasPdf")]:
        page.evaluate("() => { window.__frames = [] }")
        page.evaluate(f"""async () => {{ const {{ workspace }} = await import('/src/lib/workspace.svelte.ts'); const tab = workspace.tabs.find((one) => one.id === workspace.activeTabId); const d = await import('/src/lib/export/drawing.ts'); const p = await import('/src/lib/canvas/picture.ts'); void p.{call}(d.drawingOf({{ text: tab.note.text, name: 'Board', path: null, root: null }})) }}""")
        page.wait_for_timeout(4000)
        sheet = page.evaluate("() => window.__frames.map((one) => { try { return one.contentDocument?.documentElement?.outerHTML ?? one.srcdoc ?? '' } catch { return one.srcdoc ?? '' } }).join('')")
        check(f"{kind}: the sheet holds the plane", sheet.count("card ") >= N - 1, f"{len(sheet)} chars")

    print(json.dumps({"passed": sum(1 for r in results if r[1]), "failed": [r[0] for r in results if not r[1]]}))
    browser.close()
