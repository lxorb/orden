from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

CLOCK = """
() => {
  let now = performance.now()
  let waiting = new Map()
  let next = 1
  performance.now = () => now
  window.requestAnimationFrame = (run) => { waiting.set(next, run); return next++ }
  window.cancelAnimationFrame = (id) => waiting.delete(id)
  window.__frame = () => {
    now += 1000 / 60
    const due = waiting
    waiting = new Map()
    for (const run of due.values()) run(now)
  }
}
"""

OVERLAPS = """
() => {
  const boxes = [...document.querySelectorAll('.window')].map((one) => [one.getAttribute('aria-label'), one.getBoundingClientRect()])
  const out = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [an, a] = boxes[i]
    const [bn, b] = boxes[j]
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    if (w > 1 && h > 1) out.push(`${an} on ${bn}`)
  }
  return out
}
"""

BLANK = """
() => {
  const ws = window.ordenApp.workspace
  const out = []
  for (const pane of ws.panes.all) {
    const node = document.querySelector(`[data-pane="${pane.id}"]`)
    const tab = ws.tabs.find((one) => one.id === pane.activeTabId)
    const window = [...document.querySelectorAll('.window')].find((one) => one.getAttribute('aria-label') === tab?.shown)
    if (!node || !window || !node.style.transform) continue
    const shown = node.getBoundingClientRect()
    const at = window.getBoundingClientRect()
    if (shown.bottom < at.bottom - 1.5) out.push(`${tab.shown}: ${(at.bottom - shown.bottom).toFixed(1)}px of its window shows nothing`)
  }
  return out
}
"""

BARS = """
() => {
  const bar = document.querySelector('header[data-chrome="top"]')
  const box = bar.getBoundingClientRect()
  const out = []
  const ground = getComputedStyle(bar).backgroundColor
  const parts = (/\\(([^)]*)\\)/.exec(ground)?.[1] ?? '').split(/[ ,\\/]+/).filter(Boolean)
  const alpha = ground === 'transparent' ? 0 : ground.includes('/') || ground.startsWith('rgba') ? Number(parts[parts.length - 1]) : 1
  if (alpha > 0.01) out.push(`the bar is not see-through: ${ground}`)
  for (const one of document.querySelectorAll('.canvas *, .under')) {
    const style = getComputedStyle(one)
    const blur = style.backdropFilter || style.webkitBackdropFilter
    if (blur && blur !== 'none') out.push(`${one.className} blurs what lies behind it`)
  }
  for (const one of document.querySelectorAll('.canvas .top button, .canvas .top [role=combobox]')) {
    const at = one.getBoundingClientRect()
    if (at.width && (at.top < box.top - 1 || at.bottom > box.bottom + 1)) out.push(`${one.textContent.trim()} lies outside the bar`)
  }
  const under = document.querySelector('.under')
  if (under && getComputedStyle(under).clipPath !== 'none') out.push('the bubbles are cut at the bar')
  return out
}
"""

CORNERS = """
() => {
  const ws = window.ordenApp.workspace
  const node = document.querySelector(`[data-pane="${ws.panes.all[0].id}"]`)
  const style = getComputedStyle(node)
  const own = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((one) => parseFloat(one) || 0)
  const clip = node.style.clipPath
  if (!clip) return own
  const scale = Number(/scale\\(([-\\d.e]+)\\)/.exec(node.style.transform)?.[1] ?? 1)
  const round = /round (.*)\\)$/.exec(clip)?.[1]
  if (!round) return [0, 0, 0, 0]
  const radii = round.split(' ').map((one) => parseFloat(one) * scale)
  while (radii.length < 4) radii.push(radii[radii.length % Math.max(1, radii.length)] ?? radii[0])
  return radii
}
"""

def toggle(page: Page) -> None:
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")

def opened(page: Page) -> None:
    toggle(page)
    wait_for(page, "document.querySelector('.canvas')", "the overview")
    wait_for(page, "Number(document.querySelector('.canvas .top')?.style.getPropertyValue('--overview-open')) >= 0.99", "the overview open")
    before = None
    for _ in range(40):
        page.wait_for_timeout(150)
        now = page.evaluate("() => [...document.querySelectorAll('.window')].map((one) => one.style.transform).join()")
        if now == before:
            break
        before = now

def closed(page: Page) -> None:
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.canvas')", "the overview gone")
    page.wait_for_timeout(600)

