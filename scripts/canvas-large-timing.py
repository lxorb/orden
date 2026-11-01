"""#535: how long a large canvas holds the main thread, in Chromium, on the web build.

The longest task and the sum of long tasks for opening a plane of N cards, Ctrl+A, one
arrow-key nudge of everything, deleting everything and undoing that - framed whole, or
with `near`, zoomed in to reading size first - and what the file says after each, so a
step that did nothing cannot pass for a fast one. With a profile prefix, a CPU profile
of each step beside it.

Run against the web build under Vite's dev server, which serves the app's own modules
by path so the drive can make a plane through them:

    pnpm --filter @orden/desktop exec vite --port 5535 --strictPort --host 127.0.0.1
    python3 scripts/canvas-large-timing.py <cards> [profile prefix] [near]

with Playwright's Chromium (the drives ran it headless in Playwright's own image, on
the host's network). A Vite that has reloaded a module since the page last loaded hands
it out under another address, and the drive then makes its plane in a second copy of
the workspace nobody sees: start the server again after an edit.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

N = int(sys.argv[1])
PROFILE = sys.argv[2] if len(sys.argv) > 2 else None

MAKE = """async (n) => {
  const f = await import('/src/lib/canvas/format.ts')
  const nodes = [], edges = []
  const side = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    nodes.push({ id: 'n' + i, type: 'text', text: 'card ' + i, x: (i % side) * 300, y: Math.floor(i / side) * 120, width: 250, height: 60 })
    if (i > 0) edges.push({ id: 'e' + i, fromNode: 'n' + (i - 1), toNode: 'n' + i })
  }
  const text = f.writeCanvas({ ...f.readCanvas('{}'), nodes, edges })
  const { workspace } = await import('/src/lib/workspace.svelte.ts')
  window.__long = []
  workspace.openUnsaved('canvas', text)
  return text.length
}"""

def settle(page, quiet=1.5, most=60):
    """Waits until no long task for `quiet` seconds; answers the long tasks since."""
    start = time.time()
    seen = -1
    still = time.time()
    while time.time() - start < most:
        count = page.evaluate("window.__long.length")
        if count != seen:
            seen, still = count, time.time()
        elif time.time() - still > quiet:
            break
        time.sleep(0.1)
    tasks = page.evaluate("window.__long.splice(0)")
    return (max(tasks) if tasks else 0, sum(tasks), len(tasks))

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.on("console", lambda m: print("CONSOLE", m.type, m.text[:300]) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:400]))
    page.goto("http://127.0.0.1:5535/", wait_until="load")
    page.wait_for_timeout(6000)
    page.evaluate("""() => { window.__long = []; new PerformanceObserver((list) => { for (const one of list.getEntries()) window.__long.push(Math.round(one.duration)) }).observe({ type: 'longtask' }) }""")
    cdp = page.context.new_cdp_session(page) if PROFILE else None
    def start():
        if cdp:
            cdp.send("Profiler.enable"); cdp.send("Profiler.setSamplingInterval", {"interval": 200}); cdp.send("Profiler.start")
    def stop(name):
        if cdp:
            json.dump(cdp.send("Profiler.stop")["profile"], open(f"{PROFILE}-{name.replace(' ', '_')}.cpuprofile", "w"))
    start()
    size = page.evaluate(MAKE, N)
    out = {"cards": N, "bytes": size}
    out["open"] = settle(page, most=120)
    stop("open")
    plane = page.locator(".canvas").first
    plane.wait_for(timeout=60000)
    box = plane.bounding_box()
    page.mouse.click(box["x"] + 5, box["y"] + box["height"] - 5)
    settle(page, 0.5)
    if "near" in sys.argv:
        # Zoomed in to reading size over the middle of the plane, Ctrl and the wheel.
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        scale = lambda: page.evaluate("Number(/scale\\(([0-9.e-]+)\\)/.exec(document.querySelector('.canvas .plane').style.transform)?.[1] ?? 0)")
        page.keyboard.down("Control")
        for _ in range(200):
            if scale() >= 1: break
            page.mouse.wheel(0, -120)
            page.wait_for_timeout(30)
        page.keyboard.up("Control")
        settle(page, 1.0, most=60)
        out["scale"] = round(scale(), 2)
        out["zoom cards"] = page.evaluate("document.querySelectorAll('.canvas .node').length")
    for name, keys in [("select all", "Control+a"), ("arrow move", "ArrowRight"), ("delete all", "Delete"), ("undo delete", "Control+z")]:
        start()
        page.keyboard.press(keys)
        out[name] = settle(page, most=120)
        stop(name)
        page.wait_for_timeout(1500)
        out[name + " state"] = page.evaluate("""async () => {
          const { workspace } = await import('/src/lib/workspace.svelte.ts')
          const tab = workspace.tabs.find((one) => one.id === workspace.activeTabId)
          let cards = null, xs = null
          try { const file = JSON.parse(tab.note.text); cards = file.nodes.length; xs = file.nodes[0]?.x } catch {}
          return { frame: !!document.querySelector('.canvas .frame'), cards, x0: xs }
        }""")
    out["cards after"] = page.evaluate("document.querySelectorAll('.canvas .node, .canvas [data-node]').length")
    print(json.dumps(out))
    browser.close()