def blank(page: Page, *names: str) -> None:
    page.evaluate(
        """async (names) => {
          const ws = window.ordenApp.workspace
          for (const name of names) ws.openBlank(name, '# ' + name + '\\n\\n' + 'words\\n\\n'.repeat(20))
          await new Promise((go) => setTimeout(go, 400))
        }""",
        list(names),
    )

def apart(page: Page, label: str) -> None:
    laps = page.evaluate(OVERLAPS)
    if laps:
        wrong(f"[{label}] windows lie on each other: {', '.join(laps)}")
        shot(page, f"{label}-overlap")
    else:
        say(f"ok   [{label}] {page.evaluate('document.querySelectorAll(\".window\").length')} windows, none on another")
    empty = page.evaluate(BLANK)
    if empty:
        wrong(f"[{label}] {'; '.join(empty)}")
        shot(page, f"{label}-blank")
    else:
        say(f"ok   [{label}] every pane fills its window")

def overlapping(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 800})
    DRIVE.open(page)
    blank(page, "One", "Two", "Three")
    page.evaluate("() => window.ordenApp.workspace.split('row')")
    page.wait_for_timeout(500)
    blank(page, *[f"New{i}" for i in range(5)])
    opened(page)
    apart(page, "split")
    for one in (page.locator(".window").nth(1), page.locator(".window.is-front")):
        win = one.bounding_box()
        assert win
        page.mouse.move(win["x"] + win["width"] / 2, win["y"] + win["height"] / 2)
        page.mouse.down()
        page.mouse.move(win["x"] + win["width"] / 2 + 150, win["y"] + win["height"] / 2 + 60, steps=10)
        page.mouse.up()
        page.wait_for_timeout(800)
    closed(page)
    blank(page, *[f"More{i}" for i in range(6)])
    opened(page)
    apart(page, "kept-then-new")
    shot(page, "kept-then-new")
    closed(page)
    page.set_viewport_size({"width": 1500, "height": 620})
    page.wait_for_timeout(500)
    opened(page)
    apart(page, "reshaped")
    bars = page.evaluate(BARS)
    shot(page, "one-bar")
    if bars:
        wrong(f"[bar] {'; '.join(bars)}")
    else:
        say("ok   [bar] one see-through bar holds the buttons, nothing blurred, the bubbles run under it")
    page.mouse.move(750, 400)
    for _ in range(40):
        page.mouse.wheel(0, 240)
        page.wait_for_timeout(30)
    page.wait_for_timeout(1200)
    zoom = page.evaluate("() => Number(/scale\\(([-\\d.e]+)\\)/.exec(document.querySelector('.world').style.transform)?.[1])")
    if zoom > 0.2 / 1.25:
        wrong(f"[zoom] zooms out no further than {zoom:.3f}")
    else:
        say(f"ok   [zoom] zooms out to {zoom:.3f}")
    shot(page, "farthest")
    closed(page)
    page.close()

def cornered(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 800})
    DRIVE.open(page)
    page.evaluate("() => { window.ordenApp.modes.flushBottom = true }")
    blank(page, "One", "Two")
    page.wait_for_timeout(400)
    opened(page)
    closed(page)
    page.evaluate(CLOCK)
    for label, act in (("opening", lambda: toggle(page)), ("closing", lambda: page.keyboard.press("Escape"))):
        seen = [page.evaluate(CORNERS)]
        act()
        for _ in range(90):
            page.evaluate("() => window.__frame()")
            seen.append(page.evaluate(CORNERS))
        jumps = [
            f"frame {i}: {', '.join(f'{a:.1f}' for a in seen[i - 1])} to {', '.join(f'{b:.1f}' for b in seen[i])}"
            for i in range(1, len(seen))
            if max(abs(a - b) for a, b in zip(seen[i - 1], seen[i])) > 2.5
        ]
        if jumps:
            wrong(f"[{label}] a corner changes in one frame: {'; '.join(jumps[:3])}")
        else:
            say(f"ok   [{label}] the pane's corners turn with the flight: {seen[0]} to {seen[-1]}")
        for _ in range(60):
            page.evaluate("() => window.__frame()")
    page.close()

def drive(browser: Browser) -> None:
    overlapping(browser)
    cornered(browser)

if __name__ == "__main__":
    raise SystemExit(
        DRIVE.run(
            drive,
            "the overview's windows never lie on each other or show nothing, one see-through bar, further out, corners that turn",
        )
    )
